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

export function addTerrainCollider(imgData, sizeX, sizeZ, heightScale, subdiv = 128) {
  if (!physicsReady || !physicsWorld) return;
  _removeTerrainCollider();

  // Build a trimesh directly from the same pixel data used to stamp visual mesh vertices.
  // This guarantees exact alignment - no coordinate system translation needed.
  const verts = subdiv + 1;
  const vertCount = verts * verts;
  const vertices = new Float32Array(vertCount * 3);
  const indices  = new Uint32Array(subdiv * subdiv * 6);

  // Build vertex grid - same UV formula as getTerrainHeightAt and _stampVertices
  for (let row = 0; row < verts; row++) {
    for (let col = 0; col < verts; col++) {
      const i = row * verts + col;
      const wx = -sizeX / 2 + (col / subdiv) * sizeX;
      const wz = -sizeZ / 2 + (row / subdiv) * sizeZ;
      const u  =        (wx + sizeX / 2) / sizeX;
      const v  = 1.0 - ((wz + sizeZ / 2) / sizeZ);
      const px = Math.max(0, Math.min(imgData.width  - 1, Math.floor(u * (imgData.width  - 1))));
      const py = Math.max(0, Math.min(imgData.height - 1, Math.floor(v * (imgData.height - 1))));
      const h  = (imgData.data[(py * imgData.width + px) * 4] / 255) * heightScale;
      vertices[i * 3 + 0] = wx;
      vertices[i * 3 + 1] = h;
      vertices[i * 3 + 2] = wz;
    }
  }

  // Build index buffer - two triangles per quad cell
  let idx = 0;
  for (let row = 0; row < subdiv; row++) {
    for (let col = 0; col < subdiv; col++) {
      const a = row * verts + col;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      indices[idx++] = a; indices[idx++] = c; indices[idx++] = b;
      indices[idx++] = b; indices[idx++] = c; indices[idx++] = d;
    }
  }

  _terrainBody = physicsWorld.createRigidBody(RAPIER_MODULE.RigidBodyDesc.fixed());
  _terrainCollider = physicsWorld.createCollider(
    RAPIER_MODULE.ColliderDesc.trimesh(vertices, indices),
    _terrainBody
  );
  console.log('[physics] Terrain trimesh collider:', vertCount, 'verts |', indices.length / 3, 'tris');
}

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