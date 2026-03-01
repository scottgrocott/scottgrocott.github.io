/* ─── NOTE NAMES ────────────────────────────────────────────── */
export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function midiNoteToName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

/* ─── CHORD DETECTION ───────────────────────────────────────── */
const CHORD_PATTERNS = [
  { intervals: [0,4,7],    suffix: 'maj'  },
  { intervals: [0,3,7],    suffix: 'min'  },
  { intervals: [0,3,6],    suffix: 'dim'  },
  { intervals: [0,4,8],    suffix: 'aug'  },
  { intervals: [0,4,7,11], suffix: 'maj7' },
  { intervals: [0,4,7,10], suffix: '7'    },
  { intervals: [0,3,7,10], suffix: 'min7' },
  { intervals: [0,3,6,10], suffix: 'm7b5' },
  { intervals: [0,3,6,9],  suffix: 'dim7' },
  { intervals: [0,5,7],    suffix: 'sus4' },
  { intervals: [0,2,7],    suffix: 'sus2' },
];

/**
 * Given an array of MIDI note numbers, return a chord label string.
 * Single note  → pitch class name only (e.g. "C")
 * Known chord  → root + suffix (e.g. "G min7")
 * Unknown      → pitch classes joined (e.g. "C · E · G#")
 */
export function detectChord(midiNums) {
  if (!midiNums.length) return '';
  if (midiNums.length === 1) return NOTE_NAMES[midiNums[0] % 12];

  const pcs = [...new Set(midiNums.map(n => n % 12))].sort((a, b) => a - b);

  for (const root of pcs) {
    const ivs = pcs.map(pc => ((pc - root) + 12) % 12).sort((a, b) => a - b);
    for (const pattern of CHORD_PATTERNS) {
      if (JSON.stringify(ivs) === JSON.stringify(pattern.intervals)) {
        return NOTE_NAMES[root] + ' ' + pattern.suffix;
      }
    }
  }

  // Fallback: list the pitch classes
  return pcs.map(pc => NOTE_NAMES[pc]).join(' · ');
}
