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

export function initPlayer() {
  if (!physicsReady) return;

  // Spawn above terrain surface at world centre
  const spawnX = 0, spawnZ = 0;
  const spawnY = getTerrainHeightAt(spawnX, spawnZ) + PLAYER.height + 2;

  const rdesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnX, spawnY, spawnZ)
    .setLinearDamping(4.0)
    .setAngularDamping(100.0);

  player.rigidBody = physicsWorld.createRigidBody(rdesc);

  const cdesc = RAPIER.ColliderDesc.capsule(PLAYER.height / 2, PLAYER.radius)
    .setMass(PLAYER.mass)
    .setFriction(0.8)
    .setRestitution(0.0);
  physicsWorld.createCollider(cdesc, player.rigidBody);
  player.rigidBody.lockRotations(true);

  playerRig = new BABYLON.TransformNode('playerRig', scene);
  playerRig.position.set(spawnX, spawnY, spawnZ);
  camera.parent = playerRig;
  camera.position.set(0, 0.7, 0);

  player.health   = 100;
  player.freeCam  = false;
  player.grounded = false;

  console.log('[player] Spawned at', spawnX, spawnY.toFixed(1), spawnZ);
}

export function toggleFreeCam() {
  player.freeCam = !player.freeCam;
  if (player.rigidBody) player.rigidBody.setEnabled(!player.freeCam);
  return player.freeCam;
}

const GROUND_CAST_LEN = PLAYER.height / 2 + PLAYER.radius + 0.25;

export function tickPlayer(dt) {
  if (!physicsReady || !playerRig) return;
  player.freeCam ? _tickFreeCam(dt) : _tickWalk(dt);
}

function _tickWalk(dt) {
  if (!player.rigidBody) return;
  const t = player.rigidBody.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) return;

  playerRig.position.set(px, py, pz);

  // Ground check — ray down from body centre
  if (physicsWorld) {
    const ray = new RAPIER.Ray({ x: px, y: py, z: pz }, { x: 0, y: -1, z: 0 });
    const hit = physicsWorld.castRay(ray, GROUND_CAST_LEN, true);
    player.grounded = !!hit;
  }

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

  const curVel = player.rigidBody.linvel();
  player.rigidBody.setLinvel({ x: mx, y: curVel.y, z: mz }, true);

  if (keys.jump && player.grounded) {
    player.rigidBody.applyImpulse({ x: 0, y: PLAYER.jumpImpulse * PLAYER.mass, z: 0 }, true);
  }

  const targetEye = keys.duck ? 0.2 : 0.7;
  camera.position.y += (targetEye - camera.position.y) * 0.15;
}

function _tickFreeCam(dt) {
  if (!playerRig) return;
  const speed = PLAYER.freeFlyCamSpeed;
  const yaw   = euler.y, pitch = euler.x;
  const sinY  = Math.sin(yaw), cosY = Math.cos(yaw);
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

  const len = Math.sqrt(vx*vx + vy*vy + vz*vz);
  if (len > 0) {
    const s = speed * dt / len;
    playerRig.position.x += vx * s;
    playerRig.position.y += vy * s;
    playerRig.position.z += vz * s;
  }
  camera.position.y = 0.7;
}