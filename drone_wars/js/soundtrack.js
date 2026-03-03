// ============================================================
//  soundtrack.js — Contextual adaptive music system
//
//  Three zones crossfaded by player position:
//    PEAK    — eerie mountain ambience (birds, coyotes, jaw harp)
//    CANYON  — Morricone spaghetti-western (twang, harmonica, whip)
//    FACTORY — industrial urgency (kick, bass, metallic clanks)
//
//  Key scheduling rules that prevent the Tone.js
//  "start time must be strictly greater" error:
//    1. Tone.Sequence values use null for rests — Tone skips nulls
//       so callbacks only fire on non-null steps, never on every step.
//    2. All triggerAttackRelease calls are wrapped in try/catch.
//    3. Sequences are started with small staggered offsets (not all at 0)
//       so they don't all fire simultaneously when the Transport is
//       already running.
//    4. Random-chance loops use `'+0.01'` relative offset instead of
//       the raw `time` arg when the Transport may already be past that point.
// ============================================================

import { terrainProfile } from './world.js';

const MASTER_VOL = -6;
const XFADE_TIME = 4.0;
const TICK_RATE  = 2.0;
const BPM        = 52;

const ZONE = { PEAK: 'peak', CANYON: 'canyon', FACTORY: 'factory', NONE: 'none' };

let _ready       = false;
let _currentZone = ZONE.NONE;
let _tickTimer   = 0;
const _layers    = {};

// ============================================================
//  PUBLIC API
// ============================================================

export function initSoundtrack() {
  try {
    Tone.getTransport().bpm.value = BPM;

    const master = new Tone.Volume(MASTER_VOL).toDestination();

    _layers[ZONE.PEAK]    = _buildPeakLayer(master);
    _layers[ZONE.CANYON]  = _buildCanyonLayer(master);
    _layers[ZONE.FACTORY] = _buildFactoryLayer(master);

    for (const z of Object.values(ZONE)) {
      if (_layers[z]) _layers[z].vol.volume.value = -Infinity;
    }

    Tone.getTransport().start();
    _ready = true;
    console.info('[soundtrack] Initialised. BPM:', BPM);
  } catch (e) {
    console.warn('[soundtrack] Init failed:', e);
  }
}

export function tickSoundtrack(playerPos, dt) {
  if (!_ready) return;
  _tickTimer += dt;
  if (_tickTimer < TICK_RATE) return;
  _tickTimer = 0;

  const zone = _resolveZone(playerPos);
  if (zone !== _currentZone) {
    console.info(`[soundtrack] Zone: ${_currentZone} → ${zone}`);
    _crossfadeTo(zone);
    _currentZone = zone;
  }
}

// ============================================================
//  ZONE RESOLVER
// ============================================================

function _resolveZone(pos) {
  if (!terrainProfile.ready) return ZONE.CANYON;

  const dx = pos.x - terrainProfile.centre.x;
  const dz = pos.z - terrainProfile.centre.z;
  if (Math.sqrt(dx * dx + dz * dz) < terrainProfile.factoryRadius) return ZONE.FACTORY;

  if (pos.y >= terrainProfile.peakThreshold)   return ZONE.PEAK;
  if (pos.y <= terrainProfile.canyonThreshold) return ZONE.CANYON;

  return _currentZone === ZONE.NONE ? ZONE.CANYON : _currentZone;
}

// ============================================================
//  CROSSFADE
// ============================================================

function _crossfadeTo(newZone) {
  for (const [z, layer] of Object.entries(_layers)) {
    layer.vol.volume.rampTo(z === newZone ? 0 : -Infinity, XFADE_TIME);
  }
}

// ============================================================
//  Safe trigger wrapper — prevents uncaught scheduling errors
// ============================================================
function _trig(instrument, note, dur, time) {
  try { instrument.triggerAttackRelease(note, dur, time); } catch (_) {}
}
function _trigEnv(env, dur, time) {
  try { env.triggerAttackRelease(dur, time); } catch (_) {}
}

// ============================================================
//  LAYER BUILDERS
// ============================================================

