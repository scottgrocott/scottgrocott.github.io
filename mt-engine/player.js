// player.js — player capsule body, walk tick, freecam tick

import { scene, camera } from './core.js';
import { CONFIG, PLAYER } from './config.js';
import { keys } from './input.js';
import { euler } from './look.js';
import { physicsWorld, physicsReady, safeVec3 } from './physics.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';

export const player = {
  rigidBody:  null,
  health:     100,
  freeCam:    false,
  grounded:   false,
  _wasGrounded: false,
};

export let playerRig = null;

const _fwd3   = new BABYLON.Vector3();
const _right3 = new BABYLON.Vector3();

// Step 1: create TransformNode + camera only. No physics body.
// Call BEFORE dropOnStart so playerRig exists for terrain sampling.
export function initPlayer() {
  if (playerRig) {
    camera.parent = null;
    try { playerRig.dispose(); } catch(e) {}
    playerRig = null;
  }
  if (player.rigidBody && physicsWorld) {
    try { physicsWorld.removeRigidBody(player.rigidBody); } catch(e) {}
    player.rigidBody = null;
  }
  playerRig = new BABYLON.TransformNode('playerRig', scene);
  playerRig.position.set(0, 0, 0);
  camera.parent = playerRig;
  camera.position.set(0, 0.7, 0);
  player.health   = 100;
  player.freeCam  = false;
  player.grounded = false;
  window._player    = player;
  window._playerRig = playerRig;
}

// Step 2: create Rapier body at exact spawn position.
// Called by spawn.js after terrain height is known. Never spawns at y=3.
export function initPlayerBody(x, y, z) {
  if (!physicsReady || !physicsWorld) return;
  if (player.rigidBody) {
    try { physicsWorld.removeRigidBody(player.rigidBody); } catch(e) {}
    player.rigidBody = null;
  }
  const rdesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(4.0)
    .setAngularDamping(100.0);
  player.rigidBody = physicsWorld.createRigidBody(rdesc);
  player.rigidBody.enableCcd(true);
  player.rigidBody.lockRotations(true);
  const cdesc = RAPIER.ColliderDesc.capsule(PLAYER.height / 2, PLAYER.radius)
    .setMass(PLAYER.mass)
    .setFriction(0.1)
    .setRestitution(0.0);
  if (typeof cdesc.setContactSkin === 'function') cdesc.setContactSkin(0.08);
  physicsWorld.createCollider(cdesc, player.rigidBody);
  if (playerRig) playerRig.position.set(x, y, z);
  window._resnapPlayerToTerrain = function() {
    if (!playerRig) return;
    const cx = +playerRig.position.x;
    const cz = +playerRig.position.z;
    const landY = getTerrainHeightAt(cx, cz) + PLAYER.height + 0.5;
    if (!player.rigidBody) { initPlayerBody(cx, landY, cz); return; }
    player.rigidBody.setTranslation({ x: cx, y: landY, z: cz }, true);
    player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerRig.position.set(cx, landY, cz);
  };
  // Gravity off for first 15 frames — prevents ejection impulse while
  // Rapier resolves the initial contact with terrain.
  player.rigidBody.setGravityScale(0.0, true);
  player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  player._spawnSettleFrames = 15;
  console.log('[player] Body at', x.toFixed(1), y.toFixed(1), z.toFixed(1));
}

// Freecam: never setEnabled(false/true) — that causes impulse spike on re-enable.
export function toggleFreeCam() {
  player.freeCam = !player.freeCam;
  if (player.rigidBody) {
    if (player.freeCam) {
      // Entering freecam — freeze the physics body in place (gravity=0, no velocity)
      player.rigidBody.setGravityScale(0.0, true);
      player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      // Exiting freecam — snap body to current camera position, re-enable gravity
      const cx = +playerRig.position.x;
      const cz = +playerRig.position.z;
      const landY = getTerrainHeightAt(cx, cz) + PLAYER.height + 0.5;
      player.rigidBody.setTranslation({ x: cx, y: landY, z: cz }, true);
      player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      playerRig.position.set(cx, landY, cz);
      // CRITICAL: restore gravity and clear settle gate so walk tick runs immediately
      player.rigidBody.setGravityScale(1.0, true);
      player._spawnSettleFrames = 0;
    }
  }
  return player.freeCam;
}

const CAPSULE_BOT     = PLAYER.height / 2 + PLAYER.radius;
const GROUND_CAST_LEN = CAPSULE_BOT + 0.35;
const MAX_GROUNDED_VY = 4.0;

export function tickPlayer(dt) {
  if (!playerRig) return;
  if (player.freeCam) { _tickFreeCam(dt); } else { _tickWalk(dt); }
}

