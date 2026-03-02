// ============================================================
//  soundtrack.js — Contextual adaptive music system
//
//  Three zones, each a self-contained Tone.js layer:
//
//  PEAK    — mountain top ambience: sparse, eerie, wind-driven.
//            Distant bird calls, coyote howls, owl stabs,
//            lone jaw harp, occasional harmonica sigh.
//
//  CANYON  — Morricone / Sergio Leone spaghetti-western odyssey.
//            Gritty twang guitar, mournful harmonica, whip-crack
//            percussion, mariachi trumpet stabs, ghostly soprano
//            whistle, slow arpeggiated tension ostinato.
//
//  FACTORY — Industrial urgency. Heavy kick/snare grid,
//            distorted sawtooth bass, metallic clanks,
//            tension-riser sweeps, mechanical pulse.
//
//  Zone is evaluated each frame via tickSoundtrack(playerPos).
//  Transitions crossfade over XFADE_TIME seconds — no hard cuts.
//  Each layer runs on its own Tone.Transport loop so timing is
//  always locked to musical bars, never interrupted by crossfades.
//
//  Call initSoundtrack() once after Tone.start() resolves.
// ============================================================

import { terrainProfile } from './world.js';

// ---- Master config ----
const MASTER_VOL   = -6;    // dB
const XFADE_TIME   = 4.0;   // seconds — crossfade duration between zones
const TICK_RATE    = 2.0;   // seconds — how often zone is re-evaluated
const BPM          = 52;    // slow, cinematic pulse used by canyon + factory

// Zone IDs
const ZONE = { PEAK: 'peak', CANYON: 'canyon', FACTORY: 'factory', NONE: 'none' };

// ---- Module state ----
let _ready       = false;
let _currentZone = ZONE.NONE;
let _tickTimer   = 0;

// Each layer: { vol: Tone.Volume, active: bool, transport: Tone.Transport-ish }
const _layers = {};

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

    // Start all layers silent — crossfade logic brings them up
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

/**
 * Call once per game frame from the render loop.
 * @param {{ x: number, y: number, z: number }} playerPos
 * @param {number} dt  frame delta in seconds
 */
export function tickSoundtrack(playerPos, dt) {
  if (!_ready) return;

  _tickTimer += dt;
  if (_tickTimer < TICK_RATE) return;
  _tickTimer = 0;

  const zone = _resolveZone(playerPos);
  if (zone !== _currentZone) {
    _crossfadeTo(zone);
    _currentZone = zone;
  }
}

// ============================================================
//  ZONE RESOLVER
// ============================================================

function _resolveZone(pos) {
  if (!terrainProfile.ready) return ZONE.CANYON; // safe default before scan

  // Factory proximity always wins
  const cx  = terrainProfile.centre.x;
  const cz  = terrainProfile.centre.z;
  const dx  = pos.x - cx, dz = pos.z - cz;
  const xzDist = Math.sqrt(dx * dx + dz * dz);
  if (xzDist < terrainProfile.factoryRadius) return ZONE.FACTORY;

  // Elevation determines peak vs canyon
  if (pos.y >= terrainProfile.peakThreshold)   return ZONE.PEAK;
  if (pos.y <= terrainProfile.canyonThreshold) return ZONE.CANYON;

  // Mid-elevation — keep current zone for stability (no yo-yo at threshold edges)
  return _currentZone === ZONE.NONE ? ZONE.CANYON : _currentZone;
}

// ============================================================
//  CROSSFADE
// ============================================================

function _crossfadeTo(newZone) {
  console.info(`[soundtrack] Zone: ${_currentZone} → ${newZone}`);

  // Fade out all layers except the incoming one
  for (const [z, layer] of Object.entries(_layers)) {
    if (z === newZone) {
      layer.vol.volume.rampTo(-0, XFADE_TIME);   // fade in to 0 dB (relative to master)
    } else {
      layer.vol.volume.rampTo(-Infinity, XFADE_TIME);
    }
  }
}

// ============================================================
//  LAYER BUILDERS
// ============================================================

