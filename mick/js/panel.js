import { LAYER_CONFIG } from './layers.js';

let layerListEl = null;
let logEl       = null;
const MAX_LOG   = 80;

export function buildPanel() {
  layerListEl = document.getElementById('layer-list');
  logEl       = document.getElementById('activity-log');

  // Render top-to-bottom: lead (ch1) first, drums (ch10) last
  ;[...LAYER_CONFIG].reverse().forEach(cfg => {
    const row = document.createElement('div');
    row.className  = 'layer-row';
    row.id         = `panel-layer-${cfg.ch}`;

    const swatch = document.createElement('span');
    swatch.className        = 'layer-swatch';
    swatch.style.background = cfg.color === '#111111' ? '#333' : cfg.color;

    const name = document.createElement('span');
    name.className   = 'layer-name';
    name.textContent = `CH ${cfg.ch + 1} — ${cfg.label}`;

    const shader = document.createElement('span');
    shader.className   = 'layer-shader';
    shader.textContent = cfg.shader;

    const dot = document.createElement('span');
    dot.className = 'layer-indicator';
    dot.id        = `layer-ind-${cfg.ch}`;

    row.append(swatch, name, shader, dot);
    layerListEl.appendChild(row);
  });
}

export function setLayerActive(chIndex, active) {
  const dot = document.getElementById(`layer-ind-${chIndex}`);
  const row = document.getElementById(`panel-layer-${chIndex}`);
  if (dot) dot.className = active ? 'layer-indicator on' : 'layer-indicator';
  if (row) row.classList.toggle('active', active);
}

export function logActivity(msg, type = '') {
  if (!logEl) return;
  const d   = new Date();
  const ts  = `${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
  const row = document.createElement('div');
  row.className   = `log-row ${type}`;
  row.textContent = `[${ts}] ${msg}`;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > MAX_LOG) logEl.removeChild(logEl.firstChild);
}