// enemies/submarines.js — underwater submarine enemy
// Stays fully submerged or at water surface only. Never goes on land.
// States:
//   submerged  — prowls underwater, avoids seabed, counts down to periscope
//   periscope  — rises to waterline, scans slowly for player
//   surfaced   — player spotted, orbits at water surface
//   sinking    — hit, rolls and descends, then respawns

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 }               from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies }              from './enemyRegistry.js';
import { getWaypoints }            from '../flatnav.js';
import { getTerrainHeightAt }      from '../terrain/terrainMesh.js';
import { getWaterY }               from '../water.js';

const SUBMERGED_DEPTH = 5.5;
const PERISCOPE_DEPTH = 0.6;
const SURFACED_HEIGHT = 0.4;
const TERRAIN_FLOOR   = 1.5;
const PATROL_SPEED    = 3;
const SURFACE_SPEED   = 6;
const SCAN_INTERVAL   = 7.0;
const SCAN_DURATION   = 5.0;
const DETECT_RANGE    = 38;
const ORBIT_RADIUS    = 20;
const PROBE_DIST      = 8;
const STEER_ANGLE     = 0.7;

// ── Water-constrained steering (same algorithm as boats.js) ───────────────────

function _isWater(x, z, wY) {
  return getTerrainHeightAt(x, z) < wY - 0.5;
}

function _waterSteer(px, pz, dx, dz, wY) {
  const len = Math.sqrt(dx*dx + dz*dz);
  if (len < 0.01) return { nx:0, nz:0 };
  let nx = dx/len, nz = dz/len;
  if (_isWater(px + nx*PROBE_DIST, pz + nz*PROBE_DIST, wY)) return { nx, nz };
  for (let a = STEER_ANGLE; a <= Math.PI; a += STEER_ANGLE) {
    const c = Math.cos(a), s = Math.sin(a);
    const lx = nx*c - nz*s, lz = nx*s + nz*c;
    if (_isWater(px + lx*PROBE_DIST, pz + lz*PROBE_DIST, wY)) return { nx:lx, nz:lz };
    const rx = nx*c + nz*s, rz = -nx*s + nz*c;
    if (_isWater(px + rx*PROBE_DIST, pz + rz*PROBE_DIST, wY)) return { nx:rx, nz:rz };
  }
  return { nx:0, nz:0 };
}

