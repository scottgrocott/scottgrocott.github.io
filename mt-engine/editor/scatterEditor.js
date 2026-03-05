// editor/scatterEditor.js — per-layer scatter density/sheet controls

import { CONFIG } from '../config.js';
import { rebuildScatterLayer, clearScatter, scatterProps } from '../scatter.js';

export function initScatterEditor(container) {
  if (!container) return;
  _renderLayers(container);
}

function _renderLayers(container) {
  container.innerHTML = '';
  const layers = CONFIG.scatterLayers || [];

  if (layers.length === 0) {
    const msg = document.createElement('div');
    msg.style.color = '#4a7a4a';
    msg.textContent = 'No scatter layers in config.';
    container.appendChild(msg);
  }

  layers.forEach((layer, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid #1a3a1a;padding:6px;margin-bottom:6px;';

    const label = document.createElement('div');
    label.textContent = `Layer ${i}: ${layer.category}`;
    label.style.color = '#6aaa6a';
    row.appendChild(label);

    // Density slider
    const dWrap = document.createElement('div');
    dWrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;';
    const dLabel = document.createElement('span');
    dLabel.textContent = 'Density:';
    dLabel.style.color = '#4a7a4a';
    const dSlider = document.createElement('input');
    dSlider.type = 'range'; dSlider.min = 0; dSlider.max = 1; dSlider.step = 0.01;
    dSlider.value = layer.density || 0.1;
    dSlider.style.accentColor = '#4aee4a';
    const dVal = document.createElement('span');
    dVal.textContent = layer.density || 0.1;
    dSlider.addEventListener('input', () => {
      layer.density = +dSlider.value;
      dVal.textContent = layer.density.toFixed(2);
    });
    dWrap.appendChild(dLabel); dWrap.appendChild(dSlider); dWrap.appendChild(dVal);
    row.appendChild(dWrap);

    // Rebuild button
    const rebuildBtn = document.createElement('button');
    rebuildBtn.textContent = 'Rebuild Layer';
    rebuildBtn.style.cssText = 'background:#0e1e0e;border:1px solid #3a6a3a;color:#8aee8a;cursor:pointer;padding:2px 6px;font-family:inherit;';
    rebuildBtn.addEventListener('click', () => rebuildScatterLayer(i));
    row.appendChild(rebuildBtn);

    container.appendChild(row);
  });

  const rebuildAllBtn = document.createElement('button');
  rebuildAllBtn.textContent = 'Rebuild All';
  rebuildAllBtn.style.cssText = 'background:#0e1e0e;border:1px solid #3a6a3a;color:#8aee8a;cursor:pointer;padding:3px 8px;width:100%;font-family:inherit;margin-top:4px;';
  rebuildAllBtn.addEventListener('click', () => { clearScatter(); scatterProps(); });
  container.appendChild(rebuildAllBtn);
}

export function rebuildAllLayers() {
  clearScatter();
  scatterProps();
}
