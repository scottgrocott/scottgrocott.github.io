// enemies/forklifts.js — forklift enemy
// Drives BACKWARDS — forks lead, steers from rear axle (front swings wide)

import { scene, shadowGenerator } from '../core.js';
import { physicsWorld, safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';

const PATROL_SPEED  = 2.5;
const CHASE_SPEED   = 4;
const RAM_SPEED     = 7;
const DETECT_RANGE  = 30;
const RAM_RANGE     = 6;

// Wheel corners — forklift is wider/squatter than car
// Note: z-axis is flipped vs car because the forklift drives with +z as its BACK
const WHEEL_OFFSETS = [
  { x:  0.75, z:  0.85 },  // rear-right  (steering axle)
  { x: -0.75, z:  0.85 },  // rear-left
  { x:  0.75, z: -0.85 },  // front-right (under counterweight)
  { x: -0.75, z: -0.85 },  // front-left
];

const RIDE_HEIGHT   = 0.65;
const SPRING_RATE   = 12.0;
const TILT_RATE     = 5.0;    // slower tilt — heavier vehicle
const GRAVITY       = -22.0;
const AIR_THRESHOLD = 0.7;
const BOUNCE_FACTOR = 0.10;   // heavier — less bounce
const TUMBLE_SPEED  = 8.0;
const FLIP_ANGLE    = 0.62;
const FLIP_DELAY    = 1.2;

// Rear-wheel steering lag — the chassis heading trails the travel direction
// simulating the back-end steering feel of a forklift
const HEADING_LAG   = 3.5;   // lower = more lag (vs car's 8.0)

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
    enemy._velY          = 0;
    enemy._airborne      = false;
    enemy._flipTimer     = 0;
    enemy._forkY         = 0.3;
    enemy._forkRaising   = false;

    _buildForkliftMesh(enemy);
    spawned.push(enemy);
  }
  return spawned;
}

