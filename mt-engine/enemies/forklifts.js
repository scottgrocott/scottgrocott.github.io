// enemies/forklifts.js — ground forklift enemy (GLTF model)

import { scene, shadowGenerator } from '../core.js';
import { physicsWorld, safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';
import { loadEnemyModel, findNode, findPieces } from './enemyModels.js';

const PATROL_SPEED  = 2.5;
const CHASE_SPEED   = 4;
const RAM_SPEED     = 7;
const DETECT_RANGE  = 30;
const RAM_RANGE     = 6;

export function spawnForklifts(def) {
  const count = def.maxCount || 2;
  const groundWaypoints = getWaypoints('ground');
  const spawned = [];
  for (let i = 0; i < count; i++) {
    const wp = groundWaypoints[i % Math.max(1, groundWaypoints.length)];
    const spawnPos = wp
      ? new BABYLON.Vector3(wp.x, wp.y, wp.z)
      : new BABYLON.Vector3((Math.random()-0.5)*60, 0.7, (Math.random()-0.5)*60);

    const enemy = new EnemyBase({
      scene, rapierWorld: physicsWorld, type: 'forklift',
      speed: PATROL_SPEED, health: def.health ?? 150, spawnPos,
    });

    enemy.state          = 'patrol';
    enemy._waypointIndex = Math.floor(Math.random() * Math.max(1, groundWaypoints.length));
    enemy._forkRaising   = false;
    enemy._forkY         = 0.3;

    _buildForkliftMesh(enemy, spawnPos, def.overrides);
    spawned.push(enemy);
  }
  return spawned;
}

async function _buildForkliftMesh(enemy, spawnPos, overrides) {
  const _savedPos = spawnPos?.clone() ?? new BABYLON.Vector3(0, 0.7, 0);
  if (enemy.mesh) { try { enemy.mesh.dispose(); } catch(_) {} }

  try {
    const root = await loadEnemyModel(scene, 'forklift', {
      position:  _savedPos,
      shadowGen: shadowGenerator,
      overrides: overrides ?? {},
    });
    enemy.mesh = root;
    // Fork node — find the fork meshes; animate by moving them on Y
    enemy._forkMeshes = findPieces(root, 'forklift_fork');
    enemy._forkNode   = null; // forks animated directly in tick via _forkMeshes
  } catch (e) {
    console.warn('[forklifts] GLTF load failed, using procedural fallback:', e);
    _buildForkliftMeshProc(enemy, _savedPos);
  }
}

function _buildForkliftMeshProc(enemy, savedPos) {
  if (enemy.mesh) enemy.mesh.dispose();
  const root = new BABYLON.TransformNode('flRoot', scene);
  root.position.copyFrom(savedPos);
  enemy.mesh = root;

  const body = BABYLON.MeshBuilder.CreateBox('flBody', { width:1.4, height:1.2, depth:2.0 }, scene);
  body.parent = root;
  body.position.set(0, 0.7, 0);
  const mat = new BABYLON.StandardMaterial('flMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.95, 0.75, 0.05);
  body.material = mat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(body);

  enemy._forkNode = new BABYLON.TransformNode('forkNode', scene);
  enemy._forkNode.parent = root;
  enemy._forkNode.position.set(0, 0.3, 1.1);
  enemy._forkMeshes = [];

  for (const off of [{x:0.3},{x:-0.3}]) {
    const fork = BABYLON.MeshBuilder.CreateBox('fork', { width:0.12, height:0.08, depth:1.2 }, scene);
    fork.parent = enemy._forkNode;
    fork.position.set(off.x, 0, 0.6);
    const fmat = new BABYLON.StandardMaterial('forkMat', scene);
    fmat.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    fork.material = fmat;
    enemy._forkMeshes.push(fork);
  }
}

export function tickForklifts(dt) {
  const groundWaypoints = getWaypoints('ground');
  for (const e of getEnemies()) {
    if (e.type !== 'forklift' || e.dead) continue;
    _tickForklift(e, dt, groundWaypoints);
  }
}

function _tickForklift(enemy, dt, groundWaypoints) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return;

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({x:px, y:py, z:pz});
  let targetX = px, targetZ = pz, spd = PATROL_SPEED;

  switch (enemy.state) {
    case 'idle': { enemy.state = 'patrol'; break; }
    case 'patrol': {
      if (dPlayer < DETECT_RANGE) { enemy.state = 'chase'; break; }
      if (groundWaypoints.length > 0) {
        const wp = groundWaypoints[enemy._waypointIndex % groundWaypoints.length];
        const dx = wp.x - px, dz = wp.z - pz;
        if (Math.sqrt(dx*dx+dz*dz) < 4) {
          enemy._waypointIndex = (enemy._waypointIndex + 1) % groundWaypoints.length;
        } else { targetX = wp.x; targetZ = wp.z; }
      }
      break;
    }
    case 'chase': {
      if (dPlayer > DETECT_RANGE * 1.5) { enemy.state = 'patrol'; break; }
      if (dPlayer < RAM_RANGE)           { enemy.state = 'ram';    break; }
      targetX = playerPos.x; targetZ = playerPos.z;
      spd = CHASE_SPEED;
      break;
    }
    case 'ram': {
      if (dPlayer > RAM_RANGE * 2) { enemy.state = 'chase'; break; }
      targetX = playerPos.x; targetZ = playerPos.z;
      spd = RAM_SPEED;
      enemy._forkRaising = true;
      break;
    }
  }

  // Animate forks — either via TransformNode (procedural) or direct Y offset (GLTF)
  if (enemy._forkNode) {
    if (enemy._forkRaising) {
      enemy._forkY = Math.min(enemy._forkY + dt * 1.5, 1.8);
    } else {
      enemy._forkY = Math.max(enemy._forkY - dt * 0.8, 0.3);
    }
    enemy._forkNode.position.y = enemy._forkY;
    if (enemy.state !== 'ram') enemy._forkRaising = false;
  } else if (enemy._forkMeshes?.length) {
    // GLTF path: shift fork meshes on world Y directly
    if (enemy._forkRaising) {
      enemy._forkY = Math.min(enemy._forkY + dt * 1.5, 1.8);
    } else {
      enemy._forkY = Math.max(enemy._forkY - dt * 0.8, 0.3);
    }
    for (const m of enemy._forkMeshes) {
      m.position.y = enemy._forkY;
    }
    if (enemy.state !== 'ram') enemy._forkRaising = false;
  }

  const dx = targetX - px, dz = targetZ - pz;
  const len = Math.sqrt(dx*dx + dz*dz);
  if (len > 0.5) {
    const nx = dx/len, nz = dz/len;
    const safe = safeVec3(px + nx*spd*dt, getTerrainHeightAt(px, pz) + 0.7, pz + nz*spd*dt, 'forklift tick');
    if (safe) {
      enemy.body.setNextKinematicTranslation(safe);
      if (enemy.mesh) {
        enemy.mesh.position.set(safe.x, safe.y, safe.z);
        enemy.mesh.rotation.y = Math.atan2(nx, nz);
      }
    }
  }
}
