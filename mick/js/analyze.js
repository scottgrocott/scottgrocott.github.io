/* ═══════════════════════════════════════════════════════════════════════════
   analyze.js — Real-time MIDI stream feature extractor

   Collects a rolling window of MIDI events and extracts musical features
   every ANALYSIS_INTERVAL ms. Publishes results to registered listeners.

   Features extracted:
     bpm            estimated tempo from inter-onset intervals
     key            detected key root (0-11, C=0)
     mode           'major' | 'minor' | 'modal' | 'atonal'
     chordComplexity 0-1  (0=triads only, 1=extensions/alterations)
     noteDensity    notes per second (all channels combined)
     velocityRange  { min, max, mean } — dynamics profile
     channelActivity  Set of active channel indices
     hasBlueNotes   bool — b3, b5, b7 prominent
     hasSyncopation bool — notes landing on off-beats
     pitchClassVector  Float32Array(12) — normalised pitch class histogram
     intervalVector    Float32Array(13) — interval content 0-12 semitones
   ═══════════════════════════════════════════════════════════════════════════ */

import { detectChord } from './theory.js';

/* ─── CONFIG ─────────────────────────────────────────────────────────────── */
const WINDOW_MS       = 8000;   // rolling analysis window
const ANALYSIS_INTERVAL = 2500; // re-analyse every N ms
const MIN_EVENTS      = 8;      // minimum events before attempting analysis

/* ─── KRUMHANSL-SCHMUCKLER KEY PROFILES ─────────────────────────────────
   Major and minor probe tones (Krumhansl & Schmuckler 1990).
   Index 0 = C, 1 = C#, ... 11 = B.
   ─────────────────────────────────────────────────────────────────────── */
const KS_MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KS_MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

/* ─── EVENT BUFFER ───────────────────────────────────────────────────────
   Each event: { t, ch, midi, vel, type: 'on'|'off' }
   ─────────────────────────────────────────────────────────────────────── */
let events = [];
let listeners = [];
let intervalId = null;

/* ─── PUBLIC: FEED EVENTS ────────────────────────────────────────────── */
export function feedNoteOn(ch, midi, vel) {
  events.push({ t: performance.now(), ch, midi, vel, type: 'on' });
}

export function feedNoteOff(ch, midi) {
  events.push({ t: performance.now(), ch, midi, vel: 0, type: 'off' });
}

/* ─── PUBLIC: SUBSCRIBE / UNSUBSCRIBE ────────────────────────────────── */
export function onAnalysis(fn) {
  listeners.push(fn);
}

/* ─── START / STOP ───────────────────────────────────────────────────── */
export function startAnalysis() {
  if (intervalId) return;
  intervalId = setInterval(runAnalysis, ANALYSIS_INTERVAL);
}

export function stopAnalysis() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

/* ═══════════════════════════════════════════════════════════════════════
   CORE ANALYSIS
   ═══════════════════════════════════════════════════════════════════════ */
function runAnalysis() {
  const now    = performance.now();
  const cutoff = now - WINDOW_MS;

  // Trim old events
  events = events.filter(e => e.t >= cutoff);

  const noteOns = events.filter(e => e.type === 'on');
  if (noteOns.length < MIN_EVENTS) return;

  const features = {
    bpm:             estimateBPM(noteOns),
    ...detectKeyMode(noteOns),
    chordComplexity: measureChordComplexity(noteOns),
    noteDensity:     noteOns.length / (WINDOW_MS / 1000),
    velocityRange:   velocityStats(noteOns),
    channelActivity: new Set(noteOns.map(e => e.ch)),
    hasBlueNotes:    detectBlueNotes(noteOns),
    hasSyncopation:  detectSyncopation(noteOns),
    pitchClassVector: buildPCVector(noteOns),
    intervalVector:   buildIntervalVector(noteOns),
    eventCount:       noteOns.length,
  };

  listeners.forEach(fn => fn(features));
}

/* ─── BPM ESTIMATION ─────────────────────────────────────────────────
   Uses inter-onset intervals (IOI) between consecutive note-ons.
   Takes the median IOI, converts to BPM, then looks for a subdivision
   match (dotted, triplet, etc.) in the range 50-220 BPM.
   ─────────────────────────────────────────────────────────────────── */
