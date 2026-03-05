// editor/editor.js — master editor panel (localhost-only, always built-in)

import { CONFIG, getConfig } from '../config.js';
import { playerRig } from '../player.js';
import { getShelterDesignIds, spawnShelterByDesign, clearShelters } from '../shelters/shelters.js';
import { capturePlayerPosition } from '../shelters/utils.js';
import { suspendMouse } from '../inputGuard.js';
import { getEnemyCount } from '../enemies/enemyRegistry.js';
import { rebuildScatterLayer } from '../scatter.js';
import { applyHeightmapFromDataUrl, rescaleHeights } from '../terrain/terrainMesh.js';
import { dropOnStart } from '../spawn.js';

let _scene = null;
let _pendingHeightmapDataUrl = null;

export function initEditorScene(scene) { _scene = scene; }

const IS_LOCALHOST = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

let _panel   = null;
let _open    = false;
let _getPlayerPos = null;
let _logEl   = null;
let _countdownActive = false;

export function initEditor(getPosFn) {
  if (!IS_LOCALHOST) return;
  _getPlayerPos = getPosFn;
  _buildPanel();
  console.log('[editor] Editor initialized (localhost)');
}

export function tickEditor() {
  if (!IS_LOCALHOST || !_open) return;
  _refreshDynamicFields();
}

export function onFreeCamEnter() {
  if (!IS_LOCALHOST) return;
  _openPanel();
}

export function onFreeCamExit() {
  if (!IS_LOCALHOST) return;
  _closePanel();
}

function _openPanel() {
  if (_panel) _panel.style.display = 'flex';
  _open = true;
  suspendMouse();
  document.exitPointerLock();
}

function _closePanel() {
  if (_panel) _panel.style.display = 'none';
  _open = false;
}

