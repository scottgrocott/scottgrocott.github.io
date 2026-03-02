// ============================================================
//  input.js — Pointer-lock FPS mouse + keyboard state
// ============================================================

import { scene } from './core.js';
import { camera } from './core.js';

const canvas = document.getElementById('renderCanvas');

export const pointerLock = {
  locked: false,
  euler: { x: 0, y: 0, z: 0 },
  PI_2: Math.PI / 2,
};

document.addEventListener('pointerlockchange', () => {
  pointerLock.locked = document.pointerLockElement === canvas;
});

scene.onPointerObservable.add((pi) => {
  if (pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
    if (pi.event.button !== 0) return;
    if (!pointerLock.locked) {
      canvas.requestPointerLock();
    } else {
      // Delegate to shootBullet — imported lazily via callback to avoid circular deps
      onShoot?.();
    }
  } else if (pi.type === BABYLON.PointerEventTypes.POINTERMOVE) {
    if (!pointerLock.locked) return;
    const e    = pi.event;
    const sens = 0.002;

    pointerLock.euler.y -= (e.movementX || 0) * sens;
    pointerLock.euler.x -= (e.movementY || 0) * sens;
    pointerLock.euler.x  = Math.max(-pointerLock.PI_2, Math.min(pointerLock.PI_2, pointerLock.euler.x));

    BABYLON.Quaternion.RotationYawPitchRollToRef(
      pointerLock.euler.y,
      pointerLock.euler.x,
      0,
      camera.rotationQuaternion,
    );
  }
});

// Shoot callback — registered externally to avoid circular deps
let onShoot = null;
export function registerShootCallback(fn) { onShoot = fn; }

// ---- Keyboard state ----
export const keys = {
  w: false, s: false, a: false, d: false,
  space: false, duck: false,
};

// Callbacks for one-shot actions (F, 0)
let onToggleFreeCam = null;
let onSpawnDrone    = null;
export function registerFreeCamCallback(fn)  { onToggleFreeCam = fn; }
export function registerSpawnDroneCallback(fn) { onSpawnDrone = fn; }

window.addEventListener('keydown', e => {
  switch (e.code) {
    case 'KeyW':    case 'ArrowUp':    keys.w     = true;  break;
    case 'KeyS':    case 'ArrowDown':  keys.s     = true;  break;
    case 'KeyA':    case 'ArrowLeft':  keys.a     = true;  break;
    case 'KeyD':    case 'ArrowRight': keys.d     = true;  break;
    case 'Space':   keys.space = true;  e.preventDefault(); break;
    case 'KeyC':    keys.duck  = true;  break;
    case 'KeyF':    onToggleFreeCam?.(); break;
    case 'Digit0':
    case 'Numpad0': onSpawnDrone?.();   break;
  }
});

window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'KeyW':    case 'ArrowUp':    keys.w     = false; break;
    case 'KeyS':    case 'ArrowDown':  keys.s     = false; break;
    case 'KeyA':    case 'ArrowLeft':  keys.a     = false; break;
    case 'KeyD':    case 'ArrowRight': keys.d     = false; break;
    case 'Space':   keys.space = false; break;
    case 'KeyC':    keys.duck  = false; break;
  }
});
