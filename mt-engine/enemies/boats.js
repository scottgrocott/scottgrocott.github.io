// enemies/boats.js — surface boat enemy
//
// FSM states:
//   patrol   → circles water waypoints at cruise speed
//   chase    → turns toward player, full throttle
//   attack   → within fire range, circling and firing torpedoes
//   sinking  → hit enough times, tilts and sinks below waterY, then respawns
//
// onBoatHit(enemy) is exported for basicGun.js hit detection.
// Torpedoes are visual-only particle trails that damage the player on proximity.

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies, registerEnemy } from './enemyRegistry.js';
import { getHeightAt } from '../terrain/heightmap.js';
import { getWaterY } from '../water.js';
import { CONFIG } from '../config.js';
import { loadEnemyModel, findPieces } from './enemyModels.js';

// ── Defaults ──────────────────────────────────────────────────────────────────
const D = {
  PATROL_SPEED:  4,
  CHASE_SPEED:   8,
  DETECT_RANGE:  60,
  FIRE_RANGE:    35,
  FIRE_COOLDOWN: 3.5,   // seconds between torpedo shots
  HEALTH:        120,
  RESPAWN_TIME:  14,
  SINK_DURATION: 4.0,   // seconds to fully sink
  CIRCLE_RADIUS: 18,    // radius of attack circle around player
};

const TORPEDO_SPEED   = 22;
const TORPEDO_LIFE    = 4.0;
const TORPEDO_RADIUS  = 3.5;  // damage radius
const TORPEDO_DAMAGE  = 25;

const _torpedoes = [];

// ── Spawn ─────────────────────────────────────────────────────────────────────
export function spawnBoats(def) {
  // getWaterY() reads from water.js internal state; fall back to CONFIG if not yet set
  let waterY = getWaterY();
  if (waterY === null) waterY = CONFIG.water?.enabled ? (CONFIG.water?.mesh?.position?.y ?? null) : null;
  console.log(`[boats] spawnBoats called — waterY=${waterY} enabled=${def.enabled} maxCount=${def.maxCount}`);
  if (waterY === null) {
    console.warn('[boats] No water in scene — skipping boat spawn');
    return [];
  }

  const count = def.maxCount || 2;
  const waypoints = _waterWaypoints(waterY);
  const spawned = [];

  for (let i = 0; i < count; i++) {
    const wp = waypoints[i % waypoints.length];
    const spawnPos = new BABYLON.Vector3(wp.x, waterY, wp.z);

    const enemy = new EnemyBase({
      scene,
      type: 'boat',
      speed: D.PATROL_SPEED,
      health: def.health ?? D.HEALTH,
      spawnPos,
      noVehicle: true,
    });

    enemy.state          = 'patrol';
    enemy._waypointIndex = i % waypoints.length;
    enemy._waypoints     = waypoints;
    enemy._fireCooldown  = D.FIRE_COOLDOWN * Math.random(); // stagger first shots
    enemy._sinkTimer     = 0;
    enemy._sinkStartY    = waterY;
    enemy._heading       = Math.random() * Math.PI * 2;
    enemy._circleAngle   = Math.random() * Math.PI * 2;
    enemy._cfg = {
      patrolSpeed:  def.patrolSpeed  ?? D.PATROL_SPEED,
      chaseSpeed:   def.chaseSpeed   ?? D.CHASE_SPEED,
      detectRange:  def.detectRange  ?? D.DETECT_RANGE,
      fireRange:    def.fireRange    ?? D.FIRE_RANGE,
      fireCooldown: def.fireCooldown ?? D.FIRE_COOLDOWN,
      respawnTime:  def.respawnTime  ?? D.RESPAWN_TIME,
    };

    _buildBoatMesh(enemy, spawnPos, def.overrides);
    spawned.push(enemy);
  }
  return spawned;
}

