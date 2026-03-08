// physics.js — Havok physics via BabylonJS HavokPlugin
// Drop-in replacement for the Rapier physics.js.
// The same exports are preserved so callers (player.js, shelters.js,
// basicGun.js, cars.js, drones.js, forklifts.js, spawn.js) need only
// minor adaptations — each file's changes are described in its header.
//
// CDN REQUIREMENT — add to index.html BEFORE the <script type="module"> tag:
//   <script src="https://cdn.babylonjs.com/havok/HavokPhysics.es.js"></script>

import { scene } from './core.js';

export let hkPlugin      = null;   // BABYLON.HavokPlugin instance
export let physicsReady  = false;
export let physicsWorld  = null;   // alias for hkPlugin (kept for compat)
export const physCache   = new Map();

const FIXED_DT = 1 / 60;

// ─── Init ─────────────────────────────────────────────────────────────────────
export async function initPhysics() {
  // window.HK is pre-initialized in index.html via: window.HK = HavokPhysics();
  // We just await that promise here.
  if (!window.HK) {
    throw new Error('[physics] window.HK not found — ensure HavokPhysics_umd.js is loaded and window.HK = HavokPhysics() is called in index.html before the engine module');
  }
  const havok = await window.HK;
  hkPlugin     = new BABYLON.HavokPlugin(true, havok);
  scene.enablePhysics(new BABYLON.Vector3(0, -20, 0), hkPlugin);
  physicsWorld = hkPlugin;
  physicsReady = true;
  console.log('[physics] Havok world ready');
}

export function resetPhysics() {
  if (hkPlugin) {
    try { scene.disablePhysicsEngine(); } catch(e) {}
    hkPlugin     = null;
    physicsWorld = null;
  }
  physicsReady = false;
  physCache.clear();
}

// BabylonJS auto-steps Havok each frame; stepPhysics is a no-op kept for compat.
export function stepPhysics() {}
export function syncPhysicsReads() {}

// ─── Raycasts (wall-avoidance) ────────────────────────────────────────────────
export function queryPhysics(origin, radius) {
  if (!physicsReady) return [];
  const results = [];
  const dirs = [
    { x:  1, y: 0, z:  0 }, { x: -1, y: 0, z:  0 },
    { x:  0, y: 0, z:  1 }, { x:  0, y: 0, z: -1 },
    { x:  0.707, y: 0, z:  0.707 }, { x: -0.707, y: 0, z:  0.707 },
    { x:  0.707, y: 0, z: -0.707 }, { x: -0.707, y: 0, z: -0.707 },
  ];
  const eng = scene.getPhysicsEngine();
  if (!eng) return results;
  for (const d of dirs) {
    const from = new BABYLON.Vector3(origin.x, origin.y, origin.z);
    const to   = new BABYLON.Vector3(
      origin.x + d.x * radius * 3,
      origin.y,
      origin.z + d.z * radius * 3,
    );
    const hit = eng.raycast(from, to);
    if (hit?.hasHit) {
      const dist = BABYLON.Vector3.Distance(from, hit.hitPointWorld);
      results.push({ dir: d, toi: dist / (radius * 3) });
    }
  }
  return results;
}

// ─── NaN guard ────────────────────────────────────────────────────────────────
export function safeVec3(x, y, z, label) {
  const px = +x, py = +y, pz = +z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) {
    console.error(`[physics] NaN at: ${label}`, x, y, z);
    return null;
  }
  return { x: px, y: py, z: pz };
}

// ─── Terrain collider ─────────────────────────────────────────────────────────
let _terrainAggregate = null;

export function addTerrainCollider(_vertexData, _subdiv) {
  if (!physicsReady) return;
  const mesh = scene.getMeshByName('terrain');
  if (!mesh) { console.warn('[physics] addTerrainCollider: no mesh "terrain"'); return; }
  if (_terrainAggregate) { try { _terrainAggregate.dispose(); } catch(e) {} }
  _terrainAggregate = new BABYLON.PhysicsAggregate(
    mesh,
    BABYLON.PhysicsShapeType.MESH,
    { mass: 0, restitution: 0.0, friction: 0.6 },
    scene,
  );
  console.log('[physics] Terrain collider attached (Havok trimesh)');
}

export function addFlatGroundCollider() {
  addTerrainCollider();
}

// ─── Box collider helpers ─────────────────────────────────────────────────────
// Two call signatures are supported:
//   addBoxCollider(mesh, opts)           — attach to an existing mesh
//   addBoxCollider(x, y, z, hw, hh, hd, rotY) — old Rapier-style positional call
//     creates an invisible box mesh internally and tracks it for clearBoxColliders()

const _boxAggregates = [];

export function addBoxCollider(meshOrX, optsOrY, _z, hw, hh, hd, rotY) {
  if (!physicsReady) return null;

  // Positional call: addBoxCollider(x, y, z, hw, hh, hd, rotY)
  if (typeof meshOrX === 'number') {
    const x = meshOrX, y = optsOrY, z = _z;
    if (isNaN(x) || isNaN(y) || isNaN(z) || !hw || !hh || !hd) return null;

    const box = BABYLON.MeshBuilder.CreateBox('_bCollider', {
      width:  hw * 2,
      height: hh * 2,
      depth:  hd * 2,
    }, scene);
    box.position.set(x, y, z);
    if (rotY) box.rotation.y = rotY;
    box.isVisible  = false;
    box.isPickable = false;

    const agg = new BABYLON.PhysicsAggregate(
      box,
      BABYLON.PhysicsShapeType.BOX,
      { mass: 0, restitution: 0.0, friction: 0.6 },
      scene,
    );
    _boxAggregates.push({ agg, mesh: box });
    return agg;
  }

  // Mesh call: addBoxCollider(mesh, opts)
  const mesh = meshOrX, opts = optsOrY ?? {};
  if (!mesh) return null;
  const agg = new BABYLON.PhysicsAggregate(
    mesh,
    BABYLON.PhysicsShapeType.BOX,
    { mass: opts.mass ?? 0, restitution: opts.restitution ?? 0.1, friction: opts.friction ?? 0.6 },
    scene,
  );
  _boxAggregates.push({ agg, mesh: null });
  return agg;
}

export function clearBoxColliders() {
  for (const { agg, mesh } of _boxAggregates) {
    try { agg?.dispose(); } catch(e) {}
    try { if (mesh) mesh.dispose(); } catch(e) {}
  }
  _boxAggregates.length = 0;
}