// shelterBridge.js — panel registry + hit physics
// No imports from basicGun or shelters — breaks any circular dependency.
// scatter.js  → registerPanelMesh(mesh)
// basicGun.js → onShelterHit(mesh, pos, dir)  /  panelMeshes

import { scene } from './core.js';

// ── Registry ──────────────────────────────────────────────────────────────────
export const panelMeshes = new Set();

export function registerPanelMesh(mesh) {
  mesh._panelFlying = false;   // state stored on mesh, no external map needed
  panelMeshes.add(mesh);
}

export function unregisterPanelMesh(mesh) { panelMeshes.delete(mesh); }
export function clearPanelMeshes()        { panelMeshes.clear(); }

// ── Hit handler ───────────────────────────────────────────────────────────────
export function onShelterHit(mesh, hitPos, hitDir) {
  if (!mesh || mesh.isDisposed() || mesh._panelFlying) return;
  mesh._panelFlying = true;
  unregisterPanelMesh(mesh);   // can't be hit again

  // Detach from parent so physics can move it freely in world space
  const worldPos = mesh.getAbsolutePosition().clone();
  const worldRot = mesh.absoluteRotationQuaternion?.clone();
  mesh.setParent(null);
  mesh.position.copyFrom(worldPos);
  if (worldRot) mesh.rotationQuaternion = worldRot;

  try {
    const agg = new BABYLON.PhysicsAggregate(
      mesh, BABYLON.PhysicsShapeType.BOX,
      { mass: 0.8, restitution: 0.3, friction: 0.5 }, scene,
    );
    const body = agg.body;
    if (body) {
      const fwd = hitDir || new BABYLON.Vector3(0, 1, 0);
      body.applyImpulse(new BABYLON.Vector3(
        fwd.x * 20 + (Math.random() - 0.5) * 8,
        14  + Math.random() * 10,
        fwd.z * 20 + (Math.random() - 0.5) * 8,
      ), worldPos);
      body.applyAngularImpulse(new BABYLON.Vector3(
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 25,
      ));
    }
  } catch(e) { console.warn('[shelterBridge] panel physics failed', e); }
}