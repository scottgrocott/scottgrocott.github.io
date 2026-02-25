/* ═══════════════════════════════════════════════════════════════════════════
   synth.js — Per-channel GM voice engine
   ───────────────────────────────────────────────────────────────────────────
   Each MIDI channel (0-indexed internally, 1-indexed in GM) gets its own
   Tone.js synth instance with a tailored signal chain. This means attack /
   release calls are completely isolated per channel — no voice-stealing
   between channels, and each role has its own tonal character.

   Channel map (GM, 1-based → internal index 0-based):
     0  (ch 1)  Main Lead / Piano       → PolySynth + FM-ish triangle
     1  (ch 2)  Secondary Lead / Strings → PolySynth + sawtooth + slow attack
     2  (ch 3)  Bass                     → MonoSynth + sub-octave feel
     3  (ch 4)  Chords / Guitar          → PolySynth + plucked tone
     4  (ch 5)  Arp / Pluck              → PolySynth + short decay
     5  (ch 6)  Pad / Atmosphere         → PolySynth + slow attack, long release
     6  (ch 7)  Brass / Hits             → PolySynth + bright saw + fast attack
     7  (ch 8)  Extra Synth / FX         → PolySynth + PWM + detune
     8  (ch 9)  Optional / Percussion    → PolySynth + neutral
     9  (ch 10) DRUMS                    → MembraneSynth + MetalSynth + NoiseSynth
    10–15 (ch 11–16) Expansion           → PolySynth variants
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── GM DRUM NOTE MAP (ch 10, index 9) ─────────────────────────────────── */
// Maps GM drum note numbers to { synth: 'membrane'|'metal'|'noise', params }
const DRUM_MAP = {
  35: { synth: 'membrane', note: 'C1',  opts: { pitchDecay: 0.05, octaves: 6 } }, // Bass Drum 2
  36: { synth: 'membrane', note: 'C1',  opts: { pitchDecay: 0.08, octaves: 8 } }, // Bass Drum 1
  37: { synth: 'noise',    dur: '32n',  opts: { type: 'white' } },                // Rimshot
  38: { synth: 'noise',    dur: '16n',  opts: { type: 'white' } },                // Snare
  39: { synth: 'noise',    dur: '16n',  opts: { type: 'pink'  } },                // Hand Clap
  40: { synth: 'noise',    dur: '16n',  opts: { type: 'white' } },                // Electric Snare
  41: { synth: 'membrane', note: 'G1',  opts: { pitchDecay: 0.05, octaves: 4 } }, // Low Floor Tom
  42: { synth: 'metal',    note: 'C6',  dur: '32n' },                             // Closed Hi-Hat
  43: { synth: 'membrane', note: 'A1',  opts: { pitchDecay: 0.05, octaves: 4 } }, // High Floor Tom
  44: { synth: 'metal',    note: 'C6',  dur: '16n' },                             // Pedal Hi-Hat
  45: { synth: 'membrane', note: 'C2',  opts: { pitchDecay: 0.05, octaves: 4 } }, // Low Tom
  46: { synth: 'metal',    note: 'C6',  dur: '8n'  },                             // Open Hi-Hat
  47: { synth: 'membrane', note: 'D2',  opts: { pitchDecay: 0.05, octaves: 4 } }, // Low-Mid Tom
  48: { synth: 'membrane', note: 'F2',  opts: { pitchDecay: 0.05, octaves: 4 } }, // High-Mid Tom
  49: { synth: 'metal',    note: 'C7',  dur: '2n'  },                             // Crash Cymbal 1
  50: { synth: 'membrane', note: 'A2',  opts: { pitchDecay: 0.05, octaves: 4 } }, // High Tom
  51: { synth: 'metal',    note: 'D6',  dur: '4n'  },                             // Ride Cymbal 1
  57: { synth: 'metal',    note: 'C7',  dur: '2n'  },                             // Crash Cymbal 2
};