// ── GLTF mesh builder ─────────────────────────────────────────────────────────
async function _buildBoatMesh(enemy, spawnPos, overrides) {
  const savedPos = spawnPos?.clone() ?? new BABYLON.Vector3(0, 0, 0);

  const placeholder = enemy.mesh;
  if (placeholder) {
    placeholder.setEnabled(false);
    placeholder.position.copyFrom(savedPos);
  }

  // Try GLTF first; fall back to procedural immediately on any failure
  let gltfOk = false;
  try {
    const root = await loadEnemyModel(scene, 'boat', {
      position:  savedPos,
      shadowGen: shadowGenerator,
      overrides: overrides ?? {},
    });
    enemy.mesh    = root;
    enemy._turret = findPieces(root, 'boat_turret')[0] ?? null;
    enemy._barrel = findPieces(root, 'boat_barrel')[0] ?? null;
    if (placeholder) try { placeholder.dispose(); } catch(_) {}
    gltfOk = true;
    console.log(`[boats] mesh ready (GLTF) at`, savedPos.toString());
  } catch (e) {
    // GLTF unavailable — procedural fallback
  }

  if (!gltfOk) {
    if (placeholder) try { placeholder.dispose(); } catch(_) {}
    _buildBoatMeshProc(enemy, savedPos);
    console.log(`[boats] mesh ready (procedural) at`, savedPos.toString());
  }
}

function _buildBoatMeshProc(enemy, savedPos) {
  if (enemy.mesh) { try { enemy.mesh.dispose(); } catch(_) {} }
  const root = new BABYLON.TransformNode('boatRoot', scene);
  root.position.copyFrom(savedPos);
  enemy.mesh = root;

  // Hull
  const hull = BABYLON.MeshBuilder.CreateBox('boatHull', { width:3.8, height:0.6, depth:1.4 }, scene);
  hull.parent = root;
  const hmat = new BABYLON.StandardMaterial('boatHullMat', scene);
  hmat.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.28);
  hull.material = hmat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(hull);

  // Cabin
  const cabin = BABYLON.MeshBuilder.CreateBox('boatCabin', { width:1.2, height:0.8, depth:1.0 }, scene);
  cabin.parent = root;
  cabin.position.set(0, 0.6, -0.3);
  const cmat = new BABYLON.StandardMaterial('boatCabinMat', scene);
  cmat.diffuseColor = new BABYLON.Color3(0.25, 0.28, 0.22);
  cabin.material = cmat;

  // Gun turret
  const turret = BABYLON.MeshBuilder.CreateCylinder('boatTurret',
    { diameter:0.45, height:0.35, tessellation:8 }, scene);
  turret.parent = root;
  turret.position.set(0, 0.65, -0.6);
  const tmat = new BABYLON.StandardMaterial('boatTurretMat', scene);
  tmat.diffuseColor = new BABYLON.Color3(0.30, 0.32, 0.25);
  turret.material = tmat;
  enemy._turret = turret;

  // Barrel
  const barrel = BABYLON.MeshBuilder.CreateCylinder('boatBarrel',
    { diameter:0.08, height:0.90, tessellation:6 }, scene);
  barrel.parent = root;
  barrel.position.set(0, 0.88, -0.55);
  barrel.rotation.x = Math.PI / 2;
  const bmat = new BABYLON.StandardMaterial('boatBarrelMat', scene);
  bmat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.18);
  barrel.material = bmat;
  enemy._barrel = barrel;
}

// ── Tick ──────────────────────────────────────────────────────────────────────
export function tickBoats(dt) {
  let waterY = getWaterY();
  if (waterY === null) waterY = CONFIG.water?.mesh?.position?.y ?? null;
  if (waterY === null) return;
  for (const e of getEnemies()) {
    if (e.type !== 'boat' || e.dead) continue;
    _tickBoat(e, dt, waterY ?? 0);
  }
  _tickTorpedoes(dt);
}