// ---- PEAK LAYER — sparse, eerie, high-altitude ambience ----
function _buildPeakLayer(master) {
  const vol = new Tone.Volume(-Infinity);
  vol.connect(master);

  // Slow wind texture (reuse pattern from audio.js wind but quieter + higher pitched)
  const windNoise  = new Tone.Noise('pink').start();
  const windFilter = new Tone.Filter({ frequency: 1200, type: 'bandpass', Q: 0.6 });
  const windAmt    = new Tone.Volume(-32);
  windNoise.connect(windFilter);
  windFilter.connect(windAmt);
  windAmt.connect(vol);

  // Jaw harp — metallic twang: short pluck, rich odd harmonics, heavy reverb
  const jawHarp = new Tone.FMSynth({
    harmonicity:   3.5,
    modulationIndex: 12,
    oscillator:    { type: 'sawtooth' },
    envelope:      { attack: 0.001, decay: 0.4, sustain: 0.05, release: 1.2 },
    modulation:    { type: 'square' },
    modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.5 },
  });
  const jawVerb = new Tone.Reverb({ decay: 4, wet: 0.7 });
  const jawVol  = new Tone.Volume(-14);
  jawHarp.connect(jawVerb);
  jawVerb.connect(jawVol);
  jawVol.connect(vol);

  // Harmonica breath — slow sine cluster with slight vibrato
  const harpVib  = new Tone.Vibrato({ frequency: 4.5, depth: 0.12 });
  const harpSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope:   { attack: 0.3, decay: 0.1, sustain: 0.8, release: 1.5 },
  });
  const harpVerb = new Tone.Reverb({ decay: 6, wet: 0.5 });
  const harpVol  = new Tone.Volume(-20);
  harpSynth.connect(harpVib);
  harpVib.connect(harpVerb);
  harpVerb.connect(harpVol);
  harpVol.connect(vol);

  // Owl stab — short band-passed noise burst
  const owlEnv   = new Tone.AmplitudeEnvelope({ attack: 0.02, decay: 0.3, sustain: 0, release: 0.8 });
  const owlFilt  = new Tone.Filter({ frequency: 700, type: 'bandpass', Q: 8 });
  const owlNoise = new Tone.Noise('white');
  const owlVerb  = new Tone.Reverb({ decay: 5, wet: 0.8 });
  const owlVol   = new Tone.Volume(-18);
  owlNoise.connect(owlEnv);
  owlEnv.connect(owlFilt);
  owlFilt.connect(owlVerb);
  owlVerb.connect(owlVol);
  owlVol.connect(vol);
  owlNoise.start();

  // Coyote howl — pitch-glide synth
  const coyoteSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope:   { attack: 0.4, decay: 0.1, sustain: 0.7, release: 2.5 },
  });
  const coyoteVerb  = new Tone.Reverb({ decay: 8, wet: 0.85 });
  const coyoteVol   = new Tone.Volume(-16);
  coyoteSynth.connect(coyoteVerb);
  coyoteVerb.connect(coyoteVol);
  coyoteVol.connect(vol);

  // ---- Randomised event scheduler ----
  // Jaw harp plucks — irregular, lonely
  const jawLoop = new Tone.Loop(time => {
    if (Math.random() > 0.55) return;   // ~45% chance each cycle fires
    const note = _pick(['A2', 'E2', 'D2', 'B2']);
    jawHarp.triggerAttackRelease(note, '8n', time);
  }, '2n');
  jawLoop.start(0);

  // Harmonica sighs — occasional long notes
  const harpLoop = new Tone.Loop(time => {
    if (Math.random() > 0.3) return;
    const chord = _pick([
      ['A3', 'E4'],
      ['D3', 'A3'],
      ['G3', 'D4'],
    ]);
    harpSynth.triggerAttackRelease(chord, '2n', time);
  }, '4m');
  harpLoop.start('2m');

  // Owl stabs — rare, startling
  const owlLoop = new Tone.Loop(time => {
    if (Math.random() > 0.25) return;
    owlEnv.triggerAttackRelease('1n', time);
    // Double-hoot occasionally
    if (Math.random() > 0.5) {
      owlEnv.triggerAttackRelease('8n', `+${0.5 + Math.random() * 0.3}`);
    }
  }, '6m');
  owlLoop.start('1m');

  // Coyote howl — very rare, mournful
  const coyoteLoop = new Tone.Loop(time => {
    if (Math.random() > 0.2) return;
    const startNote = _pick(['A3', 'G3', 'E3']);
    coyoteSynth.triggerAttackRelease(startNote, '2n', time);
    // Glide up a fifth
    coyoteSynth.frequency.rampTo(
      Tone.Frequency(startNote).transpose(7).toFrequency(),
      0.8,
      `+0.4`,
    );
  }, '8m');
  coyoteLoop.start('4m');

  return { vol };
}

