// ladders.js — ladder zones, climb detection, tick
// Fix: _currentLadder null-guard after _stopClimbing
// Fix: rotation support so ladders face the correct shelter side

import { scene } from './core.js';
import { playerRig, player } from './player.js';
import { keys } from './input.js';
import { LADDERS, CONFIG } from './config.js';

let _ladders       = [];
let _climbing      = false;
let _currentLadder = null;

export function initLadders() {
  clearLadders();
  for (const def of (CONFIG.ladders || [])) spawnLadder(def);
}

export function spawnLadder(def) {
  const px  = +(def.position?.x || 0);
  const py  = +(def.position?.y || 0);
  const pz  = +(def.position?.z || 0);
  const height = def.height || 5;
  // rotY: ladder faces in this direction (rungs face away from shelter)
  const rotY   = def.rotY ?? def.rotation ?? 0;

  const node = new BABYLON.TransformNode('ladder', scene);
  node.position.set(px, py, pz);
  node.rotation.y = rotY;

  const RAIL_COLOR = new BABYLON.Color3(0.55, 0.38, 0.18);
  const RUNG_COLOR = new BABYLON.Color3(0.46, 0.32, 0.14);

  const railMat = new BABYLON.StandardMaterial('ladderMat', scene);
  railMat.diffuseColor = RAIL_COLOR;
  const rungMat = new BABYLON.StandardMaterial('rungMat', scene);
  rungMat.diffuseColor = RUNG_COLOR;

  // Rails: placed at local ±0.2 on X, centred vertically
  for (const ox of [-0.2, 0.2]) {
    const rail = BABYLON.MeshBuilder.CreateCylinder('rail', { diameter: 0.06, height }, scene);
    rail.parent = node;
    rail.position.set(ox, height / 2, 0);
    rail.material = railMat;
  }

  // Rungs: span X, step up every 0.4m
  const rungCount = Math.floor(height / 0.4);
  for (let i = 0; i < rungCount; i++) {
    const rung = BABYLON.MeshBuilder.CreateCylinder('rung', { diameter: 0.04, height: 0.45 }, scene);
    rung.parent = node;
    rung.position.set(0, i * 0.4 + 0.2, 0);
    rung.rotation.z = Math.PI / 2;
    rung.material = rungMat;
  }

  const ladder = { node, def, position: { x: px, y: py, z: pz }, height, rotY };
  _ladders.push(ladder);
  return ladder;
}

export function tickLadders(dt) {
  if (!playerRig) return;
  const pp = playerRig.position;

  if (!_climbing) {
    for (const ladder of _ladders) {
      const lp  = ladder.position;
      const dx  = pp.x - lp.x;
      const dz  = pp.z - lp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.9 && pp.y >= lp.y - 0.2 && pp.y <= lp.y + ladder.height + 0.5) {
        if (keys.moveForward || keys.jump) {
          _startClimbing(ladder);
          break;
        }
      }
    }
    return;
  }

  // ── Climbing ─────────────────────────────────────────────────────────────
  // Cache current ladder reference BEFORE any _stopClimbing call
  const activeLadder = _currentLadder;
  if (!activeLadder) { _stopClimbing(); return; }

  if (keys.moveForward || keys.jump) {
    playerRig.position.y += LADDERS.climbSpeed * dt;
  } else if (keys.moveBack) {
    playerRig.position.y -= LADDERS.climbSpeed * dt;
  }

  const lp = activeLadder.position;

  // Detach checks — MUST use activeLadder snapshot, not _currentLadder
  if (playerRig.position.y > lp.y + activeLadder.height + LADDERS.detachThreshold) {
    _stopClimbing();
    return;   // <-- return immediately; _currentLadder is now null
  }
  if (playerRig.position.y < lp.y - LADDERS.detachThreshold) {
    _stopClimbing();
    return;
  }

  // Align player to ladder centre (still safe — using activeLadder snapshot)
  playerRig.position.x += (lp.x - playerRig.position.x) * 0.3;
  playerRig.position.z += (lp.z - playerRig.position.z) * 0.3;

  // Zero physics velocity so gravity doesn't fight us
  const body = player.aggregate?.body ?? player.rigidBody;
  if (body) {
    try {
      body.setLinearVelocity(BABYLON.Vector3.Zero());
      body.setAngularVelocity(BABYLON.Vector3.Zero());
    } catch(e) {}
  }

  if (player._capsuleMesh) {
    player._capsuleMesh.position.set(
      playerRig.position.x,
      playerRig.position.y,
      playerRig.position.z,
    );
  }
}

function _startClimbing(ladder) {
  _climbing      = true;
  _currentLadder = ladder;
  const body = player.aggregate?.body ?? player.rigidBody;
  if (body) {
    try { body.setLinearVelocity(BABYLON.Vector3.Zero()); } catch(e) {}
    try {
      body.setGravityFactor(0);
    } catch(e) {
      try { body.setMassProperties({ mass: 0, inertia: BABYLON.Vector3.Zero() }); } catch(e2) {}
    }
  }
}

function _stopClimbing() {
  _climbing      = false;
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
    try { l.node.getChildMeshes().forEach(m => m.dispose()); } catch(e) {}
    try { l.node.dispose(); } catch(e) {}
  }
  _ladders       = [];
  _climbing      = false;
  _currentLadder = null;
}

export function isClimbing() { return _climbing; }