function _tickBoat(enemy, dt, waterY) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  const px = +t.x, pz = +t.z;
  if (isNaN(px)||isNaN(pz)) return;

  const playerPos  = getPlayerPos();
  const dPlayer    = distToPlayer({x:px, y:waterY, z:pz});
  const cfg        = enemy._cfg;

  // ── State machine ──────────────────────────────────────────────────────────
  switch (enemy.state) {

    case 'patrol': {
      if (dPlayer < cfg.detectRange) { enemy.state = 'chase'; break; }
      const wp = enemy._waypoints[enemy._waypointIndex];
      const dx = wp.x - px, dz = wp.z - pz;
      if (Math.sqrt(dx*dx+dz*dz) < 5) {
        enemy._waypointIndex = (enemy._waypointIndex + 1) % enemy._waypoints.length;
      } else {
        _steerToward(enemy, wp.x, wp.z, cfg.patrolSpeed, dt, waterY);
      }
      break;
    }

    case 'chase': {
      if (dPlayer > cfg.detectRange * 1.5) { enemy.state = 'patrol'; break; }
      if (dPlayer < cfg.fireRange)          { enemy.state = 'attack'; break; }
      _steerToward(enemy, playerPos.x, playerPos.z, cfg.chaseSpeed, dt, waterY);
      break;
    }

    case 'attack': {
      if (dPlayer > cfg.fireRange * 1.6) { enemy.state = 'chase'; break; }
      // Circle the player
      enemy._circleAngle += dt * 0.6;
      const tx = playerPos.x + Math.cos(enemy._circleAngle) * D.CIRCLE_RADIUS;
      const tz = playerPos.z + Math.sin(enemy._circleAngle) * D.CIRCLE_RADIUS;
      _steerToward(enemy, tx, tz, cfg.chaseSpeed * 0.75, dt, waterY);

      // Turret tracks player
      if (enemy._turret) {
        const ang = Math.atan2(playerPos.x - px, playerPos.z - pz);
        enemy._turret.rotation.y = ang - (enemy.mesh?.rotation?.y ?? 0);
      }

      // Fire torpedo
      enemy._fireCooldown -= dt;
      if (enemy._fireCooldown <= 0) {
        _fireTorpedo(enemy, playerPos, waterY);
        enemy._fireCooldown = cfg.fireCooldown;
      }
      break;
    }

    case 'sinking': {
      enemy._sinkTimer += dt;
      const frac = Math.min(enemy._sinkTimer / D.SINK_DURATION, 1.0);
      const sinkY = waterY - frac * 4.0;
      const tiltZ = frac * 0.8; // list sideways as it sinks
      if (enemy.mesh) {
        enemy.mesh.position.y = sinkY;
        enemy.mesh.rotation.z = tiltZ;
      }
      if (frac >= 1.0) {
        enemy.dead = true;
        if (enemy.mesh) enemy.mesh.setEnabled(false);
        setTimeout(() => _respawnBoat(enemy, waterY), cfg.respawnTime * 1000);
      }
      return; // skip normal physics push while sinking
    }
  }

  // Keep boat locked to water surface
  if (enemy.mesh) {
    enemy.mesh.position.y  = waterY;
    enemy.mesh.rotation.z  = 0;
  }

  // Gentle bobbing
  const bob = Math.sin(Date.now() * 0.001 + px * 0.1) * 0.06;
  if (enemy.mesh) enemy.mesh.position.y = waterY + bob;
}

function _steerToward(enemy, tx, tz, speed, dt, waterY) {
  const t = enemy.body.translation();
  const px = +t.x, pz = +t.z;
  const dx = tx - px, dz = tz - pz;
  const len = Math.sqrt(dx*dx+dz*dz);
  if (len < 0.5) return;

  const nx = dx/len, nz = dz/len;
  const targetAngle = Math.atan2(nx, nz);

  // Smooth heading toward target
  let diff = targetAngle - enemy._heading;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  enemy._heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.2);

  // Terrain avoidance — probe ahead and deflect if land detected
  const PROBE = speed * dt * 6;  // look 6 frames ahead
  const probeX = px + Math.sin(enemy._heading) * PROBE;
  const probeZ = pz + Math.cos(enemy._heading) * PROBE;
  if (getHeightAt(probeX, probeZ) >= waterY) {
    // Land ahead — turn away. Try left then right, pick whichever has more water
    const leftH  = getHeightAt(px + Math.sin(enemy._heading - 0.8) * PROBE,
                                pz + Math.cos(enemy._heading - 0.8) * PROBE);
    const rightH = getHeightAt(px + Math.sin(enemy._heading + 0.8) * PROBE,
                                pz + Math.cos(enemy._heading + 0.8) * PROBE);
    enemy._heading += (leftH < rightH) ? -dt * 3.5 : dt * 3.5;
  }

  const fwd = new BABYLON.Vector3(Math.sin(enemy._heading), 0, Math.cos(enemy._heading));
  const nx2 = px + fwd.x*speed*dt;
  const nz2 = pz + fwd.z*speed*dt;

  // Final safety check — only move if destination is actually water
  if (getHeightAt(nx2, nz2) >= waterY) return;

  const safe = safeVec3(nx2, waterY, nz2, 'boat tick');
  if (safe) {
    enemy.body.setNextKinematicTranslation(safe);
    if (enemy.mesh) {
      enemy.mesh.position.set(safe.x, enemy.mesh.position.y, safe.z);
      enemy.mesh.rotation.y = enemy._heading;
    }
  }
}

