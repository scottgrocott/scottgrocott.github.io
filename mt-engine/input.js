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

// Only lock pointer after play button pressed — not on the play button click itself
let _splashDismissed = false;
document.addEventListener('splash-dismissed', () => { _splashDismissed = true; });

canvas.addEventListener('click', () => {
  if (_splashDismissed && !_inFreeCam) canvas.requestPointerLock();
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
  if (!pointerLock.locked && !_inFreeCam) return;   // require lock to shoot with mouse
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

// ── Gamepad ───────────────────────────────────────────────────────────────────
// Button indices (standard mapping): 0=A/Cross, 6=LT, 7=RT
// Axes: 0=LS-X, 1=LS-Y, 2=RS-X, 3=RS-Y
const GP_DEAD     = 0.15;
const GP_LOOK_SPD = 0.045;
let _gpShootHeld  = false;
let _gpAHeld      = false;
let _gpActive     = false;   // true once splash is dismissed

// Activate gamepad only after splash is dismissed (avoids firing on page load)
document.addEventListener('splash-dismissed', () => { _gpActive = true; });

// Also allow gamepad A/Cross to dismiss the splash (checked separately below)
export function tickGamepad() {
  const pads = navigator.getGamepads?.();
  if (!pads) return;
  const gp = Array.from(pads).find(p => p);
  if (!gp) return;

  // ── Pre-splash: only watch A/Cross to dismiss ─────────────────────────────
  if (!_gpActive) {
    const aPressed = gp.buttons[0]?.pressed;
    if (aPressed && !_gpAHeld) {
      const screen = document.getElementById('loading-screen');
      const btn    = document.getElementById('btn-play');
      // Only trigger if play button is actually visible (level is loaded and ready)
      if (screen && screen.style.display !== 'none' && btn && btn.style.display !== 'none') {
        btn.click();
      }
    }
    _gpAHeld = !!gp.buttons[0]?.pressed;
    return;
  }

  // ── Post-splash: full gamepad control ─────────────────────────────────────

  // Left stick → movement
  const lx = Math.abs(gp.axes[0]) > GP_DEAD ? gp.axes[0] : 0;
  const ly = Math.abs(gp.axes[1]) > GP_DEAD ? gp.axes[1] : 0;
  _base.moveForward = ly < -GP_DEAD;
  _base.moveBack    = ly >  GP_DEAD;
  _base.moveLeft    = lx < -GP_DEAD;
  _base.moveRight   = lx >  GP_DEAD;

  // Right stick → look
  const rx = Math.abs(gp.axes[2]) > GP_DEAD ? gp.axes[2] : 0;
  const ry = Math.abs(gp.axes[3]) > GP_DEAD ? gp.axes[3] : 0;
  if (rx !== 0 || ry !== 0) _applyLookDelta(rx * GP_LOOK_SPD, ry * GP_LOOK_SPD);

  // RT (button 7) → shoot on each press edge; weapon cooldown controls repeat rate
  const rtVal     = gp.buttons[7]?.value ?? 0;
  const rtPressed = rtVal > 0.25 || !!gp.buttons[7]?.pressed;
  if (rtPressed) _shootCallbacks.forEach(fn => fn()); // cooldown in weapon handles rate
  _gpShootHeld = rtPressed;

  // A / Cross → jump
  const aPressed = !!gp.buttons[0]?.pressed;
  if (aPressed && !_gpAHeld) {
    _base.jump = true;
    setTimeout(() => { _base.jump = false; }, 120);
  }
  _gpAHeld = aPressed;
}

// Re-export applyLookDelta so other modules can import it from here
export { _applyLookDelta as applyLookDelta };