// ---- PEAK — sparse, eerie mountain ambience ----
function _buildPeakLayer(master) {
  const vol = new Tone.Volume(-Infinity);
  vol.connect(master);

  // Wind texture
  const windNoise  = new Tone.Noise('pink').start();
  const windFilter = new Tone.Filter({ frequency: 1200, type: 'bandpass', Q: 0.6 });
  const windVol    = new Tone.Volume(-32);
  windNoise.connect(windFilter); windFilter.connect(windVol); windVol.connect(vol);

  // Jaw harp
  const jawHarp = new Tone.FMSynth({
    harmonicity: 3.5, modulationIndex: 12,
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.05, release: 1.2 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.5 },
  });
  const jawVerb = new Tone.Reverb({ decay: 4, wet: 0.7 });
  const jawVol  = new Tone.Volume(-14);
  jawHarp.connect(jawVerb); jawVerb.connect(jawVol); jawVol.connect(vol);

  // Harmonica
  const harpSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.3, decay: 0.1, sustain: 0.8, release: 1.5 },
  });
  const harpVib  = new Tone.Vibrato({ frequency: 4.5, depth: 0.12 });
  const harpVerb = new Tone.Reverb({ decay: 6, wet: 0.5 });
  const harpVol  = new Tone.Volume(-20);
  harpSynth.connect(harpVib); harpVib.connect(harpVerb); harpVerb.connect(harpVol); harpVol.connect(vol);

  // Owl noise burst
  const owlNoise = new Tone.Noise('white');
  const owlEnv   = new Tone.AmplitudeEnvelope({ attack: 0.02, decay: 0.3, sustain: 0, release: 0.8 });
  const owlFilt  = new Tone.Filter({ frequency: 700, type: 'bandpass', Q: 8 });
  const owlVerb  = new Tone.Reverb({ decay: 5, wet: 0.8 });
  const owlVol   = new Tone.Volume(-18);
  owlNoise.connect(owlEnv); owlEnv.connect(owlFilt); owlFilt.connect(owlVerb); owlVerb.connect(owlVol); owlVol.connect(vol);
  owlNoise.start();

  // Coyote howl
  const coyoteSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.4, decay: 0.1, sustain: 0.7, release: 2.5 },
  });
  const coyoteVerb = new Tone.Reverb({ decay: 8, wet: 0.85 });
  const coyoteVol  = new Tone.Volume(-16);
  coyoteSynth.connect(coyoteVerb); coyoteVerb.connect(coyoteVol); coyoteVol.connect(vol);

  // ---- Loops (staggered starts, safe triggers) ----

  // Jaw harp plucks — fire on non-null sequence steps only
  const JAW_SEQ = ['A2', null, null, 'E2', null, null, null, 'D2', null, null, null, null, 'B2', null, null, null];
  const jawLoop = new Tone.Sequence((time, note) => {
    if (Math.random() > 0.6) return;
    _trig(jawHarp, note, '8n', time);
  }, JAW_SEQ, '4n');
  jawLoop.start('1m');

  // Harmonica sighs
  const HARP_CHORDS = [['A3','E4'], ['D3','A3'], ['G3','D4']];
  const harpLoop = new Tone.Loop(time => {
    if (Math.random() > 0.3) return;
    _trig(harpSynth, _pick(HARP_CHORDS), '2n', time);
  }, '4m');
  harpLoop.start('2m');

  // Owl stabs
  const owlLoop = new Tone.Loop(time => {
    if (Math.random() > 0.25) return;
    _trigEnv(owlEnv, '1n', time);
  }, '6m');
  owlLoop.start('1m');

  // Coyote howl
  const coyoteLoop = new Tone.Loop(time => {
    if (Math.random() > 0.2) return;
    const note = _pick(['A3', 'G3', 'E3']);
    _trig(coyoteSynth, note, '2n', time);
    try {
      coyoteSynth.frequency.rampTo(
        Tone.Frequency(note).transpose(7).toFrequency(), 0.8, '+0.4',
      );
    } catch (_) {}
  }, '8m');
  coyoteLoop.start('4m');

  return { vol };
}