function _buildPanel() {
  _panel = document.createElement('div');
  _panel.id = 'editor-panel';
  Object.assign(_panel.style, {
    position: 'fixed', top: '36px', right: '0', bottom: '0',
    width: '300px', background: 'rgba(4,10,4,0.96)',
    borderLeft: '1px solid #2a4a2a', display: 'none',
    flexDirection: 'column', zIndex: '8000', overflowY: 'auto',
    fontFamily: 'Courier New, monospace', fontSize: '11px', color: '#8aee8a',
    padding: '8px',
  });

  // Header
  const header = _el('div', { style: 'font-size:13px;letter-spacing:.15em;color:#4aee4a;margin-bottom:10px;border-bottom:1px solid #2a4a2a;padding-bottom:6px;' });
  header.textContent = '⚙ EDITOR';
  _panel.appendChild(header);

  // Section: Scene
  _section('SCENE', [
    _btn('Copy JSON', () => {
      navigator.clipboard.writeText(JSON.stringify(getConfig(), null, 2));
      _log('JSON copied to clipboard');
    }),
    _btn('Save JSON ↓', () => {
      const blob = new Blob([JSON.stringify(getConfig(), null, 2)], {type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (CONFIG.meta?.id || 'config') + '.json'; a.click();
      _log('Config saved');
    }),
  ]);

  // Section: Terrain
  _section('TERRAIN', () => {
    const scaleVal = _el('span', {});
    scaleVal.textContent = CONFIG.terrain?.heightScale ?? 50;

    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 1; slider.max = 400;
    slider.value = CONFIG.terrain?.heightScale ?? 50;
    Object.assign(slider.style, { width:'100%', accentColor:'#4aee4a', margin:'4px 0' });
    slider.addEventListener('input', () => { scaleVal.textContent = slider.value; });

    const fileLabel = _el('div', { style:'font-size:10px;color:#8b8;margin:3px 0;min-height:12px;' });

    const fileInp = document.createElement('input');
    fileInp.type = 'file'; fileInp.accept = 'image/png,image/jpeg';
    Object.assign(fileInp.style, { color:'#8aee8a', fontSize:'10px', width:'100%', margin:'2px 0' });
    fileInp.addEventListener('change', () => {
      const file = fileInp.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        _pendingHeightmapDataUrl = e.target.result;
        fileLabel.textContent = '✔ ' + file.name + ' — click Apply';
        fileLabel.style.color = '#8f8';
      };
      reader.readAsDataURL(file);
    });

    const statusEl = _el('div', { style:'font-size:10px;color:#fa8;min-height:12px;' });

    const applyBtn = _btn('Apply Terrain', async () => {
      if (!_scene) { statusEl.textContent = 'Scene not ready'; return; }
      const scale = parseInt(slider.value, 10);
      applyBtn.disabled = true;
      if (_pendingHeightmapDataUrl) {
        statusEl.textContent = 'Building…';
        try {
          await applyHeightmapFromDataUrl(_scene, _pendingHeightmapDataUrl, scale, () => {
            dropOnStart();   // reposition player onto new terrain surface
          });
          statusEl.textContent = '✔ Loaded (scale ' + scale + ')';
          fileLabel.textContent = '';
          _pendingHeightmapDataUrl = null;
          _log('Terrain heightmap applied, scale ' + scale);
        } catch(e) { statusEl.textContent = '✘ ' + e.message; }
      } else {
        rescaleHeights(scale);
        dropOnStart();       // reposition player after rescale too
        statusEl.textContent = '✔ Scale → ' + scale;
        _log('Height scale: ' + scale);
      }
      applyBtn.disabled = false;
    });

    const scaleWrap = _el('div', { style:'display:flex;gap:6px;align-items:center;' });
    scaleWrap.appendChild(slider);
    scaleWrap.appendChild(scaleVal);

    return [_label('Heightmap PNG:'), fileInp, fileLabel,
            _label('Height Scale:'), scaleWrap, applyBtn, statusEl];
  });

  // Section: Scatter
  _section('SCATTER', [
    _btn('Rebuild Scatter', () => { rebuildScatterLayer(0); _log('Scatter rebuilt'); }),
  ]);

  // Section: Shelters
  _section('SHELTERS', () => {
    const ids = getShelterDesignIds();
    const sel = document.createElement('select');
    sel.id = 'shelter-design-select';
    Object.assign(sel.style, { background:'#0e1e0e', border:'1px solid #3a6a3a', color:'#8aee8a', width:'100%', margin:'4px 0' });
    ids.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      sel.appendChild(opt);
    });
    const dropBtn = _btn('Drop Shelter (3s)', () => {
      if (_countdownActive) return;
      const designId = sel.value;
      const snapPos = capturePlayerPosition();
      _countdownActive = true;
      let t = 3;
      dropBtn.textContent = `Dropping in ${t}s...`;
      const iv = setInterval(() => {
        t--;
        if (t <= 0) {
          clearInterval(iv);
          _countdownActive = false;
          dropBtn.textContent = 'Drop Shelter (3s)';
          spawnShelterByDesign(designId, snapPos);
          _log(`Shelter '${designId}' dropped at ${JSON.stringify(snapPos)}`);
        } else {
          dropBtn.textContent = `Dropping in ${t}s...`;
        }
      }, 1000);
    });
    return [sel, dropBtn, _btn('Clear Shelters', () => { clearShelters(); _log('Shelters cleared'); })];
  });

  // Section: Enemies
  _section('ENEMIES', [
    _label('Enemy count: '),
    _dynSpan('enemy-count', () => getEnemyCount() + ' alive'),
  ]);

  // Section: Player Position
  _section('PLAYER POS', [
    _dynSpan('player-pos', () => {
      if (!playerRig) return '--';
      const p = playerRig.position;
      return `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
    }),
    _btn('Copy Position', () => {
      if (_getPlayerPos) navigator.clipboard.writeText(JSON.stringify(_getPlayerPos()));
      _log('Position copied');
    }),
  ]);

  // Section: Deploy
  _section('DEPLOY', () => {
    const stored = localStorage.getItem('deploy_engine_url') || '';
    const urlLabel = _el('div', { style:'font-size:10px;color:#8b8;margin-bottom:4px;' });
    urlLabel.textContent = 'GitHub Pages engine URL:';

    const urlInp = document.createElement('input');
    urlInp.type = 'text';
    urlInp.placeholder = 'https://username.github.io/engine';
    urlInp.value = stored;
    Object.assign(urlInp.style, {
      width:'100%', background:'#0a1a0a', border:'1px solid #3a6a3a',
      color:'#8aee8a', fontFamily:'inherit', fontSize:'10px',
      padding:'3px 5px', margin:'2px 0 6px', borderRadius:'2px',
    });

    const saveBtn = _btn('💾 Save Engine URL', () => {
      const url = urlInp.value.trim().replace(/\/$/, '');
      if (!url) { _log('Enter a URL first'); return; }
      window.setDeployEngineUrl(url);
      statusEl.textContent = '✔ Saved: ' + url;
      _log('Deploy URL set: ' + url);
    });

    const exportBtn = _btn('📦 Export Game (index.html + game-config.json)', () => {
      if (typeof _exportGameFromEditor === 'function') {
        _exportGameFromEditor();
      } else {
        document.getElementById('btn-deploy')?.click();
      }
    });

    const statusEl = _el('div', { style:'font-size:10px;color:#fa8;min-height:12px;margin-top:4px;' });
    if (stored) statusEl.textContent = 'Engine URL: ' + stored;
    else statusEl.textContent = 'No URL set — will use current server';

    return [urlLabel, urlInp, saveBtn, exportBtn, statusEl];
  });

  // Section: Log
  _section('LOG', []);
  _logEl = _el('div', { style: 'height:100px;overflow-y:auto;font-size:10px;color:#4aaa4a;border:1px solid #1a2a1a;padding:4px;margin-top:4px;' });
  _panel.appendChild(_logEl);

  document.body.appendChild(_panel);
}

function _section(title, childrenOrFn) {
  if (!_panel) return;
  const sec = _el('div', { style: 'margin-bottom:10px;' });
  const hd  = _el('div', { style: 'color:#4a8a4a;letter-spacing:.12em;margin-bottom:4px;border-bottom:1px solid #1a3a1a;padding-bottom:2px;' });
  hd.textContent = title;
  sec.appendChild(hd);
  const children = typeof childrenOrFn === 'function' ? childrenOrFn() : childrenOrFn;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child) sec.appendChild(child);
    }
  }
  _panel.appendChild(sec);
}

function _btn(label, onClick) {
  const b = _el('button', { style: 'background:#0e1e0e;border:1px solid #3a6a3a;color:#8aee8a;font-family:inherit;font-size:11px;padding:3px 8px;cursor:pointer;width:100%;margin:2px 0;text-align:left;' });
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function _label(text) {
  const l = _el('div', { style: 'color:#4a7a4a;margin-top:4px;' });
  l.textContent = text;
  return l;
}

function _slider(id, value, min, max, onChange) {
  const wrap = _el('div', { style: 'display:flex;gap:6px;align-items:center;margin:4px 0;' });
  const inp  = document.createElement('input');
  inp.type = 'range'; inp.min = min; inp.max = max; inp.value = value; inp.id = id;
  Object.assign(inp.style, { flex:'1', accentColor:'#4aee4a' });
  const val = _el('span', {}); val.textContent = value;
  inp.addEventListener('input', () => { val.textContent = inp.value; onChange(+inp.value); });
  wrap.appendChild(inp); wrap.appendChild(val);
  return wrap;
}

function _fileInput(accept, onLoad) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.' + accept;
  Object.assign(inp.style, { color:'#8aee8a', fontSize:'10px', width:'100%' });
  inp.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    onLoad(url);
  });
  return inp;
}

function _dynSpan(id, getFn) {
  const span = _el('span', { id: 'editor-dyn-' + id });
  span.textContent = getFn();
  span._getVal = getFn;
  return span;
}

function _refreshDynamicFields() {
  if (!_panel) return;
  _panel.querySelectorAll('[id^="editor-dyn-"]').forEach(el => {
    if (el._getVal) el.textContent = el._getVal();
  });
}

function _el(tag, attrs) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'style') { el.style.cssText = v; }
    else el[k] = v;
  }
  return el;
}

function _log(msg) {
  if (!_logEl) return;
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  _logEl.prepend(line);
}