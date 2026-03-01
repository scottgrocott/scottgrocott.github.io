/* ═══════════════════════════════════════════════════════════════════════════
   toolpanel.js — Canvas tool panel  (smoothness rewrite)

   Fixes vs original:
   • Trigger timer only RESETS on canInteract going false — doesn't bleed-
     down while gesture flickers between pointing/null (common at boundaries)
   • Dwell has spatial hysteresis: small jitter (~2% canvas) doesn't cancel
     the dwell timer, only a real move to a new control resets it
   • _syncToChannel guarded so it only fires once per actual channel change
   • canInteract tolerates brief gesture gaps with a short grace period so
     moving over the control-panel sidebar doesn't instantly kill the state
   • Hit-test coordinate math simplified and cross-document safe
   ═══════════════════════════════════════════════════════════════════════════ */

import { getBrushSettings, setBrushSettings, clearPaint } from './brush.js';
import { setHandLayer } from './hand.js';
import { LAYER_CONFIG } from './layers.js';

/* ─── CONSTANTS ──────────────────────────────────────────────────────────── */
const TRIGGER_ZONE    = 0.07;   // left 7% of canvas width
const TRIGGER_SECS    = 2.0;    // dwell time to open
const DISMISS_SECS    = 4.0;    // idle time before auto-close
const DWELL_PICK_SECS = 1.0;    // dwell time to activate a control
const GRACE_SECS      = 0.35;   // gesture-gap grace period (no canInteract)
const DWELL_MOVE_THR  = 0.025;  // normalised dist before dwell resets (jitter buffer)

/* ─── STATE ──────────────────────────────────────────────────────────────── */
let containerEl    = null;
let panelEl        = null;
let triggerBarEl   = null;
let triggerFillEl  = null;
let dwellRingEl    = null;

let isOpen         = false;
let triggerTimer   = 0;
let dismissTimer   = 0;
let activeChannel  = 0;
let graceTimer     = 0;   // counts up while canInteract is false

let dwellEl        = null;
let dwellTimer     = 0;
let dwellOrigin    = null;  // {x,y} where current dwell started

let hue        = 0;
let saturation = 0.8;
let lightness  = 0.5;
let pickerHueCvs = null;
let pickerSLCvs  = null;

// Mouse state — normalised coords within container, updated every mousemove
let mouseNx       = null;   // null = mouse not over container
let mouseNy       = null;
let mouseOverPanel = false; // true when mouse is directly over the panel

