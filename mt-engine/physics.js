// physics.js — Rapier physics world, fixed-step, sync, query
import * as RAPIER_MODULE from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm';

window.RAPIER = RAPIER_MODULE;

export let physicsWorld   = null;
export let physicsReady   = false;

const _raycastMeshSet = new Set();
export const raycastMeshes = {
  add(m)      { _raycastMeshSet.add(m); },
  push(m)     { _raycastMeshSet.add(m); },
  delete(m)   { _raycastMeshSet.delete(m); },
  includes(m) { return _raycastMeshSet.has(m); },
  has(m)      { return _raycastMeshSet.has(m); },
  forEach(fn) { _raycastMeshSet.forEach(fn); },
  get size()  { return _raycastMeshSet.size; },
  [Symbol.iterator]() { return _raycastMeshSet[Symbol.iterator](); },
};

export const physCache = new Map();
export const rayQueryResults = [];

const FIXED_DT   = 1 / 60;
let   _accumulator = 0;

// ---- Terrain body tracking ----
let _terrainBody     = null;
let _terrainCollider = null;
const _boxBodies = [];  // tracked so clearBoxColliders() can remove them all

export async function initPhysics() {
  await RAPIER_MODULE.init();
  physicsWorld = new RAPIER_MODULE.World({ x: 0.0, y: -20.0, z: 0.0 });
  physicsReady = true;
  window._physicsWorld = physicsWorld;
  console.log('[physics] Rapier world ready');
}

export function resetPhysics() {
  if (physicsWorld) {
    try { physicsWorld.free(); } catch(e) {}
    physicsWorld = null;
  }
  physicsReady     = false;
  _terrainBody     = null;
  _terrainCollider = null;
  _boxBodies.length = 0;
  physCache.clear();
  _accumulator = 0;
}

function _removeTerrainCollider() {
  if (_terrainBody && physicsWorld) {
    try { physicsWorld.removeRigidBody(_terrainBody); } catch(e) {}
  }
  _terrainBody     = null;
  _terrainCollider = null;
}

export function addTerrainCollider(positions, subdiv) {
  // positions: Float32Array [x,y,z, x,y,z ...] taken directly from the visual mesh.
  // This guarantees physics and visual terrain are pixel-perfect identical.
  if (!physicsReady || !physicsWorld) return;
  _removeTerrainCollider();

  const verts = subdiv + 1;  // vertices per side
  const vertCount = verts * verts;

  // Build trimesh indices — two triangles per quad
  const indices = new Uint32Array(subdiv * subdiv * 6);
  let ii = 0;
  for (let row = 0; row < subdiv; row++) {
    for (let col = 0; col < subdiv; col++) {
      const a = row * verts + col;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
      indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
    }
  }

  _terrainBody = physicsWorld.createRigidBody(RAPIER_MODULE.RigidBodyDesc.fixed());
  const tdesc = RAPIER_MODULE.ColliderDesc.trimesh(new Float32Array(positions), indices);
  _terrainCollider = physicsWorld.createCollider(tdesc, _terrainBody);
  console.log('[physics] Terrain trimesh from mesh verts:', vertCount, 'verts |', indices.length/3, 'tris');
}

// Add a static box collider at world position (wx, wy, wz) with half-extents (hw, hh, hd)
// rotY is Y-axis rotation in radians
export function addBoxCollider(wx, wy, wz, hw, hh, hd, rotY = 0) {
  if (!physicsReady || !physicsWorld) return null;
  const body = physicsWorld.createRigidBody(RAPIER_MODULE.RigidBodyDesc.fixed());
  const desc = RAPIER_MODULE.ColliderDesc.cuboid(hw, hh, hd)
    .setTranslation(wx, wy, wz)
    .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
  const col = physicsWorld.createCollider(desc, body);
  _boxBodies.push(body);
  console.log(`[physics] addBoxCollider total=${_boxBodies.length} at (${wx.toFixed(1)},${wy.toFixed(1)},${wz.toFixed(1)})`);
  console.trace('[physics] addBoxCollider caller');
  return col;
}

export function clearBoxColliders() {
  console.log(`[physics] clearBoxColliders — removing ${_boxBodies.length} bodies`);
  if (!physicsWorld) { _boxBodies.length = 0; return; }
  for (const body of _boxBodies) {
    try { physicsWorld.removeRigidBody(body); } catch(e) { console.warn('[physics] removeRigidBody failed', e); }
  }
  _boxBodies.length = 0;
}
// Also expose globally so shelters.js / any non-importing module can call it
window._clearBoxColliders = clearBoxColliders;

export function addFlatGroundCollider(sizeX = 512, sizeZ = 512) {
  if (!physicsReady || !physicsWorld) return;
  _removeTerrainCollider();

  _terrainBody = physicsWorld.createRigidBody(RAPIER_MODULE.RigidBodyDesc.fixed());
  _terrainCollider = physicsWorld.createCollider(
    RAPIER_MODULE.ColliderDesc.cuboid(sizeX / 2, 0.5, sizeZ / 2).setTranslation(0, -0.5, 0),
    _terrainBody
  );
  console.log('[physics] Flat ground collider added', sizeX, 'x', sizeZ);
}

export function stepPhysics(dt) {
  if (!physicsReady || !physicsWorld) return;
  _accumulator += dt;
  while (_accumulator >= FIXED_DT) {
    physicsWorld.step();
    _accumulator -= FIXED_DT;
  }
}

export function syncPhysicsReads() {
  if (!physicsReady || !physicsWorld) return;
  physicsWorld.bodies.forEach(body => {
    const t = body.translation();
    physCache.set(body.handle, { x: t.x, y: t.y, z: t.z });
  });
}

export function queryPhysics(origin, radius) {
  if (!physicsReady) return [];
  const results = [];
  const dirs = [
    {x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1},
    {x:0.707,y:0,z:0.707},{x:-0.707,y:0,z:0.707},
    {x:0.707,y:0,z:-0.707},{x:-0.707,y:0,z:-0.707},
  ];
  const ray = new RAPIER_MODULE.Ray(origin, {x:1,y:0,z:0});
  for (const d of dirs) {
    ray.origin = origin;
    ray.dir    = d;
    const hit = physicsWorld.castRay(ray, radius * 3, true);
    if (hit) results.push({ dir: d, toi: hit.timeOfImpact });
  }
  return results;
}

export function safeVec3(x, y, z, label) {
  const px = +x, py = +y, pz = +z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) {
    console.error('[physics] NaN at:', label, x, y, z);
    return null;
  }
  return { x: px, y: py, z: pz };
}