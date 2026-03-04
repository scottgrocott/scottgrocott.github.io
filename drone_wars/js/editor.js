// ============================================================
//  editor.js — In-game level editor overlay
//
//  Sections:
//    1. Player Position
//    2. Shelters  — place, list, select
//    3. Edit Mode — group move, part grab, part add, delete part
//    4. Design Library — save design, copy JSON for editor.php
//    5. Log
//
//  Wires into: shelters.js, shelterEditor.js, utils.js
// ============================================================

import { shelters, serializeDesign,
         addPartToShelter }          from './shelters.js';
import { initShelterEditor,
         setShelterEditorMode,
         getShelterEditorMode,
         getSelectedShelter,
         saveSelectedDesign,
         removeGrabbedPart,
         releasePart,
         nudge,
         addPartAtPlayer }           from './shelterEditor.js';
import { placeShelterAtPlayer,
         getPlayerWorldPos,
         formatPos,
         shelterToJSON }             from './utils.js';
import { suspendMouse, resumeMouse } from './inputGuard.js';

// ============================================================
//  State
// ============================================================
let _getPlayerPos = null;
let _panel        = null;
let _posDisplay   = null;
let _modeDisplay  = null;
let _logEl        = null;
let _cancelPlace  = null;
let _shelListEl   = null;
let _outputEl     = null;
let _designLib    = [];   // [{ name, parts }]

// ============================================================
//  Localhost gate — editor only visible in local dev
// ============================================================
const _isLocalhost = location.hostname === 'localhost'
                  || location.hostname === '127.0.0.1'
                  || location.hostname.startsWith('192.168.');

// ============================================================
//  Public API
// ============================================================

export function initEditor(getPlayerPos) {
  if (!_isLocalhost) return;   // hidden on production / GitHub Pages
  _getPlayerPos = getPlayerPos;
  _buildUI();
  initShelterEditor(_onModeChange, _onDesignSaved);
  _log('Editor ready. E=mode G=group P=part Arrows=nudge Del=remove');
}

/** Call when freecam/fly mode activates — opens editor panel, suspends shooting */
export function onFreeCamEnter() {
  if (!_isLocalhost || !_panel) return;
  const toggle = document.getElementById('ed-toggle');
  toggle?.classList.add('open');
  _panel.classList.add('open');
  if (document.pointerLockElement) document.exitPointerLock();
  suspendMouse();
}

/** Call when freecam/fly mode exits — hides editor panel, resumes shooting */
export function onFreeCamExit() {
  if (!_panel) return;
  const toggle = document.getElementById('ed-toggle');
  toggle?.classList.remove('open');
  _panel.classList.remove('open');
  resumeMouse();
}

export function tickEditor() {
  if (!_posDisplay || !_getPlayerPos) return;
  const pos = _getPlayerPos();
  _posDisplay.textContent = pos ? formatPos(pos) : '—';
}

// ============================================================
//  Callbacks from shelterEditor
// ============================================================

function _onModeChange(mode, shelterId) {
  if (!_modeDisplay) return;
  const labels = {
    off:        '— OFF',
    selectShel: '● SELECT SHELTER',
    moveGroup:  '⤢ MOVE GROUP',
    selectPart: '◎ SELECT PART',
    movePart:   '✥ MOVE PART',
  };
  _modeDisplay.textContent = labels[mode] || mode;
  _modeDisplay.style.color = mode === 'off' ? '#4a6a4a' : '#ffcc44';
  if (shelterId !== null && shelterId !== undefined)
    _log(`Shelter #${shelterId} selected`);
  _refreshShelterList();
}

function _onDesignSaved(design) {
  // Check for existing design with same name and overwrite
  const idx = _designLib.findIndex(d => d.name === design.name);
  if (idx >= 0) _designLib[idx] = design;
  else          _designLib.push(design);
  _refreshDesignList();
  _log(`Design "${design.name}" saved (${design.parts.length} parts)`);
}

