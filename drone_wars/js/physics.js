// ============================================================
//  physics.js — Rapier physics world management
// ============================================================

import { scene } from './core.js';

export let physicsWorld      = null;
export let physicsReady      = false;
let        physicsAccumulator = 0;
const      PHYSICS_DT         = 1 / 60;

// Use a Set for O(1) raycast predicate lookups (was Array.includes = O(n))
const _raycastSet = new Set();
export const raycastMeshes = new Proxy(_raycastSet, {
  get(target, prop) {
    if (prop === 'push')     return m => target.add(m);
    if (prop === 'includes') return m => target.has(m);
    if (prop === 'length')   return target.size;
    if (prop === Symbol.iterator) return () => target[Symbol.iterator]();
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  },
});

export const physCache = {
  playerPos:  { x: 0, y: 0, z: 0 },
  playerVel:  { x: 0, y: 0, z: 0 },
  deadDrones: {},
};

export let rayQueryResults = {};

// ---- Wall-avoidance ray directions (pre-allocated, never recreated) ----
const WALL_SENSE_DIST = 5.0;
const WALL_AVOID_DIRS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return new BABYLON.Vector3(Math.cos(a), 0, Math.sin(a)).normalize();
});

// Pre-allocated Ray objects — one per wall-sense direction, reused every frame
const _wallRays = WALL_AVOID_DIRS.map(
  dir => new BABYLON.Ray(BABYLON.Vector3.Zero(), dir, WALL_SENSE_DIST)
);

// Pre-allocated downward ray for terrain ground sensing (one, reused per drone)
const GROUND_SENSE_DIST = 35;
const _groundRayDir = new BABYLON.Vector3(0, -1, 0);
const _groundRay    = new BABYLON.Ray(BABYLON.Vector3.Zero(), _groundRayDir, GROUND_SENSE_DIST);

// One reusable Ray for detonator checks
const _detRay     = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 0.5);
// Scratch vectors to avoid per-frame allocations in queryPhysics
const _fwdScratch = new BABYLON.Vector3();

// Predicate function reference — stable, not recreated each call
const _rayPredicate = m => _raycastSet.has(m);

// ---- Public API ----

export async function initPhysics() {
  while (!window.RAPIER) await sleep(100);
  await window.RAPIER.init();

  const R = window.RAPIER;
  physicsWorld = new R.World({ x: 0, y: -20.81, z: 0 });

  const groundBody = physicsWorld.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
  );
  physicsWorld.createCollider(R.ColliderDesc.cuboid(5000, 0.5, 5000), groundBody);
  physicsReady = true;
}

export function stepPhysics(dt) {
  if (!physicsReady) return;
  physicsAccumulator += Math.min(dt, 0.1);
  while (physicsAccumulator >= PHYSICS_DT) {
    physicsWorld.step();
    physicsAccumulator -= PHYSICS_DT;
  }
}

export function syncPhysicsReads(player, drones) {
  if (!physicsReady) return;

  try {
    if (player.rigidBody) {
      const p = player.rigidBody.translation();
      const v = player.rigidBody.linvel();
      physCache.playerPos.x = p.x; physCache.playerPos.y = p.y; physCache.playerPos.z = p.z;
      physCache.playerVel.x = v.x; physCache.playerVel.y = v.y; physCache.playerVel.z = v.z;
    }
  } catch (_) {}

  const dd = physCache.deadDrones;
  for (const k in dd) delete dd[k];

  for (const d of drones) {
    if (!d.dead || !d.body) continue;
    try {
      const p = d.body.translation();
      const r = d.body.rotation();
      dd[d.id] = {
        pos: { x: p.x, y: p.y, z: p.z },
        rot: { x: r.x, y: r.y, z: r.z, w: r.w },
      };
    } catch (_) {}
  }
}

export function queryPhysics(player, drones) {
  const rqr = rayQueryResults;
  for (const k in rqr) delete rqr[k];

  player.isGrounded = physCache.playerPos.y <= 1.6 + 0.25;
  if (!_raycastSet.size) return;

  for (const drone of drones) {
    if (drone.dead) continue;

    const pos    = drone.group.position;
    const result = { wallPush: { x: 0, z: 0 }, wallHitCount: 0, detonatorHit: false, groundY: null };

    // ---- Horizontal wall avoidance ----
    for (let i = 0; i < _wallRays.length; i++) {
      _wallRays[i].origin.copyFrom(pos);
      const hit = scene.pickWithRay(_wallRays[i], _rayPredicate);
      if (hit?.hit) {
        const strength = (1 - hit.distance / WALL_SENSE_DIST) * 6;
        result.wallPush.x -= WALL_AVOID_DIRS[i].x * strength;
        result.wallPush.z -= WALL_AVOID_DIRS[i].z * strength;
        result.wallHitCount++;
      }
    }

    // ---- Downward ground ray — terrain height below drone ----
    _groundRay.origin.copyFrom(pos);
    const groundHit = scene.pickWithRay(_groundRay, _rayPredicate);
    if (groundHit?.hit) {
      result.groundY = groundHit.pickedPoint.y;
    }

    // ---- Detonator forward ray ----
    if (drone.detonatorArmed) {
      const detWorld = drone.detonatorMesh.getAbsolutePosition();
      _fwdScratch.set(0, 0, 1);
      _fwdScratch.rotateByQuaternionToRef(drone.group.rotationQuaternion, _fwdScratch);
      _fwdScratch.normalizeToRef(_fwdScratch);
      _detRay.origin.copyFrom(detWorld);
      _detRay.direction.copyFrom(_fwdScratch);
      const hit = scene.pickWithRay(_detRay, _rayPredicate);
      if (hit?.hit) result.detonatorHit = true;
    }

    rqr[drone.id] = result;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }