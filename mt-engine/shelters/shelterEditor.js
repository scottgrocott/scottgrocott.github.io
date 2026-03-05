// shelters/shelterEditor.js — select, move group, grab part, nudge

import { scene }   from '../core.js';
import { shelters } from './shelters.js';
import { physicsWorld } from '../physics.js';

const NUDGE_STEP = 0.05;

let _selectedShelter = null;
let _selectedPart    = null;

export function initShelterEditor() {
  document.addEventListener('keydown', _onKey);
}

function _onKey(e) {
  if (!_selectedPart) return;

  const nudge = { x:0, y:0, z:0 };
  if (e.code === 'ArrowLeft')  nudge.x = -NUDGE_STEP;
  if (e.code === 'ArrowRight') nudge.x =  NUDGE_STEP;
  if (e.code === 'ArrowUp')    nudge.z = -NUDGE_STEP;
  if (e.code === 'ArrowDown')  nudge.z =  NUDGE_STEP;
  if (e.code === 'PageUp')     nudge.y =  NUDGE_STEP;
  if (e.code === 'PageDown')   nudge.y = -NUDGE_STEP;

  if (nudge.x !== 0 || nudge.y !== 0 || nudge.z !== 0) {
    _movePart(_selectedPart, nudge);
  }
}

function _movePart(part, delta) {
  if (!part.body) return;
  const t = part.body.translation();
  const nx = t.x + delta.x, ny = t.y + delta.y, nz = t.z + delta.z;
  if (isNaN(nx)||isNaN(ny)||isNaN(nz)) return;
  try {
    part.body.setTranslation({x:nx, y:ny, z:nz}, true);
    part.mesh.position.set(nx, ny, nz);
  } catch(e) {}
}

export function selectShelter(idx) {
  _selectedShelter = shelters[idx] || null;
  _selectedPart    = null;
}

export function selectPart(shelterIdx, partIdx) {
  const shelter = shelters[shelterIdx];
  if (!shelter) return;
  _selectedPart = shelter.parts[partIdx] || null;
}

export function getSelectedShelter() { return _selectedShelter; }
export function getSelectedPart()    { return _selectedPart; }
