import './scene.js';
import { initTone } from './synth.js';
import { buildLayerDOM } from './layers.js';
import { initMIDI } from './midi.js';

/* ─── BUILD LAYER DOM ───────────────────────────────────────── */
buildLayerDOM();

/* ─── AUDIO UNLOCK ──────────────────────────────────────────── */
document.getElementById('tone-btn').addEventListener('click', () => initTone());

/* ─── BOOT ──────────────────────────────────────────────────── */
initMIDI();