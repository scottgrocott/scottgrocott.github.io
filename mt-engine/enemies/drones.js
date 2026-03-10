// enemies/drones.js — aerial drone enemy (GLTF model)

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 } from "../physics.js";
import { EnemyBase, _ym, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { CONFIG } from '../config.js';
import { getWaterY } from '../water.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';
import { loadEnemyModel, findPieces } from './enemyModels.js';

const RISE_TARGET_Y   = 16;
const RISE_SPEED      = 4;
const PATROL_SPEED    = 5;
const HUNT_SPEED      = 9;
const DETECT_RANGE    = 45;

export function spawnDrones(def) {
  const count = def.maxCount || 3;
  const flightWaypoints = getWaypoints('flight');
  const spawned = [];
  for (let i = 0; i < count; i++) {
    const wp = flightWaypoints[i % Math.max(1, flightWaypoints.length)];
    const spawnPos = wp
      ? new BABYLON.Vector3(wp.x, RISE_TARGET_Y, wp.z)
      : new BABYLON.Vector3((Math.random()-0.5)*60, RISE_TARGET_Y, (Math.random()-0.5)*60);

    const enemy = new EnemyBase({
      scene,
      type: 'drone',
      speed: PATROL_SPEED,
      health: def.health ?? 60,
      spawnPos,
      noVehicle: true,
    });

    enemy.state   = 'rising';
    enemy._rotors = [];

    // Build mesh — async GLTF load, falls back to procedural on error
    _buildDroneMesh(enemy, spawnPos, def.overrides);
    _setupDroneWaypoints(enemy, flightWaypoints);
    spawned.push(enemy);
  }
  return spawned;
}

async function _buildDroneMesh(enemy, spawnPos, overrides) {
  const _savedPos = spawnPos?.clone() ?? new BABYLON.Vector3(0, RISE_TARGET_Y, 0);

  // Dispose placeholder created by EnemyBase
  if (enemy.mesh) { try { enemy.mesh.dispose(); } catch(_) {} }

  try {
    const root = await loadEnemyModel(scene, 'drone', {
      position:  _savedPos,
      shadowGen: shadowGenerator,
      overrides: overrides ?? {},
    });
    enemy.mesh   = root;
    enemy._rotors = findPieces(root, 'drone_rotor');
  } catch (e) {
    console.warn('[drones] GLTF load failed, using procedural fallback:', e);
    _buildDroneMeshProc(enemy, _savedPos);
  }
}

function _buildDroneMeshProc(enemy, savedPos) {
  const root = new BABYLON.TransformNode('droneRoot', scene);
  root.position.copyFrom(savedPos);
  enemy.mesh = root;

  const body = BABYLON.MeshBuilder.CreateBox('droneBody', { width:0.8, height:0.25, depth:0.8 }, scene);
  body.parent = root;
  const mat = new BABYLON.StandardMaterial('droneMat', scene);
  mat.diffuseColor  = new BABYLON.Color3(0.9, 0.15, 0.1);
  mat.emissiveColor = new BABYLON.Color3(0.3, 0.0, 0.0);
  body.material = mat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(body);

  enemy._rotors = [];
  for (const off of [{x:0.5,z:0.5},{x:-0.5,z:0.5},{x:0.5,z:-0.5},{x:-0.5,z:-0.5}]) {
    const rotor = BABYLON.MeshBuilder.CreateCylinder('rotor',
      { diameter:0.4, height:0.05, tessellation:6 }, scene);
    rotor.parent = root;
    rotor.position.set(off.x, 0.05, off.z);
    const rmat = new BABYLON.StandardMaterial('rotorMat', scene);
    rmat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    rotor.material = rmat;
    enemy._rotors.push(rotor);
  }
}

function _setupDroneWaypoints(enemy, flightWaypoints) {
  if (!flightWaypoints || flightWaypoints.length === 0) {
    enemy._waypoints = [
      {x:20,y:RISE_TARGET_Y,z:0},{x:0,y:RISE_TARGET_Y,z:20},
      {x:-20,y:RISE_TARGET_Y,z:0},{x:0,y:RISE_TARGET_Y,z:-20}
    ];
  } else {
    const shuffled = [...flightWaypoints].sort(() => Math.random()-0.5);
    enemy._waypoints = shuffled.slice(0, Math.min(8, shuffled.length));
  }
  enemy._waypointIndex = 0;
}

export function tickDrones(dt) {
  for (const e of getEnemies()) {
    if (e.type !== 'drone' || e.dead) continue;
    _tickDrone(e, dt);
  }
}

function _tickDrone(enemy, dt) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return;

  if (enemy._rotors?.length) {
    for (const r of enemy._rotors) r.rotation.y += dt * 15;
  }

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({x:px, y:py, z:pz});
  let targetX = px, targetY = py, targetZ = pz;

  switch (enemy.state) {
    case 'rising': {
      targetY = RISE_TARGET_Y;
      if (Math.abs(py - RISE_TARGET_Y) < 1.0) enemy.state = 'patrol';
      break;
    }
    case 'patrol':
    case 'skyPatrol': {
      if (dPlayer < DETECT_RANGE) { enemy.state = 'hunting'; break; }
      const wp = enemy._waypoints?.[enemy._waypointIndex];
      if (wp) {
        const dx = wp.x - px, dz = wp.z - pz;
        if (Math.sqrt(dx*dx+dz*dz) < 3) {
          enemy._waypointIndex = (enemy._waypointIndex + 1) % enemy._waypoints.length;
        } else {
          targetX = wp.x;
          targetY = Math.max(wp.y ?? RISE_TARGET_Y, getTerrainHeightAt(wp.x, wp.z) + 5.0);
          targetZ = wp.z;
        }
      }
      break;
    }
    case 'hunting': {
      if (dPlayer > DETECT_RANGE * 1.5) { enemy.state = 'patrol'; break; }
      targetX = playerPos.x; targetY = playerPos.y + 6; targetZ = playerPos.z;
      break;
    }
    case 'investigating': {
      if (dPlayer < 6) enemy.state = 'patrol';
      break;
    }
  }

  const TERRAIN_CLEARANCE = 6.0;
  const _floorCurrent = getTerrainHeightAt(px, pz);
  const _floorTarget  = getTerrainHeightAt(targetX, targetZ);
  const _minY = Math.max(_floorCurrent, _floorTarget) + TERRAIN_CLEARANCE;
  if (targetY < _minY) targetY = _minY;

  const _wy = getWaterY();
  const _waterFloor = (_wy !== null) ? _wy + 2.0 : -Infinity;
  if (targetY < _waterFloor) targetY = _waterFloor;

  const _hardFloor = Math.max(_floorCurrent + TERRAIN_CLEARANCE, _waterFloor);
  if (py < _hardFloor) {
    const snapSafe = safeVec3(px, _hardFloor, pz, 'drone floor snap');
    if (snapSafe) {
      enemy.body.setNextKinematicTranslation(snapSafe);
      if (enemy.mesh) enemy.mesh.position.set(snapSafe.x, snapSafe.y, snapSafe.z);
    }
    return;
  }

  const spd = enemy.state === 'hunting' ? HUNT_SPEED : PATROL_SPEED;
  const dx = targetX - px, dy = targetY - py, dz = targetZ - pz;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if (len > 0.5) {
    const nx = dx/len, ny = dy/len, nz = dz/len;
    const safe = safeVec3(px + nx*spd*dt, py + ny*spd*dt, pz + nz*spd*dt, 'drone tick');
    if (safe) {
      enemy.body.setNextKinematicTranslation(safe);
      if (enemy.mesh) enemy.mesh.position.set(safe.x, safe.y, safe.z);
    }
  }
}