function estimateBPM(noteOns) {
  if (noteOns.length < 4) return null;

  // Collect IOIs from all channels combined, sorted by time
  const times = noteOns.map(e => e.t).sort((a,b) => a-b);
  const iois  = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i-1];
    if (d > 30 && d < 3000) iois.push(d);  // filter outliers
  }
  if (iois.length < 3) return null;

  // Median IOI
  iois.sort((a,b) => a-b);
  const med = iois[Math.floor(iois.length / 2)];

  // Convert to BPM candidates (beat = 1, 2, 4 IOIs)
  const candidates = [
    60000 / med,
    60000 / (med * 2),
    60000 / (med * 0.5),
    60000 / (med * 4),
    60000 / (med * 1.5),   // triplet feel
  ];

  // Return the candidate in the most musical range
  for (const bpm of candidates) {
    if (bpm >= 50 && bpm <= 220) return Math.round(bpm);
  }
  return null;
}

/* ─── KEY / MODE DETECTION (Krumhansl-Schmuckler) ───────────────────
   Builds a pitch class histogram, correlates against all 24 key
   profiles (12 major + 12 minor). Returns best match + mode.
   ─────────────────────────────────────────────────────────────────── */
function detectKeyMode(noteOns) {
  const pcv = buildPCVector(noteOns);

  let bestR   = -Infinity;
  let bestKey = 0;
  let bestMode = 'major';

  for (let root = 0; root < 12; root++) {
    // Rotate the probe tone profile to match this root
    const majProfile = KS_MAJOR.map((_, i) => KS_MAJOR[(i - root + 12) % 12]);
    const minProfile = KS_MINOR.map((_, i) => KS_MINOR[(i - root + 12) % 12]);

    const rMaj = pearsonR(pcv, majProfile);
    const rMin = pearsonR(pcv, minProfile);

    if (rMaj > bestR) { bestR = rMaj; bestKey = root; bestMode = 'major'; }
    if (rMin > bestR) { bestR = rMin; bestKey = root; bestMode = 'minor'; }
  }

  // If best correlation is very weak → atonal / no clear key
  const mode = bestR < 0.3 ? 'atonal'
             : detectModalQuality(pcv, bestKey) || bestMode;

  return { key: bestKey, mode, keyConfidence: Math.max(0, bestR) };
}

/* ─── MODAL DETECTION ───────────────────────────────────────────────
   Checks if the pitch content better matches a modal scale
   (Dorian, Phrygian, Lydian, Mixolydian) than major/minor.
   ─────────────────────────────────────────────────────────────────── */
const MODAL_PROFILES = {
  dorian:     [1,0,1,1,0,1,0,1,0,1,1,0],
  phrygian:   [1,1,0,1,0,1,0,1,1,0,1,0],
  lydian:     [1,0,1,0,1,1,0,1,0,1,0,1],
  mixolydian: [1,0,1,0,1,1,0,1,0,1,1,0],
  pentatonic: [1,0,1,0,1,0,0,1,0,1,0,0],
  blues:      [1,0,0,1,0,1,1,1,0,0,1,0],
};

function detectModalQuality(pcv, root) {
  let bestMode = null;
  let bestR    = 0.55; // threshold — must beat this to claim modal

  for (const [modeName, profile] of Object.entries(MODAL_PROFILES)) {
    const rotated = profile.map((_, i) => profile[(i - root + 12) % 12]);
    const r       = pearsonR(pcv, rotated);
    if (r > bestR) { bestR = r; bestMode = modeName; }
  }
  return bestMode;
}

/* ─── CHORD COMPLEXITY ───────────────────────────────────────────────
   Looks at simultaneous note clusters, measures how many use
   extensions beyond basic triads.
   ─────────────────────────────────────────────────────────────────── */
