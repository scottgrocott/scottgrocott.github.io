// enemies/boats.js — buoyant boat enemy
// Stays in water at all times. When player is on land it patrols the
// nearest shoreline point rather than chasing over terrain.
// States: patrol → beach (hover near shore when player close) → sinking (when hit)

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 }               from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies }              from './enemyRegistry.js';
import { getWaypoints }            from '../flatnav.js';
import { getTerrainHeightAt }      from '../terrain/terrainMesh.js';
import { getWaterY }               from '../water.js';

const PATROL_SPEED  = 4;
const BEACH_SPEED   = 1.5;
const DETECT_RANGE  = 50;
const BEACH_RANGE   = 20;
const SINK_SPEED    = 1.2;
const SINK_ROLL     = 1.4;
const PROBE_DIST    = 6;     // how far ahead to probe for land
const STEER_ANGLE   = 0.8;   // radians to deflect when land detected

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True if world position (x,z) is underwater (terrain below water surface) */
function _isWater(x, z, wY) {
  return getTerrainHeightAt(x, z) < wY - 0.5;
}

/**
 * Given a desired move direction (dx,dz) from (px,pz), find a deflected
 * direction that keeps the vessel in water.  Returns {nx,nz} unit vector.
 */
function _waterSteer(px, pz, dx, dz, wY) {
  const len = Math.sqrt(dx*dx + dz*dz);
  if (len < 0.01) return { nx: 0, nz: 0 };
  let nx = dx/len, nz = dz/len;

  // Probe straight ahead
  const aheadX = px + nx * PROBE_DIST;
  const aheadZ = pz + nz * PROBE_DIST;
  if (_isWater(aheadX, aheadZ, wY)) return { nx, nz };  // clear — no deflection

  // Try deflecting left and right, increasing angle until a clear path found
  for (let a = STEER_ANGLE; a <= Math.PI; a += STEER_ANGLE) {
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const lx = nx*cosA - nz*sinA, lz = nx*sinA + nz*cosA;
    if (_isWater(px + lx*PROBE_DIST, pz + lz*PROBE_DIST, wY)) return { nx:lx, nz:lz };
    const rx = nx*cosA + nz*sinA, rz = -nx*sinA + nz*cosA;
    if (_isWater(px + rx*PROBE_DIST, pz + rz*PROBE_DIST, wY)) return { nx:rx, nz:rz };
  }
  return { nx: 0, nz: 0 };  // completely surrounded — hold position
}

/**
 * Find the nearest water-edge point toward a target.
 * Steps along the line from (px,pz) toward (tx,tz) and returns the last
 * water cell before hitting land — so the boat patrols the shoreline
 * closest to the player rather than driving onto the beach.
 */
function _shorelineTarget(px, pz, tx, tz, wY) {
  const dx = tx - px, dz = tz - pz;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist < 1) return { x: px, z: pz };
  const steps = Math.min(40, Math.ceil(dist / 3));
  let lastWaterX = px, lastWaterZ = pz;
  for (let i = 1; i <= steps; i++) {
    const t  = i / steps;
    const sx = px + dx * t, sz = pz + dz * t;
    if (_isWater(sx, sz, wY)) {
      lastWaterX = sx; lastWaterZ = sz;
    } else {
      break;  // hit land — stop here
    }
  }
  return { x: lastWaterX, z: lastWaterZ };
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

export function spawnBoats(def) {
  const waterY = getWaterY();
  if (waterY === null) { console.warn('[boats] No water — skipping'); return []; }

  const count = def.maxCount || 2;
  const waypoints = getWaypoints('ground');
  const spawned = [];

  for (let i = 0; i < count; i++) {
    const wp = waypoints[i % Math.max(1, waypoints.length)];
    // Find a spawn that is actually in water
    let spawnX = wp ? wp.x : (Math.random()-0.5)*120;
    let spawnZ = wp ? wp.z : (Math.random()-0.5)*120;
    // Nudge spawn toward centre if on land
    for (let attempt = 0; attempt < 20 && !_isWater(spawnX, spawnZ, waterY); attempt++) {
      spawnX *= 0.8; spawnZ *= 0.8;
    }

    const enemy = new EnemyBase({
      scene,
      type:        'boat',
      speed:       PATROL_SPEED,
      health:      def.health ?? 80,
      spawnPos:    new BABYLON.Vector3(spawnX, waterY + 0.3, spawnZ),
      noVehicle:   true,
      respawnTime: 12,
    });
    enemy.state          = 'patrol';
    enemy._waypointIndex = i % Math.max(1, waypoints.length);
    enemy._sinkY         = 0;
    enemy._bobPhase      = Math.random() * Math.PI * 2;
    _buildBoatMesh(enemy);
    spawned.push(enemy);
  }
  return spawned;
}

// ── Mesh ──────────────────────────────────────────────────────────────────────