/** Nearest water-edge position toward a target — sub won't try to go on land */
function _shorelineTarget(px, pz, tx, tz, wY) {
  const dx = tx-px, dz = tz-pz;
  const dist = Math.sqrt(dx*dx+dz*dz);
  if (dist < 1) return { x:px, z:pz };
  const steps = Math.min(40, Math.ceil(dist/3));
  let lwx = px, lwz = pz;
  for (let i = 1; i <= steps; i++) {
    const f = i/steps;
    const sx = px+dx*f, sz = pz+dz*f;
    if (_isWater(sx, sz, wY)) { lwx=sx; lwz=sz; } else break;
  }
  return { x:lwx, z:lwz };
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

export function spawnSubmarines(def) {
  const waterY = getWaterY();
  if (waterY === null) { console.warn('[submarines] No water — skipping'); return []; }

  const count = def.maxCount || 2;
  const wps   = getWaypoints('ground');
  const spawned = [];

  for (let i = 0; i < count; i++) {
    const wp = wps[i % Math.max(1, wps.length)];
    let spawnX = wp ? wp.x : (Math.random()-0.5)*100;
    let spawnZ = wp ? wp.z : (Math.random()-0.5)*100;
    for (let a = 0; a < 20 && !_isWater(spawnX, spawnZ, waterY); a++) {
      spawnX *= 0.75; spawnZ *= 0.75;
    }

    const enemy = new EnemyBase({
      scene,
      type:        'submarine',
      speed:       PATROL_SPEED,
      health:      def.health ?? 120,
      spawnPos:    new BABYLON.Vector3(spawnX, waterY - SUBMERGED_DEPTH, spawnZ),
      noVehicle:   true,
      respawnTime: 15,
    });
    enemy.state           = 'submerged';
    enemy._scanTimer      = SCAN_INTERVAL * (0.3 + Math.random()*0.7);
    enemy._scanElapsed    = 0;
    enemy._waypointIndex  = i % Math.max(1, wps.length);
    enemy._sinkY          = 0;
    enemy._periscopeAngle = 0;
    _buildSubMesh(enemy);
    spawned.push(enemy);
  }
  return spawned;
}

// ── Mesh ──────────────────────────────────────────────────────────────────────

function _buildSubMesh(enemy) {
  if (enemy.mesh) enemy.mesh.dispose();
  const root = new BABYLON.TransformNode('subRoot', scene);
  enemy.mesh = root;

  const hull = BABYLON.MeshBuilder.CreateCylinder('subHull',
    { diameter:1.4, height:6.0, tessellation:12 }, scene);
  hull.parent = root; hull.rotation.x = Math.PI/2;
  const hullMat = new BABYLON.StandardMaterial('subHullMat', scene);
  hullMat.diffuseColor  = new BABYLON.Color3(0.18, 0.22, 0.18);
  hullMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.02);
  hull.material = hullMat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(hull);

  const sail = BABYLON.MeshBuilder.CreateBox('subSail',
    { width:0.7, height:1.1, depth:1.8 }, scene);
  sail.parent = root; sail.position.set(0, 0.9, 0);
  const sailMat = new BABYLON.StandardMaterial('subSailMat', scene);
  sailMat.diffuseColor = new BABYLON.Color3(0.15, 0.19, 0.15);
  sail.material = sailMat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(sail);

  const scope = BABYLON.MeshBuilder.CreateCylinder('periscope',
    { diameter:0.12, height:2.2, tessellation:6 }, scene);
  scope.parent = sail; scope.position.set(0, 1.4, -0.2);
  const scopeMat = new BABYLON.StandardMaterial('scopeMat', scene);
  scopeMat.diffuseColor  = new BABYLON.Color3(0.4, 0.4, 0.35);
  scope.material = scopeMat;

  const eye = BABYLON.MeshBuilder.CreateSphere('scopeEye', { diameter:0.22, segments:4 }, scene);
  eye.parent = scope; eye.position.y = 1.1;
  const eyeMat = new BABYLON.StandardMaterial('eyeMat', scene);
  eyeMat.emissiveColor = new BABYLON.Color3(0.1, 0.9, 0.1);
  eye.material = eyeMat;

  for (const side of [-1, 1]) {
    const fin = BABYLON.MeshBuilder.CreateBox('fin',
      { width:1.2, height:0.1, depth:0.5 }, scene);
    fin.parent = hull; fin.position.set(side*1.3, 0, -1.5);
    const finMat = new BABYLON.StandardMaterial('finMat', scene);
    finMat.diffuseColor = new BABYLON.Color3(0.15, 0.18, 0.15);
    fin.material = finMat;
  }

  enemy._sailMesh  = sail;
  enemy._scopeMesh = scope;
  enemy._eyeMesh   = eye;
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export function tickSubmarines(dt) {
  const waterY = getWaterY();
  if (waterY === null) return;
  for (const e of getEnemies()) {
    if (e.type !== 'submarine' || e.dead) continue;
    _tickSub(e, dt, waterY);
  }
}

function _tickSub(enemy, dt, waterY) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  let px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)) return;

  const terrainH  = getTerrainHeightAt(px, pz);
  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({ x:px, y:py, z:pz });

  // ── Sinking ────────────────────────────────────────────────────────────────
  if (enemy.state === 'sinking') {
    enemy._sinkY = (enemy._sinkY||0) + 1.0 * dt;
    enemy.mesh.position.set(px, waterY - SUBMERGED_DEPTH - enemy._sinkY, pz);
    enemy.mesh.rotation.z += 1.0 * dt * 0.5;
    if (enemy._sinkY > 12) {
      enemy.dead = true;
      enemy.mesh.setEnabled(false);
      setTimeout(() => {
        if (enemy.destroyed || window._levelComplete) return;
        enemy._sinkY = 0;
        enemy.mesh.rotation.set(0, enemy.mesh.rotation.y, 0);
        enemy.mesh.setEnabled(true);
        enemy.health = enemy.maxHealth;
        enemy.dead   = false;
        enemy.state  = 'submerged';
        enemy._scanTimer = SCAN_INTERVAL;
      }, (enemy.respawnTime??15)*1000);
    }
    return;
  }

  let targetX = px, targetY = py, targetZ = pz;
  let moveXZ = true;
  let spd = PATROL_SPEED;

  switch (enemy.state) {

    case 'submerged': {
      // Clamp depth: between seabed+floor and waterY-depth
      const minY = Math.max(terrainH + TERRAIN_FLOOR, waterY - SUBMERGED_DEPTH - 3);
      targetY = Math.min(waterY - SUBMERGED_DEPTH, Math.max(minY, py));

      // Navigate toward next waypoint, constrained to water
      const wps = getWaypoints('ground');
      if (wps.length > 0) {
        const wp = wps[enemy._waypointIndex % wps.length];
        const shore = _shorelineTarget(px, pz, wp.x, wp.z, waterY);
        const dd = Math.sqrt((shore.x-px)**2 + (shore.z-pz)**2);
        if (dd < 6) enemy._waypointIndex = (enemy._waypointIndex+1) % wps.length;
        targetX = shore.x; targetZ = shore.z;
      }

      enemy._scanTimer -= dt;
      if (enemy._scanTimer <= 0) {
        enemy.state = 'periscope'; enemy._scanElapsed = 0;
      }
      break;
    }

    case 'periscope': {
      // Rise to periscope depth, hold XZ
      targetY = waterY - PERISCOPE_DEPTH;
      targetX = px; targetZ = pz;
      moveXZ  = false;

      // Slow scan rotation
      enemy._periscopeAngle = (enemy._periscopeAngle||0) + dt * 0.55;
      enemy.mesh.rotation.y = enemy._periscopeAngle;

      enemy._scanElapsed += dt;

      // Detect player: horizontal range check (periscope can't see through terrain)
      const hDist = Math.sqrt((px-playerPos.x)**2 + (pz-playerPos.z)**2);
      if (hDist < DETECT_RANGE && playerPos.y > waterY - 3) {
        // Player is visible (above or near water)
        enemy.state = 'surfaced';
        break;
      }
      if (enemy._scanElapsed >= SCAN_DURATION) {
        enemy.state      = 'submerged';
        enemy._scanTimer = SCAN_INTERVAL * (0.8 + Math.random()*0.6);
      }
      break;
    }

    case 'surfaced': {
      targetY = waterY + SURFACED_HEIGHT;
      spd     = SURFACE_SPEED;

      // Orbit the nearest shoreline point toward player (stays in water)
      const shore = _shorelineTarget(px, pz, playerPos.x, playerPos.z, waterY);
      const orbitAngle = Math.atan2(px - shore.x, pz - shore.z) + dt * 0.38;
      targetX = shore.x + Math.sin(orbitAngle) * ORBIT_RADIUS;
      targetZ = shore.z + Math.cos(orbitAngle) * ORBIT_RADIUS;

      // Face player
      const faceAng = Math.atan2(playerPos.x - px, playerPos.z - pz);
      enemy.mesh.rotation.y += (faceAng - enemy.mesh.rotation.y) * 0.06;

      if (dPlayer > DETECT_RANGE * 1.8) {
        enemy.state = 'submerged'; enemy._scanTimer = SCAN_INTERVAL * 0.5;
      }
      break;
    }
  }

  // Terrain floor safety
  const floorMin = terrainH + TERRAIN_FLOOR;
  if (targetY < floorMin) targetY = floorMin;

  // ── Move ──────────────────────────────────────────────────────────────────
  const dy  = targetY - py;
  let   fnx = 0, fnz = 0;

  if (moveXZ) {
    const rdx = targetX - px, rdz = targetZ - pz;
    const steered = _waterSteer(px, pz, rdx, rdz, waterY);
    fnx = steered.nx; fnz = steered.nz;
  }

  const hSpd = spd * dt;
  const vSpd = Math.min(Math.abs(dy), 3*dt) * Math.sign(dy);
  const safe = safeVec3(px + fnx*hSpd, py + vSpd, pz + fnz*hSpd, 'sub tick');
  if (safe) {
    enemy.body.setNextKinematicTranslation(safe);
    // TransformNode must be synced manually
    if (enemy.mesh) enemy.mesh.position.set(safe.x, safe.y, safe.z);
  }

  // Periscope eye glow
  if (enemy._eyeMesh) {
    const scan = enemy.state === 'periscope' || enemy.state === 'surfaced';
    const p = scan ? (0.5 + 0.5*Math.sin(Date.now()*0.008)) : 0.1;
    enemy._eyeMesh.material.emissiveColor.set(0.05, p, 0.05);
  }
}