/* ─── CONTAINER HELPER ───────────────────────────────────────────────────── */
function _getContainer() {
  return containerEl ?? document.getElementById('canvas-container');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════════════ */
export function setToolPanelContainer(newParent) {
  if (!newParent) return;
  containerEl = newParent;
  if (triggerBarEl) newParent.appendChild(triggerBarEl);
  if (panelEl)      newParent.appendChild(panelEl);
  if (dwellRingEl)  newParent.appendChild(dwellRingEl);
  mouseNx = null; mouseNy = null; mouseOverPanel = false;
  _attachMouseListeners();
}

export function initToolPanel() {
  containerEl = document.getElementById('canvas-container');
  LAYER_CONFIG.forEach(cfg => {
    const hex = cfg.color === '#111111' ? '#888888' : cfg.color;
    setBrushSettings(cfg.ch, { color: hex });
  });
  _buildTriggerBar();
  _buildPanel();
  _attachMouseListeners();
}

export function closeToolPanel()  { _closePanel(); }
export function isToolPanelOpen() { return isOpen; }

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildTriggerBar() {
  triggerBarEl = document.createElement('div');
  triggerBarEl.id = 'tool-trigger-bar';

  triggerFillEl = document.createElement('div');
  triggerFillEl.id = 'tool-trigger-fill';
  triggerBarEl.appendChild(triggerFillEl);

  _getContainer().appendChild(triggerBarEl);
}

function _buildPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'tool-panel';

  // ── Header row: title + layer dropdown ──────────────────────────────────
  const headerRow = document.createElement('div');
  headerRow.className = 'tp-header-row';

  const title = document.createElement('div');
  title.className   = 'tp-title';
  title.textContent = 'BRUSH';
  headerRow.appendChild(title);

  // Layer selector — lives at the top of the panel, replaces the plain label
  const layerSel = document.createElement('select');
  layerSel.id        = 'tp-layer-select';
  layerSel.className = 'tp-layer-select';
  LAYER_CONFIG.filter(c => c.ch <= 9).sort((a,b) => a.ch - b.ch).forEach(cfg => {
    const opt = document.createElement('option');
    opt.value       = cfg.ch;
    opt.textContent = `CH${cfg.ch + 1} ${cfg.label}`;
    layerSel.appendChild(opt);
  });
  layerSel.addEventListener('change', () => {
    activeChannel = parseInt(layerSel.value, 10);
    setHandLayer(activeChannel);   // drive hand cursor to same layer
    _syncToChannel(activeChannel);
  });
  headerRow.appendChild(layerSel);
  panelEl.appendChild(headerRow);

  _addToggle(panelEl, 'tp-enable', 'Brush Active', true, (val) => {
    setBrushSettings(activeChannel, { enabled: val });
  });

  _addColorPicker(panelEl);

  _addSlider(panelEl, 'tp-size',      'Size',      4, 120, 40,   1,
    v => setBrushSettings(activeChannel, { size: v }),
    v => `${Math.round(v)}px`);
  _addSlider(panelEl, 'tp-opacity',   'Opacity',   0, 1, 0.55, 0.01,
    v => setBrushSettings(activeChannel, { opacity: v }),
    v => `${Math.round(v*100)}%`);
  _addSlider(panelEl, 'tp-sheen',     'Sheen',     0, 1, 0.7,  0.01,
    v => setBrushSettings(activeChannel, { sheen: v }),
    v => v < 0.2 ? 'Matte' : v > 0.8 ? 'Gloss' : 'Satin');
  _addSlider(panelEl, 'tp-strength',  'Strength',  0, 1, 0.6,  0.01,
    v => setBrushSettings(activeChannel, { strength: v }),
    v => `${Math.round(v*100)}%`);
  _addSlider(panelEl, 'tp-viscosity', 'Viscosity', 0, 1, 0.55, 0.01,
    v => setBrushSettings(activeChannel, { viscosity: v }),
    v => v < 0.2 ? 'Water' : v > 0.8 ? 'Tar' : 'Oil');

  // Drip progress bar
  const dripRow = document.createElement('div');
  dripRow.className = 'tp-drip-row';
  dripRow.innerHTML = '<span class="tp-drip-label">Drip</span>';
  const dripBar  = document.createElement('div');
  dripBar.className = 'tp-drip-track';
  const dripFill = document.createElement('div');
  dripFill.className = 'tp-drip-fill';
  dripFill.id        = 'tp-drip-fill';
  dripBar.appendChild(dripFill);
  dripRow.appendChild(dripBar);
  panelEl.appendChild(dripRow);

  // Spacer pushes clear button to bottom of panel
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  panelEl.appendChild(spacer);

  // Clear button
  const clearBtn = document.createElement('div');
  clearBtn.className   = 'tp-clear-btn tp-dwell-target';
  clearBtn.id          = 'tp-clear';
  clearBtn.textContent = '✕ Clear Layer';
  clearBtn.setAttribute('data-action', 'clear');
  panelEl.appendChild(clearBtn);

  // Dwell ring
  dwellRingEl = document.createElement('div');
  dwellRingEl.id = 'tp-dwell-ring';
  dwellRingEl.innerHTML = `<svg viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="15" fill="none" stroke="#ffffff22" stroke-width="2"/>
    <circle id="tp-dwell-arc" cx="18" cy="18" r="15" fill="none" stroke="#ff6600"
            stroke-width="2.5" stroke-dasharray="0 94.25" stroke-linecap="round"
            transform="rotate(-90 18 18)"/>
  </svg>`;

  const cont = _getContainer();
  cont.appendChild(panelEl);
  cont.appendChild(dwellRingEl);
}