// ---- CANYON LAYER — Morricone spaghetti-western ----
function _buildCanyonLayer(master) {
  const vol = new Tone.Volume(-Infinity);
  vol.connect(master);

  const verb = new Tone.Reverb({ decay: 5, wet: 0.35 });
  const delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 0.2 });
  verb.connect(vol);
  delay.connect(verb);

  // ---- Twangy electric guitar — surf-rock pluck ----
  const guitar = new Tone.PluckSynth({
    attackNoise:  2.5,
    dampening:    3800,
    resonance:    0.97,
  });
  const guitarDist = new Tone.Distortion(0.15);
  const guitarVol  = new Tone.Volume(-12);
  guitar.connect(guitarDist);
  guitarDist.connect(guitarVol);
  guitarVol.connect(delay);

  // ---- Harmonica — breathy, bending sine ----
  const harmonica = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope:   { attack: 0.08, decay: 0.05, sustain: 0.9, release: 0.6 },
  });
  const harmoVib  = new Tone.Vibrato({ frequency: 5, depth: 0.08 });
  const harmoVol  = new Tone.Volume(-14);
  harmonica.connect(harmoVib);
  harmoVib.connect(harmoVol);
  harmoVol.connect(verb);

  // ---- Trumpet stab — mariachi punch ----
  const trumpet = new Tone.Synth({
    oscillator: { type: 'sawtooth' },
    envelope:   { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.4 },
    filterEnvelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.3, baseFrequency: 300, octaves: 3 },
  });
  const trumpetVol = new Tone.Volume(-16);
  trumpet.connect(trumpetVol);
  trumpetVol.connect(verb);

  // ---- Soprano whistle — ghostly high melody ----
  const whistle = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope:   { attack: 0.15, decay: 0.05, sustain: 0.8, release: 0.9 },
  });
  const whistleVib  = new Tone.Vibrato({ frequency: 5.5, depth: 0.06 });
  const whistleVol  = new Tone.Volume(-18);
  whistle.connect(whistleVib);
  whistleVib.connect(whistleVol);
  whistleVol.connect(verb);

  // ---- Whip-crack percussion ----
  const whipEnv   = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 });
  const whipNoise = new Tone.Noise('white');
  const whipFilt  = new Tone.Filter({ frequency: 5000, type: 'highpass' });
  const whipVol   = new Tone.Volume(-10);
  whipNoise.connect(whipEnv);
  whipEnv.connect(whipFilt);
  whipFilt.connect(whipVol);
  whipVol.connect(vol);    // dry — no verb on whip
  whipNoise.start();

  // ---- Ticking watch — mechanical 16th-note pulse ----
  const tickOsc = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope:   { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
  });
  const tickVol = new Tone.Volume(-24);
  tickOsc.connect(tickVol);
  tickVol.connect(vol);

  // ---- Jaw harp tension drone ----
  const jDrone = new Tone.FMSynth({
    harmonicity: 4,
    modulationIndex: 8,
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.5, decay: 0.2, sustain: 0.6, release: 2 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.1, decay: 0.1, sustain: 0.3, release: 1 },
  });
  const jDroneVol = new Tone.Volume(-22);
  jDrone.connect(jDroneVol);
  jDroneVol.connect(delay);

  // ---- Sequences ----

  // Twang guitar ostinato — Am pentatonic, shuffled, quintessential Leone feel
  // Plays a hesitant, stuttering arpeggiated motif
  const TWANG = ['A2', null, 'E3', null, 'A2', 'C3', null, 'E3'];
  let twangIdx = 0;
  const twangLoop = new Tone.Sequence(time => {
    const note = TWANG[twangIdx % TWANG.length];
    if (note) guitar.triggerAttackRelease(note, '16n', time);
    twangIdx++;
  }, TWANG, '8n');
  twangLoop.start(0);

  // Tick on every 16th
  const tickLoop = new Tone.Loop(time => {
    tickOsc.triggerAttackRelease('C6', '32n', time);
  }, '16n');
  tickLoop.start(0);

  // Harmonica melody — slow, searching phrases in A minor
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
      if (note) harmonica.triggerAttackRelease([note], dur, time + offset);
      offset += Tone.Time(dur).toSeconds();
    }
    phraseIdx++;
  }, '2m');
  harmoLoop.start('1m');

  // Soprano whistle — the iconic lone melody, higher register
  const WHISTLE_PHRASES = [
    ['E5', 'D5', 'C5', 'A4'],
    ['A4', 'B4', 'C5', 'B4', 'A4'],
  ];
  let wIdx = 0;
  const whistleLoop = new Tone.Loop(time => {
    if (Math.random() > 0.5) return;
    const phrase = WHISTLE_PHRASES[wIdx % WHISTLE_PHRASES.length];
    let off = 0;
    for (const note of phrase) {
      whistle.triggerAttackRelease(note, '4n', time + off);
      off += Tone.Time('4n').toSeconds() * (0.9 + Math.random() * 0.3);
    }
    wIdx++;
  }, '4m');
  whistleLoop.start('2m');

  // Trumpet stab — dramatic, occasional
  const TRUMPET_STABS = ['A4', 'E5', 'C5', 'G4'];
  const trumpetLoop = new Tone.Loop(time => {
    if (Math.random() > 0.35) return;
    trumpet.triggerAttackRelease(_pick(TRUMPET_STABS), '8n', time);
  }, '2m');
  trumpetLoop.start('3m');

  // Whip cracks — sparse, startling
  const whipLoop = new Tone.Loop(time => {
    if (Math.random() > 0.3) return;
    whipEnv.triggerAttackRelease('16n', time);
  }, '3m');
  whipLoop.start('1m');

  // Jaw harp tension — holds on tonic between phrases
  const jDroneLoop = new Tone.Loop(time => {
    if (Math.random() > 0.4) return;
    jDrone.triggerAttackRelease('A2', '2n', time);
  }, '4m');
  jDroneLoop.start(0);

  return { vol };
}