/* ─── CHANNEL VOICE DEFINITIONS ─────────────────────────────────────────── */
// Each entry describes how to build the synth + FX chain for that channel.
// 'factory' is called once during initTone() and returns { synth, effects[] }.
const CHANNEL_DEFINITIONS = [
  /* 0 — ch 1 — Main Lead / Piano */
  {
    label: 'Piano',
    factory: () => {
      const reverb  = new Tone.Reverb({ decay: 1.5, wet: 0.2 });
      const synth   = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.005, decay: 0.3, sustain: 0.4, release: 1.2 },
        volume: -6
      });
      synth.maxPolyphony = 16;
      return { synth, chain: [reverb, Tone.Destination] };
    }
  },

  /* 1 — ch 2 — Secondary Lead / Strings */
  {
    label: 'Strings',
    factory: () => {
      const reverb  = new Tone.Reverb({ decay: 3.0, wet: 0.5 });
      const chorus  = new Tone.Chorus(2, 3.5, 0.6).start();
      const synth   = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope:   { attack: 0.4, decay: 0.1, sustain: 0.9, release: 1.5 },
        volume: -10
      });
      synth.maxPolyphony = 8;
      return { synth, chain: [chorus, reverb, Tone.Destination] };
    }
  },

  /* 2 — ch 3 — Bass */
  {
    label: 'Bass',
    factory: () => {
      const filter  = new Tone.Filter(400, 'lowpass');
      const dist    = new Tone.Distortion(0.08);
      // MonoSynth for tight monophonic bass feel
      const synth   = new Tone.MonoSynth({
        oscillator: { type: 'sawtooth' },
        envelope:   { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
        filterEnvelope: {
          attack: 0.01, decay: 0.15, sustain: 0.5, release: 0.3,
          baseFrequency: 200, octaves: 2.5
        },
        volume: -4
      });
      return { synth, chain: [filter, dist, Tone.Destination] };
    }
  },

  /* 3 — ch 4 — Chords / Guitar */
  {
    label: 'Guitar',
    factory: () => {
      const reverb  = new Tone.Reverb({ decay: 1.2, wet: 0.25 });
      const synth   = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.8 },
        volume: -8
      });
      synth.maxPolyphony = 6;
      return { synth, chain: [reverb, Tone.Destination] };
    }
  },

  /* 4 — ch 5 — Arp / Pluck */
  {
    label: 'Pluck',
    factory: () => {
      const delay  = new Tone.PingPongDelay('8n', 0.3);
      const reverb = new Tone.Reverb({ decay: 1.0, wet: 0.2 });
      delay.connect(reverb);
      reverb.connect(Tone.Destination);

      // PluckSynth cannot be wrapped in PolySynth (doesn't extend Monophonic).
      // Use a round-robin pool of instances instead.
      const POOL_SIZE = 8;
      const pool = Array.from({ length: POOL_SIZE }, () => {
        const p = new Tone.PluckSynth({
          attackNoise: 1, dampening: 4000, resonance: 0.95, volume: -8
        });
        p.connect(delay);
        return p;
      });
      let poolIdx = 0;

      const synth = {
        isPluckPool: true,
        triggerAttack(note, time, vel) {
          pool[poolIdx % POOL_SIZE].triggerAttackRelease(note, '2n', time);
          poolIdx++;
        },
        triggerRelease() { /* one-shot, nothing to release */ },
        releaseAll()     { /* nothing to release */ },
      };
      return { synth, chain: [] }; // chain already wired above
    }
  },

  /* 5 — ch 6 — Pad / Atmosphere */
  {
    label: 'Pad',
    factory: async () => {
      const reverb  = new Tone.Reverb({ decay: 5.0, wet: 0.7 });
      await reverb.ready;
      const chorus  = new Tone.Chorus(0.5, 4, 0.8).start();
      const synth   = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope:   { attack: 1.2, decay: 0.5, sustain: 1.0, release: 3.0 },
        volume: -12
      });
      synth.maxPolyphony = 8;
      return { synth, chain: [chorus, reverb, Tone.Destination] };
    }
  },

  /* 6 — ch 7 — Brass / Hits */
  {
    label: 'Brass',
    factory: () => {
      const reverb  = new Tone.Reverb({ decay: 0.8, wet: 0.15 });
      const synth   = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope:   { attack: 0.04, decay: 0.1, sustain: 0.85, release: 0.4 },
        volume: -8
      });
      synth.maxPolyphony = 8;
      return { synth, chain: [reverb, Tone.Destination] };
    }
  },

  /* 7 — ch 8 — Extra Synth / FX (PWM + detune) */
  {
    label: 'Synth Lead',
    factory: () => {
      const delay   = new Tone.FeedbackDelay('16n', 0.25);
      const reverb  = new Tone.Reverb({ decay: 1.5, wet: 0.3 });
      const synth   = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'pwm', modulationFrequency: 0.4 },
        envelope:   { attack: 0.02, decay: 0.15, sustain: 0.75, release: 0.8 },
        volume: -10
      });
      synth.maxPolyphony = 8;
      return { synth, chain: [delay, reverb, Tone.Destination] };
    }
  },

  /* 8 — ch 9 — Optional / Percussion variant (neutral poly) */
  {
    label: 'Extra',
    factory: () => {
      const reverb  = new Tone.Reverb({ decay: 2.0, wet: 0.3 });
      const synth   = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.8 },
        volume: -8
      });
      synth.maxPolyphony = 8;
      return { synth, chain: [reverb, Tone.Destination] };
    }
  },

  /* 9 — ch 10 — DRUMS (special: membrane + metal + noise) */
  {
    label: 'Drums',
    factory: () => {
      const limiter  = new Tone.Limiter(-6);

      const membrane = new Tone.MembraneSynth({
        pitchDecay: 0.08, octaves: 8, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
        volume: -6
      });
      const metal = new Tone.MetalSynth({
        frequency: 400, envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
        volume: -14
      });
      const noise = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
        volume: -10
      });

      membrane.connect(limiter);
      metal.connect(limiter);
      noise.connect(limiter);
      limiter.connect(Tone.Destination);

      // Return a special drums object — attack/release handled differently
      return { synth: { membrane, metal, noise, isDrums: true }, chain: [] };
    }
  },

  /* 10–15 — ch 11–16 — Expansion channels (varied colours) */
  {
    label: 'Expansion 1',
    factory: () => buildExpansion('sine',     { attack: 0.05, decay: 0.2, sustain: 0.7, release: 1.0 }, -10)
  },
  {
    label: 'Expansion 2',
    factory: () => buildExpansion('triangle', { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.8 }, -9)
  },
  {
    label: 'Expansion 3',
    factory: () => buildExpansion('sawtooth', { attack: 0.1,  decay: 0.2, sustain: 0.8, release: 1.2 }, -11)
  },
  {
    label: 'Expansion 4',
    factory: () => buildExpansion('square',   { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.6 }, -12)
  },
  {
    label: 'Expansion 5',
    factory: () => buildExpansion('sine',     { attack: 0.3,  decay: 0.4, sustain: 0.6, release: 2.0 }, -11)
  },
  {
    label: 'Expansion 6',
    factory: () => buildExpansion('triangle', { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.5 }, -8)
  },
];

