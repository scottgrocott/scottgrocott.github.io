import { midiNoteToName } from './theory.js';
import { initTone, synthAttack, synthRelease, synthReleaseAll, synthPanic, isToneReady } from './synth.js';
import { activeNotes, setStatus, updateDisplay, clearDisplay } from './display.js';
import { logActivity, setLayerActive } from './panel.js';
import { audioNoteOn, audioNoteOff, audioAllOff } from './audio.js';
import { feedNoteOn, feedNoteOff, startAnalysis, onAnalysis } from './analyze.js';
import { classify } from './classifier.js';
import { updateStyleDetection } from './panel.js';

let midiSelectEl = null;
let midiAccess   = null;
let activeInput  = null;

async function onMidiMessage(event) {
  const raw    = event.data;
  const status = raw[0];
  if (status >= 0xF0) return;

  const data1 = raw[1] ?? 0;
  const data2 = raw[2] ?? 0;
  const type  = status & 0xF0;
  const ch    = status & 0x0F;

  if (type === 0xB0 && (data1 === 120 || data1 === 123)) {
    synthPanic();
    audioAllOff();
    activeNotes.clear();
    for (let i = 0; i < 16; i++) setLayerActive(i, false);
    setStatus('connected', 'Connected');
    clearDisplay();
    logActivity('PANIC — all notes off', 'warn');
    return;
  }

  if (type !== 0x90 && type !== 0x80) return;

  const noteName = midiNoteToName(data1);
  const key      = `${ch}:${data1}`;
  const isNoteOn = type === 0x90 && data2 > 0;

  if (isNoteOn) {
    if (!isToneReady()) await initTone();
    if (activeNotes.has(key)) synthRelease(noteName, data1, ch);
    activeNotes.set(key, noteName);
    synthAttack(noteName, data2 / 127, data1, ch);
    audioNoteOn(ch);
    feedNoteOn(ch, data1, data2);
    setStatus('playing', 'Playing');
    updateDisplay();
    setLayerActive(ch, true);
    logActivity(`ON  ch${ch+1} ${noteName} vel=${data2}`, 'note-on');
  } else {
    if (!activeNotes.has(key)) return;
    activeNotes.delete(key);
    synthRelease(noteName, data1, ch);
    audioNoteOff(ch);
    feedNoteOff(ch, data1);
    if (!activeNotes.size) setStatus('connected', 'Connected');
    const chStillActive = [...activeNotes.keys()].some(k => parseInt(k.split(':')[0]) === ch);
    setLayerActive(ch, chStillActive);
    updateDisplay();
    logActivity(`OFF ch${ch+1} ${noteName}`, 'note-off');
  }
}

function connectInput(inputId) {
  if (activeInput) { activeInput.onmidimessage = null; activeInput = null; }
  activeNotes.clear();
  synthReleaseAll();
  clearDisplay();
  if (!inputId || !midiAccess) { setStatus('', 'No device'); return; }
  activeInput = midiAccess.inputs.get(inputId);
  if (activeInput) {
    activeInput.onmidimessage = onMidiMessage;
    setStatus('connected', activeInput.name);
    logActivity(`Connected: ${activeInput.name}`, 'good');
  }
}

function populateInputs() {
  if (!midiSelectEl) return;
  const prev = midiSelectEl.value;
  while (midiSelectEl.options.length > 1) midiSelectEl.remove(1);
  midiAccess.inputs.forEach(inp => {
    const opt = document.createElement('option');
    opt.value = inp.id;
    opt.textContent = inp.name;
    midiSelectEl.appendChild(opt);
  });
  if (prev && midiAccess.inputs.has(prev)) midiSelectEl.value = prev;
}

export async function initMIDI() {
  // Defer all DOM access to here
  midiSelectEl = document.getElementById('midi-select');

  midiSelectEl.addEventListener('change', () => connectInput(midiSelectEl.value));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      synthPanic();
      audioAllOff();
      activeNotes.clear();
      for (let i = 0; i < 16; i++) setLayerActive(i, false);
      setStatus('connected', 'Connected');
      clearDisplay();
      logActivity('ESC — panic', 'warn');
    }
  });

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
      logActivity(`Device ${e.port.state}: ${e.port.name}`);
      if (e.port.type === 'input' && e.port.state === 'disconnected'
          && activeInput?.id === e.port.id) {
        connectInput('');
        midiSelectEl.value = '';
        setStatus('', 'Disconnected');
      }
    };
  } catch(err) {
    setStatus('error', 'Access denied');
    logActivity('MIDI access denied: ' + err.message, 'err');
    console.error('MIDI error:', err);
  }

  // Start rolling analysis and connect to style detection UI
  startAnalysis();
  onAnalysis(features => {
    const result = classify(features);
    updateStyleDetection(result);
  });
}