// ── Torpedo ───────────────────────────────────────────────────────────────────
function _fireTorpedo(enemy, playerPos, waterY) {
  const ep = enemy.mesh?.position;
  if (!ep) return;

  const dx = playerPos.x - ep.x, dz = playerPos.z - ep.z;
  const len = Math.sqrt(dx*dx+dz*dz) || 1;

  // Torpedo mesh — thin cylinder
  const torp = BABYLON.MeshBuilder.CreateCylinder('torpedo',
    { diameter:0.22, height:1.2, tessellation:6 }, scene);
  torp.position.set(ep.x, waterY, ep.z);
  torp.rotation.x = Math.PI / 2;
  const tmat = new BABYLON.StandardMaterial('torpMat', scene);
  tmat.diffuseColor  = new BABYLON.Color3(0.6, 0.5, 0.1);
  tmat.emissiveColor = new BABYLON.Color3(0.3, 0.25, 0.0);
  torp.material = tmat;

  // Wake particle trail
  const wake = new BABYLON.ParticleSystem('torpWake', 40, scene);
  wake.emitter       = torp;
  wake.minSize       = 0.3; wake.maxSize = 0.8;
  wake.minLifeTime   = 0.5; wake.maxLifeTime = 1.0;
  wake.emitRate      = 30;
  wake.color1        = new BABYLON.Color4(0.8,0.9,1.0,0.7);
  wake.color2        = new BABYLON.Color4(0.6,0.8,1.0,0.0);
  wake.minEmitBox    = new BABYLON.Vector3(-0.1,0,-0.6);
  wake.maxEmitBox    = new BABYLON.Vector3( 0.1,0,-0.6);
  wake.direction1    = new BABYLON.Vector3(-0.3,0.3,-0.1);
  wake.direction2    = new BABYLON.Vector3( 0.3,0.5, 0.1);
  wake.updateSpeed   = 0.02;
  wake.start();

  _torpedoes.push({
    mesh: torp, wake,
    vx: (dx/len)*TORPEDO_SPEED,
    vz: (dz/len)*TORPEDO_SPEED,
    waterY,
    life: TORPEDO_LIFE,
  });
}

function _tickTorpedoes(dt) {
  const playerPos = getPlayerPos();
  for (let i = _torpedoes.length - 1; i >= 0; i--) {
    const tp = _torpedoes[i];
    tp.life -= dt;
    tp.mesh.position.x += tp.vx * dt;
    tp.mesh.position.z += tp.vz * dt;
    tp.mesh.position.y  = tp.waterY;
    tp.mesh.rotation.y  = Math.atan2(tp.vx, tp.vz);

    // Player proximity damage
    const dx = tp.mesh.position.x - playerPos.x;
    const dz = tp.mesh.position.z - playerPos.z;
    if (Math.sqrt(dx*dx+dz*dz) < TORPEDO_RADIUS) {
      window._playerTakeDamage?.(TORPEDO_DAMAGE);
      _killTorpedo(tp);
      _torpedoes.splice(i, 1);
      continue;
    }

    if (tp.life <= 0) {
      _killTorpedo(tp);
      _torpedoes.splice(i, 1);
    }
  }
}

