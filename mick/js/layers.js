import { detectChord, NOTE_NAMES, midiNoteToName } from './theory.js';

/* ═══════════════════════════════════════════════════════════════════════════
   layers.js — Per-channel display layer system

   Each MIDI channel (0-indexed) gets one DOM layer.
   Layers are stacked via z-index; ch 10 (drums/index 9) is the deepest
   background, ch 1 (index 0) is the topmost foreground element.

   Each layer config exposes:
     ch        — 0-based MIDI channel index
     color     — CSS color string for the text
     fontSize  — clamp() string controlling responsive size
     opacity   — base opacity when active (0–1)
     blendMode — CSS mix-blend-mode
     align     — 'center' | 'left' | 'right'  (future use)
     label     — human-readable name

   Add new properties here as the project grows — layers.js is the single
   source of truth for all per-channel visual configuration.
   ═══════════════════════════════════════════════════════════════════════════ */

export const LAYER_CONFIG = [
  /* index 0 — MIDI ch 1 — White — smallest/topmost — Lead */
  {
    ch:        0,
    label:     'Lead',
    color:     '#ffffff',
    fontSize:  'clamp(28px, 4vw,  56px)',
    opacity:   1.0,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 1 — MIDI ch 2 — Orange — Strings */
  {
    ch:        1,
    label:     'Strings',
    color:     '#ff8c00',
    fontSize:  'clamp(36px, 5.5vw, 72px)',
    opacity:   1.0,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 2 — MIDI ch 3 — Yellow — Bass */
  {
    ch:        2,
    label:     'Bass',
    color:     '#ffd700',
    fontSize:  'clamp(44px, 7vw,  96px)',
    opacity:   1.0,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 3 — MIDI ch 4 — Blue — Chords */
  {
    ch:        3,
    label:     'Chords',
    color:     '#4488ff',
    fontSize:  'clamp(52px, 9vw,  120px)',
    opacity:   1.0,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 4 — MIDI ch 5 — Green — Arp/Pluck */
  {
    ch:        4,
    label:     'Arp',
    color:     '#44dd88',
    fontSize:  'clamp(60px, 11vw, 148px)',
    opacity:   1.0,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 5 — MIDI ch 6 — Brown — Pad */
  {
    ch:        5,
    label:     'Pad',
    color:     '#a0522d',
    fontSize:  'clamp(72px, 13vw, 180px)',
    opacity:   0.9,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 6 — MIDI ch 7 — Dark Orange — Brass */
  {
    ch:        6,
    label:     'Brass',
    color:     '#cc5500',
    fontSize:  'clamp(88px, 15vw, 210px)',
    opacity:   0.9,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 7 — MIDI ch 8 — Dark Green — FX Synth */
  {
    ch:        7,
    label:     'FX',
    color:     '#1a6b3a',
    fontSize:  'clamp(104px, 17vw, 240px)',
    opacity:   0.85,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 8 — MIDI ch 9 — Dark Brown — Percussion variant */
  {
    ch:        8,
    label:     'Perc',
    color:     '#3b1f0e',
    fontSize:  'clamp(120px, 19vw, 268px)',
    opacity:   0.85,
    blendMode: 'normal',
    align:     'center',
  },
  /* index 9 — MIDI ch 10 — Black — Drums — largest, background fill */
  {
    ch:        9,
    label:     'Drums',
    color:     '#000000',
    fontSize:  'clamp(140px, 22vw, 300px)',
    opacity:   0.8,
    blendMode: 'normal',
    align:     'center',
  },
];

/* ─── LAYER STATE ───────────────────────────────────────────── */
// Per-layer: current label string and whether it is visible
const layerState = LAYER_CONFIG.map(() => ({ label: '', visible: false }));

/* ─── DOM LAYER ELEMENTS ────────────────────────────────────── */
// Built once, reused on every update
const layerEls = [];

export function buildLayerDOM() {
  const container = document.getElementById('layer-display');
  // Render deepest (ch 10, index 9) first so z-index stacks correctly
  [...LAYER_CONFIG].reverse().forEach(cfg => {
    const el = document.createElement('div');
    el.className  = 'note-layer';
    el.id         = `layer-ch${cfg.ch + 1}`;
    el.dataset.ch = cfg.ch;

    Object.assign(el.style, {
      color:       cfg.color,
      fontSize:    cfg.fontSize,
      opacity:     '0',
      mixBlendMode: cfg.blendMode,
      textAlign:   cfg.align,
    });

    container.appendChild(el);
    // Store by channel index for O(1) access
    layerEls[cfg.ch] = el;
  });
}

/* ─── UPDATE A SINGLE LAYER ─────────────────────────────────── */
export function updateLayer(chIndex, activeNotesForChannel) {
  const el  = layerEls[chIndex];
  const cfg = LAYER_CONFIG[chIndex];
  if (!el || !cfg) return;

  const midiNums = activeNotesForChannel.map(k => parseInt(k.split(':')[1], 10));

  if (!midiNums.length) {
    // Fade out
    el.style.opacity   = '0';
    el.style.transform = 'scale(0.92)';
    layerState[chIndex].visible = false;
    layerState[chIndex].label   = '';
    return;
  }

  const label = detectChord(midiNums);
  el.textContent     = label;
  el.style.opacity   = String(cfg.opacity);
  el.style.transform = 'scale(1)';
  layerState[chIndex].visible = true;
  layerState[chIndex].label   = label;
}

/* ─── CLEAR ALL LAYERS ──────────────────────────────────────── */
export function clearAllLayers() {
  layerEls.forEach((el, i) => {
    if (!el) return;
    el.style.opacity   = '0';
    el.style.transform = 'scale(0.92)';
    layerState[i].visible = false;
    layerState[i].label   = '';
  });
}

/* ─── GET ACTIVE LAYER SUMMARY (for footer) ─────────────────── */
export function getActiveSummary() {
  return layerState
    .map((s, i) => s.visible ? `ch${i + 1}:${s.label}` : null)
    .filter(Boolean)
    .join('  ·  ');
}