function measureChordComplexity(noteOns) {
  // Group notes within 80ms windows as simultaneous
  const WINDOW = 80;
  const clusters = [];
  let i = 0;
  while (i < noteOns.length) {
    const cluster = [noteOns[i]];
    let j = i + 1;
    while (j < noteOns.length && noteOns[j].t - noteOns[i].t < WINDOW) {
      cluster.push(noteOns[j++]);
    }
    if (cluster.length >= 2) clusters.push(cluster.map(e => e.midi));
    i = j || i + 1;
  }

  if (!clusters.length) return 0;

  let complexCount = 0;
  for (const cluster of clusters) {
    const pcs  = [...new Set(cluster.map(m => m % 12))].sort((a,b)=>a-b);
    const label = detectChord(pcs);
    // Extension markers: 7, maj7, min7, m7b5, dim7, aug, sus
    if (/7|aug|sus|b5|#5|9|11|13/.test(label)) complexCount++;
  }

  return clusters.length > 0 ? complexCount / clusters.length : 0;
}

/* ─── VELOCITY STATS ─────────────────────────────────────────────── */
function velocityStats(noteOns) {
  const vels = noteOns.map(e => e.vel);
  const mean = vels.reduce((a,b) => a+b, 0) / vels.length;
  return {
    min:  Math.min(...vels),
    max:  Math.max(...vels),
    mean: Math.round(mean),
    range: Math.max(...vels) - Math.min(...vels),
  };
}

/* ─── BLUE NOTE DETECTION ───────────────────────────────────────────
   b3 (3), b5 (6), b7 (10) relative to detected key are "blue notes".
   Returns true if they appear frequently.
   ─────────────────────────────────────────────────────────────────── */
function detectBlueNotes(noteOns) {
  const pcv = buildPCVector(noteOns);
  // Blue notes relative to C (will work regardless of key by shape)
  const b3  = pcv[3];
  const b5  = pcv[6];
  const b7  = pcv[10];
  return (b3 + b5 + b7) / 3 > 0.06; // at least 6% blue note presence
}

/* ─── SYNCOPATION DETECTION ──────────────────────────────────────────
   Rough proxy: look at IOIs. If many are non-integer multiples of a
   grid unit, syncopation is likely.
   ─────────────────────────────────────────────────────────────────── */
function detectSyncopation(noteOns) {
  if (noteOns.length < 6) return false;
  const times = noteOns.map(e => e.t).sort((a,b) => a-b);
  const iois  = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i-1];
    if (d > 50 && d < 1000) iois.push(d);
  }
  if (iois.length < 4) return false;

  const median = iois.sort((a,b)=>a-b)[Math.floor(iois.length/2)];
  let offGrid = 0;
  for (const d of iois) {
    const ratio = d / median;
    const nearInt = Math.abs(ratio - Math.round(ratio));
    if (nearInt > 0.2) offGrid++;
  }
  return offGrid / iois.length > 0.35;
}

/* ─── PITCH CLASS VECTOR ─────────────────────────────────────────────
   Weighted by velocity, normalised to sum=1.
   ─────────────────────────────────────────────────────────────────── */
function buildPCVector(noteOns) {
  const pcv = new Float32Array(12);
  for (const e of noteOns) {
    pcv[e.midi % 12] += e.vel / 127;
  }
  const sum = pcv.reduce((a,b) => a+b, 0);
  if (sum > 0) for (let i = 0; i < 12; i++) pcv[i] /= sum;
  return pcv;
}

/* ─── INTERVAL VECTOR ────────────────────────────────────────────────
   All pairwise semitone intervals between simultaneous note clusters.
   ─────────────────────────────────────────────────────────────────── */
function buildIntervalVector(noteOns) {
  const iv = new Float32Array(13);
  const midis = noteOns.map(e => e.midi % 12);
  let count = 0;
  for (let i = 0; i < midis.length; i++) {
    for (let j = i+1; j < Math.min(i+8, midis.length); j++) {
      const interval = Math.abs(midis[i] - midis[j]) % 12;
      iv[interval]++;
      count++;
    }
  }
  if (count > 0) for (let i = 0; i < 13; i++) iv[i] /= count;
  return iv;
}

/* ─── PEARSON CORRELATION ─────────────────────────────────────────── */
function pearsonR(a, b) {
  const n   = a.length;
  const mA  = a.reduce((s,v)=>s+v,0) / n;
  const mB  = b.reduce((s,v)=>s+v,0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - mA;
    const db = b[i] - mB;
    num += da * db;
    dA  += da * da;
    dB  += db * db;
  }
  const denom = Math.sqrt(dA * dB);
  return denom < 1e-10 ? 0 : num / denom;
}