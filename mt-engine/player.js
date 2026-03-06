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

// Pre-allocated scratch vectors
const _vel3    = new BABYLON.Vector3();
const _fwd3    = new BABYLON.Vector3();
const _right3  = new BABYLON.Vector3();
const _up3     = new BABYLON.Vector3(0, 1, 0);

export function initPlayer() {
  if (!physicsReady) return;

  // Clean up old rig if reinitialising after physics reset
  if (playerRig) {
    camera.parent = null;
    try { playerRig.dispose(); } catch(e) {}
    playerRig = null;
  }

  // Rapier capsule body
  const rdesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 3, 0)
    .setLinearDamping(4.0)
    .setAngularDamping(100.0);

  player.rigidBody = physicsWorld.createRigidBody(rdesc);
  player.rigidBody.enableCcd(true);  // prevent tunneling through terrain

  const cdesc = RAPIER.ColliderDesc.capsule(PLAYER.height / 2, PLAYER.radius)
    .setMass(PLAYER.mass)
    .setFriction(0.5)
    .setRestitution(0.0);
  physicsWorld.createCollider(cdesc, player.rigidBody);

  player.rigidBody.lockRotations(true);

  playerRig = new BABYLON.TransformNode('playerRig', scene);
  playerRig.position.set(0, 3, 0);
  camera.parent = playerRig;
  camera.position.set(0, 0.7, 0);

  player.health = 100;
  player.freeCam  = false;
  player.grounded = false;

  // Debug globals
  window._player    = player;
  window._playerRig = playerRig;

  // Snap player onto terrain surface — called after heightmap applied in editor
  window._resnapPlayerToTerrain = function() {
    if (!player.rigidBody || !playerRig) return;
    const cx = +playerRig.position.x;
    const cz = +playerRig.position.z;
    const terrainY = getTerrainHeightAt(cx, cz);
    const landY = terrainY + PLAYER.height + 0.5;
    player.rigidBody.setTranslation({ x: cx, y: landY, z: cz }, true);
    player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerRig.position.set(cx, landY, cz);
    console.log('[player] Snapped to terrain at', cx.toFixed(1), landY.toFixed(1), cz.toFixed(1));
  };

  console.log('[player] Spawned at', +playerRig.position.x, +playerRig.position.y, +playerRig.position.z);
}

export function toggleFreeCam() {
  player.freeCam = !player.freeCam;

  if (player.rigidBody) {
    if (player.freeCam) {
      // Entering freecam — disable physics so body doesn't fall while flying
      player.rigidBody.setEnabled(false);
    } else {
      // Exiting freecam — land at current XZ, snapped to terrain surface
      const cx = +playerRig.position.x;
      const cz = +playerRig.position.z;
      const terrainY = getTerrainHeightAt(cx, cz);
      const landY = terrainY + PLAYER.height + 0.5;

      player.rigidBody.setEnabled(true);
      player.rigidBody.setTranslation({ x: cx, y: landY, z: cz }, true);
      player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      playerRig.position.set(cx, landY, cz);
    }
  }

  return player.freeCam;
}

const GROUND_CAST_LEN = PLAYER.height / 2 + PLAYER.radius + 0.15;

export function tickPlayer(dt) {
  if (!physicsReady || !playerRig) return;

  if (player.freeCam) {
    _tickFreeCam(dt);
  } else {
    _tickWalk(dt);
  }
}

function _tickWalk(dt) {
  if (!player.rigidBody) return;
  const t = player.rigidBody.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) return;

  // Sync rig with physics body
  playerRig.position.set(px, py, pz);

  // --- Ground check (downward ray) ---
  if (physicsWorld) {
    const ray = new RAPIER.Ray({ x: px, y: py, z: pz }, { x: 0, y: -1, z: 0 });
    const hit = physicsWorld.castRay(ray, GROUND_CAST_LEN, true);
    player.grounded = !!hit;
  }

  // --- Movement direction ---
  const yaw   = euler.y;
  const sinY  = Math.sin(yaw), cosY = Math.cos(yaw);

  let mx = 0, mz = 0;
  if (keys.moveForward)  { mx += sinY;  mz += cosY;  }
  if (keys.moveBack)     { mx -= sinY;  mz -= cosY;  }
  if (keys.moveLeft)     { mx -= cosY;  mz += sinY;  }
  if (keys.moveRight)    { mx += cosY;  mz -= sinY;  }

  const speed = keys.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const len   = Math.sqrt(mx * mx + mz * mz);
  if (len > 0) { mx = (mx / len) * speed; mz = (mz / len) * speed; }

  const curVel = player.rigidBody.linvel();
  player.rigidBody.setLinvel({ x: mx, y: curVel.y, z: mz }, true);

  // --- Jump ---
  if (keys.jump && player.grounded) {
    player.rigidBody.applyImpulse({ x: 0, y: PLAYER.jumpImpulse * PLAYER.mass, z: 0 }, true);
  }

  // --- Duck: lower camera ---
  const targetEye = keys.duck ? 0.2 : 0.7;
  camera.position.y += (targetEye - camera.position.y) * 0.15;
}

function _tickFreeCam(dt) {
  if (!playerRig) return;
  const speed = PLAYER.freeFlyCamSpeed;
  const yaw   = euler.y, pitch = euler.x;
  const sinY  = Math.sin(yaw),  cosY  = Math.cos(yaw);
  const sinP  = Math.sin(pitch),cosP  = Math.cos(pitch);

  // Forward in look direction
  _fwd3.set(sinY * cosP, -sinP, cosY * cosP);
  // Right
  _right3.set(cosY, 0, -sinY);

  let vx = 0, vy = 0, vz = 0;
  if (keys.moveForward)  { vx += _fwd3.x;   vy += _fwd3.y;   vz += _fwd3.z;   }
  if (keys.moveBack)     { vx -= _fwd3.x;   vy -= _fwd3.y;   vz -= _fwd3.z;   }
  if (keys.moveLeft)     { vx -= _right3.x; vz -= _right3.z; }
  if (keys.moveRight)    { vx += _right3.x; vz += _right3.z; }
  if (keys.jump)  vy += 1;
  if (keys.duck)  vy -= 1;

  const len = Math.sqrt(vx*vx + vy*vy + vz*vz);
  if (len > 0) {
    const s = speed * dt / len;
    playerRig.position.x += vx * s;
    playerRig.position.y += vy * s;
    playerRig.position.z += vz * s;
  }
  camera.position.y = 0.7;
}