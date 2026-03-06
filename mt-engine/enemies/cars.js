// enemies/cars.js — ground car enemy with terrain-riding suspension and cliff physics

import { scene, shadowGenerator } from '../core.js';
import { physicsWorld, safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';

const PATROL_SPEED  = 5;
const CHASE_SPEED   = 9;
const RAM_SPEED     = 14;
const DETECT_RANGE  = 38;
const RAM_RANGE     = 5;

// Wheel corner offsets — local space, matching mesh proportions
const WHEEL_OFFSETS = [
  { x:  0.9, z:  1.0 },  // front-right
  { x: -0.9, z:  1.0 },  // front-left
  { x:  0.9, z: -1.0 },  // rear-right
  { x: -0.9, z: -1.0 },  // rear-left
];

const RIDE_HEIGHT   = 0.5;    // chassis centre above ground
const SPRING_RATE   = 14.0;   // how fast chassis snaps to terrain height
const TILT_RATE     = 7.0;    // how fast chassis tilts to match slope
const GRAVITY       = -22.0;  // m/s² when airborne
const AIR_THRESHOLD = 0.7;    // gap between chassis floor and ground to go airborne
const BOUNCE_FACTOR = 0.18;   // energy retained on landing
const TUMBLE_SPEED  = 10.0;   // impact speed (m/s) that causes random tumble rotation
const FLIP_ANGLE    = 0.62;   // fraction of PI — car deleted if |pitch| or |roll| exceed this * PI
const FLIP_DELAY    = 1.0;    // seconds flipped before deletion

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
    enemy._wheelSpin     = 0;
    enemy._velY          = 0;      // vertical velocity when airborne
    enemy._airborne      = false;
    enemy._flipTimer     = 0;

    _buildCarMesh(enemy);
    spawned.push(enemy);
  }
  return spawned;
}

