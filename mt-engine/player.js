// player.js — player capsule body, walk tick, freecam tick
// Physics: Havok via PhysicsAggregate (dynamic capsule).
// No PhysicsCharacterController — not available in BabylonJS 8.
// Ground check: short downward raycast each frame.

import { scene, camera } from './core.js';
import { CONFIG, PLAYER } from './config.js';
import { keys } from './input.js';
import { euler } from './look.js';
import { physicsReady, safeVec3 } from './physics.js';

export const player = {
  aggregate:    null,   // BABYLON.PhysicsAggregate
  _capsuleMesh: null,   // invisible mesh the aggregate lives on
  health:       100,
  freeCam:      false,
  grounded:     false,
  _wasGrounded: false,
  // compat alias so any caller using player.rigidBody still works
  get rigidBody() { return this.aggregate?.body ?? null; },
};

export let playerRig = null;

const _fwd3   = new BABYLON.Vector3();
const _right3 = new BABYLON.Vector3();
const _down   = new BABYLON.Vector3(0, -1, 0);

// Ground cast length: just past the bottom of the capsule
const GROUND_CAST_LEN = PLAYER.height / 2 + PLAYER.radius + 0.25;

export function initPlayer() {
  if (!physicsReady) return;

  const h = PLAYER.height, r = PLAYER.radius;

  // Invisible capsule mesh — PhysicsAggregate attaches to this
  player._capsuleMesh = BABYLON.MeshBuilder.CreateCapsule('playerCapsule', {
    radius:          r,
    height:          h + r * 2,
    tessellation:    8,
    capSubdivisions: 2,
  }, scene);
  player._capsuleMesh.isVisible  = false;
  player._capsuleMesh.isPickable = false;
  player._capsuleMesh.position.set(0, h / 2 + r, 0);

  // Dynamic Havok capsule
  player.aggregate = new BABYLON.PhysicsAggregate(
    player._capsuleMesh,
    BABYLON.PhysicsShapeType.CAPSULE,
    { mass: PLAYER.mass, restitution: 0.0, friction: 0.5 },
    scene,
  );

  // Lock rotation so the capsule stays upright
  player.aggregate.body.setMassProperties({
    mass:            PLAYER.mass,
    inertia:         new BABYLON.Vector3(0, 0, 0),   // no rotation
    inertiaOrientation: BABYLON.Quaternion.Identity(),
  });
  player.aggregate.body.setAngularVelocity(BABYLON.Vector3.Zero());

  // High linear damping prevents sliding
  player.aggregate.body.setLinearDamping(4.0);
  player.aggregate.body.setAngularDamping(100.0);

  // Player rig (TransformNode) — camera parents here
  playerRig = new BABYLON.TransformNode('playerRig', scene);
  playerRig.position.copyFrom(player._capsuleMesh.position);
  camera.parent   = playerRig;
  camera.position.set(0, 0.7, 0);

  player.health   = 100;
  player.freeCam  = false;
  player.grounded = false;
}

export function initPlayerBody() {}   // compat stub

export function toggleFreeCam() {
  player.freeCam = !player.freeCam;
  if (player.aggregate?.body) {
    player.aggregate.body.setMotionType(
      player.freeCam
        ? BABYLON.PhysicsMotionType.STATIC
        : BABYLON.PhysicsMotionType.DYNAMIC,
    );
  }
  return player.freeCam;
}

export function tickPlayer(dt) {
  if (!physicsReady || !playerRig) return;
  player.freeCam ? _tickFreeCam(dt) : _tickWalk(dt);
}

function _tickWalk(dt) {
  const body = player.aggregate?.body;
  if (!body) return;

  const cp = player._capsuleMesh.position;
  if (isNaN(cp.x)) return;
  playerRig.position.copyFrom(cp);

  // ── Hard boundary clamp — keep player inside terrain ─────────────────────
  const _bound = (window._CONFIG_terrainHalf ?? 340);  // set by main.js after load
  let _clamped = false;
  if (cp.x >  _bound) { cp.x =  _bound; _clamped = true; }
  if (cp.x < -_bound) { cp.x = -_bound; _clamped = true; }
  if (cp.z >  _bound) { cp.z =  _bound; _clamped = true; }
  if (cp.z < -_bound) { cp.z = -_bound; _clamped = true; }
  if (_clamped) {
    player.aggregate.body.setLinearVelocity(BABYLON.Vector3.Zero());
    playerRig.position.copyFrom(cp);
  }

  // ── Ground check (downward raycast) ──────────────────────────────────────
  const eng = scene.getPhysicsEngine();
  if (eng) {
    const from = cp.clone();
    const to   = new BABYLON.Vector3(cp.x, cp.y - GROUND_CAST_LEN, cp.z);
    const hit  = eng.raycast(from, to);
    player.grounded = !!(hit?.hasHit);
  }

  // ── Movement direction ────────────────────────────────────────────────────
  const yaw  = euler.y;
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);

  let mx = 0, mz = 0;
  if (keys.moveForward) { mx += sinY; mz += cosY; }
  if (keys.moveBack)    { mx -= sinY; mz -= cosY; }
  if (keys.moveLeft)    { mx -= cosY; mz += sinY; }
  if (keys.moveRight)   { mx += cosY; mz -= sinY; }

  const speed = keys.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const len   = Math.sqrt(mx * mx + mz * mz);
  if (len > 0) { mx = (mx / len) * speed; mz = (mz / len) * speed; }

  // Preserve current vertical velocity (gravity)
  const vel = body.getLinearVelocity();
  body.setLinearVelocity(new BABYLON.Vector3(mx, vel.y, mz));

  // ── Jump ──────────────────────────────────────────────────────────────────
  if (keys.jump && player.grounded) {
    const jumpVel = Math.sqrt(2 * 20 * (PLAYER.jumpImpulse ?? 1.5));
    body.setLinearVelocity(new BABYLON.Vector3(mx, jumpVel, mz));
  }

  // ── Duck camera ───────────────────────────────────────────────────────────
  const targetEye = keys.duck ? 0.2 : 0.7;
  camera.position.y += (targetEye - camera.position.y) * 0.15;
}

function _tickFreeCam(dt) {
  if (!playerRig) return;
  const speed = PLAYER.freeFlyCamSpeed;
  const yaw   = euler.y, pitch = euler.x;
  const sinY  = Math.sin(yaw),  cosY  = Math.cos(yaw);
  const sinP  = Math.sin(pitch), cosP = Math.cos(pitch);

  _fwd3.set(sinY * cosP, -sinP, cosY * cosP);
  _right3.set(cosY, 0, -sinY);

  let vx = 0, vy = 0, vz = 0;
  if (keys.moveForward) { vx += _fwd3.x;   vy += _fwd3.y;   vz += _fwd3.z;   }
  if (keys.moveBack)    { vx -= _fwd3.x;   vy -= _fwd3.y;   vz -= _fwd3.z;   }
  if (keys.moveLeft)    { vx -= _right3.x; vz -= _right3.z; }
  if (keys.moveRight)   { vx += _right3.x; vz += _right3.z; }
  if (keys.jump)  vy += 1;
  if (keys.duck)  vy -= 1;

  const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (len > 0) {
    const s = speed * dt / len;
    playerRig.position.x += vx * s;
    playerRig.position.y += vy * s;
    playerRig.position.z += vz * s;
    // Keep capsule in sync so re-entry position is correct
    if (player._capsuleMesh) player._capsuleMesh.position.copyFrom(playerRig.position);
  }
  camera.position.y = 0.7;
}