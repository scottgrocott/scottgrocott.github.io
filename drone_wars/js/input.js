// ============================================================
//  input.js — Keyboard, mouse (pointer-lock), callback registry
//
//  Key bindings:
//    WASD / Arrow keys — move
//    Space             — jump
//    C                 — crouch/duck
//    F                 — toggle freecam / fly+edit mode
//    N or 0            — spawn drone manually
//    Left-click        — shoot (while pointer-locked)
//    Escape            — release pointer lock
// ============================================================

import { isMouseSuspended } from './inputGuard.js';
import { pointerLock, applyLookDelta } from './look.js';

export { pointerLock };

// ============================================================
//  Shared input state — 'inputState' (gamepad.js) + 'keys' (player.js)
// ============================================================

export const inputState = {
  moveForward: false,
  moveBack:    false,
  moveLeft:    false,
  moveRight:   false,
  jump:        false,
  duck:        false,
  sprint:      false,
};

// player.js reads: keys.w  keys.s  keys.a  keys.d  keys.space  keys.duck
Object.defineProperties(inputState, {
  w:        { get() { return this.moveForward; }, set(v) { this.moveForward = v; }, enumerable: true },
  s:        { get() { return this.moveBack;    }, set(v) { this.moveBack    = v; }, enumerable: true },
  a:        { get() { return this.moveLeft;    }, set(v) { this.moveLeft    = v; }, enumerable: true },
  d:        { get() { return this.moveRight;   }, set(v) { this.moveRight   = v; }, enumerable: true },
  space:    { get() { return this.jump;        }, set(v) { this.jump        = v; }, enumerable: true },
  forward:  { get() { return this.moveForward; }, set(v) { this.moveForward = v; }, enumerable: true },
  backward: { get() { return this.moveBack;    }, set(v) { this.moveBack    = v; }, enumerable: true },
  left:     { get() { return this.moveLeft;    }, set(v) { this.moveLeft    = v; }, enumerable: true },
  right:    { get() { return this.moveRight;   }, set(v) { this.moveRight   = v; }, enumerable: true },
});

export const keys = inputState;

// ============================================================
//  Callbacks
// ============================================================

let _shootCb      = null;
let _freeCamCb    = null;
let _spawnDroneCb = null;

export function registerShootCallback(fn)      { _shootCb      = fn; }
export function registerFreeCamCallback(fn)    { _freeCamCb    = fn; }
export function registerSpawnDroneCallback(fn) { _spawnDroneCb = fn; }

// ============================================================
//  Mouse sensitivity
// ============================================================

const SENS_X = 0.0018;
const SENS_Y = 0.0022;

// ============================================================
//  Pointer-lock
// ============================================================

const _canvas = document.getElementById('renderCanvas') || document.querySelector('canvas');

if (_canvas) {
  _canvas.addEventListener('click', () => {
    if (isMouseSuspended()) return;
    if (!document.pointerLockElement) _canvas.requestPointerLock();
  });
}

document.addEventListener('pointerlockchange', () => {
  pointerLock.locked = !!document.pointerLockElement;
});

document.addEventListener('pointerlockerror', () => {
  console.warn('[input] Pointer lock error');
});

// ============================================================
//  Mouse-move
// ============================================================

document.addEventListener('mousemove', e => {
  if (isMouseSuspended()) return;
  if (!pointerLock.locked) return;
  applyLookDelta(
    -e.movementX * SENS_Y,
    -e.movementY * SENS_X,
  );
});

// ============================================================
//  Mouse-click — shoot
// ============================================================

document.addEventListener('mousedown', e => {
  if (isMouseSuspended()) return;
  if (!pointerLock.locked) return;
  if (e.button === 0) _shootCb?.();
});

// ============================================================
//  Keyboard
// ============================================================

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.code) {
    // Movement — WASD and Arrow keys both work
    case 'KeyW': case 'ArrowUp':    inputState.moveForward = true;  break;
    case 'KeyS': case 'ArrowDown':  inputState.moveBack    = true;  break;
    case 'KeyA': case 'ArrowLeft':  inputState.moveLeft    = true;  break;
    case 'KeyD': case 'ArrowRight': inputState.moveRight   = true;  break;
    case 'Space':                   inputState.jump        = true;  e.preventDefault(); break;
    case 'KeyC':                    inputState.duck        = true;  break;
    case 'ShiftLeft': case 'ShiftRight': inputState.sprint = true;  break;

    // F — toggle freecam / fly+edit mode
    case 'KeyF':
      e.preventDefault();
      _freeCamCb?.();
      break;

    // N or 0 — spawn drone
    case 'KeyN':
    case 'Digit0':
    case 'Numpad0':
      _spawnDroneCb?.();
      break;

    // Escape — release pointer lock (inputGuard blanks 3 frames to absorb cursor snap)
    case 'Escape':
      if (document.pointerLockElement) document.exitPointerLock();
      break;
  }
});

document.addEventListener('keyup', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    inputState.moveForward = false; break;
    case 'KeyS': case 'ArrowDown':  inputState.moveBack    = false; break;
    case 'KeyA': case 'ArrowLeft':  inputState.moveLeft    = false; break;
    case 'KeyD': case 'ArrowRight': inputState.moveRight   = false; break;
    case 'Space':                   inputState.jump        = false; break;
    case 'KeyC':                    inputState.duck        = false; break;
    case 'ShiftLeft': case 'ShiftRight': inputState.sprint = false; break;
  }
});

export { isMouseSuspended };
export { applyLookDelta };