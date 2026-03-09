// editor/editor.js — full config editor popup (localhost-only)
// Opens as a detached OS window. All sections map directly to level-0.json structure.

import { CONFIG, getConfig } from '../config.js';
import { playerRig } from '../player.js';
import { getShelterDesignIds, spawnShelterByDesign, clearShelters } from '../shelters/shelters.js';
import { capturePlayerPosition } from '../shelters/utils.js';
import { rebuildScatterLayer, clearScatter, scatterProps } from '../scatter.js';
import { applyHeightmapFromDataUrl } from '../terrain/terrainMesh.js';
import { scene } from '../core.js';
import { muteChannel, soloChannel, unsoloAll, setChannelVolume, getChannelStates, getGainNode } from '../audio.js';

const IS_LOCALHOST = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

let _win          = null;
let _doc          = null;
let _open         = false;
let _getPlayerPos = null;
let _countdown    = false;
let _pendingHmap  = null; // { idx, dataUrl, name }

export function initEditor(getPosFn)    { if (!IS_LOCALHOST) return; _getPlayerPos = getPosFn; }
export function tickEditor()            {}
export function initEditorScene()       {}
export function onFreeCamEnter()        { if (!IS_LOCALHOST) return; _openPopup(); }
export function onFreeCamExit()         {}

// ── Popup lifecycle ───────────────────────────────────────────────────────────
function _openPopup() {
  if (_win && !_win.closed) { _win.focus(); return; }
  const w = 380, h = 760;
  _win = window.open('', 'mt-editor',
    `width=${w},height=${h},left=${window.screen.width - w - 20},top=60,resizable=yes,scrollbars=yes`);
  if (!_win) { console.warn('[editor] Popup blocked — allow popups for localhost'); return; }
  _doc = _win.document;
  _open = true;
  _doc.open(); _doc.write(_html()); _doc.close();
  _wired = false;   // reset so _wire runs fresh for this popup
  // Poll until popup DOM is ready - 150ms not always enough
  let _wireAttempts = 0;
  const _tryWire = () => {
    _wireAttempts++;
    if (_wireAttempts > 40) { console.warn('[editor] popup wire timeout'); return; }
    if (!_win || _win.closed) return;
    _wire();
    if (!_wired) setTimeout(_tryWire, 100);
  };
  setTimeout(_tryWire, 100);
  _win.requestAnimationFrame(function tick() {
    if (!_win || _win.closed) return;
    _refreshDyn();
    _win.requestAnimationFrame(tick);
  });
  _win.addEventListener('beforeunload', () => { _open = false; _win = null; _doc = null; });
}

