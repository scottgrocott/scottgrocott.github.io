/* ═══════════════════════════════════════════════════════════════════════════
   synth.js — Per-channel GM voice engine
   Factories return RAW, unwired nodes. All signal-chain wiring happens
   centrally in initTone() so the Volume node is guaranteed to be in-path.
   ═══════════════════════════════════════════════════════════════════════════ */

const DRUM_MAP = {
  35: { synth: 'membrane', note: 'C1',  opts: { pitchDecay: 0.05, octaves: 6 } },
  36: { synth: 'membrane', note: 'C1',  opts: { pitchDecay: 0.08, octaves: 8 } },
  37: { synth: 'noise',    dur: '32n',  opts: { type: 'white' } },
  38: { synth: 'noise',    dur: '16n',  opts: { type: 'white' } },
  39: { synth: 'noise',    dur: '16n',  opts: { type: 'pink'  } },
  40: { synth: 'noise',    dur: '16n',  opts: { type: 'white' } },
  41: { synth: 'membrane', note: 'G1',  opts: { pitchDecay: 0.05, octaves: 4 } },
  42: { synth: 'metal',    note: 'C6',  dur: '32n' },
  43: { synth: 'membrane', note: 'A1',  opts: { pitchDecay: 0.05, octaves: 4 } },
  44: { synth: 'metal',    note: 'C6',  dur: '16n' },
  45: { synth: 'membrane', note: 'C2',  opts: { pitchDecay: 0.05, octaves: 4 } },
  46: { synth: 'metal',    note: 'C6',  dur: '8n'  },
  47: { synth: 'membrane', note: 'D2',  opts: { pitchDecay: 0.05, octaves: 4 } },
  48: { synth: 'membrane', note: 'F2',  opts: { pitchDecay: 0.05, octaves: 4 } },
  49: { synth: 'metal',    note: 'C7',  dur: '2n'  },
  50: { synth: 'membrane', note: 'A2',  opts: { pitchDecay: 0.05, octaves: 4 } },
  51: { synth: 'metal',    note: 'D6',  dur: '4n'  },
  57: { synth: 'metal',    note: 'C7',  dur: '2n'  },
};

/* ─── CHANNEL DEFINITIONS ────────────────────────────────────────────────
   factory() returns:
     synth    — the sound generator (PolySynth, MonoSynth, etc.)
     effects  — named map of Tone effect nodes, ALL UNWIRED
     volDb    — initial volume in dB
     fxOrder  — ordered array of effect keys (signal flows synth→vol→fxOrder[0]→...→Destination)
     oscType  — oscillator type string for GUI, or null
     env      — envelope defaults for GUI, or null
   ─────────────────────────────────────────────────────────────────────── */
const CHANNEL_DEFINITIONS = [
  {
    label: 'Lead / Piano',
    factory: () => ({
      synth: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.005, decay: 0.3, sustain: 0.4, release: 1.2 },
        maxPolyphony: 16,
      }),
      effects:  { reverb: new Tone.Reverb({ decay: 1.5, wet: 0.2 }) },
      fxOrder:  ['reverb'],
      volDb:    -6,
      oscType:  'triangle',
      env:      { attack: 0.005, decay: 0.3, sustain: 0.4, release: 1.2 },
    })
  },
  {
    label: 'Strings',
    factory: () => ({
      synth: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope:   { attack: 0.4, decay: 0.1, sustain: 0.9, release: 1.5 },
        maxPolyphony: 8,
      }),
      effects:  { chorus: new Tone.Chorus(2, 3.5, 0.6).start(), reverb: new Tone.Reverb({ decay: 3.0, wet: 0.5 }) },
      fxOrder:  ['chorus', 'reverb'],
      volDb:    -10,
      oscType:  'sawtooth',
      env:      { attack: 0.4, decay: 0.1, sustain: 0.9, release: 1.5 },
    })
  },
  {
    label: 'Bass',
    factory: () => ({
      synth: new Tone.MonoSynth({
        oscillator:     { type: 'sawtooth' },
        envelope:       { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
        filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.5, release: 0.3, baseFrequency: 200, octaves: 2.5 },
      }),
      effects:  { filter: new Tone.Filter(400, 'lowpass'), distortion: new Tone.Distortion(0.08) },
      fxOrder:  ['filter', 'distortion'],
      volDb:    -4,
      oscType:  'sawtooth',
      env:      { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
    })
  },
  {
    label: 'Chords',
    factory: () => ({
      synth: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.8 },
        maxPolyphony: 6,
      }),
      effects:  { reverb: new Tone.Reverb({ decay: 1.2, wet: 0.25 }) },
      fxOrder:  ['reverb'],
      volDb:    -8,
      oscType:  'triangle',
      env:      { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.8 },
    })
  },
  {
    label: 'Arp / Pluck',
    factory: () => {
      // PluckSynth pool — wired internally as it can't be chain()ed
      const delay  = new Tone.PingPongDelay('8n', 0.3);
      const reverb = new Tone.Reverb({ decay: 1.0, wet: 0.2 });
      // Wire delay→reverb→Destination here since PluckPool bypasses central wiring
      delay.chain(reverb, Tone.Destination);
      const POOL = 8;
      const pool = Array.from({ length: POOL }, () => {
        const p = new Tone.PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.95 });
        p.connect(delay);
        return p;
      });
      let idx = 0;
      const synth = {
        isPluckPool: true,
        triggerAttack(note, time) { pool[idx++ % POOL].triggerAttackRelease(note, '2n', time); },
        triggerRelease() {},
        releaseAll()    {},
      };
      return { synth, effects: { pingpong: delay, reverb }, fxOrder: [], volDb: -8, oscType: null, env: null };
    }
  },
  {
    label: 'Pad',
    factory: async () => {
      const reverb = new Tone.Reverb({ decay: 5.0, wet: 0.7 });
      await reverb.ready;
      return {
        synth: new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope:   { attack: 1.2, decay: 0.5, sustain: 1.0, release: 3.0 },
          maxPolyphony: 8,
        }),
        effects:  { chorus: new Tone.Chorus(0.5, 4, 0.8).start(), reverb },
        fxOrder:  ['chorus', 'reverb'],
        volDb:    -12,
        oscType:  'sine',
        env:      { attack: 1.2, decay: 0.5, sustain: 1.0, release: 3.0 },
      };
    }
  },
  {
    label: 'Brass',
    factory: () => ({
      synth: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope:   { attack: 0.04, decay: 0.1, sustain: 0.85, release: 0.4 },
        maxPolyphony: 8,
      }),
      effects:  { reverb: new Tone.Reverb({ decay: 0.8, wet: 0.15 }) },
      fxOrder:  ['reverb'],
      volDb:    -8,
      oscType:  'sawtooth',
      env:      { attack: 0.04, decay: 0.1, sustain: 0.85, release: 0.4 },
    })
  },
  {
    label: 'FX / PWM',
    factory: () => ({
      synth: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'pwm', modulationFrequency: 0.4 },
        envelope:   { attack: 0.02, decay: 0.15, sustain: 0.75, release: 0.8 },
        maxPolyphony: 8,
      }),
      effects:  { feedbackDelay: new Tone.FeedbackDelay('16n', 0.25), reverb: new Tone.Reverb({ decay: 1.5, wet: 0.3 }) },
      fxOrder:  ['feedbackDelay', 'reverb'],
      volDb:    -10,
      oscType:  'pwm',
      env:      { attack: 0.02, decay: 0.15, sustain: 0.75, release: 0.8 },
    })
  },
  {
    label: 'Perc',
    factory: () => ({
      synth: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.8 },
        maxPolyphony: 8,
      }),
      effects:  { reverb: new Tone.Reverb({ decay: 2.0, wet: 0.3 }) },
      fxOrder:  ['reverb'],
      volDb:    -8,
      oscType:  'triangle',
      env:      { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.8 },
    })
  },
  {
    label: 'Drums',
    factory: () => {
      const limiter  = new Tone.Limiter(-6);
      const membrane = new Tone.MembraneSynth({
        pitchDecay: 0.08, octaves: 8,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
        volume: -6,
      });
      const metal = new Tone.MetalSynth({
        frequency: 400, harmonicity: 5.1, modulationIndex: 32,
        resonance: 4000, octaves: 1.5,
        envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
        volume: -14,
      });
      const noise = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
        volume: -10,
      });
      membrane.connect(limiter);
      metal.connect(limiter);
      noise.connect(limiter);
      limiter.connect(Tone.Destination);
      return {
        synth: { membrane, metal, noise, isDrums: true },
        effects: {}, fxOrder: [], volDb: 0, oscType: null, env: null,
      };
    }
  },
  { label: 'Expansion 1', factory: () => buildExpansion('sine',     { attack: 0.05, decay: 0.2, sustain: 0.7, release: 1.0 }, -10) },
  { label: 'Expansion 2', factory: () => buildExpansion('triangle', { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.8 }, -9)  },
  { label: 'Expansion 3', factory: () => buildExpansion('sawtooth', { attack: 0.1,  decay: 0.2, sustain: 0.8, release: 1.2 }, -11) },
  { label: 'Expansion 4', factory: () => buildExpansion('square',   { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.6 }, -12) },
  { label: 'Expansion 5', factory: () => buildExpansion('sine',     { attack: 0.3,  decay: 0.4, sustain: 0.6, release: 2.0 }, -11) },
  { label: 'Expansion 6', factory: () => buildExpansion('triangle', { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.5 }, -8)  },
];

