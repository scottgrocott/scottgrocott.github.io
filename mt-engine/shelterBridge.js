// shelterBridge.js — panel mesh registry + hit dispatch
// Sits between basicGun.js and shelters.js to break the circular import.
// basicGun imports: panelMeshes, onShelterHit
// shelters imports: registerPanelMesh, unregisterPanelMesh, clearPanelMeshes

// ── Registry ──────────────────────────────────────────────────────────────────
export const panelMeshes = new Set();
export function registerPanelMesh(mesh)   { panelMeshes.add(mesh); }
export function unregisterPanelMesh(mesh) { panelMeshes.delete(mesh); }
export function clearPanelMeshes()        { panelMeshes.clear(); }

// ── Hit dispatch ──────────────────────────────────────────────────────────────
// shelters.js sets this callback on init so basicGun never imports shelters directly.
let _onHitFn = null;
export function setShelterHitCallback(fn) { _onHitFn = fn; }
export function onShelterHit(mesh, pos, dir) {
  if (_onHitFn) _onHitFn(mesh, pos, dir);
}