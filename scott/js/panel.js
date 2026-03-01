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
import { initHand, setPreviewCanvas, startCalibration, clearCalibration, onCalibrationChange } from './hand.js';

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
  /* ══════════════════════════════════════════════════════════════
     Build the hand tracking panel as a FIXED bottom-left overlay
     on the main page. This is a large, prominent panel separate
     from the right control panel sidebar.
     ══════════════════════════════════════════════════════════════ */
  const panel = document.createElement('div');
  panel.id = 'hand-panel';

  /* ── HEADER BAR ── */
  const header = document.createElement('div');
  header.className = 'hand-panel-header';
  header.innerHTML = `<span class="hand-panel-title">HAND CURSOR</span>`;

  /* ── COLLAPSE TOGGLE ── */
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'hand-panel-collapse';
  collapseBtn.textContent = '▾';
  collapseBtn.title = 'Collapse panel';
  header.appendChild(collapseBtn);
  panel.appendChild(header);

  /* ── BODY (collapsible) ── */
  const body = document.createElement('div');
  body.id = 'hand-panel-body';

  /* ── CAMERA PREVIEW CANVAS ── */
  const previewCanvas = document.createElement('canvas');
  previewCanvas.id     = 'hand-preview';
  previewCanvas.width  = 640;
  previewCanvas.height = 360;
  body.appendChild(previewCanvas);
  setPreviewCanvas(previewCanvas);

  /* ── STATUS LINE ── */
  _handStatusEl = document.createElement('div');
  _handStatusEl.id = 'hand-status';
  body.appendChild(_handStatusEl);
  _setHandStatus('Inactive — click Enable to start');

  /* ── CONTROLS ROW ── */
  const ctrlRow = document.createElement('div');
  ctrlRow.className = 'hand-panel-controls';

  /* Enable button */
  _handEnableBtn = document.createElement('button');
  _handEnableBtn.id          = 'hand-enable-btn';
  _handEnableBtn.className   = 'action-btn hand-enable-btn';
  _handEnableBtn.textContent = '◉ Enable Tracking';
  ctrlRow.appendChild(_handEnableBtn);

  // Layer selection moved to tool panel dropdown
  body.appendChild(ctrlRow);

  /* ── CALIBRATION CONTROLS ── */
  const calibSection = document.createElement('div');
  calibSection.className = 'hand-calib-section';

  const calibLabel = document.createElement('div');
  calibLabel.className   = 'hand-calib-label';
  calibLabel.textContent = 'CANVAS CALIBRATION';
  calibSection.appendChild(calibLabel);

  const calibStatus = document.createElement('div');
  calibStatus.id        = 'hand-calib-status';
  calibStatus.className = 'hand-calib-status';
  calibStatus.textContent = 'No calibration — using full frame';
  calibSection.appendChild(calibStatus);

  const calibBtns = document.createElement('div');
  calibBtns.className = 'hand-calib-btns';

  const startCalibBtn = document.createElement('button');
  startCalibBtn.id          = 'hand-calib-start';
  startCalibBtn.className   = 'hand-calib-btn hand-calib-btn-start';
  startCalibBtn.textContent = '⊹ Start Calibration';
  startCalibBtn.title       = 'Click 4 corners on the preview (TL → TR → BR → BL)';

  const clearCalibBtn = document.createElement('button');
  clearCalibBtn.id          = 'hand-calib-clear';
  clearCalibBtn.className   = 'hand-calib-btn hand-calib-btn-clear';
  clearCalibBtn.textContent = '✕ Clear';
  clearCalibBtn.title       = 'Remove calibration, revert to full frame';

  calibBtns.append(startCalibBtn, clearCalibBtn);
  calibSection.appendChild(calibBtns);
  body.appendChild(calibSection);

  /* ── Wire calibration callbacks ── */
  startCalibBtn.addEventListener('click', () => {
    if (!_handEnabled) {
      _setHandStatus('Enable hand tracking first');
      return;
    }
    startCalibration();
  });

  clearCalibBtn.addEventListener('click', () => {
    clearCalibration();
  });

  onCalibrationChange(({ phase, pointsCollected }) => {
    const statusEl = document.getElementById('hand-calib-status');
    if (!statusEl) return;
    if (phase === 'collecting') {
      statusEl.textContent = `Collecting: click corner ${pointsCollected + 1} of 4 on the preview`;
      statusEl.className   = 'hand-calib-status collecting';
      startCalibBtn.textContent = `⊹ ${pointsCollected}/4 — Click next corner`;
    } else if (phase === 'done') {
      statusEl.textContent = '✓ Calibrated — canvas mapped';
      statusEl.className   = 'hand-calib-status done';
      startCalibBtn.textContent = '⊹ Recalibrate';
    } else {
      statusEl.textContent = 'No calibration — using full frame';
      statusEl.className   = 'hand-calib-status';
      startCalibBtn.textContent = '⊹ Start Calibration';
    }
  });

  panel.appendChild(body);

  /* ── COLLAPSE LOGIC ── */
  let collapsed = false;
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display    = collapsed ? 'none' : '';
    collapseBtn.textContent = collapsed ? '▸' : '▾';
  });

  /* ── WIRE BUTTONS ── */
  _handEnableBtn.addEventListener('click', () => _enableHandTracking());

  /* ── APPEND TO BODY (fixed position, outside panel sidebar) ── */
  document.body.appendChild(panel);
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
    _setHandStatus('Point your index finger at the screen');
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