// ── Dynamic refresh ───────────────────────────────────────────────────────────
let _syncing = false;
function _refreshDyn() {
  if (!_doc) return;
  try {
    const p = playerRig?.position;
    if (p) _set('dyn-pos', `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
    _set('dyn-enemies', (window._enemyCount?.() ?? '?') + ' alive');
    // Audio status
    const ctx = window.Tone?.context?.state ?? 'unknown';
    const ready = ctx === 'running';
    _set('dyn-audio-status', ready ? '🟢 running' : '🔴 ' + ctx + ' — click game canvas first');
    // Dim mixer controls if audio not ready
    const mixer = _doc.getElementById('mixer-body');
    if (mixer) mixer.style.opacity = ready ? '1' : '0.45';
    // Sync solo button highlights from live state (suppress change events)
    try {
      _syncing = true;
      const states = getChannelStates();
      for (const [ch, st] of Object.entries(states)) {
        const btn = _doc.getElementById('btn-solo-' + ch);
        if (btn) btn.classList.toggle('solo-on', !!st.soloed);
        const chk = _doc.getElementById('chk-mute-' + ch);
        if (chk && chk.checked !== !!st.muted) chk.checked = !!st.muted;
      }
    } catch(e) {}
    finally { _syncing = false; }
  } catch(e) {}
}
function _set(id, txt) { const el = _doc.getElementById(id); if (el) el.textContent = txt; }
function _val(id)      { return _doc.getElementById(id)?.value ?? ''; }
function _log(msg) {
  const el = _doc?.getElementById('log'); if (!el) return;
  const d = _doc.createElement('div'); d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(d); if (el.children.length > 40) el.lastChild.remove();
}

// ── Wire all controls after doc.write ─────────────────────────────────────────
let _wired = false;
function _wire() {
  if (_wired || !_doc?.getElementById('btn-copy-json')) { setTimeout(_wire, 100); return; }
  _wired = true;

  // ── META ──────────────────────────────────────────────────────────────────
  _on('inp-meta-id',       'input', () => { CONFIG.meta.id          = _val('inp-meta-id'); });
  _on('inp-meta-title',    'input', () => { CONFIG.meta.title        = _val('inp-meta-title'); });
  _on('inp-meta-subtitle', 'input', () => { CONFIG.meta.subtitle     = _val('inp-meta-subtitle'); });
  _on('inp-meta-desc',     'input', () => { CONFIG.meta.description  = _val('inp-meta-desc'); });

  // ── LEVELS LIST ───────────────────────────────────────────────────────────
  _renderLevels();
  _on('btn-add-level', 'click', () => {
    if (!CONFIG.meta.levels) CONFIG.meta.levels = [];
    CONFIG.meta.levels.push({ id: 'level-' + (CONFIG.meta.levels.length + 1), title: 'New Level', subtitle: '' });
    _renderLevels(); _log('Level added');
  });

  // ── TERRAIN ───────────────────────────────────────────────────────────────
  const slH = _doc.getElementById('sl-heightscale');
  const spH = _doc.getElementById('dyn-heightscale');
  slH?.addEventListener('input', () => {
    CONFIG.terrain.heightScale = +slH.value;
    if (spH) spH.textContent = slH.value;
    // Height scale only applies on next terrain rebuild (via MAPS tab Apply button)
    _log('Height scale staged — use MAPS tab Apply to rebuild');
  });
  _on('sl-shelter-count', 'input', () => {
    CONFIG.terrain.shelterCount = +_val('sl-shelter-count');
    _set('dyn-shelter-count', _val('sl-shelter-count'));
  });

  // ── HEIGHTMAPS ────────────────────────────────────────────────────────────
  _renderHeightmaps();
  _on('btn-add-heightmap', 'click', () => {
    if (!CONFIG.terrain.heightmaps) CONFIG.terrain.heightmaps = [];
    CONFIG.terrain.heightmaps.push(_newHeightmapTemplate());
    _renderHeightmaps(); _log('Heightmap entry added');
  });

  // ── FOG ───────────────────────────────────────────────────────────────────
  _on('inp-fog-start',   'input', () => { CONFIG.fog.start   = +_val('inp-fog-start');   window._applyFog?.(); });
  _on('inp-fog-end',     'input', () => { CONFIG.fog.end     = +_val('inp-fog-end');     window._applyFog?.(); });
  _on('inp-fog-density', 'input', () => { CONFIG.fog.density = +_val('inp-fog-density'); window._applyFog?.(); });
  _on('chk-fog',         'change',() => { CONFIG.fog.enabled = _doc.getElementById('chk-fog').checked; window._applyFog?.(); });

  // ── WATER ─────────────────────────────────────────────────────────────────
  _on('chk-water',      'change',() => { CONFIG.water.enabled = _doc.getElementById('chk-water').checked; });
  _on('inp-water-y',    'input', () => { CONFIG.water.mesh.position.y = +_val('inp-water-y'); window._applyWaterY?.(); });
  _on('inp-wind-force', 'input', () => { CONFIG.water.material.windForce  = +_val('inp-wind-force'); });
  _on('inp-wave-h',     'input', () => { CONFIG.water.material.waveHeight = +_val('inp-wave-h'); });

  // ── ENEMIES ───────────────────────────────────────────────────────────────
  _renderEnemies();

  // ── SCATTER ───────────────────────────────────────────────────────────────
  _renderScatter();
  _renderScatter2();

  // ── AUDIO ─────────────────────────────────────────────────────────────────
  ['music','env','enemy','sfx'].forEach(ch => {
    _on('sl-vol-' + ch, 'input', () => {
      const db = +_val('sl-vol-' + ch);
      // Update CONFIG
      if (!CONFIG.audio.channels)     CONFIG.audio.channels = {};
      if (!CONFIG.audio.channels[ch]) CONFIG.audio.channels[ch] = {};
      CONFIG.audio.channels[ch].volume = db;
      _set('dyn-vol-' + ch, db + 'dB');
      // Call audio.js API
      setChannelVolume(ch, db);
      // Direct fallback: set gain node immediately if rampTo isn't working
      try {
        const gn = getGainNode(ch);
        if (gn) {
          const lin = window.Tone?.dbToGain(db) ?? Math.pow(10, db/20);
          gn.gain.rampTo(lin, 0.05);
          _log(`${ch} vol ${db}dB → gain ${lin.toFixed(3)} (node: ${gn ? '✔' : '✘'})`);
        } else {
          _log(`${ch}: no gain node — audio not routed through channel bus`);
        }
      } catch(e) { _log('gain err: ' + e.message); }
    });
    _on('chk-mute-' + ch, 'change', () => {
      if (_syncing) return;
      const muted = _doc.getElementById('chk-mute-' + ch).checked;
      muteChannel(ch, muted);
      if (CONFIG.audio.channels?.[ch]) CONFIG.audio.channels[ch].muted = muted;
      // Direct fallback
      try {
        const gn = getGainNode(ch);
        if (gn) {
          const db = CONFIG.audio.channels?.[ch]?.volume ?? -6;
          gn.gain.rampTo(muted ? 0 : (window.Tone?.dbToGain(db) ?? 1), 0.05);
          _log(`${ch} ${muted ? 'MUTED' : 'unmuted'} (direct)`);
        }
      } catch(e) {}
    });
    _on('btn-solo-' + ch, 'click', () => {
      if (_syncing) return;
      // Toggle solo — if this channel is already soloed, unsolo all
      const states = getChannelStates();
      if (states[ch].soloed) {
        unsoloAll();
        _doc.querySelectorAll('[id^="btn-solo-"]').forEach(b => b.classList.remove('solo-on'));
      } else {
        soloChannel(ch);
        _doc.querySelectorAll('[id^="btn-solo-"]').forEach(b => b.classList.remove('solo-on'));
        _doc.getElementById('btn-solo-' + ch)?.classList.add('solo-on');
      }
    });
  });

  // ── AUDIO master + unsolo-all ───────────────────────────────────────────────
  _on('sl-master-vol', 'input', () => {
    const db = +_val('sl-master-vol');
    _set('dyn-master-vol', db + 'dB');
    try {
      if (window.Tone?.Destination) {
        window.Tone.Destination.volume.rampTo(db, 0.05);
        _log('Master vol: ' + db + 'dB');
      }
    } catch(e) { _log('master err: ' + e.message); }
  });
  _on('btn-unsolo-all', 'click', () => {
    unsoloAll();
    _doc.querySelectorAll('[id^="btn-solo-"]').forEach(b => b.classList.remove('solo-on'));
    _log('All channels unsoloed');
  });
  // Force-apply current slider values to audio engine (useful if audio started after editor opened)
  _on('btn-audio-apply', 'click', () => {
    ['music','env','enemy','sfx'].forEach(ch => {
      const db = +(_doc.getElementById('sl-vol-'+ch)?.value ?? -6);
      const muted = _doc.getElementById('chk-mute-'+ch)?.checked ?? false;
      setChannelVolume(ch, db);
      muteChannel(ch, muted);
    });
    _log('Audio state applied');
  });

  // ── SHELTERS ──────────────────────────────────────────────────────────────
  const sel = _doc.getElementById('shelter-select');
  try { getShelterDesignIds().forEach(id => { const o = _doc.createElement('option'); o.value = o.textContent = id; sel?.appendChild(o); }); } catch(e) {}
  const dropBtn = _doc.getElementById('btn-drop-shelter');
  dropBtn?.addEventListener('click', () => {
    if (_countdown) return;
    const id = sel?.value; const snapPos = capturePlayerPosition();
    _countdown = true; let t = 3;
    dropBtn.textContent = `Dropping in ${t}s…`;
    const iv = setInterval(() => { t--;
      if (t <= 0) { clearInterval(iv); _countdown = false; dropBtn.textContent = 'Drop Shelter (3s)';
        spawnShelterByDesign(id, snapPos); _log(`Shelter '${id}' dropped`);
      } else { dropBtn.textContent = `Dropping in ${t}s…`; }
    }, 1000);
  });
  _on('btn-clear-shelters', 'click', () => { clearShelters(); _log('Shelters cleared'); });

  // ── PLAYER ────────────────────────────────────────────────────────────────
  _on('btn-copy-pos', 'click', () => {
    if (_getPlayerPos) { navigator.clipboard.writeText(JSON.stringify(_getPlayerPos())); _log('Position copied'); }
  });

  // ── SCENE ─────────────────────────────────────────────────────────────────
  _on('btn-copy-json', 'click', () => { navigator.clipboard.writeText(JSON.stringify(getConfig(),null,2)); _log('JSON copied'); });
  _on('btn-save-json', 'click', () => {
    const blob = new Blob([JSON.stringify(getConfig(),null,2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (CONFIG.meta?.id||'config') + '.json'; a.click(); _log('Config saved');
  });
}

function _on(id, ev, fn) {
  const el = _doc?.getElementById(id); if (el) el.addEventListener(ev, fn);
}

// ── Levels renderer ───────────────────────────────────────────────────────────
function _renderLevels() {
  const c = _doc?.getElementById('levels-list'); if (!c) return;
  c.innerHTML = '';
  (CONFIG.meta?.levels || []).forEach((lvl, i) => {
    const row = _doc.createElement('div');
    row.style.cssText = 'border:1px solid #1a3a1a;padding:6px;margin-bottom:4px;';
    row.innerHTML = `
      <div class="lbl">Level ${i+1}</div>
      <input class="inp" placeholder="id" value="${lvl.id||''}" data-li="${i}" data-f="id">
      <input class="inp" placeholder="title" value="${lvl.title||''}" data-li="${i}" data-f="title">
      <input class="inp" placeholder="subtitle" value="${lvl.subtitle||''}" data-li="${i}" data-f="subtitle">
      <button class="btn btn-del" data-li="${i}">✕ Remove</button>`;
    row.querySelectorAll('[data-li]').forEach(el => {
      const f = el.dataset.f; if (!f) return;
      el.addEventListener('input', () => { CONFIG.meta.levels[+el.dataset.li][f] = el.value; });
    });
    row.querySelector('.btn-del')?.addEventListener('click', e => {
      CONFIG.meta.levels.splice(+e.target.dataset.li, 1); _renderLevels(); _log('Level removed');
    });
    c.appendChild(row);
  });
}

// ── Heightmaps renderer ───────────────────────────────────────────────────────
function _renderHeightmaps() {
  const c = _doc?.getElementById('heightmaps-list'); if (!c) return;
  c.innerHTML = '';
  (CONFIG.terrain?.heightmaps || []).forEach((hm, i) => {
    const row = _doc.createElement('div');
    row.style.cssText = 'border:1px solid #1a3a1a;padding:6px;margin-bottom:6px;';
    const colors = (hm.environment?.shaderLayers || []).map((l,si) =>
      `<div class="row" style="margin:2px 0">
        <span class="lbl" style="width:80px">Layer ${si}</span>
        <input class="inp" style="width:60px" type="color" value="${l.color||'#556655'}" data-hi="${i}" data-si="${si}" data-f="color">
        <input class="inp" style="width:44px" type="number" min="0" max="1" step="0.05" value="${l.minElevation??0}" data-hi="${i}" data-si="${si}" data-f="min">
        <span class="lbl">–</span>
        <input class="inp" style="width:44px" type="number" min="0" max="1" step="0.05" value="${l.maxElevation??1}" data-hi="${i}" data-si="${si}" data-f="max">
      </div>`).join('');
    row.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <span class="lbl" style="color:#6aee6a">Heightmap ${i+1}</span>
        <button class="btn btn-del-hm" data-hi="${i}">✕</button>
      </div>
      <div class="lbl">Name:</div>
      <input class="inp" placeholder="_name" value="${hm._name||''}" data-hi="${i}" data-f="_name">
      <div class="lbl">URL:</div>
      <input class="inp" placeholder="https://…" value="${hm.url||''}" data-hi="${i}" data-f="url">
      <div class="row" style="margin:4px 0">
        <span class="lbl">Shelter count:</span>
        <input class="inp" style="width:50px" type="number" value="${hm.shelterCount||0}" data-hi="${i}" data-f="shelterCount">
      </div>
      <div class="lbl">Shader Layers (color / min / max):</div>
      ${colors}
      <div class="row" style="margin-top:6px;gap:4px">
        <label class="inp-file-lbl" style="cursor:pointer;padding:3px 8px;background:#0e1e0e;border:1px solid #3a6a3a;border-radius:2px;font-size:10px">
          📂 Upload PNG <input type="file" accept=".png" style="display:none" data-hi="${i}">
        </label>
        <span id="hm-file-status-${i}" style="font-size:10px;color:#4a8a4a"></span>
        <button class="btn" id="btn-apply-hm-${i}" data-hi="${i}" style="margin-left:auto">▶ Apply</button>
      </div>`;
    // Field inputs
    row.querySelectorAll('[data-hi][data-f]').forEach(el => {
      const hi = +el.dataset.hi, f = el.dataset.f;
      const si = el.dataset.si !== undefined ? +el.dataset.si : null;
      el.addEventListener('input', () => {
        if (si !== null) {
          const layer = CONFIG.terrain.heightmaps[hi].environment.shaderLayers[si];
          if (f === 'color') layer.color = el.value;
          else if (f === 'min') layer.minElevation = +el.value;
          else if (f === 'max') layer.maxElevation = +el.value;
        } else if (f === 'shelterCount') {
          CONFIG.terrain.heightmaps[hi][f] = +el.value;
        } else {
          CONFIG.terrain.heightmaps[hi][f] = el.value;
        }
      });
    });
    // File upload
    const fileInp = row.querySelector('input[type="file"]');
    fileInp?.addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        _pendingHmap = { idx: i, dataUrl: ev.target.result, name: file.name };
        _set('hm-file-status-' + i, '✔ ' + file.name);
      };
      reader.readAsDataURL(file);
    });
    // Apply button
    row.querySelector('#btn-apply-hm-' + i)?.addEventListener('click', async () => {
      const scale = CONFIG.terrain.heightScale || 80;
      const url   = _pendingHmap?.idx === i ? _pendingHmap.dataUrl : CONFIG.terrain.heightmaps[i].url;
      if (!url) { _log('No URL or file for heightmap ' + i); return; }
      _log('Applying heightmap ' + i + '…');
      try { await applyHeightmapFromDataUrl(scene, url, scale); _log('Heightmap applied'); }
      catch(e) { _log('Error: ' + e.message); }
    });
    // Delete
    row.querySelector('.btn-del-hm')?.addEventListener('click', e => {
      CONFIG.terrain.heightmaps.splice(+e.target.dataset.hi, 1); _renderHeightmaps(); _log('Heightmap removed');
    });
    c.appendChild(row);
  });
}

