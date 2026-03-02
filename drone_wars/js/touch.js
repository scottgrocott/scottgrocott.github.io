// ============================================================
//  touch.js — Touch / mobile driver
//
//  Pattern: dual virtual joystick
//    Left  half of screen → movement (writes inputState)
//    Right half of screen → look    (writes pointerLock.euler via applyLookDelta)
//
//  Currently a STUB — canvas and event hooks are wired up,
//  joystick geometry is defined, but rendering and full
//  multi-touch tracking are left for the mobile sprint.
//
//  To activate: call initTouch() from boot() in main.js.
// ============================================================

import { inputState }      from './input.js';
import { applyLookDelta }  from './look.js';

// ---- Tuning ----
const JOYSTICK_RADIUS   = 60;    // px — virtual stick max travel
const MOVE_DEAD_ZONE    = 8;     // px — ignore tiny thumb drift
const LOOK_SENSITIVITY  = 0.005; // radians per pixel

// ---- Touch tracking ----
// Each entry: { id, startX, startY, currentX, currentY, side: 'left'|'right' }
const _touches = new Map();

let _oneShoot      = null;
let _oneFreeCam    = null;
let _oneSpawnDrone = null;
export function registerTouchShootCallback(fn)      { _oneShoot      = fn; }
export function registerTouchFreeCamCallback(fn)    { _oneFreeCam    = fn; }
export function registerTouchSpawnDroneCallback(fn) { _oneSpawnDrone = fn; }

export function initTouch() {
  const canvas = document.getElementById('renderCanvas');

  canvas.addEventListener('touchstart',  _onTouchStart,  { passive: false });
  canvas.addEventListener('touchmove',   _onTouchMove,   { passive: false });
  canvas.addEventListener('touchend',    _onTouchEnd,    { passive: false });
  canvas.addEventListener('touchcancel', _onTouchEnd,    { passive: false });

  console.info('[touch] Virtual joystick driver initialised (stub).');
}

// ---- Event handlers ----

function _onTouchStart(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const side = t.clientX < window.innerWidth / 2 ? 'left' : 'right';
    _touches.set(t.identifier, {
      id: t.identifier,
      startX: t.clientX, startY: t.clientY,
      currentX: t.clientX, currentY: t.clientY,
      side,
    });
  }
}

function _onTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const tracked = _touches.get(t.identifier);
    if (!tracked) continue;
    tracked.currentX = t.clientX;
    tracked.currentY = t.clientY;
  }
  _applyTouchState();
}

function _onTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const tracked = _touches.get(t.identifier);
    if (tracked) {
      // Release any movement this finger was driving
      if (tracked.side === 'left') {
        inputState.moveForward = false;
        inputState.moveBack    = false;
        inputState.moveLeft    = false;
        inputState.moveRight   = false;
      }
      _touches.delete(t.identifier);
    }
  }
}

// ---- Translate touch positions into inputState ----

function _applyTouchState() {
  for (const touch of _touches.values()) {
    const dx = touch.currentX - touch.startX;
    const dy = touch.currentY - touch.startY;

    if (touch.side === 'left') {
      // ---- Left joystick → movement ----
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag < MOVE_DEAD_ZONE) {
        inputState.moveForward = false;
        inputState.moveBack    = false;
        inputState.moveLeft    = false;
        inputState.moveRight   = false;
        continue;
      }
      // Clamp to joystick radius for normalised direction
      const clampedX = (dx / Math.max(mag, JOYSTICK_RADIUS));
      const clampedY = (dy / Math.max(mag, JOYSTICK_RADIUS));

      inputState.moveForward = clampedY < -0.3;
      inputState.moveBack    = clampedY >  0.3;
      inputState.moveLeft    = clampedX < -0.3;
      inputState.moveRight   = clampedX >  0.3;

    } else {
      // ---- Right joystick → look ----
      // Delta from last frame would be ideal, but for a stub we use raw delta
      // from touch start (works for slow swipes, jittery for fast ones).
      // TODO: store prevX/prevY per touch and use frame delta instead.
      applyLookDelta(dx * LOOK_SENSITIVITY, dy * LOOK_SENSITIVITY);
    }
  }
}