function _buildCarMesh(enemy) {
  if (enemy.mesh) enemy.mesh.dispose();
  const root = new BABYLON.TransformNode('carRoot', scene);
  enemy.mesh = root;

  const body = BABYLON.MeshBuilder.CreateBox('carBody', { width:1.6, height:0.5, depth:2.4 }, scene);
  body.parent = root;
  body.position.set(0, 0.35, 0);
  const mat = new BABYLON.StandardMaterial('carMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.9);
  body.material = mat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(body);

  // Cab on top
  const cab = BABYLON.MeshBuilder.CreateBox('carCab', { width:1.3, height:0.42, depth:1.1 }, scene);
  cab.parent = root;
  cab.position.set(0, 0.72, -0.1);
  const cabMat = new BABYLON.StandardMaterial('cabMat', scene);
  cabMat.diffuseColor = new BABYLON.Color3(0.08, 0.22, 0.7);
  cab.material = cabMat;

  enemy._wheels = [];
  for (const off of WHEEL_OFFSETS) {
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
  if (!enemy.body || !enemy.mesh) return;
  const t = enemy.body.translation();
  let px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return;

  // ── Flip / upside-down detection ──────────────────────────────────────────
  const ax = Math.abs(enemy.mesh.rotation.x);
  const az = Math.abs(enemy.mesh.rotation.z);
  if (ax > Math.PI * FLIP_ANGLE || az > Math.PI * FLIP_ANGLE) {
    enemy._flipTimer += dt;
    if (enemy._flipTimer >= FLIP_DELAY) { _destroyCar(enemy); return; }
  } else {
    enemy._flipTimer = 0;
  }

  // ── AI state machine ───────────────────────────────────────────────────────
  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({x:px, y:py, z:pz});
  let targetX = px, targetZ = pz;
  let spd = PATROL_SPEED;

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

  // ── Horizontal movement ────────────────────────────────────────────────────
  const dx = targetX - px, dz = targetZ - pz;
  const dist = Math.sqrt(dx*dx + dz*dz);
  let nx = 0, nz = 0, moving = false;
  if (dist > 0.5) {
    nx = dx/dist; nz = dz/dist;
    px += nx * spd * dt;
    pz += nz * spd * dt;
    moving = true;
  }

  // ── Sample terrain height at each wheel corner ─────────────────────────────
  // Rotate offsets by car heading so samples stay under the actual wheel positions
  const heading = enemy.mesh.rotation.y;
  const cosH = Math.cos(heading), sinH = Math.sin(heading);

  const wh = WHEEL_OFFSETS.map(off => {
    const wx = px + off.x * cosH - off.z * sinH;
    const wz = pz + off.x * sinH + off.z * cosH;
    return getTerrainHeightAt(wx, wz);
  });

  const groundAvg = (wh[0] + wh[1] + wh[2] + wh[3]) * 0.25;

  // ── Airborne / grounded physics ────────────────────────────────────────────
  const chassisFloor = py - RIDE_HEIGHT;
  const gap = chassisFloor - groundAvg;

  if (enemy._airborne || gap > AIR_THRESHOLD) {
    // — Falling arc —
    enemy._airborne = true;
    enemy._velY += GRAVITY * dt;
    py += enemy._velY * dt;

    // Landing check
    if (py <= groundAvg + RIDE_HEIGHT + 0.05) {
      const impact = Math.abs(enemy._velY);
      py = groundAvg + RIDE_HEIGHT;
      enemy._airborne = false;
      enemy._velY = impact > 3 ? impact * BOUNCE_FACTOR : 0;

      // Hard landing: random tumble rotation
      if (impact > TUMBLE_SPEED) {
        enemy.mesh.rotation.x += (Math.random() - 0.5) * 1.1;
        enemy.mesh.rotation.z += (Math.random() - 0.5) * 1.1;
      }
    }
  } else {
    // — Grounded: spring height + slope tilt —
    enemy._velY = 0;
    const targetY = groundAvg + RIDE_HEIGHT;
    py += (targetY - py) * Math.min(1.0, SPRING_RATE * dt);

    // Pitch from front-rear height difference
    const frontAvg = (wh[0] + wh[1]) * 0.5;
    const rearAvg  = (wh[2] + wh[3]) * 0.5;
    const targetPitch = Math.atan2(frontAvg - rearAvg, 2.0);

    // Roll from right-left height difference
    const rightAvg = (wh[0] + wh[2]) * 0.5;
    const leftAvg  = (wh[1] + wh[3]) * 0.5;
    const targetRoll  = Math.atan2(rightAvg - leftAvg, 1.8);

    enemy.mesh.rotation.x += (targetPitch - enemy.mesh.rotation.x) * Math.min(1.0, TILT_RATE * dt);
    enemy.mesh.rotation.z += (targetRoll  - enemy.mesh.rotation.z) * Math.min(1.0, TILT_RATE * dt);

    // Per-wheel visual bob
    if (enemy._wheels) {
      wh.forEach((h, i) => {
        const compress = Math.max(-0.15, Math.min(0.15, h - groundAvg));
        enemy._wheels[i].position.y = 0.05 + compress * 0.6;
      });
    }
  }

  // ── Write back ─────────────────────────────────────────────────────────────
  const safe = safeVec3(px, py, pz, 'car tick');
  if (!safe) return;
  enemy.body.setNextKinematicTranslation(safe);
  enemy.mesh.position.set(safe.x, safe.y, safe.z);

  // Smooth heading rotation
  if (moving) {
    const targetH = Math.atan2(nx, nz);
    let dh = targetH - enemy.mesh.rotation.y;
    while (dh >  Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    enemy.mesh.rotation.y += dh * Math.min(1.0, 8.0 * dt);
  }

  // Wheel spin
  enemy._wheelSpin += spd * dt * 2.5;
  if (enemy._wheels) for (const w of enemy._wheels) w.rotation.x = enemy._wheelSpin;
}

function _destroyCar(enemy) {
  enemy.dead = true;
  if (enemy.mesh) {
    enemy.mesh.getChildMeshes?.().forEach(m => {
      if (m.material) {
        m.material.diffuseColor  = new BABYLON.Color3(1, 0.15, 0);
        m.material.emissiveColor = new BABYLON.Color3(0.6, 0.05, 0);
      }
    });
    setTimeout(() => { try { enemy.mesh.dispose(); } catch(e) {} }, 350);
  }
  if (enemy.body && physicsWorld) {
    try { physicsWorld.removeRigidBody(enemy.body); } catch(e) {}
    enemy.body = null;
  }
  console.log('[car] Flipped — removed');
}