function buildExpansion(oscType, env, vol) {
  const reverb = new Tone.Reverb({ decay: 2.0, wet: 0.3 });
  const synth  = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: oscType },
    envelope:   env,
    volume:     vol
  });
  synth.maxPolyphony = 8;
  return { synth, chain: [reverb, Tone.Destination] };
}

/* ─── RUNTIME STATE ─────────────────────────────────────────── */
let toneReady   = false;
let tonePromise = null;

// voices[chIndex] = { synth, label } after init
const voices = new Array(16).fill(null);

/* ─── INIT ──────────────────────────────────────────────────── */
export async function initTone() {
  if (tonePromise) return tonePromise;

  tonePromise = (async () => {
    try {
      await Tone.start();

      // Build all 16 channel voices in parallel where possible
      const results = await Promise.all(
        CHANNEL_DEFINITIONS.map(def => Promise.resolve(def.factory()))
      );

      results.forEach(({ synth, chain }, i) => {
        // Wire non-drum synths through their effect chain
        if (!synth.isDrums && chain.length > 0) {
          synth.chain(...chain);
        }
        voices[i] = { synth, label: CHANNEL_DEFINITIONS[i].label };
      });

      toneReady = true;
      document.getElementById('tone-btn').classList.add('hidden');
      console.log('[Synth] All 16 channel voices ready');

    } catch(e) {
      console.error('[Synth] Init failed:', e);
      tonePromise = null;
    }
  })();

  return tonePromise;
}

