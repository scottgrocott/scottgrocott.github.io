// enemies/drones.js — aerial drone enemy

import { scene, shadowGenerator } from '../core.js';
import { physicsWorld, safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';

const FLIGHT_ABOVE_TERRAIN = 18;
const PATROL_SPEED = 5;
const HUNT_SPEED   = 9;
const DETECT_RANGE = 45;

export function spawnDrones(def) {
  const count = def.maxCount || 3;
  const flightWaypoints = getWaypoints('flight');
  const spawned = [];
  for (let i = 0; i < count; i++) {
    const wp = flightWaypoints[i % Math.max(1, flightWaypoints.length)];
    const groundY = wp ? getTerrainHeightAt(wp.x, wp.z) : 0;
    const spawnPos = wp
      ? new BABYLON.Vector3(wp.x, groundY + FLIGHT_ABOVE_TERRAIN, wp.z)
      : new BABYLON.Vector3((Math.random()-0.5)*60, FLIGHT_ABOVE_TERRAIN, (Math.random()-0.5)*60);

    const enemy = new EnemyBase({
      scene, rapierWorld: physicsWorld,
      type: 'drone', speed: PATROL_SPEED, health: def.health ?? 60, spawnPos,
    });

    enemy.state = 'patrol';
    _buildDroneMesh(enemy);
    _setupDroneWaypoints(enemy, flightWaypoints);
    spawned.push(enemy);
  }
  return spawned;
}

function _buildDroneMesh(enemy) {
  if (enemy.mesh) enemy.mesh.dispose();
  const root = new BABYLON.TransformNode('droneRoot', scene);
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
  enemy._waypointIndex = 0;
}

function _setupDroneWaypoints(enemy, flightWaypoints) {
  if (!flightWaypoints || flightWaypoints.length === 0) {
    enemy._waypoints = [20,0,-20].flatMap(x => [0,20,-20].map(z => ({
      x, y: getTerrainHeightAt(x, z) + FLIGHT_ABOVE_TERRAIN, z
    })));
  } else {
    const shuffled = [...flightWaypoints].sort(() => Math.random()-0.5);
    enemy._waypoints = shuffled.slice(0, Math.min(8, shuffled.length)).map(wp => ({
      x: wp.x, y: getTerrainHeightAt(wp.x, wp.z) + FLIGHT_ABOVE_TERRAIN, z: wp.z,
    }));
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

  if (enemy._rotors) for (const r of enemy._rotors) r.rotation.y += dt * 15;

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({x:px, y:py, z:pz});
  const cruiseY   = getTerrainHeightAt(px, pz) + FLIGHT_ABOVE_TERRAIN;

  let targetX = px, targetY = cruiseY, targetZ = pz;

  switch (enemy.state) {
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
          targetY = getTerrainHeightAt(wp.x, wp.z) + FLIGHT_ABOVE_TERRAIN;
          targetZ = wp.z;
        }
      }
      break;
    }
    case 'hunting': {
      if (dPlayer > DETECT_RANGE * 1.5) { enemy.state = 'patrol'; break; }
      targetX = playerPos.x;
      targetY = Math.max(playerPos.y + 6, cruiseY);
      targetZ = playerPos.z;
      break;
    }
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