// ── Enemies renderer ──────────────────────────────────────────────────────────
function _renderEnemies() {
  const c = _doc?.getElementById('enemies-list'); if (!c) return;
  c.innerHTML = '';
  (CONFIG.enemies || []).forEach((en, i) => {
    const row = _doc.createElement('div');
    row.style.cssText = 'border:1px solid #1a3a1a;padding:6px;margin-bottom:4px;';
    row.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <span class="lbl" style="color:#aeffae">${en.type}</span>
        <label><input type="checkbox" data-ei="${i}" data-f="enabled" ${en.enabled?'checked':''}> enabled</label>
      </div>
      <div class="row">
        <span class="lbl">Max:</span>
        <input class="inp" style="width:50px" type="number" min="0" value="${en.maxCount||0}" data-ei="${i}" data-f="maxCount">
        <span class="lbl">HP:</span>
        <input class="inp" style="width:50px" type="number" min="1" value="${en.health||100}" data-ei="${i}" data-f="health">
        <span class="lbl">Hits:</span>
        <input class="inp" style="width:50px" type="number" min="1" value="${en.hitsToKill||8}" data-ei="${i}" data-f="hitsToKill">
      </div>`;
    row.querySelectorAll('[data-ei]').forEach(el => {
      const ei = +el.dataset.ei, f = el.dataset.f;
      el.addEventListener(el.type==='checkbox'?'change':'input', () => {
        CONFIG.enemies[ei][f] = el.type==='checkbox' ? el.checked : +el.value;
      });
    });
    c.appendChild(row);
  });
}

// ── Scatter renderer ──────────────────────────────────────────────────────────
function _renderScatter() {
  const c = _doc?.getElementById('scatter-list'); if (!c) return;
  c.innerHTML = '';
  (CONFIG.scatterLayers || []).forEach((layer, i) => {
    const row = _doc.createElement('div');
    row.style.cssText = 'border:1px solid #1a3a1a;padding:6px;margin-bottom:4px;';
    row.innerHTML = `
      <div class="lbl">Layer ${i}: ${layer.category}</div>
      <div class="row">
        <span class="lbl">Density:</span>
        <input type="range" min="0" max="1" step="0.01" value="${layer.density||0.1}" data-sci="${i}" style="flex:1;accent-color:#4aee4a">
        <span id="dyn-scat-${i}" class="dyn">${(layer.density||0.1).toFixed(2)}</span>
      </div>
      <button class="btn" data-sci="${i}" id="btn-rebuild-${i}">Rebuild Layer ${i}</button>`;
    row.querySelector('input[data-sci]')?.addEventListener('input', e => {
      layer.density = +e.target.value; _set('dyn-scat-'+i, layer.density.toFixed(2));
    });
    row.querySelector('#btn-rebuild-'+i)?.addEventListener('click', () => { rebuildScatterLayer(i); _log('Layer '+i+' rebuilt'); });
    c.appendChild(row);
  });
  const all = _doc.createElement('button');
  all.className = 'btn'; all.textContent = 'Rebuild All Scatter';
  all.addEventListener('click', () => { clearScatter(); scatterProps(); _log('All scatter rebuilt'); });
  c.appendChild(all);
}

// ── Scatter renderer (for dedicated scatter tab) ─────────────────────────────
function _renderScatter2() {
  const c = _doc?.getElementById('scatter-list-2'); if (!c) return;
  c.innerHTML = '';
  (CONFIG.scatterLayers || []).forEach((layer, i) => {
    const row = _doc.createElement('div');
    row.style.cssText = 'border:1px solid #1a3a1a;padding:6px;margin-bottom:4px;';
    row.innerHTML = `
      <div class="lbl">Layer \${i}: \${layer.category}</div>
      <div class="row">
        <span class="lbl">Density:</span>
        <input type="range" min="0" max="1" step="0.01" value="\${layer.density||0.1}" data-sci2="\${i}" style="flex:1;accent-color:#4aee4a">
        <span id="dyn-scat2-\${i}" class="dyn">\${(layer.density||0.1).toFixed(2)}</span>
      </div>
      <button class="btn" id="btn-rebuild2-\${i}">Rebuild Layer \${i}</button>`;
    row.querySelector('input[data-sci2]')?.addEventListener('input', e => {
      layer.density = +e.target.value; _set('dyn-scat2-'+i, layer.density.toFixed(2));
    });
    row.querySelector('#btn-rebuild2-'+i)?.addEventListener('click', () => { rebuildScatterLayer(i); _log('Layer '+i+' rebuilt'); });
    c.appendChild(row);
  });
  const all = _doc.createElement('button');
  all.className = 'btn'; all.textContent = 'Rebuild All Scatter';
  all.addEventListener('click', () => { clearScatter(); scatterProps(); _log('All scatter rebuilt'); });
  c.appendChild(all);
}

// ── New heightmap template (duplicates structure from level-0.json) ────────────
function _newHeightmapTemplate() {
  return {
    _name: 'New Map',
    url: '',
    shelterCount: 6,
    environment: {
      types: ['env_wetland'],
      shaderLayers: [
        { minElevation: 0,    maxElevation: 0.33, color: '#2a4a1a', blend: 'smooth' },
        { minElevation: 0.33, maxElevation: 0.66, color: '#4a6a2a', blend: 'smooth' },
        { minElevation: 0.66, maxElevation: 1,    color: '#707060', blend: 'smooth' },
      ]
    },
    structures: { fortresses: [], villages: [], cities: [] }
  };
}

// ── HTML template ─────────────────────────────────────────────────────────────
function _html() {
  const C  = CONFIG;
  const t  = C.terrain || {};
  const f  = C.fog     || {};
  const w  = C.water   || {};
  const wm = w.material || {};
  const ac = C.audio?.channels || {};
  const volOf  = ch => ac[ch]?.volume  ?? -6;
  const mutedOf = ch => ac[ch]?.muted  ? 'checked' : '';

  return `<!DOCTYPE html><html><head>
  <meta charset="UTF-8"><title>MT Editor</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{background:#020a02;color:#8aee8a;font-family:'Courier New',monospace;font-size:11px;padding:0;}
    h1{font-size:12px;letter-spacing:.2em;color:#4aee4a;padding:10px 10px 8px;
      border-bottom:1px solid #1a3a1a;background:#010801;position:sticky;top:0;z-index:10;}
    .tabs{display:flex;border-bottom:1px solid #1a3a1a;background:#010801;position:sticky;top:33px;z-index:9;flex-wrap:wrap;}
    .tab{padding:5px 10px;cursor:pointer;color:#4a7a4a;font-size:10px;letter-spacing:.08em;border-right:1px solid #1a3a1a;}
    .tab:hover{color:#8aee8a;background:#0a180a;}
    .tab.active{color:#4aee4a;background:#0e1e0e;border-bottom:2px solid #4aee4a;}
    .panel{display:none;padding:10px;overflow-y:auto;}
    .panel.active{display:block;}
    .sec{margin-bottom:12px;}
    .sec-hd{color:#3a7a3a;letter-spacing:.12em;font-size:10px;margin-bottom:5px;
      border-bottom:1px solid #0e2a0e;padding-bottom:3px;text-transform:uppercase;}
    .lbl{color:#4a7a4a;margin:3px 0 1px;}
    .row{display:flex;gap:6px;align-items:center;margin:3px 0;flex-wrap:wrap;}
    .dyn{color:#aeffae;min-width:30px;}
    .inp{background:#030d03;border:1px solid #1a4a1a;color:#8aee8a;font-family:inherit;
      font-size:11px;padding:2px 5px;width:100%;border-radius:2px;}
    .inp:focus{outline:none;border-color:#4aee4a;}
    .inp[type=number]{width:58px;}
    .inp[type=color]{width:44px;height:22px;padding:1px;cursor:pointer;}
    .btn{background:#0a180a;border:1px solid #2a5a2a;color:#8aee8a;font-family:inherit;
      font-size:11px;padding:3px 8px;cursor:pointer;border-radius:2px;margin:2px 0;width:100%;}
    .btn:hover{border-color:#4aee4a;color:#cffecf;}
    .btn-sm{width:auto;padding:2px 6px;font-size:10px;}
    .btn-del{background:#1a0808;border-color:#4a1a1a;color:#ee6a6a;width:auto;padding:2px 6px;}
    .btn-del:hover{border-color:#ee4a4a;}
    #log{height:110px;overflow-y:auto;font-size:10px;color:#3a7a3a;border:1px solid #0e2a0e;padding:4px;margin-top:4px;}
    input[type=range]{flex:1;accent-color:#4aee4a;}
    input[type=checkbox]{accent-color:#4aee4a;}
    .solo-on{background:#1a3a00;border-color:#8aee4a;color:#cffe8a;}
  </style>
</head><body>
  <h1>⚙ METAL THRONE EDITOR</h1>
  <div class="tabs">
    <div class="tab active" data-tab="meta">META</div>
    <div class="tab" data-tab="terrain">TERRAIN</div>
    <div class="tab" data-tab="heightmaps">MAPS</div>
    <div class="tab" data-tab="environment">ENV</div>
    <div class="tab" data-tab="enemies">ENEMIES</div>
    <div class="tab" data-tab="scatter">SCATTER</div>
    <div class="tab" data-tab="shelters">SHELTERS</div>
    <div class="tab" data-tab="audio">AUDIO</div>
    <div class="tab" data-tab="scene">SCENE</div>
  </div>

  <!-- META -->
  <div class="panel active" id="tab-meta">
    <div class="sec">
      <div class="sec-hd">Level Identity</div>
      <div class="lbl">ID</div><input class="inp" id="inp-meta-id" value="${C.meta?.id||''}">
      <div class="lbl">Title</div><input class="inp" id="inp-meta-title" value="${C.meta?.title||''}">
      <div class="lbl">Subtitle</div><input class="inp" id="inp-meta-subtitle" value="${C.meta?.subtitle||''}">
      <div class="lbl">Description</div><input class="inp" id="inp-meta-desc" value="${C.meta?.description||''}">
    </div>
    <div class="sec">
      <div class="sec-hd">Levels List</div>
      <div id="levels-list"></div>
      <button class="btn" id="btn-add-level">+ Add Level</button>
    </div>
  </div>

  <!-- TERRAIN -->
  <div class="panel" id="tab-terrain">
    <div class="sec">
      <div class="sec-hd">Terrain Shape</div>
      <div class="lbl">Height Scale</div>
      <div class="row">
        <input type="range" id="sl-heightscale" min="10" max="200" value="${t.heightScale||80}">
        <span id="dyn-heightscale" class="dyn">${t.heightScale||80}</span>
      </div>
      <div class="lbl">Shelter Count</div>
      <div class="row">
        <input type="range" id="sl-shelter-count" min="0" max="30" value="${t.shelterCount||8}">
        <span id="dyn-shelter-count" class="dyn">${t.shelterCount||8}</span>
      </div>
    </div>
    <div class="sec">
      <div class="sec-hd">Fog</div>
      <div class="row">
        <label><input type="checkbox" id="chk-fog" ${f.enabled?'checked':''}> Enabled</label>
      </div>
      <div class="row">
        <span class="lbl">Start:</span><input class="inp" id="inp-fog-start" type="number" value="${f.start||160}">
        <span class="lbl">End:</span><input class="inp" id="inp-fog-end" type="number" value="${f.end||520}">
      </div>
      <div class="row"><span class="lbl">Density:</span><input class="inp" id="inp-fog-density" type="number" step="0.01" value="${f.density||0.4}"></div>
    </div>
    <div class="sec">
      <div class="sec-hd">Water</div>
      <div class="row"><label><input type="checkbox" id="chk-water" ${w.enabled?'checked':''}> Enabled</label></div>
      <div class="row">
        <span class="lbl">Y:</span><input class="inp" id="inp-water-y" type="number" step="0.5" value="${w.mesh?.position?.y||5}">
        <span class="lbl">Wind:</span><input class="inp" id="inp-wind-force" type="number" step="0.5" value="${wm.windForce||5}">
        <span class="lbl">Wave H:</span><input class="inp" id="inp-wave-h" type="number" step="0.05" value="${wm.waveHeight||0.4}">
      </div>
    </div>
  </div>

  <!-- HEIGHTMAPS -->
  <div class="panel" id="tab-heightmaps">
    <div class="sec">
      <div class="sec-hd">Heightmap Entries</div>
      <div id="heightmaps-list"></div>
      <button class="btn" id="btn-add-heightmap">+ Add Heightmap</button>
    </div>
  </div>

  <!-- ENVIRONMENT -->
  <div class="panel" id="tab-environment">
    <div class="sec">
      <div class="sec-hd">Scatter Layers</div>
      <div id="scatter-list"></div>
    </div>
  </div>

  <!-- ENEMIES -->
  <div class="panel" id="tab-enemies">
    <div class="sec">
      <div class="sec-hd">Enemy Config</div>
      <div id="enemies-list"></div>
    </div>
    <div class="sec">
      <div class="sec-hd">Live</div>
      <div class="lbl">Alive: <span id="dyn-enemies" class="dyn">--</span></div>
    </div>
  </div>

  <!-- SCATTER -->
  <div class="panel" id="tab-scatter">
    <div class="sec">
      <div class="sec-hd">Scatter Layers</div>
      <div id="scatter-list-2"></div>
    </div>
  </div>

  <!-- SHELTERS -->
  <div class="panel" id="tab-shelters">
    <div class="sec">
      <div class="sec-hd">Drop Shelter</div>
      <select id="shelter-select" class="inp"></select>
      <button class="btn" id="btn-drop-shelter">Drop Shelter (3s)</button>
      <button class="btn btn-del" id="btn-clear-shelters">Clear All Shelters</button>
    </div>
  </div>

  <!-- AUDIO -->
  <div class="panel" id="tab-audio">
    <div class="sec">
      <div class="sec-hd">Mixer</div>
      <div class="row" style="margin-bottom:8px;justify-content:space-between">
        <span>Status: <span id="dyn-audio-status" class="dyn">--</span></span>
        <button class="btn btn-sm" id="btn-unsolo-all" style="width:auto">Clear Solo</button>
      </div>
      <div class="lbl" style="margin-bottom:4px">MASTER</div>
      <div class="row" style="margin-bottom:8px">
        <input type="range" id="sl-master-vol" min="-40" max="6" step="1" value="0" style="flex:1">
        <span id="dyn-master-vol" class="dyn" style="min-width:42px;text-align:right">0dB</span>
      </div>
      <button class="btn" id="btn-audio-apply" style="margin-bottom:8px">⟳ Apply All to Engine</button>
      <div id="mixer-body">
      ${['music','env','enemy','sfx'].map(ch => `
      <div style="border:1px solid #1a3a1a;padding:6px;margin-bottom:5px;">
        <div class="row" style="justify-content:space-between;margin-bottom:4px">
          <span style="color:#6aee6a;letter-spacing:.1em">${ch.toUpperCase()}</span>
          <div class="row" style="gap:4px;width:auto">
            <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
              <input type="checkbox" id="chk-mute-${ch}" ${mutedOf(ch)}> MUTE
            </label>
            <button class="btn btn-sm" id="btn-solo-${ch}" style="width:auto;padding:2px 8px">SOLO</button>
          </div>
        </div>
        <div class="row">
          <input type="range" id="sl-vol-${ch}" min="-40" max="0" step="1" value="${volOf(ch)}" style="flex:1">
          <span id="dyn-vol-${ch}" class="dyn" style="min-width:42px;text-align:right">${volOf(ch)}dB</span>
        </div>
      </div>`).join('')}
    </div>
    </div><!-- /mixer-body -->
  </div>

  <!-- SCENE -->
  <div class="panel" id="tab-scene">
    <div class="sec">
      <div class="sec-hd">Player</div>
      <div class="lbl">Position: <span id="dyn-pos" class="dyn">--</span></div>
      <button class="btn" id="btn-copy-pos">Copy Position</button>
    </div>
    <div class="sec">
      <div class="sec-hd">Config JSON</div>
      <button class="btn" id="btn-copy-json">Copy JSON</button>
      <button class="btn" id="btn-save-json">Save JSON ↓</button>
    </div>
    <div class="sec">
      <div class="sec-hd">Log</div>
      <div id="log"></div>
    </div>
  </div>

  <script>
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
      });
    });
  </script>
</body></html>`;
}