function _killTorpedo(tp) {
  try { tp.wake.stop(); tp.wake.dispose(); } catch(_) {}
  try { tp.mesh.dispose(); } catch(_) {}
  // Small splash explosion
  _splash(tp.mesh?.position ?? BABYLON.Vector3.Zero());
}

function _splash(pos) {
  const ps = new BABYLON.ParticleSystem('splash', 60, scene);
  ps.emitter       = pos.clone ? pos.clone() : new BABYLON.Vector3(pos.x, pos.y, pos.z);
  ps.minSize       = 0.4; ps.maxSize = 1.2;
  ps.minLifeTime   = 0.4; ps.maxLifeTime = 1.2;
  ps.emitRate      = 200;
  ps.manualEmitCount = 60;
  ps.color1        = new BABYLON.Color4(0.7,0.9,1.0,0.9);
  ps.color2        = new BABYLON.Color4(0.5,0.7,0.9,0.0);
  ps.direction1    = new BABYLON.Vector3(-4,6,-4);
  ps.direction2    = new BABYLON.Vector3( 4,12,4);
  ps.gravity       = new BABYLON.Vector3(0,-18,0);
  ps.updateSpeed   = 0.02;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch(_) {} }, 2000);
}

// ── Hit / respawn ─────────────────────────────────────────────────────────────
export function onBoatHit(enemy) {
  if (enemy.dead || enemy.state === 'sinking') return;
  enemy.health = (enemy.health ?? D.HEALTH) - 20;
  // Flash hull red
  if (enemy.mesh) {
    const meshes = enemy.mesh.getChildMeshes ? enemy.mesh.getChildMeshes(false) : [];
    for (const m of meshes) {
      const orig = m.material?.diffuseColor?.clone();
      if (m.material) m.material.emissiveColor = new BABYLON.Color3(0.8, 0.1, 0.0);
      setTimeout(() => { if (m.material && orig) m.material.emissiveColor = BABYLON.Color3.Black(); }, 120);
    }
  }
  if (enemy.health <= 0) {
    enemy.state = 'sinking';
    enemy._sinkTimer = 0;
    enemy._sinkStartY = getWaterY() ?? 0;
  }
}

function _respawnBoat(enemy, waterY) {
  if (waterY === null) waterY = CONFIG.water?.mesh?.position?.y ?? 0;
  const wps = _waterWaypoints(waterY);
  const wp  = wps[Math.floor(Math.random() * wps.length)];
  const spawnPos = new BABYLON.Vector3(wp.x, waterY, wp.z);

  enemy.dead         = false;
  enemy.state        = 'patrol';
  enemy._sinkTimer   = 0;
  enemy._fireCooldown = enemy._cfg.fireCooldown * Math.random();
  enemy.health       = enemy._cfg.health ?? D.HEALTH;

  _buildBoatMesh(enemy, spawnPos, null).then(() => {
    if (enemy.mesh) enemy.mesh.setEnabled(true);
  });
  if (enemy.body) enemy.body.setNextKinematicTranslation({ x:wp.x, y:waterY, z:wp.z });
}

// ── Water waypoint helpers ────────────────────────────────────────────────────
function _waterWaypoints(waterY) {
  // Sample a grid and keep only positions where terrain is below waterY
  const candidates = [];
  const step = 40, half = 280;
  for (let x = -half; x <= half; x += step) {
    for (let z = -half; z <= half; z += step) {
      if (getHeightAt(x, z) < waterY - 0.5) {
        candidates.push({ x, y: waterY, z });
      }
    }
  }
  if (candidates.length >= 4) {
    candidates.sort(() => Math.random() - 0.5);
    return candidates.slice(0, 8);
  }
  // Fallback: small centre ring
  const r = 60, n = 6;
  return Array.from({length:n}, (_,i) => ({
    x: Math.cos(2*Math.PI*i/n) * r,
    y: waterY,
    z: Math.sin(2*Math.PI*i/n) * r,
  }));
}
