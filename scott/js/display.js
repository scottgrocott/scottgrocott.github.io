import { detectChord, midiNoteToName } from './theory.js';
import { updateLayer, clearAllLayers, getActiveSummary } from './layers.js';

/* ─── ELEMENTS ──────────────────────────────────────────────── */
const footerEl   = document.getElementById('footer');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

/* ─── ACTIVE NOTE STATE ─────────────────────────────────────── */
// Key: "ch:midiNum"  Value: Tone note name string (e.g. "C4")
export const activeNotes = new Map();

/* ─── STATUS ────────────────────────────────────────────────── */
export function setStatus(cls, msg) {
  statusDot.className    = cls;
  statusText.textContent = msg;
}

/* ─── DISPLAY UPDATE ────────────────────────────────────────── */
export function updateDisplay() {
  // Group active note keys by channel index
  const byChannel = new Map(); // chIndex -> [ "ch:midiNum", ... ]

  for (const key of activeNotes.keys()) {
    const ch = parseInt(key.split(':')[0], 10);
    if (!byChannel.has(ch)) byChannel.set(ch, []);
    byChannel.get(ch).push(key);
  }

  // Update each of the 16 possible channels
  for (let ch = 0; ch < 16; ch++) {
    updateLayer(ch, byChannel.get(ch) ?? []);
  }

  // Footer summary
  if (!activeNotes.size) {
    footerEl.textContent = 'Play a note or chord';
  } else {
    footerEl.textContent = getActiveSummary();
  }
}

/* ─── CLEAR ALL ─────────────────────────────────────────────── */
export function clearDisplay() {
  clearAllLayers();
  footerEl.textContent = 'Play a note or chord';
}