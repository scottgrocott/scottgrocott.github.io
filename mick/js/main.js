import './scene.js';
import { initTone } from './synth.js';
import { initMIDI } from './midi.js';

/* ─── AUDIO UNLOCK ──────────────────────────────────────────── */
// Browsers require a user gesture before allowing AudioContext to start.
document.getElementById('tone-btn').addEventListener('click', () => initTone());

/* ─── BOOT ──────────────────────────────────────────────────── */
initMIDI();
