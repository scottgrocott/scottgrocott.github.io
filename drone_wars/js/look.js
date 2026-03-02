// ============================================================
//  look.js — Shared look/euler state and applyLookDelta helper
//
//  No upstream game deps — safe to import from any module
//  without creating circular dependency chains.
// ============================================================

const PI_2 = Math.PI / 2;

export const pointerLock = {
  locked: false,
  euler:  { x: 0, y: 0, z: 0 },
};

// Camera reference — set once by core.js consumer (input.js calls setLookCamera)
let _camera = null;
export function setLookCamera(cam) { _camera = cam; }

/**
 * Accumulate a look delta into pointerLock.euler and apply it
 * to the camera quaternion.  All drivers call this.
 *
 * @param {number} dx  yaw   delta in radians
 * @param {number} dy  pitch delta in radians
 */
export function applyLookDelta(dx, dy) {
  pointerLock.euler.y += dx;
  pointerLock.euler.x  = Math.max(-PI_2, Math.min(PI_2, pointerLock.euler.x + dy));
  if (!_camera) return;
  BABYLON.Quaternion.RotationYawPitchRollToRef(
    pointerLock.euler.y,
    pointerLock.euler.x,
    0,
    _camera.rotationQuaternion,
  );
}