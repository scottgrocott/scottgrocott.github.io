// physics.js — Rapier physics world, fixed-step, sync, query
import * as RAPIER_MODULE from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm';

window.RAPIER = RAPIER_MODULE;

export let physicsWorld = null;
export let physicsReady = false;

let _terrainColliderHandle = null;

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

const FIXED_DT     = 1 / 60;
let   _accumulator = 0;

export async function initPhysics() {
  await RAPIER_MODULE.init();
  physicsWorld = new RAPIER_MODULE.World({ x: 0, y: -20, z: 0 });
  physicsReady = true;
  _terrainColliderHandle = null;
  console.log('[physics] Rapier world ready');
}

export function resetPhysics() {
  if (physicsWorld) {
    try { physicsWorld.free(); } catch(e) {}
    physicsWorld = null;
  }
  physicsReady        = false;
  _terrainColliderHandle = null;
  physCache.clear();
  _accumulator = 0;
}

/**
 * Build a Rapier HeightField collider from the terrain pixel data.
 * Call this from main.js after buildTerrain() completes.
 *
 * @param {ImageData} imgData   – the raw pixel data (same as terrainMesh uses)
 * @param {number}    sizeX     – world width
 * @param {number}    sizeZ     – world depth
 * @param {number}    heightScale
 * @param {number}    subdiv    – resolution (lower = faster, 64-128 is fine for physics)
 */
export function addTerrainCollider(imgData, sizeX, sizeZ, heightScale, subdiv = 64) {
  if (!physicsReady || !physicsWorld || !imgData) return;

  // Remove old terrain collider if rebuilding
  if (_terrainColliderHandle !== null) {
    try {
      const old = physicsWorld.getCollider(_terrainColliderHandle);
      if (old) physicsWorld.removeCollider(old, false);
    } catch(e) {}
    _terrainColliderHandle = null;
  }

  const rows = subdiv + 1;
  const cols = subdiv + 1;
  const iw   = imgData.width;
  const ih   = imgData.height;

  // Sample heights — same V-flip as terrainMesh._stampHeights
  const heights = new Float32Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u    = col / subdiv;
      const v    = 1.0 - (row / subdiv);
      const px   = Math.min(Math.floor(u * iw), iw - 1);
      const py   = Math.min(Math.floor(v * ih), ih - 1);
      const grey = imgData.data[(py * iw + px) * 4] / 255;
      heights[row * cols + col] = grey * heightScale;
    }
  }

  // Rapier HeightField: nrows, ncols, heights, scale
  const scale = { x: sizeX / subdiv, y: 1.0, z: sizeZ / subdiv };
  const cdesc = RAPIER_MODULE.ColliderDesc.heightfield(
    subdiv, subdiv, heights, scale
  );

  // Centre at world origin (HeightField origin is its corner by default)
  cdesc.setTranslation(-sizeX / 2, 0, -sizeZ / 2);

  const collider = physicsWorld.createCollider(cdesc);
  _terrainColliderHandle = collider.handle;
  console.log('[physics] Terrain heightfield collider added', rows, 'x', cols);
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
    ray.origin = origin; ray.dir = d;
    const hit = physicsWorld.castRay(ray, radius * 3, true);
    if (hit) results.push({ dir: d, toi: hit.timeOfImpact });
  }
  return results;
}

export function safeVec3(x, y, z, label) {
  const px = +x, py = +y, pz = +z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) {
    console.error(`[physics] NaN at: ${label}`, x, y, z);
    return null;
  }
  return { x: px, y: py, z: pz };
}