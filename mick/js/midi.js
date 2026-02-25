import { midiNoteToName } from './theory.js';
import { initTone, synthAttack, synthRelease, synthReleaseAll, synthPanic, isToneReady } from './synth.js';
import { activeNotes, setStatus, updateDisplay } from './display.js';

/* ─── ELEMENTS ──────────────────────────────────────────────── */
const midiSelectEl = document.getElementById('midi-select');

/* ─── STATE ─────────────────────────────────────────────────── */
let midiAccess  = null;
let activeInput = null;

/* ─── MESSAGE HANDLER ───────────────────────────────────────── */
async function onMidiMessage(event) {
  const raw    = event.data;
  const status = raw[0];

  // Ignore all system realtime (clock 0xF8, active sense 0xFE, etc.)
  if (status >= 0xF0) return;

  const data1 = raw[1] ?? 0;
  const data2 = raw[2] ?? 0;
  const type  = status & 0xF0;
  const ch    = status & 0x0F;

  // Handle CC 120 (All Sound Off) and CC 123 (All Notes Off) — hardware panic
  if (type === 0xB0 && (data1 === 120 || data1 === 123)) {
    synthPanic();
    activeNotes.clear();
    setStatus('connected', 'Connected');
    updateDisplay();
    return;
  }

  // Only act on note messages — ignore all other CC, pitch bend, aftertouch
  if (type !== 0x90 && type !== 0x80) return;

  const noteName = midiNoteToName(data1);
  const key      = `${ch}:${data1}`;
  const isNoteOn = type === 0x90 && data2 > 0;

  if (isNoteOn) {
    if (!isToneReady()) await initTone();

    // Re-trigger: cleanly release previous voice if same key is already held
    if (activeNotes.has(key)) synthRelease(noteName, data1, ch);

    activeNotes.set(key, noteName);
    synthAttack(noteName, data2 / 127, data1, ch);
    setStatus('playing', 'Playing');
    updateDisplay();

  } else {
    // Note off — only process notes we actually registered
    if (!activeNotes.has(key)) return;

    activeNotes.delete(key);
    synthRelease(noteName, data1, ch);
    if (!activeNotes.size) setStatus('connected', 'Connected');
    updateDisplay();
  }
}

/* ─── CONNECT / DISCONNECT ──────────────────────────────────── */
function connectInput(inputId) {
  if (activeInput) { activeInput.onmidimessage = null; activeInput = null; }

  activeNotes.clear();
  synthReleaseAll();
  updateDisplay();

  if (!inputId || !midiAccess) { setStatus('', 'No device'); return; }

  activeInput = midiAccess.inputs.get(inputId);
  if (activeInput) {
    activeInput.onmidimessage = onMidiMessage;
    setStatus('connected', activeInput.name);
  }
}

function populateInputs() {
  const prev = midiSelectEl.value;
  while (midiSelectEl.options.length > 1) midiSelectEl.remove(1);
  midiAccess.inputs.forEach(inp => {
    const opt = document.createElement('option');
    opt.value = inp.id; opt.textContent = inp.name;
    midiSelectEl.appendChild(opt);
  });
  if (prev && midiAccess.inputs.has(prev)) midiSelectEl.value = prev;
}

midiSelectEl.addEventListener('change', () => connectInput(midiSelectEl.value));

/* ─── KEYBOARD PANIC (Escape) ───────────────────────────────── */
// Emergency kill-switch: press Escape to immediately silence all voices.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    synthPanic();
    activeNotes.clear();
    setStatus('connected', 'Connected');
    updateDisplay();
  }
});

/* ─── INIT ──────────────────────────────────────────────────── */
export async function initMIDI() {
  if (!('requestMIDIAccess' in navigator)) {
    document.getElementById('no-midi-warning').style.display = 'flex';
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    populateInputs();

    const firstId = midiAccess.inputs.keys().next().value;
    if (firstId) { midiSelectEl.value = firstId; connectInput(firstId); }

    midiAccess.onstatechange = e => {
      populateInputs();
      if (e.port.type === 'input' && e.port.state === 'disconnected'
          && activeInput && activeInput.id === e.port.id) {
        connectInput('');
        midiSelectEl.value = '';
        setStatus('', 'Disconnected');
      }
    };
  } catch(err) {
    setStatus('error', 'Access denied');
    console.error('MIDI error:', err);
  }
}