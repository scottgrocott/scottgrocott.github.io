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

  // Visual ladder
  const node = new BABYLON.TransformNode('ladder', scene);
  node.position.set(px, py, pz);

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

  const ladder = { node, def, position: {x:px,y:py,z:pz}, height };
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
      _stopClimbing();
    }
    if (playerRig.position.y < lp.y - LADDERS.detachThreshold) {
      _stopClimbing();
    }

    // Keep player aligned to ladder
    playerRig.position.x += (_currentLadder.position.x - playerRig.position.x) * 0.3;
    playerRig.position.z += (_currentLadder.position.z - playerRig.position.z) * 0.3;

    // Sync Havok body to ladder position
    const _clBody = player.aggregate?.body ?? player.rigidBody;
    if (_clBody) {
      try {
        _clBody.setLinearVelocity(BABYLON.Vector3.Zero());
        _clBody.setAngularVelocity(BABYLON.Vector3.Zero());
      } catch(e) {}
    }
    // Sync capsule mesh position
    if (player._capsuleMesh) {
      player._capsuleMesh.position.set(playerRig.position.x, playerRig.position.y, playerRig.position.z);
    }
  }
}

function _startClimbing(ladder) {
  _climbing = true;
  _currentLadder = ladder;
  // Havok: zero velocity and lock via massProps (no setGravityScale in BabylonJS Havok)
  const body = player.aggregate?.body ?? player.rigidBody;
  if (body) {
    try { body.setLinearVelocity(new BABYLON.Vector3(0, 0, 0)); } catch(e) {}
    try {
      // Freeze gravity while climbing by setting inertia and gravity factor
      body.setGravityFactor(0);
    } catch(e) {
      // Fallback: lock mass (older Havok builds)
      try { body.setMassProperties({ mass: 0, inertia: BABYLON.Vector3.Zero() }); } catch(e2) {}
    }
  }
}

function _stopClimbing() {
  _climbing = false;
  _currentLadder = null;
  const body = player.aggregate?.body ?? player.rigidBody;
  if (body) {
    try { body.setGravityFactor(1); } catch(e) {
      try { body.setMassProperties({ mass: 75, inertia: new BABYLON.Vector3(0, 1, 0) }); } catch(e2) {}
    }
  }
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
