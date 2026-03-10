// enemies/cars.js — ground car enemy (GLTF model)

import { scene, shadowGenerator } from '../core.js';
import { physicsWorld, safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';
import { loadEnemyModel, findPieces } from './enemyModels.js';

const PATROL_SPEED = 5;
const CHASE_SPEED  = 9;
const RAM_SPEED    = 14;
const DETECT_RANGE = 38;
const RAM_RANGE    = 5;

export function spawnCars(def) {
  const count = def.maxCount || 2;
  const groundWaypoints = getWaypoints('ground');
  const spawned = [];
  for (let i = 0; i < count; i++) {
    const wp = groundWaypoints[i % Math.max(1, groundWaypoints.length)];
    const spawnPos = wp
      ? new BABYLON.Vector3(wp.x, wp.y, wp.z)
      : new BABYLON.Vector3((Math.random()-0.5)*60, 0.5, (Math.random()-0.5)*60);

    const enemy = new EnemyBase({
      scene, rapierWorld: physicsWorld, type: 'car',
      speed: PATROL_SPEED, health: def.health ?? 100, spawnPos,
    });

    enemy.state          = 'patrol';
    enemy._waypointIndex = Math.floor(Math.random() * Math.max(1, groundWaypoints.length));
    enemy._wheels        = [];
    enemy._wheelSpin     = 0;

    _buildCarMesh(enemy, spawnPos, def.overrides);
    spawned.push(enemy);
  }
  return spawned;
}

async function _buildCarMesh(enemy, spawnPos, overrides) {
  const _savedPos = spawnPos?.clone() ?? new BABYLON.Vector3(0, 0.5, 0);
  if (enemy.mesh) { try { enemy.mesh.dispose(); } catch(_) {} }

  try {
    const root = await loadEnemyModel(scene, 'car', {
      position:  _savedPos,
      shadowGen: shadowGenerator,
      overrides: overrides ?? {},
    });
    enemy.mesh   = root;
    enemy._wheels = findPieces(root, 'car_wheel');
  } catch (e) {
    console.warn('[cars] GLTF load failed, using procedural fallback:', e);
    _buildCarMeshProc(enemy, _savedPos);
  }
}

function _buildCarMeshProc(enemy, savedPos) {
  if (enemy.mesh) enemy.mesh.dispose();
  const root = new BABYLON.TransformNode('carRoot', scene);
  root.position.copyFrom(savedPos);
  enemy.mesh = root;

  const body = BABYLON.MeshBuilder.CreateBox('carBody', { width:1.6, height:0.5, depth:2.4 }, scene);
  body.parent = root;
  body.position.set(0, 0.35, 0);
  const mat = new BABYLON.StandardMaterial('carMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.9);
  body.material = mat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(body);

  enemy._wheels = [];
  for (const off of [{x:0.9,z:1.0},{x:-0.9,z:1.0},{x:0.9,z:-1.0},{x:-0.9,z:-1.0}]) {
    const wheel = BABYLON.MeshBuilder.CreateCylinder('wheel',
      { diameter:0.55, height:0.2, tessellation:10 }, scene);
    wheel.parent = root;
    wheel.position.set(off.x, 0.05, off.z);
    wheel.rotation.z = Math.PI / 2;
    const wmat = new BABYLON.StandardMaterial('wheelMat', scene);
    wmat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.15);
    wheel.material = wmat;
    enemy._wheels.push(wheel);
  }
}

export function tickCars(dt) {
  const groundWaypoints = getWaypoints('ground');
  for (const e of getEnemies()) {
    if (e.type !== 'car' || e.dead) continue;
    _tickCar(e, dt, groundWaypoints);
  }
}

function _tickCar(enemy, dt, groundWaypoints) {
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
      break;
    }
  }

  const dx = targetX - px, dz = targetZ - pz;
  const len = Math.sqrt(dx*dx + dz*dz);
  if (len > 0.5) {
    const nx = dx/len, nz = dz/len;
    const safe = safeVec3(px + nx*spd*dt, getTerrainHeightAt(px, pz) + 0.5, pz + nz*spd*dt, 'car tick');
    if (safe) {
      enemy.body.setNextKinematicTranslation(safe);
      if (enemy.mesh) {
        enemy.mesh.position.set(safe.x, safe.y, safe.z);
        enemy.mesh.rotation.y = Math.atan2(nx, nz);
      }
      enemy._wheelSpin = (enemy._wheelSpin || 0) + spd * dt * 2;
      if (enemy._wheels) for (const w of enemy._wheels) w.rotation.x = enemy._wheelSpin;
    }
  }
}