// ---- CANYON — Morricone spaghetti-western ----
function _buildCanyonLayer(master) {
  const vol   = new Tone.Volume(-Infinity);
  vol.connect(master);
  const verb  = new Tone.Reverb({ decay: 5, wet: 0.35 });
  const delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 0.2 });
  verb.connect(vol); delay.connect(verb);

  // Twangy guitar
  const guitar     = new Tone.PluckSynth({ attackNoise: 2.5, dampening: 3800, resonance: 0.97 });
  const guitarDist = new Tone.Distortion(0.15);
  const guitarVol  = new Tone.Volume(-12);
  guitar.connect(guitarDist); guitarDist.connect(guitarVol); guitarVol.connect(delay);

  // Harmonica
  const harmonica = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.08, decay: 0.05, sustain: 0.9, release: 0.6 },
  });
  const harmoVib = new Tone.Vibrato({ frequency: 5, depth: 0.08 });
  const harmoVol = new Tone.Volume(-14);
  harmonica.connect(harmoVib); harmoVib.connect(harmoVol); harmoVol.connect(verb);

  // Trumpet
  const trumpet    = new Tone.Synth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.4 },
  });
  const trumpetVol = new Tone.Volume(-16);
  trumpet.connect(trumpetVol); trumpetVol.connect(verb);

  // Soprano whistle
  const whistle    = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.15, decay: 0.05, sustain: 0.8, release: 0.9 },
  });
  const whistleVib = new Tone.Vibrato({ frequency: 5.5, depth: 0.06 });
  const whistleVol = new Tone.Volume(-18);
  whistle.connect(whistleVib); whistleVib.connect(whistleVol); whistleVol.connect(verb);

  // Whip crack
  const whipNoise = new Tone.Noise('white');
  const whipEnv   = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 });
  const whipFilt  = new Tone.Filter({ frequency: 5000, type: 'highpass' });
  const whipVol   = new Tone.Volume(-10);
  whipNoise.connect(whipEnv); whipEnv.connect(whipFilt); whipFilt.connect(whipVol); whipVol.connect(vol);
  whipNoise.start();

  // Tick watch
  const tickOsc = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
  });
  const tickVol = new Tone.Volume(-24);
  tickOsc.connect(tickVol); tickVol.connect(vol);

  // Jaw harp drone
  const jDrone = new Tone.FMSynth({
    harmonicity: 4, modulationIndex: 8,
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.5, decay: 0.2, sustain: 0.6, release: 2 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.1, decay: 0.1, sustain: 0.3, release: 1 },
  });
  const jDroneVol = new Tone.Volume(-22);
  jDrone.connect(jDroneVol); jDroneVol.connect(delay);

  // ---- Guitar ostinato — Am pentatonic, null = rest (Tone skips nulls) ----
  const TWANG = ['A2', null, 'E3', null, 'A2', 'C3', null, 'E3'];
  const twangLoop = new Tone.Sequence((time, note) => {
    _trig(guitar, note, '16n', time);
  }, TWANG, '8n');
  twangLoop.start('1n');   // staggered — not at t=0

  // Tick — every 16th, slight stagger
  const tickLoop = new Tone.Sequence((time, val) => {
    _trig(tickOsc, 'C6', '32n', time);
  }, ['C6', null, 'C6', null, 'C6', null, 'C6', null], '8n');
  tickLoop.start('2n');

  // Harmonica phrase
  const HARMO_PHRASES = [
    [['A4','2n'], ['G4','4n'], ['E4','2n'], [null,'4n']],
    [['E4','4n'], ['D4','8n'], ['C4','4n'], ['A3','2n']],
    [['A4','2n.'], ['B4','8n'], ['G4','2n']],
  ];
  let phraseIdx = 0;
  const harmoLoop = new Tone.Loop(time => {
    const phrase = HARMO_PHRASES[phraseIdx % HARMO_PHRASES.length];
    let offset = 0;
    for (const [note, dur] of phrase) {
      if (note) _trig(harmonica, [note], dur, time + offset);
      try { offset += Tone.Time(dur).toSeconds(); } catch (_) {}
    }
    phraseIdx++;
  }, '2m');
  harmoLoop.start('1m');

  // Whistle melody
  const WHISTLE_PHRASES = [
    ['E5', 'D5', 'C5', 'A4'],
    ['A4', 'B4', 'C5', 'B4', 'A4'],
  ];
  let wIdx = 0;
  const whistleLoop = new Tone.Loop(time => {
    if (Math.random() > 0.5) return;
    const phrase = WHISTLE_PHRASES[wIdx % WHISTLE_PHRASES.length];
    let off = 0;
    const step = Tone.Time('4n').toSeconds();
    for (const note of phrase) {
      _trig(whistle, note, '4n', time + off);
      off += step * (0.9 + Math.random() * 0.3);
    }
    wIdx++;
  }, '4m');
  whistleLoop.start('2m');

  // Trumpet stab
  const trumpetLoop = new Tone.Loop(time => {
    if (Math.random() > 0.35) return;
    _trig(trumpet, _pick(['A4','E5','C5','G4']), '8n', time);
  }, '2m');
  trumpetLoop.start('3m');

  // Whip crack
  const whipLoop = new Tone.Loop(time => {
    if (Math.random() > 0.3) return;
    _trigEnv(whipEnv, '16n', time);
  }, '3m');
  whipLoop.start('1m');

  // Jaw harp drone
  const jDroneLoop = new Tone.Loop(time => {
    if (Math.random() > 0.4) return;
    _trig(jDrone, 'A2', '2n', time);
  }, '4m');
  jDroneLoop.start('4n');

  return { vol };
}

