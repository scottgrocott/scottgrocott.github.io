/* ═══════════════════════════════════════════════════════════════════════════
   panel.js — Control panel builder + hand-tracking UI

   Hand Tracking section (always visible, no toggle):
     • Camera preview canvas (16:9, mirrors webcam feed via hand.js tickHand)
     • "Enable Hand Tracking" action button (lazy-loads MediaPipe on click)
     • Dropdown to select which layer the hand cursor is assigned to
     • Status line showing tracking state

   Everything else is unchanged from the original.
   ═══════════════════════════════════════════════════════════════════════════ */

import { LAYER_CONFIG, GEO_ALGORITHMS, setLayerAlgorithm } from './layers.js';
import { voices }                                           from './synth.js';
import { initHand, setHandLayer, setPreviewCanvas,
         startCalibration, clearCalibration, isCalibrated,
         onCalibrationChange }                              from './hand.js';

let layerListEl = null;
let logEl       = null;
const MAX_LOG   = 80;

/* ═══════════════════════════════════════════════════════════════
   BUILD PANEL
   Injects all sections into #control-panel in order:
     MIDI → Audio → Hand Tracking → Style Detection → Channel Layers → Activity
   ═══════════════════════════════════════════════════════════════ */
export function buildPanel() {
  layerListEl = document.getElementById('layer-list');
  logEl       = document.getElementById('activity-log');

  // Inject the hand tracking section before the style section
  _buildHandSection();

  // Build the channel layer list (collapsible rows)
  ;[...LAYER_CONFIG].reverse().forEach(cfg => {
    const ch = cfg.ch;

    const wrapper = document.createElement('div');
    wrapper.className = 'layer-wrapper';
    wrapper.id = `panel-layer-${ch}`;

    const header = document.createElement('div');
    header.className = 'layer-row';
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'false');

    const swatch = document.createElement('span');
    swatch.className        = 'layer-swatch';
    swatch.style.background = cfg.color === '#111111' ? '#333' : cfg.color;

    const name = document.createElement('span');
    name.className   = 'layer-name';
    name.textContent = `CH ${ch + 1} — ${cfg.label}`;

    const shader = document.createElement('span');
    shader.className   = 'layer-shader';
    shader.textContent = cfg.shader;

    const dot = document.createElement('span');
    dot.className = 'layer-indicator';
    dot.id        = `layer-ind-${ch}`;

    const chevron = document.createElement('span');
    chevron.className = 'layer-chevron';
    chevron.textContent = '›';

    header.append(swatch, name, shader, dot, chevron);

    const body = document.createElement('div');
    body.className = 'layer-body';
    body.id = `layer-body-${ch}`;

    wrapper.append(header, body);
    layerListEl.appendChild(wrapper);

    header.addEventListener('click', () => {
      const isOpen = body.classList.contains('open');
      if (!isOpen) {
        body.classList.add('open');
        header.setAttribute('aria-expanded', 'true');
        chevron.classList.add('open');
        if (!body.dataset.built) {
          buildChannelGUI(body, ch);
          body.dataset.built = 'true';
        }
      } else {
        body.classList.remove('open');
        header.setAttribute('aria-expanded', 'false');
        chevron.classList.remove('open');
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   HAND TRACKING SECTION
   ═══════════════════════════════════════════════════════════════ */
let _handStatusEl  = null;
let _handEnableBtn = null;
let _handEnabled   = false;

function _buildHandSection() {
  // Insert before the style section
  const styleSection = document.getElementById('style-section');
  if (!styleSection) return;

  const section = document.createElement('section');
  section.className = 'panel-section';
  section.id        = 'hand-section';

  /* ── SECTION LABEL ── */
  const sectionLabel = document.createElement('div');
  sectionLabel.className   = 'section-label';
  sectionLabel.textContent = 'Hand Cursor';
  section.appendChild(sectionLabel);

  /* ── CAMERA PREVIEW CANVAS — always visible ── */
  const previewCanvas = document.createElement('canvas');
  previewCanvas.id     = 'hand-preview';
  previewCanvas.width  = 288;
  previewCanvas.height = 162;
  section.appendChild(previewCanvas);

  // Register with hand.js so tickHand() can draw to it immediately
  setPreviewCanvas(previewCanvas);

  /* ── ENABLE BUTTON ── */
  _handEnableBtn = document.createElement('button');
  _handEnableBtn.id          = 'hand-enable-btn';
  _handEnableBtn.className   = 'action-btn';
  _handEnableBtn.textContent = '◉ Enable Hand Tracking';
  _handEnableBtn.style.marginTop = '8px';
  section.appendChild(_handEnableBtn);

  /* ── STATUS LINE ── */
  _handStatusEl = document.createElement('div');
  _handStatusEl.id = 'hand-status';
  section.appendChild(_handStatusEl);
  _setHandStatus('Inactive — click Enable to start');

  /* ── CALIBRATION CONTROLS ── */
  const calibRow = document.createElement('div');
  calibRow.style.cssText = 'display:flex; gap:6px; margin-top:8px;';

  const calibBtn = document.createElement('button');
  calibBtn.id          = 'calib-btn';
  calibBtn.className   = 'calib-btn';
  calibBtn.textContent = '⊹ Calibrate Canvas';

  const clearBtn = document.createElement('button');
  clearBtn.id          = 'calib-clear-btn';
  clearBtn.className   = 'calib-clear-btn';
  clearBtn.textContent = '✕';
  clearBtn.title       = 'Clear calibration';
  clearBtn.style.display = 'none';

  calibRow.append(calibBtn, clearBtn);
  section.appendChild(calibRow);

  const calibStatusEl = document.createElement('div');
  calibStatusEl.id        = 'calib-status';
  calibStatusEl.className = 'calib-status';
  section.appendChild(calibStatusEl);

  // Wire calibration state changes → UI feedback
  onCalibrationChange(({ phase, pointsCollected }) => {
    const cornerNames = ['top-left','top-right','bottom-right','bottom-left'];
    const cornerCodes = ['TL','TR','BR','BL'];
    if (phase === 'collecting') {
      calibBtn.textContent    = `◉ Click ${cornerCodes[pointsCollected]}… (${pointsCollected}/4)`;
      calibBtn.classList.add('collecting');
      clearBtn.style.display  = 'none';
      calibStatusEl.textContent = `Step ${pointsCollected + 1}/4 — click the ${cornerNames[pointsCollected]} corner of the physical canvas`;
      calibStatusEl.className = 'calib-status collecting';
      previewCanvas.style.cursor = 'crosshair';
    } else if (phase === 'done') {
      calibBtn.textContent    = '⊹ Recalibrate';
      calibBtn.classList.remove('collecting');
      clearBtn.style.display  = 'block';
      calibStatusEl.textContent = '✓ Calibrated — saved to storage';
      calibStatusEl.className = 'calib-status done';
      previewCanvas.style.cursor = 'default';
    } else {
      calibBtn.textContent    = '⊹ Calibrate Canvas';
      calibBtn.classList.remove('collecting');
      clearBtn.style.display  = 'none';
      calibStatusEl.textContent = _handEnabled ? 'No calibration — full-frame mode' : '';
      calibStatusEl.className = 'calib-status';
      previewCanvas.style.cursor = 'default';
    }
  });

  calibBtn.addEventListener('click', () => {
    if (!_handEnabled) {
      calibStatusEl.textContent = 'Enable hand tracking first';
      calibStatusEl.className   = 'calib-status warn';
      return;
    }
    startCalibration();
  });

  clearBtn.addEventListener('click', () => {
    clearCalibration();
  });

  /* ── LAYER DROPDOWN ── */
  const dropRow = document.createElement('div');
  dropRow.className = 'row';
  dropRow.style.marginTop = '8px';

  const dropLabel = document.createElement('span');
  dropLabel.className   = 'section-label';
  dropLabel.style.cssText = 'margin:0; white-space:nowrap;';
  dropLabel.textContent = 'Hand Layer';

  const layerSelect = document.createElement('select');
  layerSelect.id        = 'hand-layer-select';
  layerSelect.className = 'hand-layer-select';

  // Populate with the 10 main channels (CH 1-10, indices 0-9)
  // Listed in natural CH order (1 at top)
  const MAIN_CHANNELS = [...LAYER_CONFIG]
    .filter(cfg => cfg.ch <= 9)
    .sort((a, b) => a.ch - b.ch);

  MAIN_CHANNELS.forEach(cfg => {
    const opt = document.createElement('option');
    opt.value       = cfg.ch;
    opt.textContent = `CH ${cfg.ch + 1} — ${cfg.label}`;
    // Color swatch via data attribute (used in CSS for the left border trick)
    opt.dataset.color = cfg.color === '#111111' ? '#888888' : cfg.color;
    layerSelect.appendChild(opt);
  });

  layerSelect.addEventListener('change', () => {
    const ch = parseInt(layerSelect.value, 10);
    setHandLayer(ch);
    _updateDropdownAccent(layerSelect, ch);
  });

  dropRow.append(dropLabel, layerSelect);
  section.appendChild(dropRow);

  // Set initial accent to CH 1
  _updateDropdownAccent(layerSelect, 0);

  // Wire enable button
  _handEnableBtn.addEventListener('click', () => _enableHandTracking());

  // Insert before style-section
  styleSection.insertAdjacentElement('beforebegin', section);
}

/* ── ENABLE HAND TRACKING (lazy-loads MediaPipe on first click) ── */
async function _enableHandTracking() {
  if (_handEnabled) return;

  _handEnableBtn.textContent = '⟳ Loading...';
  _handEnableBtn.disabled    = true;
  _setHandStatus('Loading MediaPipe Hands...');

  try {
    await initHand();
    _handEnabled = true;
    _handEnableBtn.textContent = '✓ Hand Tracking Active';
    _handEnableBtn.style.background = '#00aa55';
    if (!isCalibrated()) {
      _setHandStatus('Tip: calibrate canvas for precise tracking');
    } else {
      _setHandStatus('Calibrated tracking active');
    }
    logActivity('Hand tracking enabled', 'good');
  } catch(err) {
    _handEnableBtn.textContent = '✕ Error — click to retry';
    _handEnableBtn.disabled    = false;
    _setHandStatus(`Error: ${err.message ?? 'unknown'}`);
    logActivity(`Hand init failed: ${err.message}`, 'err');
    console.error('[Panel] Hand init error:', err);
  }
}

function _setHandStatus(msg) {
  if (_handStatusEl) _handStatusEl.textContent = msg;
}

// Update the dropdown's left border to the active layer color
function _updateDropdownAccent(selectEl, chIndex) {
  const cfg = LAYER_CONFIG.find(c => c.ch === chIndex);
  if (!cfg) return;
  const color = cfg.color === '#111111' ? '#888888' : cfg.color;
  selectEl.style.borderLeftColor = color;
  selectEl.style.borderLeftWidth = '3px';
}

/* ═══════════════════════════════════════════════════════════════
   CHANNEL GUI (synth params, geometry selector)
   ═══════════════════════════════════════════════════════════════ */
function buildChannelGUI(container, ch) {
  /* ── GEOMETRY ALGORITHM ── */
  addSection(container, 'Geometry');

  const algoRow = document.createElement('div');
  algoRow.className = 'gui-row gui-row-full';

  const algoLbl = document.createElement('span');
  algoLbl.className   = 'gui-label';
  algoLbl.textContent = 'Algorithm';

  const algoSel = document.createElement('select');
  algoSel.className = 'gui-select gui-select-full';

  GEO_ALGORITHMS.forEach((alg, idx) => {
    const opt = document.createElement('option');
    opt.value       = idx;
    opt.textContent = alg.label;
    if (idx === 0) opt.selected = true;
    algoSel.appendChild(opt);
  });

  algoSel.addEventListener('change', () => {
    setLayerAlgorithm(ch, parseInt(algoSel.value, 10));
  });

  algoRow.append(algoLbl, algoSel);
  container.appendChild(algoRow);

  /* ── SYNTH PARAMS — lazy, require audio ── */
  const voice = voices[ch];
  if (!voice) {
    const placeholder = document.createElement('div');
    placeholder.className   = 'gui-placeholder';
    placeholder.textContent = 'Enable audio to edit synth parameters.';
    container.appendChild(placeholder);
    const poll = setInterval(() => {
      if (voices[ch]) {
        clearInterval(poll);
        placeholder.remove();
        buildSynthGUI(container, ch);
      }
    }, 500);
    return;
  }
  buildSynthGUI(container, ch);
}

function buildSynthGUI(container, ch) {
  const { synth, effects, volume } = voices[ch];

  addSection(container, 'Volume');
  addKnobRow(container, 'Vol (dB)', volume.volume.value, -40, 6, 1,
    val => { volume.volume.rampTo(val, 0.05); },
    v => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`);

  if (!synth.isDrums && !synth.isPluckPool && voices[ch].oscType !== null) {
    addSection(container, 'Oscillator');
    addSelectRow(container, 'Waveform', voices[ch].oscType,
      ['sine', 'triangle', 'sawtooth', 'square', 'pwm'],
      val => { try { synth.set({ oscillator: { type: val } }); } catch(e) {} });
  }

  if (!synth.isDrums && !synth.isPluckPool && voices[ch].env) {
    addSection(container, 'Envelope');
    const env = voices[ch].env;
    addKnobRow(container, 'Attack',  env.attack,  0.001, 4,    0.001, val => { env.attack  = val; try { synth.set({ envelope: { attack:  val } }); } catch(e) {} }, v => `${v.toFixed(3)}s`);
    addKnobRow(container, 'Decay',   env.decay,   0.001, 4,    0.001, val => { env.decay   = val; try { synth.set({ envelope: { decay:   val } }); } catch(e) {} }, v => `${v.toFixed(3)}s`);
    addKnobRow(container, 'Sustain', env.sustain, 0,     1,    0.01,  val => { env.sustain = val; try { synth.set({ envelope: { sustain: val } }); } catch(e) {} }, v => v.toFixed(2));
    addKnobRow(container, 'Release', env.release, 0.001, 8,    0.01,  val => { env.release = val; try { synth.set({ envelope: { release: val } }); } catch(e) {} }, v => `${v.toFixed(2)}s`);
  }

  const fxEntries = Object.entries(effects);
  if (fxEntries.length) addSection(container, 'Effects');

  fxEntries.forEach(([name, node]) => {
    if (name === 'reverb') {
      addSubLabel(container, '— Reverb');
      addKnobRow(container, 'Wet',   node.wet.value, 0, 1,    0.01, val => node.wet.rampTo(val, 0.1),        v => `${Math.round(v * 100)}%`);
      addKnobRow(container, 'Decay', node.decay,     0.1, 20, 0.1,  val => { node.decay = val; },            v => `${v.toFixed(1)}s`);
    } else if (name === 'chorus') {
      addSubLabel(container, '— Chorus');
      addKnobRow(container, 'Wet',   node.wet.value,       0, 1,   0.01, val => node.wet.rampTo(val, 0.1),       v => `${Math.round(v * 100)}%`);
      addKnobRow(container, 'Depth', node.depth,           0, 1,   0.01, val => { node.depth = val; },            v => v.toFixed(2));
      addKnobRow(container, 'Freq',  node.frequency.value, 0.1, 10, 0.1, val => { node.frequency.value = val; },  v => `${v.toFixed(1)}Hz`);
    } else if (name === 'feedbackDelay') {
      addSubLabel(container, '— Feedback Delay');
      addKnobRow(container, 'Wet',      node.wet.value,      0, 1,    0.01, val => node.wet.rampTo(val, 0.1),       v => `${Math.round(v * 100)}%`);
      addKnobRow(container, 'Feedback', node.feedback.value, 0, 0.95, 0.01, val => node.feedback.rampTo(val, 0.05), v => v.toFixed(2));
    } else if (name === 'pingpong') {
      addSubLabel(container, '— Ping Pong Delay');
      addKnobRow(container, 'Wet',      node.wet.value,      0, 1,    0.01, val => node.wet.rampTo(val, 0.1),       v => `${Math.round(v * 100)}%`);
      addKnobRow(container, 'Feedback', node.feedback.value, 0, 0.95, 0.01, val => node.feedback.rampTo(val, 0.05), v => v.toFixed(2));
    } else if (name === 'filter') {
      addSubLabel(container, '— Filter');
      addKnobRow(container, 'Cutoff', node.frequency.value, 20, 20000, 10,  val => node.frequency.rampTo(val, 0.05), v => v < 1000 ? `${Math.round(v)}Hz` : `${(v / 1000).toFixed(1)}kHz`);
      addKnobRow(container, 'Q',      node.Q.value,         0.1, 20,   0.1, val => node.Q.rampTo(val, 0.05),         v => v.toFixed(1));
    } else if (name === 'distortion') {
      addSubLabel(container, '— Distortion');
      addKnobRow(container, 'Drive', node.distortion,  0, 1, 0.01, val => { node.distortion = val; },  v => v.toFixed(2));
      addKnobRow(container, 'Wet',   node.wet.value,   0, 1, 0.01, val => node.wet.rampTo(val, 0.1),  v => `${Math.round(v * 100)}%`);
    }
  });

  if (synth.isDrums) {
    addSection(container, 'Drum Volumes');
    addKnobRow(container, 'Kick',   synth.membrane.volume.value, -40, 6, 1, val => synth.membrane.volume.rampTo(val, 0.05), v => `${v.toFixed(0)} dB`);
    addKnobRow(container, 'Cymbal', synth.metal.volume.value,    -40, 6, 1, val => synth.metal.volume.rampTo(val, 0.05),    v => `${v.toFixed(0)} dB`);
    addKnobRow(container, 'Snare',  synth.noise.volume.value,    -40, 6, 1, val => synth.noise.volume.rampTo(val, 0.05),    v => `${v.toFixed(0)} dB`);
  }
}

/* ═══════════════════════════════════════════════════════════════
   GUI HELPERS
   ═══════════════════════════════════════════════════════════════ */
function addSection(container, title) {
  const el = document.createElement('div');
  el.className   = 'gui-section-label';
  el.textContent = title;
  container.appendChild(el);
}

function addSubLabel(container, title) {
  const el = document.createElement('div');
  el.className   = 'gui-sub-label';
  el.textContent = title;
  container.appendChild(el);
}

function addKnobRow(container, label, initVal, min, max, step, onChange, fmt) {
  const row = document.createElement('div');
  row.className = 'gui-row';

  const lbl = document.createElement('span');
  lbl.className   = 'gui-label';
  lbl.textContent = label;

  const slider = document.createElement('input');
  slider.type      = 'range';
  slider.className = 'gui-slider';
  slider.min       = min;
  slider.max       = max;
  slider.step      = step;
  slider.value     = Math.max(min, Math.min(max, isFinite(initVal) ? initVal : min));

  const val = document.createElement('span');
  val.className   = 'gui-value';
  val.textContent = fmt ? fmt(parseFloat(slider.value)) : parseFloat(slider.value).toFixed(2);

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    val.textContent = fmt ? fmt(v) : v.toFixed(2);
    onChange(v);
  });

  row.append(lbl, slider, val);
  container.appendChild(row);
}

function addSelectRow(container, label, initVal, options, onChange) {
  const row = document.createElement('div');
  row.className = 'gui-row';

  const lbl = document.createElement('span');
  lbl.className   = 'gui-label';
  lbl.textContent = label;

  const sel = document.createElement('select');
  sel.className = 'gui-select';
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value       = o;
    opt.textContent = o;
    if (o === initVal) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));

  row.append(lbl, sel);
  container.appendChild(row);
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════ */
export function setLayerActive(chIndex, active) {
  const dot     = document.getElementById(`layer-ind-${chIndex}`);
  const wrapper = document.getElementById(`panel-layer-${chIndex}`);
  if (dot)     dot.className = active ? 'layer-indicator on' : 'layer-indicator';
  if (wrapper) wrapper.querySelector('.layer-row')?.classList.toggle('active', active);
}

export function logActivity(msg, type = '') {
  if (!logEl) return;
  const d   = new Date();
  const ts  = `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const row = document.createElement('div');
  row.className   = `log-row ${type}`;
  row.textContent = `[${ts}] ${msg}`;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > MAX_LOG) logEl.removeChild(logEl.firstChild);
}

/* ── STYLE DETECTION ── */
let styleGenreEl    = null;
let styleSubgenreEl = null;
let styleContextEl  = null;
let styleBarEls     = [];

export function initStylePanel() {
  styleGenreEl    = document.getElementById('style-genre');
  styleSubgenreEl = document.getElementById('style-subgenre');
  styleContextEl  = document.getElementById('style-context');
  styleBarEls     = [
    document.getElementById('style-bar-0'),
    document.getElementById('style-bar-1'),
    document.getElementById('style-bar-2'),
  ];
}

export function updateStyleDetection(result) {
  if (!styleGenreEl) return;
  styleGenreEl.textContent    = result.top;
  styleSubgenreEl.textContent = result.subgenre ?? '';
  styleContextEl.textContent  = result.context  ?? '';

  result.ranked.slice(0, 3).forEach((r, i) => {
    const barEl = styleBarEls[i];
    if (!barEl) return;
    const row = barEl.closest('.style-bar-row');
    if (row) row.querySelector('.style-bar-label').textContent = r.genre;
    barEl.style.width   = `${r.confidence}%`;
    barEl.style.opacity = i === 0 ? '1' : '0.55';
  });
}