function _buildBoatMesh(enemy) {
  if (enemy.mesh) enemy.mesh.dispose();
  const root = new BABYLON.TransformNode('boatRoot', scene);
  enemy.mesh = root;

  const hull = BABYLON.MeshBuilder.CreateBox('boatHull', { width:2.2, height:0.5, depth:4.5 }, scene);
  hull.parent = root;
  const hullMat = new BABYLON.StandardMaterial('boatHullMat', scene);
  hullMat.diffuseColor = new BABYLON.Color3(0.25, 0.22, 0.18);
  hull.material = hullMat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(hull);

  const cabin = BABYLON.MeshBuilder.CreateBox('boatCabin', { width:1.4, height:0.8, depth:1.6 }, scene);
  cabin.parent = root; cabin.position.set(0, 0.65, 0.5);
  const cabinMat = new BABYLON.StandardMaterial('boatCabinMat', scene);
  cabinMat.diffuseColor = new BABYLON.Color3(0.5, 0.45, 0.35);
  cabin.material = cabinMat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(cabin);

  const turret = BABYLON.MeshBuilder.CreateCylinder('boatTurret',
    { diameter:0.7, height:0.4, tessellation:8 }, scene);
  turret.parent = root; turret.position.set(0, 1.1, 0.5);
  const turretMat = new BABYLON.StandardMaterial('turretMat', scene);
  turretMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
  turret.material = turretMat;

  const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel',
    { diameter:0.12, height:1.4, tessellation:6 }, scene);
  barrel.parent = turret; barrel.rotation.x = Math.PI/2;
  barrel.position.set(0, 0.1, 0.7); barrel.material = turretMat;

  enemy._turretMesh = turret;
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export function tickBoats(dt) {
  const waterY = getWaterY();
  for (const e of getEnemies()) {
    if (e.type !== 'boat' || e.dead) continue;
    _tickBoat(e, dt, waterY);
  }
}

function _tickBoat(enemy, dt, waterY) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  let px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)) return;

  const wY = waterY ?? py;

  // ── Sinking ────────────────────────────────────────────────────────────────
  if (enemy.state === 'sinking') {
    enemy._sinkY = (enemy._sinkY || 0) + SINK_SPEED * dt;
    enemy.mesh.position.set(px, wY - enemy._sinkY, pz);
    enemy.mesh.rotation.z += SINK_ROLL * dt;
    enemy.mesh.rotation.x += SINK_ROLL * 0.4 * dt;
    if (enemy._sinkY > 8) {
      enemy.dead = true;
      enemy.mesh.setEnabled(false);
      setTimeout(() => {
        if (enemy.destroyed || window._levelComplete) return;
        enemy._sinkY = 0;
        enemy.mesh.rotation.set(0, 0, 0);
        enemy.mesh.setEnabled(true);
        enemy.health = enemy.maxHealth;
        enemy.dead   = false;
        enemy.state  = 'patrol';
      }, (enemy.respawnTime ?? 12) * 1000);
    }
    return;
  }

  // ── Float height — stay at water surface, rise over submerged terrain ──────
  const terrainH = getTerrainHeightAt(px, pz);
  // Always float at water surface — Y is always wY+0.3, period.
  // Terrain clearance is irrelevant: _waterSteer prevents land cells entirely.
  const floatY = wY + 0.3;
  enemy._bobPhase = (enemy._bobPhase || 0) + dt * 1.2;
  const bobY = floatY + Math.sin(enemy._bobPhase) * 0.05;

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({ x:px, y:py, z:pz });

  let targetX = px, targetZ = pz;
  let spd = PATROL_SPEED;

  switch (enemy.state) {
    case 'patrol': {
      if (dPlayer < DETECT_RANGE) { enemy.state = 'beach'; break; }
      const wps = getWaypoints('ground');
      if (wps.length > 0) {
        const wp = wps[enemy._waypointIndex % wps.length];
        const shore = _shorelineTarget(px, pz, wp.x, wp.z, wY);
        const dd = Math.sqrt((shore.x-px)**2 + (shore.z-pz)**2);
        if (dd < 5) enemy._waypointIndex = (enemy._waypointIndex+1) % wps.length;
        targetX = shore.x; targetZ = shore.z;
      }
      break;
    }
    case 'beach': {
      if (dPlayer > DETECT_RANGE * 1.6) { enemy.state = 'patrol'; break; }
      // Target = shoreline point closest to player (boat stays in water)
      const shore = _shorelineTarget(px, pz, playerPos.x, playerPos.z, wY);
      targetX = shore.x; targetZ = shore.z;
      spd = dPlayer < BEACH_RANGE ? BEACH_SPEED : PATROL_SPEED;
      // Aim turret toward actual player
      if (enemy._turretMesh) {
        const ang = Math.atan2(playerPos.x - px, playerPos.z - pz);
        enemy._turretMesh.rotation.y += (ang - enemy._turretMesh.rotation.y) * 0.05;
      }
      break;
    }
  }

  // ── Water-constrained movement ────────────────────────────────────────────
  const rdx = targetX - px, rdz = targetZ - pz;
  const { nx, nz } = _waterSteer(px, pz, rdx, rdz, wY);

  const newX = px + nx * spd * dt;
  const newZ = pz + nz * spd * dt;
  const safe = safeVec3(newX, bobY, newZ, 'boat tick');
  if (!safe) return;

  enemy.body.setNextKinematicTranslation(safe);
  // TransformNode mesh must be synced manually — it doesn't follow the physics proxy
  if (enemy.mesh) enemy.mesh.position.set(safe.x, safe.y, safe.z);

  if (Math.abs(nx) + Math.abs(nz) > 0.01) {
    const heading = Math.atan2(nx, nz);
    enemy.mesh.rotation.y += (heading - enemy.mesh.rotation.y) * 0.08;
  }
}

// ── Damage — routes through EnemyBase.takeDamage so levelComplete works ───────
// Call this from basicGun instead of hitEnemy for boats so sinking plays
export function onBoatHit(enemy) {
  if (enemy.state === 'sinking' || enemy.dead) return;
  enemy.state  = 'sinking';
  enemy._sinkY = 0;
  // Also mark dead immediately so levelManager allDown check works
  // (sinking timeout will handle the actual mesh hide + respawn)
  enemy.health = 0;
}