// ---- FACTORY — industrial urgency ----
function _buildFactoryLayer(master) {
  const vol = new Tone.Volume(-Infinity);
  vol.connect(master);

  // Kick
  const kick    = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 } });
  const kickVol = new Tone.Volume(-8);
  kick.connect(kickVol); kickVol.connect(vol);

  // Snare
  const snareNoise = new Tone.Noise('white');
  const snareEnv   = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.18, sustain: 0, release: 0.1 });
  const snareFilt  = new Tone.Filter({ frequency: 2500, type: 'bandpass', Q: 0.8 });
  const snareVol   = new Tone.Volume(-14);
  snareNoise.connect(snareEnv); snareEnv.connect(snareFilt); snareFilt.connect(snareVol); snareVol.connect(vol);
  snareNoise.start();

  // Metallic clank
  const clankNoise = new Tone.Noise('white');
  const clankEnv   = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.08, sustain: 0, release: 0.06 });
  const clankFilt  = new Tone.Filter({ frequency: 7000, type: 'highpass' });
  const clankVol   = new Tone.Volume(-18);
  clankNoise.connect(clankEnv); clankEnv.connect(clankFilt); clankFilt.connect(clankVol); clankVol.connect(vol);
  clankNoise.start();

  // Distorted bass
  const bass       = new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.2 } });
  const bassDist   = new Tone.Distortion(0.7);
  const bassFilter = new Tone.Filter({ frequency: 400, type: 'lowpass' });
  const bassVol    = new Tone.Volume(-14);
  bass.connect(bassDist); bassDist.connect(bassFilter); bassFilter.connect(bassVol); bassVol.connect(vol);

  // Sweep noise
  const sweepNoise  = new Tone.Noise('brown');
  const sweepFilter = new Tone.Filter({ frequency: 200, type: 'lowpass' });
  const sweepVol    = new Tone.Volume(-28);
  sweepNoise.connect(sweepFilter); sweepFilter.connect(sweepVol); sweepVol.connect(vol);
  sweepNoise.start();

  // Mechanical buzz
  const buzz     = new Tone.Oscillator({ type: 'square', frequency: 60 });
  const buzzDist = new Tone.Distortion(0.9);
  const buzzFilt = new Tone.Filter({ frequency: 300, type: 'lowpass' });
  const buzzVol  = new Tone.Volume(-26);
  buzz.connect(buzzDist); buzzDist.connect(buzzFilt); buzzFilt.connect(buzzVol); buzzVol.connect(vol);
  buzz.start();

  // Stab synth
  const stab     = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.3 } });
  const stabVerb = new Tone.Reverb({ decay: 1.5, wet: 0.2 });
  const stabVol  = new Tone.Volume(-18);
  stab.connect(stabVerb); stabVerb.connect(stabVol); stabVol.connect(vol);

  // ---- Sequences — null = rest, Tone skips null entries ----

  // Kick: hits on beats 1 and 3 only (null elsewhere = silence)
  const KICK_PAT = ['C1', null, null, null, null, null, null, null, 'C1', null, null, null, null, null, null, null];
  const kickLoop = new Tone.Sequence((time, note) => {
    _trig(kick, note, '8n', time);
  }, KICK_PAT, '16n');
  kickLoop.start('1n');

  // Snare: beats 2 and 4
  const SNARE_PAT = [null, null, null, null, 'x', null, null, null, null, null, null, null, 'x', null, null, null];
  const snareLoop = new Tone.Sequence((time) => {
    _trigEnv(snareEnv, '8n', time);
  }, SNARE_PAT, '16n');
  snareLoop.start('1n');

  // Clank: syncopated accents
  const CLANK_PAT = ['x', null, 'x', null, null, 'x', null, null, 'x', null, null, 'x', null, null, 'x', null];
  const clankLoop = new Tone.Sequence((time) => {
    if (Math.random() > 0.5) return;
    _trigEnv(clankEnv, '16n', time);
  }, CLANK_PAT, '16n');
  clankLoop.start('2n');

  // Bass pattern — E Phrygian riff, null = rest
  const BASS_PAT = ['E1', null, 'E1', 'F1', null, 'E1', null, 'D#1', 'E1', null, 'E1', 'G1', 'F1', null, 'E1', null];
  const bassLoop = new Tone.Sequence((time, note) => {
    _trig(bass, note, '16n', time);
  }, BASS_PAT, '16n');
  bassLoop.start('1n');

  // Sweep riser every 8 bars
  const sweepLoop = new Tone.Loop(time => {
    try {
      sweepFilter.frequency.rampTo(80, 0, time);
      sweepFilter.frequency.rampTo(4000, Tone.Time('8m').toSeconds(), time);
      sweepVol.volume.rampTo(-14, Tone.Time('6m').toSeconds(), time);
    } catch (_) {}
  }, '8m');
  sweepLoop.start('2m');

  // Dissonant stabs
  const STAB_CHORDS = [['E3','F3','A#3'], ['D3','G#3','B3'], ['E3','A3','C4']];
  let stabIdx = 0;
  const stabLoop = new Tone.Loop(time => {
    if (Math.random() > 0.6) return;
    _trig(stab, STAB_CHORDS[stabIdx % STAB_CHORDS.length], '8n', time);
    stabIdx++;
  }, '1m');
  stabLoop.start('2m');

  return { vol };
}

// ============================================================
//  Utility
// ============================================================
function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }