// gamepad.js — gamepad polling, same callback interface as input.js

import { inputState }      from './input.js';
import { applyLookDelta }  from './look.js';

const DEADZONE = 0.15;

const _shootCallbacks     = [];
const _freecamCallbacks   = [];
const _spawnCallbacks     = [];

let _prevBtns = {};

export function registerGamepadShootCallback(fn)    { _shootCallbacks.push(fn); }
export function registerGamepadFreeCamCallback(fn)  { _freecamCallbacks.push(fn); }
export function registerGamepadSpawnEnemyCallback(fn){ _spawnCallbacks.push(fn); }

export function pollGamepad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad  = Array.from(pads).find(p => p && p.connected);
  if (!pad) return;

  const axes = pad.axes;
  const dead = (v) => Math.abs(v) < DEADZONE ? 0 : v;

  // Left stick → movement
  const lx = dead(axes[0] || 0);
  const ly = dead(axes[1] || 0);
  inputState.moveRight   = lx >  0.3;
  inputState.moveLeft    = lx < -0.3;
  inputState.moveForward = ly < -0.3;
  inputState.moveBack    = ly >  0.3;

  // Right stick → look
  const rx = dead(axes[2] || 0);
  const ry = dead(axes[3] || 0);
  if (rx !== 0 || ry !== 0) {
    applyLookDelta(rx * 0.04, ry * 0.03);
  }

  const btns = pad.buttons;

  // Right trigger (btn 7) → shoot
  if ((btns[7]?.pressed) && !_prevBtns[7]) {
    _shootCallbacks.forEach(fn => fn());
  }
  // Right bumper (btn 5) → freecam
  if ((btns[5]?.pressed) && !_prevBtns[5]) {
    _freecamCallbacks.forEach(fn => fn());
  }
  // Left bumper (btn 4) → spawn enemy
  if ((btns[4]?.pressed) && !_prevBtns[4]) {
    _spawnCallbacks.forEach(fn => fn());
  }
  // A button (btn 0) → jump
  inputState.jump = !!btns[0]?.pressed;

  // Remember prev for edge detection
  for (let i = 0; i < btns.length; i++) {
    _prevBtns[i] = btns[i]?.pressed || false;
  }
}

export function releaseGamepadAxes() {
  // Axis-driven movement flags are reset in pollGamepad each frame
  // If no gamepad connected, ensure they don't get stuck
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad  = Array.from(pads).find(p => p && p.connected);
  if (!pad) {
    // Don't clear keyboard flags here — only axis driven
  }
}
