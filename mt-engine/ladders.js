// ladders.js — ladder zones, climb detection, tick

import { scene } from './core.js';
import { playerRig, player } from './player.js';
import { keys } from './input.js';
import { LADDERS, CONFIG } from './config.js';

let _ladders = [];
let _climbing = false;
let _currentLadder = null;

export function initLadders() {
  clearLadders();
  const ladderDefs = CONFIG.ladders || [];
  for (const def of ladderDefs) {
    spawnLadder(def);
  }
}

export function spawnLadder(def) {
  const px = +(def.position?.x||0), py = +(def.position?.y||0), pz = +(def.position?.z||0);
  const height = def.height || 5;
  const rotY   = def.rotY   || 0;

  // Visual ladder
  const node = new BABYLON.TransformNode('ladder', scene);
  node.position.set(px, py, pz);
  node.rotation.y = rotY;

  // Rails
  for (const ox of [-0.2, 0.2]) {
    const rail = BABYLON.MeshBuilder.CreateCylinder(`rail`, { diameter: 0.06, height }, scene);
    rail.parent = node;
    rail.position.set(ox, height/2, 0);
    const mat = new BABYLON.StandardMaterial('ladderMat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.6, 0.4, 0.2);
    rail.material = mat;
  }

  // Rungs
  const rungCount = Math.floor(height / 0.4);
  for (let i = 0; i < rungCount; i++) {
    const rung = BABYLON.MeshBuilder.CreateCylinder('rung', { diameter: 0.04, height: 0.45 }, scene);
    rung.parent = node;
    rung.position.set(0, i * 0.4 + 0.2, 0);
    rung.rotation.z = Math.PI / 2;
    const mat = new BABYLON.StandardMaterial('rungMat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.5, 0.35, 0.15);
    rung.material = mat;
  }

  const ladder = { node, def, position: {x:px,y:py,z:pz}, height, rotY };
  _ladders.push(ladder);
  return ladder;
}

export function tickLadders(dt) {
  if (!playerRig) return;
  const pp = playerRig.position;

  if (!_climbing) {
    // Check if player is near a ladder
    for (const ladder of _ladders) {
      const lp = ladder.position;
      const dx = pp.x - lp.x, dz = pp.z - lp.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < 0.8 && pp.y >= lp.y && pp.y <= lp.y + ladder.height + 0.5) {
        if (keys.moveForward || keys.jump) {
          _startClimbing(ladder);
        }
      }
    }
  } else {
    // Climbing
    if (!keys.moveForward && !keys.jump && !keys.moveBack) return;

    if (keys.moveForward || keys.jump) {
      playerRig.position.y += LADDERS.climbSpeed * dt;
    } else if (keys.moveBack) {
      playerRig.position.y -= LADDERS.climbSpeed * dt;
    }

    // Detach at top or bottom
    const lp = _currentLadder.position;
    if (playerRig.position.y > lp.y + _currentLadder.height + LADDERS.detachThreshold) {
      _stopClimbing(); return;
    }
    if (playerRig.position.y < lp.y - LADDERS.detachThreshold) {
      _stopClimbing(); return;
    }

    // Keep player snapped to ladder — offset in front of ladder face
    const snapDist = 0.35;
    const lRotY = _currentLadder.rotY || 0;
    playerRig.position.x += (_currentLadder.position.x + Math.sin(lRotY) * snapDist - playerRig.position.x) * 0.3;
    playerRig.position.z += (_currentLadder.position.z + Math.cos(lRotY) * snapDist - playerRig.position.z) * 0.3;

    if (player.rigidBody) {
      player.rigidBody.setLinvel({x:0,y:0,z:0}, true);
      player.rigidBody.setTranslation({x:playerRig.position.x, y:playerRig.position.y, z:playerRig.position.z}, true);
    }
  }
}

function _startClimbing(ladder) {
  _climbing = true;
  _currentLadder = ladder;
  if (player.rigidBody) player.rigidBody.setEnabled(false);
}

function _stopClimbing() {
  _climbing = false;
  _currentLadder = null;
  if (player.rigidBody) player.rigidBody.setEnabled(!player.freeCam);
}

export function clearLadders() {
  for (const l of _ladders) {
    try { l.node.dispose(); } catch(e) {}
  }
  _ladders = [];
  _climbing = false;
  _currentLadder = null;
}

export function isClimbing() { return _climbing; }