function _buildForkliftMesh(enemy) {
  if (enemy.mesh) enemy.mesh.dispose();
  const root = new BABYLON.TransformNode('flRoot', scene);
  enemy.mesh = root;

  // Main body
  const body = BABYLON.MeshBuilder.CreateBox('flBody', { width:1.4, height:1.2, depth:2.0 }, scene);
  body.parent = root;
  body.position.set(0, 0.7, 0);
  const mat = new BABYLON.StandardMaterial('flMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.95, 0.75, 0.05);
  body.material = mat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(body);

  // Counterweight at the BACK (+z in local space, which is the direction of travel)
  const cw = BABYLON.MeshBuilder.CreateBox('flCW', { width:1.3, height:0.9, depth:0.4 }, scene);
  cw.parent = root;
  cw.position.set(0, 0.55, -0.85);
  const cwMat = new BABYLON.StandardMaterial('cwMat', scene);
  cwMat.diffuseColor = new BABYLON.Color3(0.3, 0.28, 0.25);
  cw.material = cwMat;

  // Overhead guard
  const guard = BABYLON.MeshBuilder.CreateBox('flGuard', { width:1.3, height:0.06, depth:1.8 }, scene);
  guard.parent = root;
  guard.position.set(0, 1.55, 0);
  const guardMat = new BABYLON.StandardMaterial('guardMat', scene);
  guardMat.diffuseColor = new BABYLON.Color3(0.6, 0.55, 0.1);
  guard.material = guardMat;

  // Mast at the FRONT (-z, forks lead)
  const mast = BABYLON.MeshBuilder.CreateBox('flMast', { width:0.1, height:1.8, depth:0.1 }, scene);
  mast.parent = root;
  mast.position.set(0.35, 0.9, 1.05);
  const mastMat = new BABYLON.StandardMaterial('mastMat', scene);
  mastMat.diffuseColor = new BABYLON.Color3(0.4, 0.38, 0.35);
  mast.material = mastMat;

  const mast2 = mast.clone('flMast2');
  mast2.parent = root;
  mast2.position.set(-0.35, 0.9, 1.05);

  // Fork carriage (moves up/down)
  enemy._forkNode = new BABYLON.TransformNode('forkNode', scene);
  enemy._forkNode.parent = root;
  enemy._forkNode.position.set(0, 0.3, 1.05);

  for (const off of [{ x: 0.28 }, { x: -0.28 }]) {
    const fork = BABYLON.MeshBuilder.CreateBox('fork', { width:0.1, height:0.07, depth:1.1 }, scene);
    fork.parent = enemy._forkNode;
    fork.position.set(off.x, 0, 0.55);
    const fmat = new BABYLON.StandardMaterial('forkMat', scene);
    fmat.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    fork.material = fmat;
  }

  // Wheels — small solid cylinders
  enemy._wheels = [];
  for (const off of WHEEL_OFFSETS) {
    const wheel = BABYLON.MeshBuilder.CreateCylinder('flWheel',
      { diameter:0.5, height:0.22, tessellation:10 }, scene);
    wheel.parent = root;
    wheel.position.set(off.x, 0.05, off.z);
    wheel.rotation.z = Math.PI / 2;
    const wmat = new BABYLON.StandardMaterial('flWheelMat', scene);
    wmat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.12);
    wheel.material = wmat;
    enemy._wheels.push(wheel);
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
  if (!enemy.body || !enemy.mesh) return;
  const t = enemy.body.translation();
  let px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return;

  // ── Flip detection ────────────────────────────────────────────────────────
  const ax = Math.abs(enemy.mesh.rotation.x);
  const az = Math.abs(enemy.mesh.rotation.z);
  if (ax > Math.PI * FLIP_ANGLE || az > Math.PI * FLIP_ANGLE) {
    enemy._flipTimer += dt;
    if (enemy._flipTimer >= FLIP_DELAY) { _destroyForklift(enemy); return; }
  } else {
    enemy._flipTimer = 0;
  }

  // ── AI state machine ──────────────────────────────────────────────────────
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
      enemy._forkRaising = true;
      break;
    }
  }

  // ── Fork raise/lower ──────────────────────────────────────────────────────
  if (enemy._forkNode) {
    if (enemy._forkRaising) {
      enemy._forkY = Math.min(enemy._forkY + dt * 1.5, 1.8);
    } else {
      enemy._forkY = Math.max(enemy._forkY - dt * 0.8, 0.3);
    }
    enemy._forkNode.position.y = enemy._forkY;
    if (enemy.state !== 'ram') enemy._forkRaising = false;
  }

  // ── Horizontal movement ───────────────────────────────────────────────────
  const dx = targetX - px, dz = targetZ - pz;
  const dist = Math.sqrt(dx*dx + dz*dz);
  let nx = 0, nz = 0, moving = false;
  if (dist > 0.5) {
    nx = dx/dist; nz = dz/dist;
    px += nx * spd * dt;
    pz += nz * spd * dt;
    moving = true;
  }

  // ── Terrain height at wheel corners ──────────────────────────────────────
  const heading = enemy.mesh.rotation.y;
  const cosH = Math.cos(heading), sinH = Math.sin(heading);

  const wh = WHEEL_OFFSETS.map(off => {
    const wx = px + off.x * cosH - off.z * sinH;
    const wz = pz + off.x * sinH + off.z * cosH;
    return getTerrainHeightAt(wx, wz);
  });

  const groundAvg = (wh[0] + wh[1] + wh[2] + wh[3]) * 0.25;

  // ── Airborne / grounded ───────────────────────────────────────────────────
  const gap = (py - RIDE_HEIGHT) - groundAvg;

  if (enemy._airborne || gap > AIR_THRESHOLD) {
    enemy._airborne = true;
    enemy._velY += GRAVITY * dt;
    py += enemy._velY * dt;

    if (py <= groundAvg + RIDE_HEIGHT + 0.05) {
      const impact = Math.abs(enemy._velY);
      py = groundAvg + RIDE_HEIGHT;
      enemy._airborne = false;
      enemy._velY = impact > 3 ? impact * BOUNCE_FACTOR : 0;
      if (impact > TUMBLE_SPEED) {
        enemy.mesh.rotation.x += (Math.random() - 0.5) * 0.9;
        enemy.mesh.rotation.z += (Math.random() - 0.5) * 0.9;
      }
    }
  } else {
    enemy._velY = 0;
    const targetY = groundAvg + RIDE_HEIGHT;
    py += (targetY - py) * Math.min(1.0, SPRING_RATE * dt);

    // Pitch and roll from wheel heights
    const frontAvg = (wh[2] + wh[3]) * 0.5;   // front = -z side (forks)
    const rearAvg  = (wh[0] + wh[1]) * 0.5;   // rear  = +z side (counterweight)
    const targetPitch = Math.atan2(rearAvg - frontAvg, 1.7);

    const rightAvg = (wh[0] + wh[2]) * 0.5;
    const leftAvg  = (wh[1] + wh[3]) * 0.5;
    const targetRoll  = Math.atan2(rightAvg - leftAvg, 1.5);

    enemy.mesh.rotation.x += (targetPitch - enemy.mesh.rotation.x) * Math.min(1.0, TILT_RATE * dt);
    enemy.mesh.rotation.z += (targetRoll  - enemy.mesh.rotation.z) * Math.min(1.0, TILT_RATE * dt);

    if (enemy._wheels) {
      wh.forEach((h, i) => {
        const compress = Math.max(-0.15, Math.min(0.15, h - groundAvg));
        enemy._wheels[i].position.y = 0.05 + compress * 0.6;
      });
    }
  }

  // ── Write back position ───────────────────────────────────────────────────
  const safe = safeVec3(px, py, pz, 'forklift tick');
  if (!safe) return;
  enemy.body.setNextKinematicTranslation(safe);
  enemy.mesh.position.set(safe.x, safe.y, safe.z);

  // ── Heading: forks lead (+z local = travel direction), slow steering lag ──
  if (moving) {
    // Forks point toward target — chassis heading = travel direction + 180°
    const forksHeading = Math.atan2(nx, nz) + Math.PI;
    let dh = forksHeading - enemy.mesh.rotation.y;
    while (dh >  Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    enemy.mesh.rotation.y += dh * Math.min(1.0, HEADING_LAG * dt);
  }
}

function _destroyForklift(enemy) {
  enemy.dead = true;
  if (enemy.mesh) {
    enemy.mesh.getChildMeshes?.().forEach(m => {
      if (m.material) {
        m.material.diffuseColor  = new BABYLON.Color3(1, 0.4, 0);
        m.material.emissiveColor = new BABYLON.Color3(0.5, 0.1, 0);
      }
    });
    setTimeout(() => { try { enemy.mesh.dispose(); } catch(e) {} }, 350);
  }
  if (enemy.body && physicsWorld) {
    try { physicsWorld.removeRigidBody(enemy.body); } catch(e) {}
    enemy.body = null;
  }
  console.log('[forklift] Flipped — removed');
}