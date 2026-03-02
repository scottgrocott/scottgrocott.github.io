// ============================================================
//  physics.js — Rapier physics world management
// ============================================================

import { scene } from './core.js';

export let physicsWorld     = null;
export let physicsReady     = false;
let       physicsAccumulator = 0;
const     PHYSICS_DT         = 1 / 60;

export const raycastMeshes = [];

// Per-frame cache written by syncPhysicsReads(), consumed by game systems
export const physCache = {
  playerPos:  { x: 0, y: 0, z: 0 },
  playerVel:  { x: 0, y: 0, z: 0 },
  deadDrones: {},
};

// Per-frame ray-query results written by queryPhysics(), keyed by drone.id
export let rayQueryResults = {};

// ---- Wall-avoidance ray directions (8 cardinal/diagonal) ----
const WALL_SENSE_DIST = 5.0;
const WALL_AVOID_DIRS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return new BABYLON.Vector3(Math.cos(a), 0, Math.sin(a)).normalize();
});

// ---- Public API ----

export async function initPhysics() {
  while (!window.RAPIER) await sleep(100);
  await window.RAPIER.init();

  const R = window.RAPIER;
  physicsWorld = new R.World({ x: 0, y: -9.81, z: 0 });

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

/**
 * syncPhysicsReads — snapshot Rapier state into physCache once per frame
 * so that render-thread code never stalls on repeated Rapier calls.
 * @param {object} player
 * @param {Array}  drones
 */
export function syncPhysicsReads(player, drones) {
  if (!physicsReady) return;

  try {
    if (player.rigidBody) {
      const p = player.rigidBody.translation();
      const v = player.rigidBody.linvel();
      physCache.playerPos.x = p.x; physCache.playerPos.y = p.y; physCache.playerPos.z = p.z;
      physCache.playerVel.x = v.x; physCache.playerVel.y = v.y; physCache.playerVel.z = v.z;
    }
  } catch (_) { /* Rapier may throw if body is removed mid-frame */ }

  physCache.deadDrones = {};
  for (const d of drones) {
    if (!d.dead || !d.body) continue;
    try {
      const p = d.body.translation();
      const r = d.body.rotation();
      physCache.deadDrones[d.id] = {
        pos: { x: p.x, y: p.y, z: p.z },
        rot: { x: r.x, y: r.y, z: r.z, w: r.w },
      };
    } catch (_) {}
  }
}

/**
 * queryPhysics — run scene ray-casts for wall avoidance & detonator checks.
 * Results stored in rayQueryResults, keyed by drone.id.
 * @param {object} player
 * @param {Array}  drones
 */
export function queryPhysics(player, drones) {
  rayQueryResults = {};
  player.isGrounded = physCache.playerPos.y <= 1.6 + 0.25; // PLAYER.height + margin

  if (!raycastMeshes.length) return;

  for (const drone of drones) {
    if (drone.dead) continue;

    const pos    = drone.group.position;
    const result = { wallPush: { x: 0, z: 0 }, detonatorHit: false };

    for (const dir of WALL_AVOID_DIRS) {
      const ray = new BABYLON.Ray(pos, dir, WALL_SENSE_DIST);
      const hit = scene.pickWithRay(ray, m => raycastMeshes.includes(m));
      if (hit?.hit) {
        const strength = (1 - hit.distance / WALL_SENSE_DIST) * 6;
        result.wallPush.x -= dir.x * strength;
        result.wallPush.z -= dir.z * strength;
      }
    }

    if (drone.detonatorArmed) {
      const detWorld = drone.detonatorMesh.getAbsolutePosition();
      const fwd      = new BABYLON.Vector3(0, 0, 1);
      fwd.rotateByQuaternionToRef(drone.group.rotationQuaternion, fwd);
      const ray = new BABYLON.Ray(detWorld, fwd.normalize(), 0.5);
      const hit = scene.pickWithRay(ray, m => raycastMeshes.includes(m));
      if (hit?.hit) result.detonatorHit = true;
    }

    rayQueryResults[drone.id] = result;
  }
}

// ---- Helpers ----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