function buildExpansion(oscType, env, vol) {
  return {
    synth: new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: oscType },
      envelope: env,
      maxPolyphony: 8,
    }),
    effects:  { reverb: new Tone.Reverb({ decay: 2.0, wet: 0.3 }) },
    fxOrder:  ['reverb'],
    volDb:    vol,
    oscType,
    env,
  };
}

/* ─── RUNTIME STATE ──────────────────────────────────────────────────────── */
let toneReady   = false;
let tonePromise = null;
export const voices = new Array(16).fill(null);

/* ─── INIT ───────────────────────────────────────────────────────────────── */
export async function initTone() {
  if (tonePromise) return tonePromise;

  tonePromise = (async () => {
    try {
      await Tone.start();

      const results = await Promise.all(
        CHANNEL_DEFINITIONS.map(def => Promise.resolve(def.factory()))
      );

      results.forEach(({ synth, effects, fxOrder, volDb, oscType, env }, i) => {
        const volume = new Tone.Volume(volDb);

        if (!synth.isDrums && !synth.isPluckPool) {
          // Wire: synth → volume → fx[0] → fx[1] → ... → Destination
          const orderedFx = fxOrder.map(k => effects[k]).filter(Boolean);
          synth.chain(volume, ...orderedFx, Tone.Destination);
        }
        // Drums: already wired to Destination inside factory
        // PluckPool: already wired inside factory (can't be re-routed cleanly)

        voices[i] = {
          synth,
          effects,
          volume,
          label:   CHANNEL_DEFINITIONS[i].label,
          oscType,
          env:     env ? { ...env } : null,
        };
      });

      toneReady = true;
      console.log('[Synth] All 16 channel voices ready');
    } catch(e) {
      console.error('[Synth] Init failed:', e);
      tonePromise = null;
    }
  })();

  return tonePromise;
}

/* ─── ATTACK ─────────────────────────────────────────────────────────────── */
export function synthAttack(noteName, velocity, midiNum, channel) {
  const voice = voices[channel];
  if (!voice) return;
  const { synth } = voice;
  if (synth.isDrums) { triggerDrum(midiNum, velocity, synth); return; }
  try { synth.triggerAttack(noteName, Tone.now(), velocity); } catch(e) {}
}

/* ─── RELEASE ────────────────────────────────────────────────────────────── */
export function synthRelease(noteName, midiNum, channel) {
  const voice = voices[channel];
  if (!voice) return;
  const { synth } = voice;
  if (synth.isDrums) return;
  try { synth.triggerRelease(noteName, Tone.now()); } catch(e) {}
}

/* ─── RELEASE ALL ────────────────────────────────────────────────────────── */
export function synthReleaseAll() {
  voices.forEach(voice => {
    if (!voice) return;
    const { synth } = voice;
    if (synth.isDrums || synth.isPluckPool) return;
    try {
      if      (typeof synth.releaseAll     === 'function') synth.releaseAll();
      else if (typeof synth.triggerRelease === 'function') synth.triggerRelease();
    } catch(e) {}
  });
}

/* ─── PANIC ──────────────────────────────────────────────────────────────── */
export function synthPanic() {
  voices.forEach(voice => {
    if (!voice) return;
    const { synth } = voice;
    if (synth.isDrums || synth.isPluckPool) return;
    try {
      if      (typeof synth.releaseAll     === 'function') synth.releaseAll();
      else if (typeof synth.triggerRelease === 'function') synth.triggerRelease();
      synth.cancel?.();
    } catch(e) {}
  });
  try { Tone.Transport.cancel(); } catch(e) {}
}

export function isToneReady() { return toneReady; }
export function getChannelLabel(ch) { return voices[ch]?.label ?? `Ch ${ch + 1}`; }

/* ─── DRUM TRIGGER ───────────────────────────────────────────────────────── */
function triggerDrum(midiNum, velocity, drumSynths) {
  const hit = DRUM_MAP[midiNum];
  const now = Tone.now();
  if (!hit) {
    try { drumSynths.membrane.triggerAttackRelease('C2', '16n', now, velocity); } catch(e) {}
    return;
  }
  try {
    if (hit.synth === 'membrane') {
      if (hit.opts) drumSynths.membrane.set(hit.opts);
      drumSynths.membrane.triggerAttackRelease(hit.note, '16n', now, velocity);
    } else if (hit.synth === 'metal') {
      drumSynths.metal.triggerAttackRelease(hit.dur ?? '16n', now, velocity);
    } else if (hit.synth === 'noise') {
      if (hit.opts?.type) drumSynths.noise.noise.type = hit.opts.type;
      drumSynths.noise.triggerAttackRelease(hit.dur ?? '16n', now, velocity);
    }
  } catch(e) {}
}