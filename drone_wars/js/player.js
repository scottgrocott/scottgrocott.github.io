// ============================================================
//  player.js — Player rig, physics init, movement tick
// ============================================================

import { scene, camera } from './core.js';
import { PLAYER, CONFIG }  from './config.js';
import { physicsWorld, physicsReady, physCache } from './physics.js';
import { pointerLock, keys }  from './input.js';
import { cockpitGroup, tickCockpit, resetCockpitSway } from './cockpit.js';
import { hud } from './hud.js';

export const playerRig = new BABYLON.TransformNode('playerRig', scene);
playerRig.position.set(0, PLAYER.height, 0);
camera.parent = playerRig;

export const player = {
  rigidBody: null,
  collider:  null,
  isGrounded: false,
  justJumped: false,
  onLadder:  false,
  isDucking: false,
  freeCam:   false,
  shotsFired: 0,
  moveDir:   new BABYLON.Vector3(0, 0, 0),
};

export function initPlayer() {
  const R   = window.RAPIER;
  const pos = playerRig.position;

  player.rigidBody = physicsWorld.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .lockRotations()
      .setLinearDamping(5.0),
  );
  player.collider = physicsWorld.createCollider(
    R.ColliderDesc.capsule(PLAYER.height / 2 - PLAYER.radius, PLAYER.radius)
      .setMass(PLAYER.mass)
      .setFriction(0)
      .setRestitution(0),
    player.rigidBody,
  );
}

export function toggleFreeCam() {
  player.freeCam = !player.freeCam;
  cockpitGroup.setEnabled(player.freeCam);

  if (player.freeCam) {
    player.rigidBody?.setEnabled(false);
  } else {
    player.rigidBody?.setEnabled(true);
    player.rigidBody?.setTranslation(playerRig.position, true);
    player.rigidBody?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    resetCockpitSway();
  }
}

export function tickPlayer(dt) {
  if (!player.rigidBody) return;

  if (player.freeCam) {
    _tickFreeCam(dt);
    return;
  }

  _tickWalking(dt);
}

// ---- Private ----

function _tickFreeCam(dt) {
  const { y: yaw, x: pitch } = pointerLock.euler;
  const fwd   = new BABYLON.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
     Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  const right = new BABYLON.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move  = new BABYLON.Vector3(0, 0, 0);

  if (keys.w) move.addInPlace(fwd);
  if (keys.s) move.subtractInPlace(fwd);
  if (keys.a) move.subtractInPlace(right);
  if (keys.d) move.addInPlace(right);
  if (keys.space) move.y += 1;
  if (keys.duck)  move.y -= 1;

  if (move.length() > 0) move.normalize();
  playerRig.position.addInPlace(move.scale(CONFIG.freeFlyCamSpeed * dt));
  tickCockpit(dt, move, true);

  const p = playerRig.position;
  hud.setGrounded('FREECAM');
  hud.setDuck('—');
  hud.setPos(p.x, p.y, p.z);
  hud.setAmmo(player.shotsFired);
}

function _tickWalking(dt) {
  // Ducking
  if (keys.duck !== player.isDucking) {
    player.isDucking  = keys.duck;
    camera.position.y = player.isDucking ? -(PLAYER.height - PLAYER.duckHeight) : 0;
  }

  // Horizontal movement
  const yaw = pointerLock.euler.y;
  player.moveDir.set(0, 0, 0);
  if (keys.w) { player.moveDir.x -= Math.sin(yaw); player.moveDir.z -= Math.cos(yaw); }
  if (keys.s) { player.moveDir.x += Math.sin(yaw); player.moveDir.z += Math.cos(yaw); }
  if (keys.a) { player.moveDir.x -= Math.cos(yaw); player.moveDir.z += Math.sin(yaw); }
  if (keys.d) { player.moveDir.x += Math.cos(yaw); player.moveDir.z -= Math.sin(yaw); }
  if (player.moveDir.length() > 0) player.moveDir.normalize();

  const spd     = player.isDucking ? PLAYER.maxVelocity * 0.5 : PLAYER.maxVelocity;
  const vel     = physCache.playerVel;
  const hspeed  = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  if (hspeed < spd) {
    player.rigidBody.applyImpulse(
      { x: player.moveDir.x * PLAYER.moveSpeed * dt, y: 0, z: player.moveDir.z * PLAYER.moveSpeed * dt },
      true,
    );
  }

  if (keys.space && player.isGrounded && !player.justJumped && !player.onLadder && !player.isDucking) {
    player.rigidBody.applyImpulse({ x: 0, y: PLAYER.jumpForce, z: 0 }, true);
    player.justJumped = true;
  }
  if (!keys.space) player.justJumped = false;

  // Sync position from physics cache
  const p = physCache.playerPos;
  playerRig.position.set(p.x, p.y, p.z);

  hud.setGrounded(player.isGrounded ? 'YES' : 'NO');
  hud.setDuck(player.isDucking ? 'YES' : 'NO');
  hud.setPos(p.x, p.y, p.z);
  hud.setAmmo(player.shotsFired);
}
