// shelterBridge.js — panel registry + hit physics
// No imports from basicGun or shelters — breaks any circular dependency.
// scatter.js  → registerPanelMesh(mesh)
// basicGun.js → onShelterHit(mesh, pos, dir)  /  panelMeshes

import { scene } from './core.js';

// ── Registry ──────────────────────────────────────────────────────────────────
export const panelMeshes  = new Set();  // static panels (not yet hit)
export const flyingPanels = new Set();  // dynamic panels (already launched, still hittable)

export function registerPanelMesh(mesh) {
  mesh._panelFlying = false;
  panelMeshes.add(mesh);
}

export function unregisterPanelMesh(mesh) { panelMeshes.delete(mesh); }
export function clearPanelMeshes()        { panelMeshes.clear(); flyingPanels.clear(); }

// ── Hit handler ───────────────────────────────────────────────────────────────
// Called when a flying panel is shot again — give it another kick
export function onFlyingPanelHit(mesh, hitDir) {
  if (!mesh || mesh.isDisposed()) return;
  flyingPanels.delete(mesh);  // brief remove to avoid double-hit same frame
  setTimeout(() => { if (!mesh.isDisposed()) flyingPanels.add(mesh); }, 80);
  try {
    const body = mesh.physicsImpostor?.physicsBody ?? mesh._physicsAggregate?.body ?? null;
    // Havok: body is on the aggregate stored at mesh._physicsAggregate
    const agg = mesh._physicsAggregate;
    if (agg?.body) {
      const fwd = hitDir || new BABYLON.Vector3(0, 1, 0);
      const pos = mesh.getAbsolutePosition();
      agg.body.applyImpulse(new BABYLON.Vector3(
        fwd.x * 14 + (Math.random() - 0.5) * 5,
        8  + Math.random() * 6,
        fwd.z * 14 + (Math.random() - 0.5) * 5,
      ), pos);
      agg.body.applyAngularImpulse(new BABYLON.Vector3(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
      ));
    }
  } catch(e) {}
}

export function onShelterHit(mesh, hitPos, hitDir) {
  if (!mesh || mesh.isDisposed() || mesh._panelFlying) return;
  mesh._panelFlying = true;
  unregisterPanelMesh(mesh);
  flyingPanels.add(mesh);  // still hittable while flying

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
    mesh._physicsAggregate = agg;  // store ref so onFlyingPanelHit can kick it
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