/* ═══════════════════════════════════════════════════════════════════════════
   audio.js — Per-channel Tone.js analysis → TSL uniform bridge

   For each MIDI channel we maintain:
     meter     Tone.Meter        → RMS amplitude (dB), polled every frame
     analyser  Tone.Analyser     → FFT bin array for spectral centroid
     envelope  JS object         → software ADSR tracker driven by note events
     onset     JS number         → transient spike [0,1] decaying ~80ms

   Every animation frame, tickAudio() is called from the render loop.
   It writes four floats per channel into the layer uniforms exported
   from layers.js:
     ampU        [0,1]  RMS level — drives overall brightness / line width
     attackU     [0,1]  ADSR envelope position — breathes with the note
     brightnessU [0,1]  spectral centroid — drives colour temperature / warp
     onsetU      [0,1]  attack transient spike — drives burst / flash effects
   ═══════════════════════════════════════════════════════════════════════════ */

import { voices, isToneReady } from './synth.js';
import { setAudioUniforms }    from './layers.js';

/* ─── PER-CHANNEL ANALYSIS STATE ────────────────────────────────────────── */
// analysers[ch] = { meter, analyser, envelope, onset, lastAmp }
const analysers = new Array(16).fill(null);

/* ─── ENVELOPE TRACKER ───────────────────────────────────────────────────
   A lightweight JS-side ADSR follower.
   On note-on  → starts attack ramp
   On note-off → starts release ramp
   tickEnvelope(dt) → returns current envelope value [0,1]
   ─────────────────────────────────────────────────────────────────────── */
function makeEnvelope(attack, decay, sustain, release) {
  return {
    value:   0,
    phase:   'idle',   // idle | attack | decay | sustain | release
    attack,  decay,  sustain,  release,
    noteOn() {
      this.phase = 'attack';
    },
    noteOff() {
      if (this.phase !== 'idle') this.phase = 'release';
    },
    tick(dt) {
      switch (this.phase) {
        case 'attack':
          this.value += dt / Math.max(this.attack, 0.001);
          if (this.value >= 1.0) { this.value = 1.0; this.phase = 'decay'; }
          break;
        case 'decay':
          this.value -= dt * (1.0 - this.sustain) / Math.max(this.decay, 0.001);
          if (this.value <= this.sustain) { this.value = this.sustain; this.phase = 'sustain'; }
          break;
        case 'sustain':
          this.value = this.sustain;
          break;
        case 'release':
          this.value -= dt * this.sustain / Math.max(this.release, 0.001);
          if (this.value <= 0.0) { this.value = 0.0; this.phase = 'idle'; }
          break;
        default:
          this.value = 0;
      }
      return Math.max(0, Math.min(1, this.value));
    }
  };
}

/* ─── SPECTRAL CENTROID ──────────────────────────────────────────────────
   Computes the weighted mean frequency bin from an FFT array.
   Returns a normalised [0,1] value (0 = low/dark, 1 = bright/high).
   ─────────────────────────────────────────────────────────────────────── */
function spectralCentroid(fftArray) {
  let weightedSum = 0;
  let totalEnergy = 0;
  const len = fftArray.length;
  for (let i = 0; i < len; i++) {
    // FFT values are in dB [-∞..0], convert to linear power
    const power = Math.pow(10, fftArray[i] / 20);
    weightedSum += power * i;
    totalEnergy += power;
  }
  if (totalEnergy < 1e-10) return 0;
  return Math.min(1, (weightedSum / totalEnergy) / (len * 0.5));
}

/* ─── INIT — called from main.js after initTone() resolves ──────────────
   Taps an analyser off each channel's volume node output.
   ─────────────────────────────────────────────────────────────────────── */
export function initAudio() {
  for (let ch = 0; ch < 16; ch++) {
    const voice = voices[ch];
    if (!voice) continue;

    const meter    = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
    const analyser = new Tone.Analyser('fft', 64);

    // Get envelope params from voice (fall back to generic)
    const env = voice.env ?? { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.5 };
    const envelope = makeEnvelope(env.attack, env.decay, env.sustain, env.release);

    // Tap: volume node → meter (metering only, no audio output)
    //       volume node → analyser (same)
    // For drums the volume node is the limiter output — we tap the channel's
    // volume node which exists for all voices.
    try {
      voice.volume.connect(meter);
      voice.volume.connect(analyser);
    } catch(e) {
      console.warn(`[Audio] Could not connect analyser for ch ${ch}:`, e);
    }

    analysers[ch] = { meter, analyser, envelope, onset: 0, lastAmp: 0 };
  }
  console.log('[Audio] Analysis ready for', analysers.filter(Boolean).length, 'channels');
}

/* ─── NOTE EVENTS — called from midi.js ─────────────────────────────── */
export function audioNoteOn(ch) {
  const a = analysers[ch];
  if (!a) return;
  a.envelope.noteOn();
  a.onset = 1.0;  // spike the transient
}

export function audioNoteOff(ch) {
  const a = analysers[ch];
  if (!a) return;
  a.envelope.noteOff();
}

export function audioAllOff() {
  analysers.forEach(a => {
    if (!a) return;
    a.envelope.noteOff();
    a.onset = 0;
  });
}

/* ─── TICK — called every animation frame from main.js ──────────────────
   dt = delta time in seconds since last frame
   ─────────────────────────────────────────────────────────────────────── */
const ONSET_DECAY = 12.0;  // onset fades in ~80ms (1/12 ≈ 83ms)

export function tickAudio(dt) {
  if (!isToneReady()) return;

  for (let ch = 0; ch < 16; ch++) {
    const a = analysers[ch];
    if (!a) continue;

    // 1. RMS amplitude from meter [0,1]
    let amp = a.meter.getValue();
    if (Array.isArray(amp)) amp = amp[0]; // stereo → mono
    amp = isFinite(amp) ? Math.max(0, Math.min(1, amp)) : 0;

    // 2. Envelope position [0,1]
    const attackVal = a.envelope.tick(dt);

    // 3. Spectral centroid [0,1] from FFT
    const fftVals     = a.analyser.getValue();
    const brightness  = spectralCentroid(fftVals);

    // 4. Onset spike: decays exponentially from 1→0
    a.onset = Math.max(0, a.onset - dt * ONSET_DECAY);

    // Push all four values into the TSL layer uniforms
    setAudioUniforms(ch, amp, attackVal, brightness, a.onset);
  }
}