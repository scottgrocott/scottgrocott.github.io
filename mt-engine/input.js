// input.js — keyboard, mouse, pointer lock, callback registry

import { pointerLock } from './look.js';
import { applyLookDelta as _applyLookDelta } from './look.js';
import { isMouseSuspended } from './inputGuard.js';

// inputState and keys are THE SAME OBJECT
// Object.defineProperties bridges keys.w/s/a/d/space → inputState.moveForward etc.
const _base = {
  moveForward:  false,
  moveBack:     false,
  moveLeft:     false,
  moveRight:    false,
  jump:         false,
  duck:         false,
  sprint:       false,
};

export const inputState = _base;

export const keys = _base;
Object.defineProperties(keys, {
  w:     { get(){ return _base.moveForward;  }, set(v){ _base.moveForward  = v; }, enumerable: true },
  s:     { get(){ return _base.moveBack;     }, set(v){ _base.moveBack     = v; }, enumerable: true },
  a:     { get(){ return _base.moveLeft;     }, set(v){ _base.moveLeft     = v; }, enumerable: true },
  d:     { get(){ return _base.moveRight;    }, set(v){ _base.moveRight    = v; }, enumerable: true },
  space: { get(){ return _base.jump;         }, set(v){ _base.jump         = v; }, enumerable: true },
});

// ---- Callback registries ----
const _shootCallbacks     = [];
const _freecamCallbacks   = [];
const _spawnEnemyCallbacks = [];

export function registerShootCallback(fn)       { _shootCallbacks.push(fn); }
export function registerFreeCamCallback(fn)     { _freecamCallbacks.push(fn); }
export function registerSpawnEnemyCallback(fn)  { _spawnEnemyCallbacks.push(fn); }

// ---- Freecam flag (set by main.js after toggle) ----
let _inFreeCam = false;
export function setFreeCamActive(val) { _inFreeCam = val; }

// ---- Mouse look sensitivity ----
export const MOUSE_SENSITIVITY = 0.002;

// ---- Pointer lock ----
const canvas = document.getElementById('renderCanvas');

canvas.addEventListener('click', () => {
  if (!_inFreeCam) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  pointerLock.locked = !!document.pointerLockElement;
});

// ---- Mouse move ----
document.addEventListener('mousemove', (e) => {
  if (isMouseSuspended()) return;
  if (!pointerLock.locked && !_inFreeCam) return;
  const dx =  e.movementX * MOUSE_SENSITIVITY;
  const dy =  e.movementY * MOUSE_SENSITIVITY;
  _applyLookDelta(dx, dy);
});

// ---- Mouse click → shoot ----
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!pointerLock.locked && !_inFreeCam) return;
  _shootCallbacks.forEach(fn => fn());
});

// ---- Keyboard ----
const KEY_MAP = {
  'KeyW': 'moveForward', 'ArrowUp': 'moveForward',
  'KeyS': 'moveBack',    'ArrowDown': 'moveBack',
  'KeyA': 'moveLeft',    'ArrowLeft': 'moveLeft',
  'KeyD': 'moveRight',   'ArrowRight': 'moveRight',
  'Space': 'jump',
  'KeyC': 'duck',
  'ShiftLeft': 'sprint', 'ShiftRight': 'sprint',
};

document.addEventListener('keydown', (e) => {
  if (e.code in KEY_MAP) {
    _base[KEY_MAP[e.code]] = true;
    if (e.code === 'Space') e.preventDefault();
    return;
  }
  if (e.code === 'KeyF') {
    _freecamCallbacks.forEach(fn => fn());
    return;
  }
  if (e.code === 'KeyN' || e.code === 'Digit0' || e.code === 'Numpad0') {
    _spawnEnemyCallbacks.forEach(fn => fn());
    return;
  }
  if (e.code === 'Escape') {
    document.exitPointerLock();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code in KEY_MAP) _base[KEY_MAP[e.code]] = false;
});

// Re-export applyLookDelta so other modules can import it from here
export { _applyLookDelta as applyLookDelta };