/* ─── ATTACK ────────────────────────────────────────────────── */
export function synthAttack(noteName, velocity, midiNum, channel) {
  const voice = voices[channel];
  if (!voice) return;
  const { synth } = voice;

  // Drums channel (ch 10, index 9) — route by MIDI note number
  if (synth.isDrums) {
    triggerDrum(midiNum, velocity, synth);
    return;
  }

  try { synth.triggerAttack(noteName, Tone.now(), velocity); } catch(e) {}
}

/* ─── RELEASE ───────────────────────────────────────────────── */
export function synthRelease(noteName, midiNum, channel) {
  const voice = voices[channel];
  if (!voice) return;
  const { synth } = voice;

  // Drums don't use sustained release — they're one-shot triggers
  if (synth.isDrums) return;

  try { synth.triggerRelease(noteName, Tone.now()); } catch(e) {}
}

/* ─── RELEASE ALL ───────────────────────────────────────────── */
// Handles every voice type correctly:
//   PolySynth  → releaseAll()
//   MonoSynth  → triggerRelease()  (no releaseAll method)
//   PluckPool  → no-op (one-shot)
//   Drums      → no-op (one-shot)
export function synthReleaseAll() {
  voices.forEach(voice => {
    if (!voice) return;
    const { synth } = voice;
    if (synth.isDrums || synth.isPluckPool) return;
    try {
      if (typeof synth.releaseAll === 'function') {
        synth.releaseAll();
      } else if (typeof synth.triggerRelease === 'function') {
        // MonoSynth — release the single active voice
        synth.triggerRelease();
      }
    } catch(e) {}
  });
}

/* ─── PANIC — nuclear option, kills every voice immediately ── */
// Call this on Escape key or whenever audio gets stuck.
// Disposes and rebuilds each synth's internal voice pool, guaranteed clean.
export function synthPanic() {
  voices.forEach(voice => {
    if (!voice) return;
    const { synth } = voice;
    if (synth.isDrums || synth.isPluckPool) return;
    try {
      if (typeof synth.releaseAll === 'function') synth.releaseAll();
      else if (typeof synth.triggerRelease === 'function') synth.triggerRelease();
      // Cancel any scheduled events on this synth
      synth.cancel?.();
    } catch(e) {}
  });
  // Also cancel all Tone Transport events as a safety net
  try { Tone.Transport.cancel(); } catch(e) {}
  console.log('[Synth] Panic — all voices released');
}

/* ─── TONE READY ────────────────────────────────────────────── */
export function isToneReady() { return toneReady; }

/* ─── GET CHANNEL LABEL (for display) ──────────────────────── */
export function getChannelLabel(channel) {
  return voices[channel]?.label ?? `Ch ${channel + 1}`;
}

/* ─── DRUM TRIGGER ──────────────────────────────────────────── */
function triggerDrum(midiNum, velocity, drumSynths) {
  const hit = DRUM_MAP[midiNum];
  const vol = velocity; // 0–1
  const now = Tone.now();

  if (!hit) {
    // Unknown drum note — fall back to a quick membrane hit
    try { drumSynths.membrane.triggerAttackRelease('C2', '16n', now, vol); } catch(e) {}
    return;
  }

  try {
    if (hit.synth === 'membrane') {
      if (hit.opts) drumSynths.membrane.set(hit.opts);
      drumSynths.membrane.triggerAttackRelease(hit.note, '16n', now, vol);
    } else if (hit.synth === 'metal') {
      drumSynths.metal.triggerAttackRelease(hit.dur ?? '16n', now, vol);
    } else if (hit.synth === 'noise') {
      if (hit.opts?.type) drumSynths.noise.noise.type = hit.opts.type;
      drumSynths.noise.triggerAttackRelease(hit.dur ?? '16n', now, vol);
    }
  } catch(e) {}
}