// ---- FACTORY LAYER — industrial urgency ----
function _buildFactoryLayer(master) {
  const vol = new Tone.Volume(-Infinity);
  vol.connect(master);

  // ---- Heavy kick ----
  const kick = new Tone.MembraneSynth({
    pitchDecay:  0.08,
    octaves:     6,
    envelope:    { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
  });
  const kickVol = new Tone.Volume(-8);
  kick.connect(kickVol);
  kickVol.connect(vol);

  // ---- Snare — filtered noise burst ----
  const snareEnv  = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.18, sustain: 0, release: 0.1 });
  const snareNoise = new Tone.Noise('white');
  const snareFilt = new Tone.Filter({ frequency: 2500, type: 'bandpass', Q: 0.8 });
  const snareVol  = new Tone.Volume(-14);
  snareNoise.connect(snareEnv);
  snareEnv.connect(snareFilt);
  snareFilt.connect(snareVol);
  snareVol.connect(vol);
  snareNoise.start();

  // ---- Metallic clank — short high percussive hit ----
  const clankEnv  = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.08, sustain: 0, release: 0.06 });
  const clankNoise = new Tone.Noise('white');
  const clankFilt = new Tone.Filter({ frequency: 7000, type: 'highpass' });
  const clankVol  = new Tone.Volume(-18);
  clankNoise.connect(clankEnv);
  clankEnv.connect(clankFilt);
  clankFilt.connect(clankVol);
  clankVol.connect(vol);
  clankNoise.start();

  // ---- Distorted sawtooth bass — mechanical pulse ----
  const bass     = new Tone.Synth({
    oscillator: { type: 'sawtooth' },
    envelope:   { attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.2 },
  });
  const bassDist = new Tone.Distortion(0.7);
  const bassFilter = new Tone.Filter({ frequency: 400, type: 'lowpass' });
  const bassVol  = new Tone.Volume(-14);
  bass.connect(bassDist);
  bassDist.connect(bassFilter);
  bassFilter.connect(bassVol);
  bassVol.connect(vol);

  // ---- Industrial sweep — rising noise tension riser ----
  const sweepNoise  = new Tone.Noise('brown');
  const sweepFilter = new Tone.Filter({ frequency: 200, type: 'lowpass' });
  const sweepVol    = new Tone.Volume(-28);
  sweepNoise.connect(sweepFilter);
  sweepFilter.connect(sweepVol);
  sweepVol.connect(vol);
  sweepNoise.start();

  // ---- High-frequency mechanical buzz — factory machinery ----
  const buzz     = new Tone.Oscillator({ type: 'square', frequency: 60 });
  const buzzDist = new Tone.Distortion(0.9);
  const buzzFilt = new Tone.Filter({ frequency: 300, type: 'lowpass' });
  const buzzVol  = new Tone.Volume(-26);
  buzz.connect(buzzDist);
  buzzDist.connect(buzzFilt);
  buzzFilt.connect(buzzVol);
  buzzVol.connect(vol);
  buzz.start();

  // ---- Tension synth stabs — angular, dissonant ----
  const stab    = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope:   { attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.3 },
  });
  const stabVerb = new Tone.Reverb({ decay: 1.5, wet: 0.2 });
  const stabVol  = new Tone.Volume(-18);
  stab.connect(stabVerb);
  stabVerb.connect(stabVol);
  stabVol.connect(vol);

  // ---- Sequences ----

  // 4-on-the-floor kick
  const kickLoop = new Tone.Sequence(time => {
    kick.triggerAttackRelease('C1', '8n', time);
  }, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], '16n');
  kickLoop.start(0);

  // Snare on 2 and 4
  const snareLoop = new Tone.Sequence(time => {
    snareEnv.triggerAttackRelease('8n', time);
  }, [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], '16n');
  snareLoop.start(0);

  // Metallic clanks — syncopated, mechanical
  const clankLoop = new Tone.Sequence(time => {
    if (Math.random() > 0.5) clankEnv.triggerAttackRelease('16n', time);
  }, [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], '16n');
  clankLoop.start(0);

  // Bass pattern — gritty industrial riff in E phrygian
  const BASS_PATTERN = ['E1', null, 'E1', 'F1', null, 'E1', null, 'D#1',
                         'E1', null, 'E1', 'G1', 'F1', null, 'E1', null];
  const bassLoop = new Tone.Sequence((time, note) => {
    if (note) bass.triggerAttackRelease(note, '16n', time);
  }, BASS_PATTERN, '16n');
  bassLoop.start(0);

  // Sweep filter automation — tension riser every 8 bars
  const sweepLoop = new Tone.Loop(time => {
    sweepFilter.frequency.rampTo(80, 0, time);
    sweepFilter.frequency.rampTo(4000, Tone.Time('8m').toSeconds(), time);
    sweepVol.volume.rampTo(-14, Tone.Time('6m').toSeconds(), time);
    sweepVol.volume.rampTo(-28, Tone.Time('2m').toSeconds(), `+${Tone.Time('6m').toSeconds()}`);
  }, '8m');
  sweepLoop.start(0);

  // Dissonant stab hits — angular, Penderecki-ish cluster chords
  const STAB_CHORDS = [
    ['E3', 'F3', 'A#3'],
    ['D3', 'G#3', 'B3'],
    ['E3', 'A3', 'C4'],
  ];
  let stabIdx = 0;
  const stabLoop = new Tone.Loop(time => {
    if (Math.random() > 0.6) return;
    stab.triggerAttackRelease(STAB_CHORDS[stabIdx % STAB_CHORDS.length], '8n', time);
    stabIdx++;
  }, '1m');
  stabLoop.start('2m');

  return { vol };
}

// ============================================================
//  Utility
// ============================================================
function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }