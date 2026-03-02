// ============================================================
//  gamepad.js — Gamepad API driver
//
//  Standard mapping (Xbox / PS / most controllers):
//
//  Left stick   axes[0]/axes[1]  — move (strafe / forward)
//  Right stick  axes[2]/axes[3]  — look (yaw / pitch)
//  A / Cross    buttons[0]       — jump
//  B / Circle   buttons[1]       — duck
//  X / Square   buttons[2]       — spawn drone
//  Y / Triangle buttons[3]       — freecam toggle
//  RT / R2      buttons[7]       — shoot (held = auto-fire)
//  LT / L2      buttons[6]       — (reserved)
//  Start        buttons[9]       — spawn drone (alt)
//
//  Call pollGamepad(dt) once per frame from the render loop.
//  It writes directly into inputState and applyLookDelta().
// ============================================================

import { inputState }                 from './input.js';
import { applyLookDelta }             from './look.js';

// ---- Tuning ----
const DEAD_ZONE        = 0.12;   // ignore stick noise below this magnitude
const LOOK_SENSITIVITY = 2.8;    // radians/second at full deflection
const MOVE_THRESHOLD   = 0.15;   // stick magnitude before movement is registered

// RT shoot: fire once per press (not every frame the trigger is held)
let _rtWasDown      = false;
let _freeCamWasDown = false;
let _spawnWasDown   = false;

// One-shot callbacks (same pattern as keyboard driver)
let _onShoot      = null;
let _onFreeCam    = null;
let _onSpawnDrone = null;
export function registerGamepadShootCallback(fn)      { _onShoot      = fn; }
export function registerGamepadFreeCamCallback(fn)    { _onFreeCam    = fn; }
export function registerGamepadSpawnDroneCallback(fn) { _onSpawnDrone = fn; }

// Connection events — purely informational
window.addEventListener('gamepadconnected',    e => console.info(`[gamepad] Connected: "${e.gamepad.id}" (index ${e.gamepad.index})`));
window.addEventListener('gamepaddisconnected', e => console.info(`[gamepad] Disconnected: index ${e.gamepad.index}`));

/**
 * Poll all connected gamepads and merge their state into inputState.
 * Must be called once per render frame.
 * @param {number} dt — frame delta in seconds
 */
export function pollGamepad(dt) {
  const gamepads = navigator.getGamepads?.();
  if (!gamepads) return;

  // Use first connected gamepad found
  let gp = null;
  for (const g of gamepads) {
    if (g && g.connected) { gp = g; break; }
  }
  if (!gp) return;

  const ax = gp.axes;
  const bt = gp.buttons;

  // ---- Left stick — movement ----
  const lx = _deadZone(ax[0] ?? 0);
  const ly = _deadZone(ax[1] ?? 0);

  // Write as digital booleans (additive with keyboard — OR logic)
  if (ly < -MOVE_THRESHOLD) inputState.moveForward = true;
  if (ly >  MOVE_THRESHOLD) inputState.moveBack    = true;
  if (lx < -MOVE_THRESHOLD) inputState.moveLeft    = true;
  if (lx >  MOVE_THRESHOLD) inputState.moveRight   = true;

  // Release when stick returns to centre (only if keyboard isn't also holding)
  // We can't distinguish here, so gamepad releases are soft — keyboard keyup still
  // clears the flag independently. Additive OR is safe.

  // ---- Right stick — look ----
  const rx = _deadZone(ax[2] ?? 0);
  const ry = _deadZone(ax[3] ?? 0);
  if (rx !== 0 || ry !== 0) {
    applyLookDelta(
       rx * LOOK_SENSITIVITY * dt,
       ry * LOOK_SENSITIVITY * dt,
    );
  }

  // ---- Face buttons ----
  inputState.jump  = inputState.jump  || _pressed(bt[0]);   // A / Cross
  inputState.duck  = inputState.duck  || _pressed(bt[1]);   // B / Circle

  // ---- RT / R2 — shoot (rising-edge only, no auto-fire) ----
  const rtDown = _pressed(bt[7]);
  if (rtDown && !_rtWasDown) _onShoot?.();
  _rtWasDown = rtDown;

  // ---- Y / Triangle — freecam toggle (rising-edge) ----
  const fcDown = _pressed(bt[3]);
  if (fcDown && !_freeCamWasDown) _onFreeCam?.();
  _freeCamWasDown = fcDown;

  // ---- X / Square or Start — spawn drone (rising-edge) ----
  const spDown = _pressed(bt[2]) || _pressed(bt[9]);
  if (spDown && !_spawnWasDown) _onSpawnDrone?.();
  _spawnWasDown = spDown;
}

/**
 * Release any gamepad-driven digital inputs at the END of each frame.
 * Called after tickPlayer so momentary presses aren't missed,
 * but gamepad state doesn't "stick" if the stick returns to centre.
 */
export function releaseGamepadAxes() {
  const gamepads = navigator.getGamepads?.();
  if (!gamepads) return;

  let gp = null;
  for (const g of gamepads) {
    if (g && g.connected) { gp = g; break; }
  }
  if (!gp) return;

  const ax = gp.axes;
  const lx = _deadZone(ax[0] ?? 0);
  const ly = _deadZone(ax[1] ?? 0);

  // Only clear if the stick is genuinely back to neutral — keyboard may still be holding
  if (ly >= -MOVE_THRESHOLD) inputState.moveForward = inputState.moveForward && false;
  if (ly <=  MOVE_THRESHOLD) inputState.moveBack    = inputState.moveBack    && false;
  if (lx >= -MOVE_THRESHOLD) inputState.moveLeft    = inputState.moveLeft    && false;
  if (lx <=  MOVE_THRESHOLD) inputState.moveRight   = inputState.moveRight   && false;

  // Note: jump and duck are face buttons — they self-clear when the button is released
  // via the !_pressed check above. We handle them differently:
  inputState.jump = inputState.jump && (_pressed(gp.buttons[0]) || _isKeyDown('Space'));
  inputState.duck = inputState.duck && (_pressed(gp.buttons[1]) || _isKeyDown('KeyC'));
}

// ---- Private helpers ----

function _deadZone(v) {
  return Math.abs(v) < DEAD_ZONE ? 0 : v;
}

function _pressed(button) {
  if (!button) return false;
  return typeof button === 'object' ? button.pressed : button > 0.5;
}

// Peek at physical keyboard state without importing from input.js (avoids circular dep)
const _keysDown = new Set();
window.addEventListener('keydown', e => _keysDown.add(e.code));
window.addEventListener('keyup',   e => _keysDown.delete(e.code));
function _isKeyDown(code) { return _keysDown.has(code); }