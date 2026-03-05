// editor/structureEditor.js — drag/drop rigid GLB structure placement

import { structures, placeStructure, removeStructure } from '../structures.js';
import { capturePlayerPosition } from '../shelters/utils.js';
import { scene } from '../core.js';

const NUDGE_STEP = 0.1;

let _selectedStruct = null;

export function initStructureEditor(container) {
  if (!container) return;

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add Structure (GLB URL)';
  addBtn.style.cssText = 'background:#0e1e0e;border:1px solid #3a6a3a;color:#8aee8a;cursor:pointer;padding:3px 8px;width:100%;font-family:inherit;margin-bottom:6px;';
  addBtn.addEventListener('click', () => {
    const url = prompt('GLB URL (or leave blank for placeholder):');
    const pos = capturePlayerPosition();
    placeStructure(url || null, pos, { width:2, height:2, depth:2 });
    _renderStructureList(listEl);
  });
  container.appendChild(addBtn);

  const listEl = document.createElement('div');
  container.appendChild(listEl);
  _renderStructureList(listEl);

  document.addEventListener('keydown', (e) => {
    if (!_selectedStruct) return;
    const pos = _selectedStruct.worldPos;
    if (e.code === 'ArrowLeft')  { pos.x -= NUDGE_STEP; _syncStruct(_selectedStruct); }
    if (e.code === 'ArrowRight') { pos.x += NUDGE_STEP; _syncStruct(_selectedStruct); }
    if (e.code === 'ArrowUp')    { pos.z -= NUDGE_STEP; _syncStruct(_selectedStruct); }
    if (e.code === 'ArrowDown')  { pos.z += NUDGE_STEP; _syncStruct(_selectedStruct); }
    if (e.code === 'Delete' && _selectedStruct) {
      removeStructure(_selectedStruct);
      _selectedStruct = null;
      _renderStructureList(listEl);
    }
  });
}

function _renderStructureList(container) {
  container.innerHTML = '';
  structures.forEach((s, i) => {
    const row = document.createElement('div');
    row.style.cssText = `border:1px solid ${_selectedStruct === s ? '#4aee4a' : '#1a3a1a'};padding:4px;margin-bottom:4px;cursor:pointer;`;
    row.textContent = `#${i} ${s.glbUrl ? s.glbUrl.split('/').pop() : 'placeholder'} @ ${s.worldPos.x.toFixed(1)},${s.worldPos.y.toFixed(1)},${s.worldPos.z.toFixed(1)}`;
    row.addEventListener('click', () => {
      _selectedStruct = s;
      _renderStructureList(container);
    });
    container.appendChild(row);
  });
}

function _syncStruct(struct) {
  if (!struct.body) return;
  const p = struct.worldPos;
  try {
    struct.body.setTranslation({x:+p.x, y:+p.y, z:+p.z}, true);
    struct.meshes.forEach(m => m.position.set(+p.x, +p.y, +p.z));
  } catch(e) {}
}
