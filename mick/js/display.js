import { NOTE_NAMES, midiNoteToName, detectChord } from './theory.js';
import { setVignetteTarget } from './scene.js';

/* ─── ELEMENTS ──────────────────────────────────────────────── */
const noteTextEl = document.getElementById('note-text');
const footerEl   = document.getElementById('footer');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

/* ─── ACTIVE NOTE STATE ─────────────────────────────────────── */
// Key: "ch:midiNum"  Value: Tone note name string (e.g. "C4")
// Keyed by channel so multi-channel devices (e.g. split keyboards) work correctly.
export const activeNotes = new Map();

/* ─── STATUS ────────────────────────────────────────────────── */
export function setStatus(cls, msg) {
  statusDot.className  = cls;
  statusText.textContent = msg;
}

/* ─── DISPLAY UPDATE ────────────────────────────────────────── */
export function updateDisplay() {
  const keys = [...activeNotes.keys()];
  const nums  = keys.map(k => parseInt(k.split(':')[1], 10));

  if (!keys.length) {
    noteTextEl.classList.remove('visible');
    setVignetteTarget(0);
    footerEl.textContent = 'Play a note or chord';
    return;
  }

  const label = detectChord(nums);
  noteTextEl.textContent = label;
  noteTextEl.classList.add('visible');
  setVignetteTarget(0.6);

  footerEl.textContent = nums.length === 1
    ? `${activeNotes.get(keys[0])}  ·  MIDI ${nums[0]}`
    : `${nums.length} notes  ·  ${label}`;
}