// ============================================================
//  UI build
// ============================================================

function _buildUI() {
  const style = document.createElement('style');
  style.textContent = `
    #ed-wrap {
      position: fixed; top: 12px; right: 12px;
      z-index: 9500;
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px; user-select: none;
      min-width: 240px; max-width: 260px;
    }
    #ed-toggle {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 10px;
      background: rgba(10,14,10,0.95);
      border: 1px solid #3a4a3a; border-radius: 4px 4px 0 0;
      color: #7aff7a; cursor: pointer;
      letter-spacing: 0.1em; text-transform: uppercase;
    }
    #ed-toggle:hover { background: rgba(20,30,20,0.98); }
    #ed-toggle .ed-caret { transition: transform 0.18s; }
    #ed-toggle.open .ed-caret { transform: rotate(180deg); }
    #ed-panel {
      display: none; background: rgba(8,12,8,0.97);
      border: 1px solid #3a4a3a; border-top: none;
      border-radius: 0 0 4px 4px; padding: 8px;
      color: #c8d8c8; max-height: 86vh; overflow-y: auto;
    }
    #ed-panel.open { display: block; }
    .ed-sec {
      margin-bottom: 8px; padding-bottom: 8px;
      border-bottom: 1px solid #1a2a1a;
    }
    .ed-sec:last-child { margin-bottom: 0; border-bottom: none; }
    .ed-lbl {
      color: #4a7a4a; font-size: 9px;
      letter-spacing: 0.15em; text-transform: uppercase;
      margin-bottom: 4px;
    }
    .ed-val { color: #aaffaa; font-size: 11px; margin-bottom: 5px; }
    .ed-mode {
      font-size: 10px; font-weight: bold;
      letter-spacing: 0.1em; padding: 3px 0;
    }
    .ed-btn {
      display: block; width: 100%; padding: 4px 8px; margin-bottom: 3px;
      background: #0e1e0e; border: 1px solid #3a6a3a;
      color: #8aee8a; cursor: pointer; text-align: left;
      font-family: inherit; font-size: 10px;
      letter-spacing: 0.06em; text-transform: uppercase;
      transition: background 0.12s; border-radius: 2px;
    }
    .ed-btn:hover  { background: #1a3a1a; color: #ccffcc; }
    .ed-btn.active { background: #0a3a0a; border-color: #7aee7a; color: #ccffcc; }
    .ed-btn.danger { border-color: #6a3a3a; color: #ee8a8a; }
    .ed-btn.danger:hover { background: #3a1a1a; }
    .ed-btn.amber  { border-color: #7a6a00; color: #ffcc44; }
    .ed-btn.amber:hover  { background: #2a2000; }
    .ed-btn.blue   { border-color: #3a6aaa; color: #8aaaee; }
    .ed-btn.blue:hover   { background: #1a2a3a; }
    .ed-btn-row {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 3px; margin-bottom: 3px;
    }
    .ed-btn-row .ed-btn { margin-bottom: 0; }
    .ed-btn-row3 {
      display: grid; grid-template-columns: 1fr 1fr 1fr;
      gap: 3px; margin-bottom: 3px;
    }
    .ed-btn-row3 .ed-btn { margin-bottom: 0; }
    #ed-countdown {
      color: #ffcc44; font-size: 13px; font-weight: bold;
      text-align: center; padding: 3px 0; display: none;
    }
    .ed-shel-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 3px 5px; margin-bottom: 2px;
      background: #050e05; border: 1px solid #1a2a1a;
      border-radius: 2px; cursor: pointer; font-size: 10px;
    }
    .ed-shel-row:hover   { background: #0a1e0a; }
    .ed-shel-row.sel     { border-color: #00ddff; color: #00ddff; }
    .ed-shel-row .sh-del { color: #ee5544; padding: 0 4px; font-size: 11px; }
    .ed-design-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 3px 5px; margin-bottom: 2px;
      background: #050a12; border: 1px solid #1a2030;
      border-radius: 2px; font-size: 10px;
    }
    .ed-design-row .name { color: #8aaaee; flex: 1; }
    .ed-design-row .parts-ct { color: #4a6a8a; font-size: 9px; margin: 0 6px; }
    .ed-design-row button {
      background: none; border: none; cursor: pointer;
      color: #5a9aee; font-family: inherit; font-size: 9px;
      padding: 1px 4px; text-transform: uppercase;
    }
    .ed-design-row button:hover { color: #aaccff; }
    .ed-design-row button.del   { color: #ee5544; }
    .ed-design-row button.del:hover { color: #ffaaaa; }
    .ed-textarea {
      width: 100%; height: 50px; background: #050a05;
      border: 1px solid #1a2a1a; color: #7acc7a;
      font-family: inherit; font-size: 10px;
      padding: 4px; resize: none; box-sizing: border-box;
      border-radius: 2px; margin-top: 3px;
    }
    #ed-log {
      height: 56px; overflow-y: auto;
      background: #050a05; border: 1px solid #1a2a1a;
      padding: 3px 5px; color: #5a8a5a;
      font-size: 9px; line-height: 1.5; border-radius: 2px;
    }
    .ed-input {
      width: 100%; background: #050a05; border: 1px solid #1a3a1a;
      color: #aaffaa; font-family: inherit; font-size: 10px;
      padding: 3px 6px; border-radius: 2px; box-sizing: border-box;
      margin-bottom: 3px; outline: none;
    }
    .ed-input:focus { border-color: #3a7a3a; }
    .ed-hint { color: #3a6a3a; font-size: 9px; line-height: 1.4; }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'ed-wrap';

  const toggle = document.createElement('div');
  toggle.id = 'ed-toggle';
  toggle.innerHTML = `<span>⚙ Level Editor</span><span class="ed-caret">▼</span>`;
  toggle.addEventListener('click', () => {
    const opening = !_panel.classList.contains('open');
    toggle.classList.toggle('open');
    _panel.classList.toggle('open');
    // Release pointer lock when opening so cursor is free to click panel
    if (opening && document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (!opening) resumeMouse();
  });

  // Suspend game mouse input whenever cursor is over the editor wrap
  wrap.addEventListener('mouseenter', () => suspendMouse());
  wrap.addEventListener('mouseleave', () => {
    // Only resume if panel is closed — keep suspended while panel is open
    if (!_panel.classList.contains('open')) resumeMouse();
  });

  _panel = document.createElement('div');
  _panel.id = 'ed-panel';

  _panel.appendChild(_buildPosSection());
  _panel.appendChild(_buildPlaceSection());
  _panel.appendChild(_buildEditSection());
  _panel.appendChild(_buildAddPartSection());
  _panel.appendChild(_buildDesignSection());
  _panel.appendChild(_buildLogSection());

  wrap.appendChild(toggle);
  wrap.appendChild(_panel);
  document.body.appendChild(wrap);

  setInterval(_refreshShelterList, 2000);
}

// ============================================================
//  Section builders
// ============================================================

function _buildPosSection() {
  const sec = _sec('Player Position');
  _posDisplay = document.createElement('div');
  _posDisplay.className = 'ed-val';
  _posDisplay.textContent = '—';
  sec.appendChild(_posDisplay);
  sec.appendChild(_btn('Copy Position', () => {
    const pos = _getPlayerPos?.();
    if (!pos) return;
    navigator.clipboard?.writeText(formatPos(pos));
    _log('Copied: ' + formatPos(pos));
  }));
  return sec;
}

function _buildPlaceSection() {
  const sec = _sec('Place Shelter');

  const countdown = document.createElement('div');
  countdown.id = 'ed-countdown';
  sec.appendChild(countdown);

  sec.appendChild(_btn('⏱ Drop Here (3s)', () => {
    if (_cancelPlace) { _cancelPlace(); _cancelPlace = null; }
    countdown.style.display = 'block';
    _log('Placing in 3s — step away!');
    _cancelPlace = placeShelterAtPlayer(
      _getPlayerPos, 3000,
      s => { countdown.textContent = s > 0 ? 'Placing in ' + s + '…' : 'Placing!'; },
      () => {
        countdown.style.display = 'none';
        _log('Shelter placed at ' + formatPos(_getPlayerPos?.()));
        _refreshShelterList();
        _cancelPlace = null;
        // Close panel, resume mouse, re-acquire pointer lock so player can navigate
        const toggle = document.getElementById('ed-toggle');
        toggle?.classList.remove('open');
        _panel.classList.remove('open');
        resumeMouse();
        const canvas = document.getElementById('renderCanvas') || document.querySelector('canvas');
        canvas?.requestPointerLock();
      },
    );
  }));

  const cancelBtn = _btn('✕ Cancel', () => {
    _cancelPlace?.(); _cancelPlace = null;
    countdown.style.display = 'none';
    _log('Cancelled.');
    resumeMouse();
    const canvas = document.getElementById('renderCanvas') || document.querySelector('canvas');
    canvas?.requestPointerLock();
  });
  cancelBtn.classList.add('danger');
  sec.appendChild(cancelBtn);

  _shelListEl = document.createElement('div');
  sec.appendChild(_shelListEl);

  return sec;
}

function _buildEditSection() {
  const sec = _sec('Edit Shelter');

  // Mode display
  _modeDisplay = document.createElement('div');
  _modeDisplay.className = 'ed-mode';
  _modeDisplay.textContent = '— OFF';
  _modeDisplay.style.color = '#4a6a4a';
  sec.appendChild(_modeDisplay);

  sec.appendChild(document.createElement('div')).className = 'ed-hint';
  sec.lastChild.textContent = 'Click shelter to select, then choose mode.';

  // Mode buttons row
  const r1 = document.createElement('div');
  r1.className = 'ed-btn-row';

  const selBtn = _btn('◎ Select', () => {
    setShelterEditorMode(
      getShelterEditorMode() === 'selectShel' ? 'off' : 'selectShel'
    );
    _refreshModeBtns(selBtn, grpBtn, partBtn);
  });

  const grpBtn = _btn('⤢ Group', () => {
    const sel = getSelectedShelter();
    if (!sel) { _log('Select a shelter first'); return; }
    setShelterEditorMode(
      getShelterEditorMode() === 'moveGroup' ? 'selectShel' : 'moveGroup'
    );
    _refreshModeBtns(selBtn, grpBtn, partBtn);
  });
  grpBtn.classList.add('amber');

  r1.appendChild(selBtn);
  r1.appendChild(grpBtn);
  sec.appendChild(r1);

  const r2 = document.createElement('div');
  r2.className = 'ed-btn-row';

  const partBtn = _btn('✥ Grab Part', () => {
    const sel = getSelectedShelter();
    if (!sel) { _log('Select a shelter first'); return; }
    setShelterEditorMode(
      getShelterEditorMode() === 'selectPart' ? 'selectShel' : 'selectPart'
    );
    _refreshModeBtns(selBtn, grpBtn, partBtn);
  });

  const releaseBtn = _btn('↓ Release', () => {
    releasePart();
    _refreshModeBtns(selBtn, grpBtn, partBtn);
    _log('Part released');
  });

  r2.appendChild(partBtn);
  r2.appendChild(releaseBtn);
  sec.appendChild(r2);

  // Nudge pad
  const nudgeLbl = document.createElement('div');
  nudgeLbl.className = 'ed-lbl';
  nudgeLbl.style.marginTop = '5px';
  nudgeLbl.textContent = 'Nudge (arrows work too)';
  sec.appendChild(nudgeLbl);

  const S = 0.25;
  const r3 = document.createElement('div');
  r3.className = 'ed-btn-row3';
  [['−X', -S,0,0,'danger'],['−Z', 0,0,-S,''],['−Y', 0,-S,0,'amber'],
   ['+X',  S,0,0,''],     ['+Z', 0,0, S,''],  ['+Y', 0, S,0,'amber']]
    .forEach(([label, dx, dy, dz, cls]) => {
      const b = _btn(label, () => nudge(dx, dy, dz));
      if (cls) b.classList.add(cls);
      r3.appendChild(b);
    });
  sec.appendChild(r3);

  // Delete part
  const delBtn = _btn('🗑 Delete Grabbed Part', () => {
    removeGrabbedPart();
    _log('Part removed');
  });
  delBtn.classList.add('danger');
  delBtn.style.marginTop = '4px';
  sec.appendChild(delBtn);

  // Deselect / exit
  const offBtn = _btn('✕ Exit Edit Mode', () => {
    setShelterEditorMode('off');
    _refreshModeBtns(selBtn, grpBtn, partBtn);
  });
  offBtn.classList.add('danger');
  sec.appendChild(offBtn);

  return sec;
}

function _buildAddPartSection() {
  const sec = _sec('Add Part to Selected');

  const hint = document.createElement('div');
  hint.className = 'ed-hint';
  hint.textContent = 'Part spawns at your feet in selected shelter.';
  sec.appendChild(hint);

  const r = document.createElement('div');
  r.className = 'ed-btn-row';

  ['pole','pallet','board','panel'].forEach(type => {
    const b = _btn('+ ' + type, () => {
      const sel = getSelectedShelter();
      if (!sel) { _log('Select a shelter first'); return; }
      const pos = _getPlayerPos?.();
      if (!pos)  { _log('No player position'); return; }
      const part = addPartAtPlayer(type, pos, sel);
      if (part) _log('Added ' + type + ' to shelter #' + sel.id);
    });
    r.appendChild(b);
  });
  sec.appendChild(r);

  return sec;
}

function _buildDesignSection() {
  const sec = _sec('Design Library');

  // Save current shelter as design
  const nameInput = document.createElement('input');
  nameInput.className   = 'ed-input';
  nameInput.placeholder = 'Design name…';
  nameInput.type        = 'text';
  sec.appendChild(nameInput);

  const saveBtn = _btn('💾 Save Selected as Design', () => {
    const sel = getSelectedShelter();
    if (!sel) { _log('Select a shelter first'); return; }
    const name = nameInput.value.trim() || ('design_' + Date.now());
    saveSelectedDesign(name);
    nameInput.value = '';
  });
  saveBtn.classList.add('blue');
  sec.appendChild(saveBtn);

  // Design list
  const listEl = document.createElement('div');
  listEl.id = 'ed-design-list';
  sec.appendChild(listEl);

  // Export all designs JSON
  _outputEl = document.createElement('textarea');
  _outputEl.className   = 'ed-textarea';
  _outputEl.placeholder = 'Design JSON output…';
  _outputEl.readOnly    = true;
  sec.appendChild(_outputEl);

  const copyBtn = _btn('Copy JSON → editor.php', () => {
    navigator.clipboard?.writeText(_outputEl.value);
    _log('Design JSON copied');
  });
  copyBtn.classList.add('blue');
  sec.appendChild(copyBtn);

  return sec;
}

function _buildLogSection() {
  const sec = _sec('Log');
  _logEl = document.createElement('div');
  _logEl.id = 'ed-log';
  sec.appendChild(_logEl);
  return sec;
}

// ============================================================
//  Refresh helpers
// ============================================================

function _refreshShelterList() {
  if (!_shelListEl) return;
  _shelListEl.innerHTML = '';
  const alive = shelters.filter(s => !s.dead);
  if (!alive.length) {
    _shelListEl.innerHTML = '<div class="ed-hint">No shelters placed</div>';
    return;
  }
  const sel = getSelectedShelter();
  for (const s of alive) {
    const row = document.createElement('div');
    row.className = 'ed-shel-row' + (sel && sel.id === s.id ? ' sel' : '');
    row.innerHTML =
      '<span>#' + s.id + ' ' +
      s.origin.x.toFixed(1) + ',' + s.origin.z.toFixed(1) +
      ' (' + s.parts.length + ' parts)</span>' +
      '<span class="sh-del" title="Delete">✕</span>';
    row.querySelector('.sh-del').addEventListener('click', e => {
      e.stopPropagation();
      // Mark dead — tickShelters will clean it up
      s.dead = true;
      for (const p of s.parts) {
        try { p.mesh?.dispose(); } catch(_) {}
      }
      _log('Shelter #' + s.id + ' removed');
      _refreshShelterList();
    });
    row.addEventListener('click', () => {
      setShelterEditorMode('selectShel');
      // Fake a selection by clicking the first mesh
      // Actually call the editor's select directly via import
      _log('Click a part on shelter #' + s.id + ' to select it');
    });
    _shelListEl.appendChild(row);
  }
}

function _refreshDesignList() {
  const listEl = document.getElementById('ed-design-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!_designLib.length) {
    listEl.innerHTML = '<div class="ed-hint">No designs saved yet</div>';
    _outputEl && (_outputEl.value = '');
    return;
  }

  for (let i = 0; i < _designLib.length; i++) {
    const d   = _designLib[i];
    const row = document.createElement('div');
    row.className = 'ed-design-row';
    row.innerHTML =
      '<span class="name">' + d.name + '</span>' +
      '<span class="parts-ct">' + d.parts.length + ' parts</span>' +
      '<button class="spawn">Spawn</button>' +
      '<button class="copy">Copy</button>' +
      '<button class="del">✕</button>';

    row.querySelector('.spawn').addEventListener('click', () => {
      const pos = _getPlayerPos?.();
      if (!pos) { _log('No player pos'); return; }
      import('./shelters.js').then(m => {
        m.spawnFromDesign(d, pos);
        _log('Spawned "' + d.name + '" at player pos');
        _refreshShelterList();
      });
    });

    row.querySelector('.copy').addEventListener('click', () => {
      const json = JSON.stringify(d, null, 2);
      navigator.clipboard?.writeText(json);
      _log('Copied "' + d.name + '" JSON');
    });

    row.querySelector('.del').addEventListener('click', () => {
      _designLib.splice(i, 1);
      _refreshDesignList();
      _log('Deleted design "' + d.name + '"');
    });

    listEl.appendChild(row);
  }

  // Update export textarea with full library JSON
  if (_outputEl) {
    _outputEl.value = JSON.stringify(_designLib, null, 2);
  }
}

function _refreshModeBtns(selBtn, grpBtn, partBtn) {
  const mode = getShelterEditorMode();
  selBtn.classList.toggle('active', mode === 'selectShel');
  grpBtn.classList.toggle('active', mode === 'moveGroup');
  partBtn.classList.toggle('active', mode === 'selectPart' || mode === 'movePart');
}

// ============================================================
//  DOM helpers
// ============================================================

function _sec(label) {
  const sec = document.createElement('div');
  sec.className = 'ed-sec';
  const lbl = document.createElement('div');
  lbl.className   = 'ed-lbl';
  lbl.textContent = label;
  sec.appendChild(lbl);
  return sec;
}

function _btn(text, onClick) {
  const b = document.createElement('button');
  b.className   = 'ed-btn';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function _log(msg) {
  if (!_logEl) return;
  const line = document.createElement('div');
  line.textContent = '> ' + msg;
  _logEl.appendChild(line);
  _logEl.scrollTop = _logEl.scrollHeight;
}