/* ─── TOGGLE ──────────────────────────────────────────────────────────── */
function _addToggle(parent, id, label, initial, onChange) {
  const row = document.createElement('div');
  row.className = 'tp-row tp-dwell-target';
  row.id        = id;
  row.setAttribute('data-type', 'toggle');

  const lbl = document.createElement('span');
  lbl.className   = 'tp-label';
  lbl.textContent = label;

  const indicator = document.createElement('div');
  indicator.className = initial ? 'tp-toggle on' : 'tp-toggle';
  indicator.id        = id + '-ind';

  row.append(lbl, indicator);

  const toggle = () => {
    const isOn = indicator.classList.contains('on');
    indicator.classList.toggle('on', !isOn);
    onChange(!isOn);
  };
  row.addEventListener('click', toggle);
  row._dwellActivate = toggle;

  parent.appendChild(row);
  return row;
}

/* ─── SLIDER ──────────────────────────────────────────────────────────── */
function _addSlider(parent, id, label, min, max, initial, step, onChange, fmtFn) {
  const row = document.createElement('div');
  row.className = 'tp-row tp-dwell-target';
  row.id        = id;
  row.setAttribute('data-type', 'slider');

  const lbl = document.createElement('span');
  lbl.className   = 'tp-label';
  lbl.textContent = label;

  const valEl = document.createElement('span');
  valEl.className   = 'tp-val';
  valEl.id          = id + '-val';
  valEl.textContent = fmtFn ? fmtFn(initial) : initial;

  const slider = document.createElement('input');
  slider.type      = 'range';
  slider.className = 'tp-slider';
  slider.min       = min;
  slider.max       = max;
  slider.step      = step;
  slider.value     = initial;
  slider.id        = id + '-input';

  const setVal = (v) => {
    // Snap to step
    const snapped = Math.round(v / step) * step;
    const clamped = Math.max(min, Math.min(max, snapped));
    slider.value = clamped;
    valEl.textContent = fmtFn ? fmtFn(clamped) : clamped;
    onChange(clamped);
  };

  slider.addEventListener('input', () => setVal(parseFloat(slider.value)));

  // Hand scrub: cursor X position maps across the slider track in real-time
  // Called every frame while cursor is hovering over this row
  row._scrubFromCursor = (nx, ny) => {
    const r = slider.getBoundingClientRect();
    const cont = _getContainer();
    const cRect = cont.getBoundingClientRect();
    const px = nx * cRect.width + cRect.left;
    const t = Math.max(0, Math.min(1, (px - r.left) / r.width));
    setVal(min + t * (max - min));
  };

  // _dwellActivate not needed for sliders — scrub handles it
  // But keep it so dwell ring still appears on hover
  row._dwellActivate = () => {};

  row.append(lbl, slider, valEl);
  parent.appendChild(row);
  return row;
}

/* ─── COLOR PICKER ────────────────────────────────────────────────────── */
function _addColorPicker(parent) {
  const section = document.createElement('div');
  section.className = 'tp-color-section';
  section.id        = 'tp-color';

  const lbl = document.createElement('div');
  lbl.className   = 'tp-label';
  lbl.textContent = 'Color';
  section.appendChild(lbl);

  pickerHueCvs = document.createElement('canvas');
  pickerHueCvs.className = 'tp-hue-strip tp-dwell-target';
  pickerHueCvs.id        = 'tp-hue-cvs';
  pickerHueCvs.width     = 180;
  pickerHueCvs.height    = 16;
  pickerHueCvs.setAttribute('data-type', 'hue');
  section.appendChild(pickerHueCvs);

  pickerSLCvs = document.createElement('canvas');
  pickerSLCvs.className = 'tp-sl-square tp-dwell-target';
  pickerSLCvs.id        = 'tp-sl-cvs';
  pickerSLCvs.width     = 180;
  pickerSLCvs.height    = 100;
  pickerSLCvs.setAttribute('data-type', 'sl');
  section.appendChild(pickerSLCvs);

  const swatch = document.createElement('div');
  swatch.className = 'tp-color-swatch';
  swatch.id        = 'tp-color-swatch';
  section.appendChild(swatch);

  parent.appendChild(section);

  requestAnimationFrame(() => { _drawHueStrip(); _drawSLSquare(); _updateSwatch(); });

  pickerHueCvs.addEventListener('click', e => {
    const r = pickerHueCvs.getBoundingClientRect();
    hue = ((e.clientX - r.left) / r.width) * 360;
    _applyColor();
  });
  pickerSLCvs.addEventListener('click', e => {
    const r = pickerSLCvs.getBoundingClientRect();
    saturation = (e.clientX - r.left) / r.width;
    lightness  = 1 - (e.clientY - r.top) / r.height;
    _applyColor();
  });
}

