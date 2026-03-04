// ============================================================
//  shelterEditor.js — In-game shelter editing
//
//  Modes:
//    off          — normal gameplay, no editing
//    selectShel   — click a shelter part to select that shelter
//    moveGroup    — drag shelter origin on XZ ground plane
//    selectPart   — click individual part to grab it
//    movePart     — drag grabbed part freely in XZ or hold Shift for XY
//
//  Controls (when editor panel is open):
//    E            — cycle mode
//    Escape       — back to 'off'
//    G            — grab selected shelter for group move
//    P            — grab individual part mode
//    Arrow keys   — nudge selected by NUDGE_STEP metres
//    Shift+Arrow  — nudge Y axis
//    Delete       — remove grabbed part from shelter
// ============================================================

import { scene, camera }             from './core.js';
import { shelters, moveShelter,
         addPartToShelter,
         serializeDesign }           from './shelters.js';
import { physicsWorld }              from './physics.js';

// ---- Config ----
const NUDGE_STEP  = 0.1;    // metres per arrow key press
const DRAG_DIST   = 8;      // metres in front of camera for part drag
const HIGHLIGHT_A = new BABYLON.Color3(0, 0.85, 1);    // cyan — selected shelter
const HIGHLIGHT_B = new BABYLON.Color3(1, 0.65, 0);    // orange — grabbed part
const HIGHLIGHT_C = new BABYLON.Color3(0, 1, 0.4);     // green — hovered

// ---- State ----
let _mode           = 'off';
let _selectedShel   = null;   // active shelter
let _grabbedPart    = null;   // { shelter, part, origMat }
let _hoveredMesh    = null;
let _onModeChange   = null;   // callback(mode, shelterId)
let _onDesignSave   = null;   // callback(design)

// Material cache for highlight/restore
const _origMaterials = new WeakMap();

// ============================================================
//  Public API
// ============================================================

export function initShelterEditor(onModeChange, onDesignSave) {
  _onModeChange = onModeChange;
  _onDesignSave = onDesignSave;
  _bindKeys();
  _bindPointer();
  console.info('[shelterEditor] Ready');
}

export function setShelterEditorMode(mode) {
  _setMode(mode);
}

export function getShelterEditorMode() { return _mode; }

export function getSelectedShelter()   { return _selectedShel; }

/** Nudge selected shelter or grabbed part by delta */
export function nudge(dx, dy, dz) {
  if (_grabbedPart) {
    _movePart(_grabbedPart, dx, dy, dz);
  } else if (_selectedShel) {
    const o = _selectedShel.origin;
    moveShelter(_selectedShel, { x: o.x+dx, y: o.y+dy, z: o.z+dz });
  }
}

/** Save selected shelter as a named design */
export function saveSelectedDesign(name) {
  if (!_selectedShel) return null;
  const design = serializeDesign(_selectedShel, name);
  _onDesignSave?.(design);
  return design;
}

/** Remove the currently grabbed part */
export function removeGrabbedPart() {
  if (!_grabbedPart) return;
  const { shelter, part } = _grabbedPart;
  _restorePartMat(part);
  // Remove physics
  try { physicsWorld.removeCollider(part.collider, true); } catch(_) {}
  try { physicsWorld.removeRigidBody(part.body); } catch(_) {}
  part.mesh?.dispose();
  const idx = shelter.parts.indexOf(part);
  if (idx >= 0) shelter.parts.splice(idx, 1);
  _grabbedPart = null;
  _setMode('selectPart');
}

/** Add a new part of given type at player position */
export function addPartAtPlayer(typeName, playerPos, shelter) {
  if (!shelter) shelter = _selectedShel;
  if (!shelter) return null;
  return addPartToShelter(shelter, typeName, playerPos, null, null);
}

// ============================================================
//  Mode management
// ============================================================

