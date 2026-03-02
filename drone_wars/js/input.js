// ============================================================
//  input.js — Abstract input layer + keyboard/mouse driver
// ============================================================

import { scene, camera }                    from './core.js';
import { pointerLock, applyLookDelta,
         setLookCamera }                    from './look.js';

// Register camera with look.js once (no circular dep — look.js has no imports)
setLookCamera(camera);

export { pointerLock };   // re-export so existing consumers don't break

const canvas = document.getElementById('renderCanvas');

// ---- Shared state ----
export const inputState = {
  moveForward: false,
  moveBack:    false,
  moveLeft:    false,
  moveRight:   false,
  jump:        false,
  duck:        false,
  shoot:       false,
  freeCam:     false,
  spawnDrone:  false,
};

// ---- One-shot callbacks ----
let _onShoot      = null;
let _onFreeCam    = null;
let _onSpawnDrone = null;
export function registerShootCallback(fn)      { _onShoot      = fn; }
export function registerFreeCamCallback(fn)    { _onFreeCam    = fn; }
export function registerSpawnDroneCallback(fn) { _onSpawnDrone = fn; }

function _fireOneShots() {
  if (inputState.shoot)      { inputState.shoot      = false; _onShoot?.();      }
  if (inputState.freeCam)    { inputState.freeCam    = false; _onFreeCam?.();    }
  if (inputState.spawnDrone) { inputState.spawnDrone = false; _onSpawnDrone?.(); }
}

// ============================================================
//  DRIVER 1 — Keyboard + Mouse (Pointer Lock)
// ============================================================

document.addEventListener('pointerlockchange', () => {
  pointerLock.locked = document.pointerLockElement === canvas;
});

scene.onPointerObservable.add(pi => {
  if (pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
    if (pi.event.button !== 0) return;
    if (!pointerLock.locked) {
      canvas.requestPointerLock();
    } else {
      inputState.shoot = true;
      _fireOneShots();
    }
  } else if (pi.type === BABYLON.PointerEventTypes.POINTERMOVE) {
    if (!pointerLock.locked) return;
    const e    = pi.event;
    const sens = 0.002;
    applyLookDelta(-(e.movementX || 0) * sens, -(e.movementY || 0) * sens);
  }
});

window.addEventListener('keydown', e => {
  switch (e.code) {
    case 'KeyW':    case 'ArrowUp':    inputState.moveForward = true;  break;
    case 'KeyS':    case 'ArrowDown':  inputState.moveBack    = true;  break;
    case 'KeyA':    case 'ArrowLeft':  inputState.moveLeft    = true;  break;
    case 'KeyD':    case 'ArrowRight': inputState.moveRight   = true;  break;
    case 'Space':   inputState.jump   = true; e.preventDefault();      break;
    case 'KeyC':    inputState.duck   = true;                          break;
    case 'KeyF':    inputState.freeCam    = true; _fireOneShots();      break;
    case 'Digit0':
    case 'Numpad0': inputState.spawnDrone = true; _fireOneShots();      break;
  }
});

window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'KeyW':    case 'ArrowUp':    inputState.moveForward = false; break;
    case 'KeyS':    case 'ArrowDown':  inputState.moveBack    = false; break;
    case 'KeyA':    case 'ArrowLeft':  inputState.moveLeft    = false; break;
    case 'KeyD':    case 'ArrowRight': inputState.moveRight   = false; break;
    case 'Space':   inputState.jump   = false;                         break;
    case 'KeyC':    inputState.duck   = false;                         break;
  }
});

// ---- Legacy shim — player.js / ladders.js still import `keys` ----
const KEY_MAP = { w: 'moveForward', s: 'moveBack', a: 'moveLeft', d: 'moveRight', space: 'jump' };

export const keys = new Proxy(inputState, {
  get(t, k) { return t[KEY_MAP[k] ?? k]; },
  set(t, k, v) { t[KEY_MAP[k] ?? k] = v; return true; },
});