function _tickWalk(dt) {
  if (!player.rigidBody) return;
  if (player._spawnSettleFrames > 0) {
    player._spawnSettleFrames--;
    if (player._spawnSettleFrames === 0) player.rigidBody.setGravityScale(1.0, true);
    return;
  }

  const t = player.rigidBody.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) return;
  playerRig.position.set(px, py, pz);

  // Ground detection — cast from centre, accept any hit within generous range
  player.grounded = false;
  let _rayHitToi = -1;
  if (physicsWorld) {
    const ray = new RAPIER.Ray({ x: px, y: py, z: pz }, { x: 0, y: -1, z: 0 });
    const hit = physicsWorld.castRay(ray, CAPSULE_BOT + 0.3, true);
    if (hit) {
      _rayHitToi = hit.timeOfImpact;
      // Grounded if the hit is within 0.3m of capsule bottom (tight = no false positives from walls)
      if (hit.timeOfImpact >= CAPSULE_BOT - 0.3) player.grounded = true;
    }
  }

  // Build desired horizontal velocity
  const yaw = euler.y, sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  let wx = 0, wz = 0;
  const hasInput = keys.moveForward || keys.moveBack || keys.moveLeft || keys.moveRight;
  if (keys.moveForward) { wx += sinY; wz += cosY; }
  if (keys.moveBack)    { wx -= sinY; wz -= cosY; }
  if (keys.moveLeft)    { wx -= cosY; wz += sinY; }
  if (keys.moveRight)   { wx += cosY; wz -= sinY; }
  const speed = keys.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const len = Math.sqrt(wx*wx + wz*wz);
  if (len > 0) { wx = wx/len*speed; wz = wz/len*speed; }

  const curVel = player.rigidBody.linvel();
  let vy = curVel.y;

  // Terrain height for ground confirmation and floor guard
  const terrainY = getTerrainHeightAt(px, pz);
  const capsuleBottom = py - CAPSULE_BOT;
  const gapToTerrain = capsuleBottom - terrainY; // positive = above terrain

  // Confirm grounded vs actual terrain (not just any Rapier collider).
  const trulyOnTerrain = player.grounded && (gapToTerrain < 0.4);

  if (trulyOnTerrain) {
    // Only kill genuine ejection spikes (> walkSpeed).
    // Smaller upward vy is normal slope-climbing contact response — don't zero it.
    if (vy > PLAYER.walkSpeed) vy = 0;
  } else if (gapToTerrain < 0.7) {
    vy = Math.min(vy, -2.0);
  } else {
    vy = Math.max(vy, -50);
  }

  // Hard floor guard
  if (gapToTerrain < -0.4) {
    const snapY = terrainY + CAPSULE_BOT + 0.05;
    player.rigidBody.setTranslation({ x: px, y: snapY, z: pz }, true);
    vy = 0;
  }

  // Horizontal velocity:
  // With input: snap directly to target. This fully overrides any contact-impulse
  // residual from the previous frame (the root cause of getting stuck on steep slopes —
  // a slow lerp takes 6+ frames to overcome a backward contact impulse, stalling movement).
  // Without input: zero directly so damping can stop us cleanly, no wall oscillation.
  if (hasInput) {
    // Full override — don't preserve contact residuals
    // wx/wz are already the correct world-space velocity for this frame
  } else {
    wx = 0;
    wz = 0;
  }

  player.rigidBody.setLinvel({ x: wx, y: vy, z: wz }, true);

  // Jump — zero Y first so slope-stick doesn't reduce jump height
  if (keys.jump && player.grounded) {
    player.rigidBody.setLinvel({ x: wx, y: 0, z: wz }, true);
    player.rigidBody.applyImpulse({ x: 0, y: PLAYER.jumpImpulse * PLAYER.mass, z: 0 }, true);
  }

  const targetEye = keys.duck ? 0.2 : 0.7;
  camera.position.y += (targetEye - camera.position.y) * 0.15;
}

function _tickFreeCam(dt) {
  if (!playerRig) return;
  if (player.rigidBody) {
    const p = playerRig.position;
    player.rigidBody.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  const speed = PLAYER.freeFlyCamSpeed;
  const yaw = euler.y, pitch = euler.x;
  _fwd3.set(Math.sin(yaw)*Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw)*Math.cos(pitch));
  _right3.set(Math.cos(yaw), 0, -Math.sin(yaw));
  let vx=0, vy=0, vz=0;
  if (keys.moveForward) { vx+=_fwd3.x;   vy+=_fwd3.y;   vz+=_fwd3.z;   }
  if (keys.moveBack)    { vx-=_fwd3.x;   vy-=_fwd3.y;   vz-=_fwd3.z;   }
  if (keys.moveLeft)    { vx-=_right3.x; vz-=_right3.z; }
  if (keys.moveRight)   { vx+=_right3.x; vz+=_right3.z; }
  if (keys.jump)  vy+=1;
  if (keys.duck)  vy-=1;
  const l = Math.sqrt(vx*vx+vy*vy+vz*vz);
  if (l > 0) { const s=speed*dt/l; playerRig.position.x+=vx*s; playerRig.position.y+=vy*s; playerRig.position.z+=vz*s; }
  camera.position.y = 0.7;
}