function _setMode(mode) {
  // Clean up previous mode
  if (_mode === 'moveGroup' && _selectedShel) _unhighlightShelter(_selectedShel);
  if (_mode === 'movePart'  && _grabbedPart)  _restorePartMat(_grabbedPart.part);

  _mode = mode;

  if (mode === 'off') {
    if (_selectedShel) _unhighlightShelter(_selectedShel);
    _selectedShel = null;
    _grabbedPart  = null;
  }

  if (mode === 'moveGroup' && _selectedShel) _highlightShelter(_selectedShel, HIGHLIGHT_A);
  if (mode === 'movePart'  && _grabbedPart)  _highlightPart(_grabbedPart.part, HIGHLIGHT_B);

  _onModeChange?.(mode, _selectedShel?.id ?? null);
  console.info('[shelterEditor] Mode:', mode);
}

// ============================================================
//  Keyboard
// ============================================================

function _bindKeys() {
  window.addEventListener('keydown', e => {
    if (_mode === 'off') return;

    switch (e.code) {
      case 'Escape': _setMode('off'); break;
      case 'KeyG':
        if (_selectedShel) _setMode(_mode === 'moveGroup' ? 'selectShel' : 'moveGroup');
        break;
      case 'KeyP':
        _setMode(_mode === 'selectPart' ? 'selectShel' : 'selectPart');
        break;
      case 'Delete':
      case 'Backspace':
        if (_grabbedPart) removeGrabbedPart();
        break;

      // Arrow nudge
      case 'ArrowLeft':  e.preventDefault(); nudge(-NUDGE_STEP, 0, 0); break;
      case 'ArrowRight': e.preventDefault(); nudge( NUDGE_STEP, 0, 0); break;
      case 'ArrowUp':
        e.preventDefault();
        e.shiftKey ? nudge(0, NUDGE_STEP, 0) : nudge(0, 0, -NUDGE_STEP);
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.shiftKey ? nudge(0, -NUDGE_STEP, 0) : nudge(0, 0, NUDGE_STEP);
        break;
    }
  });
}

// ============================================================
//  Pointer (click to select, drag to move)
// ============================================================

function _bindPointer() {
  let _dragging  = false;
  let _dragStart = null;

  scene.onPointerObservable.add(info => {
    if (_mode === 'off') return;

    const evt = info.event;

    // ---- Hover highlight ----
    if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      _handleHover(info.pickInfo);
      if (_dragging && (_mode === 'moveGroup' || _mode === 'movePart')) {
        _handleDrag(info.pickInfo);
      }
      return;
    }

    // ---- Click / press ----
    if (info.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
      _dragging  = true;
      _dragStart = { x: evt.clientX, y: evt.clientY };

      if (_mode === 'selectShel' || _mode === 'selectPart') {
        _handleClick(info.pickInfo);
      }
      return;
    }

    if (info.type === BABYLON.PointerEventTypes.POINTERUP) {
      _dragging = false;
    }
  });
}

function _handleHover(pick) {
  const mesh = pick?.hit ? pick.pickedMesh : null;
  if (mesh === _hoveredMesh) return;

  // Restore previous hover
  if (_hoveredMesh) {
    const part = _findPartByMesh(_hoveredMesh);
    if (part && part !== _grabbedPart?.part) _restorePartMat(part);
    _hoveredMesh = null;
  }

  if (!mesh) return;
  const part = _findPartByMesh(mesh);
  if (!part) return;

  _hoveredMesh = mesh;
  if (part !== _grabbedPart?.part) _highlightPart(part, HIGHLIGHT_C);
}

function _handleClick(pick) {
  if (!pick?.hit) return;
  const mesh = pick.pickedMesh;
  const { shelter, part } = _findShelterAndPart(mesh) || {};
  if (!shelter) return;

  if (_mode === 'selectShel') {
    if (_selectedShel && _selectedShel !== shelter) _unhighlightShelter(_selectedShel);
    _selectedShel = shelter;
    _highlightShelter(shelter, HIGHLIGHT_A);
    _onModeChange?.(_mode, shelter.id);

  } else if (_mode === 'selectPart') {
    if (_selectedShel !== shelter) {
      if (_selectedShel) _unhighlightShelter(_selectedShel);
      _selectedShel = shelter;
    }
    if (_grabbedPart) _restorePartMat(_grabbedPart.part);
    _grabbedPart = { shelter, part };
    _highlightPart(part, HIGHLIGHT_B);
    // Freeze physics while grabbed
    _freezePart(part);
    _setMode('movePart');
  }
}