function _drawHueStrip() {
  if (!pickerHueCvs) return;
  const ctx = pickerHueCvs.getContext('2d');
  const w = pickerHueCvs.width, h = pickerHueCvs.height;
  const grad = ctx.createLinearGradient(0,0,w,0);
  for (let i = 0; i <= 12; i++) grad.addColorStop(i/12, `hsl(${i*30},100%,50%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);
  const cx = (hue/360)*w;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,h); ctx.stroke();
}

function _drawSLSquare() {
  if (!pickerSLCvs) return;
  const ctx = pickerSLCvs.getContext('2d');
  const w = pickerSLCvs.width, h = pickerSLCvs.height;
  const gradS = ctx.createLinearGradient(0,0,w,0);
  gradS.addColorStop(0, `hsl(${hue},0%,50%)`);
  gradS.addColorStop(1, `hsl(${hue},100%,50%)`);
  ctx.fillStyle = gradS; ctx.fillRect(0,0,w,h);
  const gradL = ctx.createLinearGradient(0,0,0,h);
  gradL.addColorStop(0,'rgba(255,255,255,1)');
  gradL.addColorStop(0.5,'rgba(255,255,255,0)');
  gradL.addColorStop(0.5,'rgba(0,0,0,0)');
  gradL.addColorStop(1,'rgba(0,0,0,1)');
  ctx.fillStyle = gradL; ctx.fillRect(0,0,w,h);
  const cx = saturation*w, cy = (1-lightness)*h;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.stroke();
}

function _updateSwatch() {
  const el = document.getElementById('tp-color-swatch');
  if (el) el.style.background = `hsl(${hue},${Math.round(saturation*100)}%,${Math.round(lightness*100)}%)`;
}

function _applyColor() {
  setBrushSettings(activeChannel, { color: _hslToHex(hue, saturation, lightness) });
  _drawHueStrip(); _drawSLSquare(); _updateSwatch();
}

function _hslToHex(h, s, l) {
  const a = s * Math.min(l, 1-l);
  const f = n => {
    const k = (n + h/30) % 12;
    const c = l - a * Math.max(-1, Math.min(k-3, 9-k, 1));
    return Math.round(255*c).toString(16).padStart(2,'0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/* ─── SYNC PANEL TO CHANNEL ──────────────────────────────────────────── */
function _syncToChannel(ch) {
  activeChannel = ch;
  const s   = getBrushSettings(ch);
  const cfg = LAYER_CONFIG.find(c => c.ch === ch);

  // Keep layer dropdown in sync
  const layerSel = document.getElementById('tp-layer-select');
  if (layerSel && parseInt(layerSel.value, 10) !== ch) layerSel.value = ch;

  const ind = document.getElementById('tp-enable-ind');
  if (ind) ind.classList.toggle('on', s.enabled);

  const syncSlider = (id, val) => {
    const el = document.getElementById(id + '-input');
    if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
  };
  syncSlider('tp-size',      s.size);
  syncSlider('tp-opacity',   s.opacity);
  syncSlider('tp-sheen',     s.sheen);
  syncSlider('tp-strength',  s.strength);
  syncSlider('tp-viscosity', s.viscosity);

  // Parse color → HSL
  const hex = s.color;
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
  lightness  = (mx+mn)/2;
  saturation = mx===mn ? 0 : (mx-mn)/(lightness>0.5 ? 2-mx-mn : mx+mn);
  if (mx===mn)      hue = 0;
  else if (mx===r)  hue = ((g-b)/(mx-mn) % 6) * 60;
  else if (mx===g)  hue = ((b-r)/(mx-mn) + 2) * 60;
  else              hue = ((r-g)/(mx-mn) + 4) * 60;
  if (hue < 0) hue += 360;

  requestAnimationFrame(() => { _drawHueStrip(); _drawSLSquare(); _updateSwatch(); });
}

/* ─── DWELL RING ──────────────────────────────────────────────────────── */
function _updateDwellRing(progress, el) {
  if (!dwellRingEl) return;
  if (!el || progress <= 0) { dwellRingEl.style.display = 'none'; return; }

  // Position ring over the hovered element, relative to container
  const cont  = _getContainer();
  const cRect = cont.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const cx    = eRect.left + eRect.width/2  - cRect.left;
  const cy    = eRect.top  + eRect.height/2 - cRect.top;

  dwellRingEl.style.display = 'block';
  dwellRingEl.style.left    = `${cx - 18}px`;
  dwellRingEl.style.top     = `${cy - 18}px`;

  const arc = document.getElementById('tp-dwell-arc');
  if (arc) arc.setAttribute('stroke-dasharray', `${94.25 * progress} 94.25`);
}

/* ─── HIT TESTING ──────────────────────────────────────────────────────── */

/**
 * Convert normalised canvas coords → viewport pixel coords.
 * Works whether panelEl is in the main page or a popup window.
 */
function _normToViewport(nx, ny) {
  const cont  = _getContainer();
  const cRect = cont.getBoundingClientRect();
  return {
    px: nx * cRect.width  + cRect.left,
    py: ny * cRect.height + cRect.top,
  };
}

function _getHoveredControl(nx, ny) {
  if (!panelEl || !isOpen) return null;
  const { px, py } = _normToViewport(nx, ny);
  for (const el of panelEl.querySelectorAll('.tp-dwell-target')) {
    const r = el.getBoundingClientRect();
    if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return el;
  }
  return null;
}

function _cursorInPanel(nx, ny) {
  if (!panelEl) return false;
  const { px, py } = _normToViewport(nx, ny);
  const r = panelEl.getBoundingClientRect();
  // Add small padding so cursor touching the edge counts as "in"
  const PAD = 12;
  return px >= r.left - PAD && px <= r.right  + PAD &&
         py >= r.top  - PAD && py <= r.bottom + PAD;
}

function _activateControl(el, nx, ny) {
  const type   = el.getAttribute('data-type');
  const action = el.getAttribute('data-action');

  if (action === 'clear') { clearPaint(activeChannel); return; }
  if (el._dwellActivate)  { el._dwellActivate(); return; }

  const { px, py } = _normToViewport(nx, ny);
  const eRect = el.getBoundingClientRect();

  if (type === 'hue') {
    hue = Math.max(0, Math.min(360, ((px - eRect.left) / eRect.width) * 360));
    _applyColor();
  }
  if (type === 'sl') {
    saturation = Math.max(0, Math.min(1, (px - eRect.left) / eRect.width));
    lightness  = Math.max(0.05, Math.min(0.95, 1 - (py - eRect.top) / eRect.height));
    _applyColor();
  }
}

/* ─── OPEN / CLOSE ────────────────────────────────────────────────────── */
function _openPanel() {
  isOpen = true; dismissTimer = 0;
  _syncToChannel(activeChannel);
  panelEl.classList.add('open');
}

function _closePanel() {
  isOpen = false; dismissTimer = 0; triggerTimer = 0;
  panelEl.classList.remove('open');
  dwellEl = null; dwellTimer = 0; dwellOrigin = null;
  _updateDwellRing(0, null);
  triggerFillEl.style.height = '0%';
  triggerBarEl.style.opacity = '0';
}

/* ═══════════════════════════════════════════════════════════════════════════
   MOUSE SUPPORT — open/use panel with the regular mouse cursor
   The mouse drives the same open/close/scrub logic as hand gestures.
   ═══════════════════════════════════════════════════════════════════════════ */
function _attachMouseListeners() {
  const cont = _getContainer();
  if (!cont) return;

  const toNorm = (e) => {
    const r = cont.getBoundingClientRect();
    return {
      nx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      ny: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
    };
  };

  // ── Container: track mouse position + trigger zone ──────────────────────
  cont.addEventListener('mousemove', e => {
    clearTimeout(panelEl?._closeTimeout);
    const { nx, ny } = toNorm(e);
    mouseNx = nx;
    mouseNy = ny;
    if (!isOpen && nx < TRIGGER_ZONE) _openPanel();

    // Scrub sliders on hover
    if (isOpen && !mouseOverPanel) {
      const hovered = _getHoveredControl(nx, ny);
      if (hovered?.getAttribute('data-type') === 'slider') {
        hovered._scrubFromCursor(nx, ny);
      }
    }
  });

  cont.addEventListener('mouseleave', () => {
    mouseNx = null;
    mouseNy = null;
    // If panel is open and mouse isn't over it, close after delay
    if (isOpen && !mouseOverPanel) {
      panelEl._closeTimeout = setTimeout(() => {
        if (!mouseOverPanel && mouseNx === null) _closePanel();
      }, 800);
    }
  });

  // ── Panel: direct enter/leave for reliable hide-on-mouseout ─────────────
  // We defer attaching these because panelEl is built after _attachMouseListeners
  // is first called from initToolPanel — use a small timeout to be safe.
  const attachPanelListeners = () => {
    if (!panelEl) return;

    panelEl.addEventListener('mouseleave', () => {
      mouseOverPanel = false;
      mouseNx = null;
      mouseNy = null;
      // Close after short delay — cancelled if mouse re-enters
      panelEl._closeTimeout = setTimeout(() => {
        if (!mouseOverPanel) _closePanel();
      }, 600);
    });

    panelEl.addEventListener('mouseenter', () => {
      mouseOverPanel = true;
      dismissTimer   = 0;
      clearTimeout(panelEl._closeTimeout);
    });

    panelEl.addEventListener('mousemove', e => {
      mouseOverPanel = true;
      dismissTimer   = 0;

      // Scrub sliders on hover within panel
      const r    = cont.getBoundingClientRect();
      const nx   = (e.clientX - r.left) / r.width;
      const ny   = (e.clientY - r.top)  / r.height;
      const hov  = _getHoveredControl(nx, ny);
      if (hov?.getAttribute('data-type') === 'slider') {
        hov._scrubFromCursor(nx, ny);
        // Auto-scroll panel so hovered element stays visible
        hov.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    // Click activates toggles / color pickers / clear instantly
    panelEl.addEventListener('click', e => {
      const r  = cont.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top)  / r.height;
      const hov = _getHoveredControl(nx, ny);
      if (hov) {
        const type = hov.getAttribute('data-type');
        if (type !== 'slider') _activateControl(hov, nx, ny);
      }
    });
  };

  // Attach immediately if panelEl exists, otherwise after next paint
  if (panelEl) {
    attachPanelListeners();
  } else {
    requestAnimationFrame(attachPanelListeners);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TICK — called every animation frame from main.js
   ═══════════════════════════════════════════════════════════════════════════ */
export function tickToolPanel(dt, cursorState, dwellProgress) {
  if (!panelEl) return;

  const { x, y, active, layerIndex, gesture } = cursorState;

  // NOTE: activeChannel is driven by the dropdown, not the hand cursor layer

  // Drip bar
  const dripFill = document.getElementById('tp-drip-fill');
  if (dripFill) dripFill.style.width = `${dwellProgress * 100}%`;

  // ── Mouse takes over when present ────────────────────────────────────────
  // If the mouse is over the container or panel, bypass gesture logic entirely.
  if (mouseNx !== null || mouseOverPanel) {
    if (isOpen && mouseOverPanel) dismissTimer = 0;
    _updateDwellRing(0, null);
    return;
  }

  // ── canInteract with grace period ────────────────────────────────────────
  // Pointing gesture (or no gesture = mouse fallback) lets you use the panel.
  // Brief gaps (gesture flicker, cursor leaving canvas edge) get a grace
  // window so timers don't reset on every stray null frame.
  const rawCanInteract = active && (gesture === 'pointing' || gesture === null);

  if (rawCanInteract) {
    graceTimer = 0;
  } else {
    graceTimer += dt;
  }

  // Effective canInteract: true while within grace window
  const canInteract = rawCanInteract || graceTimer < GRACE_SECS;

  if (!canInteract) {
    // Fully lost — bleed down trigger, accumulate dismiss
    triggerTimer = Math.max(0, triggerTimer - dt * 3);
    triggerFillEl.style.height = `${(triggerTimer / TRIGGER_SECS) * 100}%`;
    if (triggerTimer <= 0) triggerBarEl.style.opacity = '0';

    if (isOpen) {
      dismissTimer += dt;
      if (dismissTimer >= DISMISS_SECS) _closePanel();
    }
    _updateDwellRing(0, null);
    return;
  }

  // Reset dismiss while we can interact
  if (rawCanInteract && isOpen) dismissTimer = 0;

  const inPanel = isOpen && _cursorInPanel(x, y);

  // ── Panel closed: trigger zone ────────────────────────────────────────────
  if (!isOpen) {
    if (x < TRIGGER_ZONE) {
      triggerTimer += dt;
      triggerFillEl.style.height = `${Math.min(1, triggerTimer / TRIGGER_SECS) * 100}%`;
      triggerBarEl.style.opacity = '1';
      if (triggerTimer >= TRIGGER_SECS) {
        _openPanel();
        triggerTimer = 0;
        triggerFillEl.style.height = '0%';
        triggerBarEl.style.opacity = '0';
      }
    } else {
      // Bleed down gently so minor wobble doesn't restart
      triggerTimer = Math.max(0, triggerTimer - dt * 1.5);
      triggerFillEl.style.height = `${(triggerTimer / TRIGGER_SECS) * 100}%`;
      if (triggerTimer <= 0) triggerBarEl.style.opacity = '0';
    }
    return;
  }

  // ── Panel open ────────────────────────────────────────────────────────────
  if (inPanel) {
    dismissTimer = 0;
    const hovered = _getHoveredControl(x, y);

    if (hovered) {
      const isSlider = hovered.getAttribute('data-type') === 'slider';

      if (isSlider) {
        // Sliders: scrub continuously from cursor X — no dwell needed
        hovered._scrubFromCursor(x, y);
        _updateDwellRing(0, null);
        dwellEl = hovered; dwellTimer = 0; dwellOrigin = { x, y };
      } else if (dwellEl === hovered) {
        // Same non-slider control — accumulate dwell
        dwellTimer += dt;
        _updateDwellRing(Math.min(1, dwellTimer / DWELL_PICK_SECS), hovered);
        if (dwellTimer >= DWELL_PICK_SECS) {
          _activateControl(hovered, x, y);
          dwellTimer = 0;
          dwellOrigin = { x, y };
        }
      } else {
        // Moving to a different control — apply jitter buffer
        if (dwellOrigin) {
          const dx = x - dwellOrigin.x;
          const dy = y - dwellOrigin.y;
          const moved = Math.sqrt(dx*dx + dy*dy) > DWELL_MOVE_THR;
          if (!moved) {
            // Tiny jitter — keep counting on previous element
            if (dwellEl) {
              dwellTimer += dt;
              _updateDwellRing(Math.min(1, dwellTimer / DWELL_PICK_SECS), dwellEl);
            }
            return;
          }
        }
        // Genuine move to new control
        dwellEl     = hovered;
        dwellTimer  = 0;
        dwellOrigin = { x, y };
        _updateDwellRing(0, null);
      }
    } else {
      // No dwell target under cursor — idle inside panel
      dwellEl = null; dwellTimer = 0; dwellOrigin = null;
      _updateDwellRing(0, null);
    }
  } else {
    // Cursor outside panel
    dwellEl = null; dwellTimer = 0; dwellOrigin = null;
    _updateDwellRing(0, null);
    dismissTimer += dt;
    if (dismissTimer >= DISMISS_SECS) _closePanel();
  }
}