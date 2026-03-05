// editor/terrainEditor.js

import { getConfig }                                        from '../config.js';
import { applyHeightmapFromDataUrl, rescaleHeights }        from '../terrain/terrainMesh.js';

let _scene          = null;
let _panel          = null;
let _pendingDataUrl = null;

export function initTerrainEditor(scene) { _scene = scene; }

export function buildTerrainEditorPanel(container) {
  if (_panel) return;

  _panel = document.createElement('div');
  _panel.style.cssText = 'padding:8px;color:#fff;font-size:12px;';

  const cfg          = getConfig();
  const currentScale = cfg.terrain?.heightScale ?? 50;

  _panel.innerHTML = `
    <div style="margin-bottom:8px;font-weight:bold;color:#adf">🏔 Terrain</div>

    <label style="display:block;margin-bottom:6px">
      Height Scale: <span id="te-scale-val">${currentScale}</span>
      <input id="te-scale" type="range" min="1" max="400" value="${currentScale}"
             style="width:100%;margin-top:2px;accent-color:#4aee4a">
    </label>

    <label style="display:block;margin-bottom:4px;cursor:pointer">
      <span style="background:#1a3a1a;border:1px solid #3a6a3a;padding:3px 8px;
                   border-radius:3px;display:inline-block">
        📂 Choose Heightmap PNG
      </span>
      <input id="te-file" type="file" accept="image/png,image/jpeg" style="display:none">
    </label>
    <div id="te-file-label" style="font-size:11px;color:#8b8;margin-bottom:6px;min-height:14px"></div>

    <button id="te-apply" style="background:#3a5;color:#fff;border:none;padding:4px 12px;
      border-radius:3px;cursor:pointer;width:100%;margin-bottom:4px">
      Apply to Terrain
    </button>
    <div id="te-status" style="font-size:11px;color:#fa8;min-height:14px"></div>
  `;

  container.appendChild(_panel);

  const scaleSlider = _panel.querySelector('#te-scale');
  const scaleVal    = _panel.querySelector('#te-scale-val');
  const fileInput   = _panel.querySelector('#te-file');
  const fileLabel   = _panel.querySelector('#te-file-label');
  const applyBtn    = _panel.querySelector('#te-apply');
  const statusEl    = _panel.querySelector('#te-status');

  scaleSlider.addEventListener('input', () => {
    scaleVal.textContent = scaleSlider.value;
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload  = (e) => {
      _pendingDataUrl = e.target.result;
      fileLabel.textContent = `✔ ${file.name} — click Apply`;
      fileLabel.style.color = '#8f8';
    };
    reader.onerror = () => {
      fileLabel.textContent = '✘ Read error';
      fileLabel.style.color = '#f88';
    };
    reader.readAsDataURL(file);
  });

  applyBtn.addEventListener('click', async () => {
    if (!_scene) { statusEl.textContent = 'Scene not ready.'; return; }
    const scale = parseInt(scaleSlider.value, 10);

    applyBtn.disabled = true;

    if (_pendingDataUrl) {
      // New file — full rebuild
      statusEl.textContent = 'Building terrain…';
      try {
        await applyHeightmapFromDataUrl(_scene, _pendingDataUrl, scale);
        statusEl.textContent = `✔ Terrain loaded (scale ${scale})`;
        fileLabel.textContent = '';
        _pendingDataUrl = null;
      } catch(e) {
        statusEl.textContent = '✘ ' + e.message;
      }
    } else {
      // No new file — just rescale existing heightmap vertices
      statusEl.textContent = 'Rescaling…';
      try {
        rescaleHeights(scale);
        statusEl.textContent = `✔ Scale → ${scale}`;
      } catch(e) {
        statusEl.textContent = '✘ ' + e.message;
      }
    }

    applyBtn.disabled = false;
  });
}