function _handleDrag(pick) {
  if (_mode === 'moveGroup' && _selectedShel) {
    // Project drag onto XZ ground plane
    const ground = _groundPoint(pick);
    if (ground) {
      moveShelter(_selectedShel, {
        x: ground.x,
        y: _selectedShel.origin.y,
        z: ground.z,
      });
    }

  } else if (_mode === 'movePart' && _grabbedPart) {
    const pt = _groundPoint(pick);
    if (pt) {
      const { part } = _grabbedPart;
      const t = part.body.translation();
      const ny = t.y;   // keep Y unless Shift held
      part.body.setTranslation({ x: pt.x, y: ny, z: pt.z }, true);
      part.mesh.position.set(pt.x, ny, pt.z);
      // Update relPos
      const o = _grabbedPart.shelter.origin;
      part.relPos.x = pt.x - o.x;
      part.relPos.z = pt.z - o.z;
    }
  }
}

// Get world XZ point from a pick / ray against ground plane y=0
function _groundPoint(pick) {
  if (pick?.hit && pick.pickedPoint) return pick.pickedPoint;
  // Fall back to ray-plane intersection at y=0
  const ray = scene.createPickingRay(
    scene.pointerX, scene.pointerY,
    BABYLON.Matrix.Identity(), camera,
  );
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;
  return new BABYLON.Vector3(
    ray.origin.x + ray.direction.x * t,
    0,
    ray.origin.z + ray.direction.z * t,
  );
}

// ============================================================
//  Physics freeze/unfreeze for grabbed parts
// ============================================================

function _freezePart(part) {
  try {
    part.body.setBodyType(window.RAPIER.RigidBodyType.KinematicPositionBased);
  } catch(_) {}
}

export function releasePart() {
  if (!_grabbedPart) return;
  const { part } = _grabbedPart;
  _restorePartMat(part);
  try {
    part.body.setBodyType(
      part.isFixed
        ? window.RAPIER.RigidBodyType.Fixed
        : window.RAPIER.RigidBodyType.Dynamic
    );
  } catch(_) {}
  _grabbedPart = null;
  _setMode('selectPart');
}

// ============================================================
//  Highlight helpers
// ============================================================

function _highlightShelter(shelter, color) {
  for (const p of shelter.parts) _highlightPart(p, color);
}

function _unhighlightShelter(shelter) {
  for (const p of shelter.parts) _restorePartMat(p);
}

function _highlightPart(part, color) {
  if (!part.mesh) return;
  if (!_origMaterials.has(part.mesh)) {
    _origMaterials.set(part.mesh, part.mesh.material);
  }
  const hi = new BABYLON.StandardMaterial('_hi', scene);
  hi.emissiveColor = color;
  hi.wireframe     = false;
  part.mesh.material = hi;
}

function _restorePartMat(part) {
  if (!part.mesh) return;
  const orig = _origMaterials.get(part.mesh);
  if (orig) { part.mesh.material = orig; _origMaterials.delete(part.mesh); }
}

// ============================================================
//  Lookup helpers
// ============================================================

function _findPartByMesh(mesh) {
  for (const s of shelters) {
    for (const p of s.parts) { if (p.mesh === mesh) return p; }
  }
  return null;
}

function _findShelterAndPart(mesh) {
  for (const s of shelters) {
    for (const p of s.parts) {
      if (p.mesh === mesh) return { shelter: s, part: p };
    }
  }
  return null;
}

function _movePart(grabbed, dx, dy, dz) {
  const { part, shelter } = grabbed;
  const t  = part.body.translation();
  const nx = t.x+dx, ny = t.y+dy, nz = t.z+dz;
  part.body.setTranslation({ x:nx, y:ny, z:nz }, true);
  part.mesh.position.set(nx, ny, nz);
  part.relPos.x = nx - shelter.origin.x;
  part.relPos.y = ny - shelter.origin.y;
  part.relPos.z = nz - shelter.origin.z;
}