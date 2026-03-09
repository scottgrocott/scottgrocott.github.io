// look.js — single source of truth for look direction

export const pointerLock = { locked: false };

export const euler = { x: 0, y: 0, z: 0 }; // pitch, yaw, roll

let _camera = null;

export function setLookCamera(cam) {
  _camera = cam;
  // Detach BabylonJS built-in camera inputs — they override rotationQuaternion every frame.
  // We drive rotation manually via applyLookDelta.
  try { cam.inputs?.clear(); } catch(e) {}
}

const _quat = new BABYLON.Quaternion();

export function applyLookDelta(dx, dy) {
  euler.y += dx;             // yaw
  euler.x += dy;             // pitch
  // Clamp pitch
  const HALF_PI = Math.PI / 2 - 0.01;
  if (euler.x >  HALF_PI) euler.x =  HALF_PI;
  if (euler.x < -HALF_PI) euler.x = -HALF_PI;

  if (_camera) {
    BABYLON.Quaternion.RotationYawPitchRollToRef(euler.y, euler.x, 0, _quat);
    _camera.rotationQuaternion = _quat.clone();
  }
}

export function setLookEuler(yaw, pitch) {
  euler.y = yaw;
  euler.x = pitch;
  if (_camera) {
    BABYLON.Quaternion.RotationYawPitchRollToRef(euler.y, euler.x, 0, _quat);
    _camera.rotationQuaternion = _quat.clone();
  }
}