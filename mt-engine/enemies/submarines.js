// enemies/submarines.js — submarine enemy
//
// FSM states:
//   submerged  → invisible below waterY, patrolling toward player area
//   surfacing  → rising from subDepth to waterY over ~2s, periscope appears first
//   firing     → on surface, fires torpedo burst, lingers briefly
//   diving     → sinks back below waterY
//   sinking    → destroyed, falls to seabed, then respawns
//
// Visibility rules:
//   submerged → mesh hidden (or translucent if player is underwater)
//   periscope only visible during surfacing (periscopeOnly = true)
//   fully visible once surfaced
//
// Torpedoes share the same _torpedoes pool and _fireTorpedo logic imported
// from boats — but we keep submarines self-contained with their own impl
// so the two files can be deployed independently.

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';

import { getHeightAt } from '../terrain/heightmap.js';
import { getWaterY } from '../water.js';
import { CONFIG } from '../config.js';
import { loadEnemyModel, findPieces } from './enemyModels.js';

// ── Defaults ──────────────────────────────────────────────────────────────────
const D = {
  PATROL_SPEED:    5,
  SURFACE_SPEED:   2,
  SUB_DEPTH:       8,      // metres below waterY while submerged
  SURFACE_TIME:    2.2,    // seconds to rise to surface
  DIVE_TIME:       1.8,    // seconds to submerge
  LINGER_TIME:     3.0,    // seconds on surface after firing
  DETECT_RANGE:    70,     // range at which sub detects player and surfaces
  FIRE_RANGE:      50,
  TORPEDO_COUNT:   3,      // torpedoes per burst
  TORPEDO_INTERVAL:0.5,    // seconds between burst torpedoes
  FIRE_COOLDOWN:   6,      // seconds between bursts
  HEALTH:          150,
  RESPAWN_TIME:    18,
};

const TORP_SPEED  = 20;
const TORP_LIFE   = 5.0;
const TORP_RADIUS = 3.5;
const TORP_DAMAGE = 30;

const _torpedoes = [];

// ── Spawn ─────────────────────────────────────────────────────────────────────
export function spawnSubmarines(def) {
  let waterY = getWaterY();
  if (waterY === null) waterY = CONFIG.water?.enabled ? (CONFIG.water?.mesh?.position?.y ?? null) : null;
  console.log(`[submarines] spawnSubmarines called — waterY=${waterY} enabled=${def.enabled} maxCount=${def.maxCount}`);
  if (waterY === null) {
    console.warn('[submarines] No water in scene — skipping submarine spawn');
    return [];
  }

  const count = def.maxCount || 1;
  const waypoints = _waterWaypoints(waterY);
  const spawned = [];

  for (let i = 0; i < count; i++) {
    const wp = waypoints[i % waypoints.length];
    const subY = waterY - (def.subDepth ?? D.SUB_DEPTH);
    const spawnPos = new BABYLON.Vector3(wp.x, subY, wp.z);

    const enemy = new EnemyBase({
      scene,
      type: 'submarine',
      speed: D.PATROL_SPEED,
      health: def.health ?? D.HEALTH,
      spawnPos,
      noVehicle: true,
    });

    enemy.state           = 'submerged';
    enemy._waypointIndex  = i % waypoints.length;
    enemy._waypoints      = waypoints;
    enemy._heading        = Math.random() * Math.PI * 2;
    enemy._stateTimer     = 0;
    enemy._fireBurstLeft  = 0;
    enemy._fireBurstTimer = 0;
    enemy._fireCooldown   = D.FIRE_COOLDOWN * Math.random();
    enemy._subY           = subY;
    enemy._cfg = {
      patrolSpeed:    def.patrolSpeed    ?? D.PATROL_SPEED,
      detectRange:    def.detectRange    ?? D.DETECT_RANGE,
      fireRange:      def.fireRange      ?? D.FIRE_RANGE,
      fireCooldown:   def.fireCooldown   ?? D.FIRE_COOLDOWN,
      torpedoCount:   def.torpedoCount   ?? D.TORPEDO_COUNT,
      torpedoInterval:def.torpedoInterval?? D.TORPEDO_INTERVAL,
      subDepth:       def.subDepth       ?? D.SUB_DEPTH,
      respawnTime:    def.respawnTime    ?? D.RESPAWN_TIME,
      lingerTime:     def.lingerTime     ?? D.LINGER_TIME,
    };

    _buildSubMesh(enemy, spawnPos, def.overrides);
    spawned.push(enemy);
  }
  return spawned;
}

// ── GLTF mesh builder ─────────────────────────────────────────────────────────
async function _buildSubMesh(enemy, spawnPos, overrides) {
  const savedPos = spawnPos?.clone() ?? new BABYLON.Vector3(0, 0, 0);

  const placeholder = enemy.mesh;
  if (placeholder) {
    placeholder.setEnabled(false);
    placeholder.position.copyFrom(savedPos);
  }

  let gltfOk = false;
  try {
    const root = await loadEnemyModel(scene, 'submarine', {
      position:  savedPos,
      shadowGen: shadowGenerator,
      overrides: overrides ?? {},
    });
    enemy.mesh       = root;
    enemy._periscope = findPieces(root, 'sub_periscope')[0] ?? null;
    enemy._tower     = findPieces(root, 'sub_tower')[0]     ?? null;
    // Submarines start hidden — they surface during FSM
    root.setEnabled(false);
    if (placeholder) try { placeholder.dispose(); } catch(_) {}
    gltfOk = true;
    console.log(`[submarines] mesh ready (GLTF) at`, savedPos.toString());
  } catch (e) {
    // GLTF unavailable
  }

  if (!gltfOk) {
    if (placeholder) try { placeholder.dispose(); } catch(_) {}
    _buildSubMeshProc(enemy, savedPos);
    // Submarines start hidden
    if (enemy.mesh) enemy.mesh.setEnabled(false);
    console.log(`[submarines] mesh ready (procedural) at`, savedPos.toString());
  }
}

function _buildSubMeshProc(enemy, savedPos) {
  if (enemy.mesh) { try { enemy.mesh.dispose(); } catch(_) {} }
  const root = new BABYLON.TransformNode('subRoot', scene);
  root.position.copyFrom(savedPos);
  enemy.mesh = root;

  const SCOL = new BABYLON.Color3(0.12, 0.18, 0.22);

  // Main tube (hull approximation)
  const hull = BABYLON.MeshBuilder.CreateCylinder('subHull',
    { diameter:1.7, height:5.5, tessellation:10 }, scene);
  hull.parent = root;
  hull.rotation.x = Math.PI / 2;
  const hmat = new BABYLON.StandardMaterial('subHullMat', scene);
  hmat.diffuseColor = SCOL;
  hull.material = hmat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(hull);

  // Conning tower
  const tower = BABYLON.MeshBuilder.CreateBox('subTower',
    { width:0.7, height:1.4, depth:1.0 }, scene);
  tower.parent = root;
  tower.position.set(0, 0.85, -0.5);
  const tmat = new BABYLON.StandardMaterial('subTowerMat', scene);
  tmat.diffuseColor = new BABYLON.Color3(0.14, 0.20, 0.25);
  tower.material = tmat;
  enemy._tower = tower;

  // Periscope
  const scope = BABYLON.MeshBuilder.CreateCylinder('subPeriscope',
    { diameter:0.10, height:1.8, tessellation:5 }, scene);
  scope.parent = root;
  scope.position.set(0, 1.8, -0.4);
  const smat = new BABYLON.StandardMaterial('subScopeMat', scene);
  smat.diffuseColor = new BABYLON.Color3(0.20, 0.22, 0.20);
  scope.material = smat;
  enemy._periscope = scope;

  root.setEnabled(false);
}

// ── Tick ──────────────────────────────────────────────────────────────────────
export function tickSubmarines(dt) {
  let waterY = getWaterY();
  if (waterY === null) waterY = CONFIG.water?.mesh?.position?.y ?? null;
  if (waterY === null) return;
  for (const e of getEnemies()) {
    if (e.type !== 'submarine' || e.dead) continue;
    _tickSub(e, dt, waterY ?? 0);
  }
  _tickTorpedoes(dt);
}

function _tickSub(enemy, dt, waterY) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return;

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({x:px, y:waterY, z:pz}); // measure horiz distance
  const cfg       = enemy._cfg;
  const subY      = waterY - cfg.subDepth;

  enemy._stateTimer += dt;

  switch (enemy.state) {

    // ── Submerged: invisible, patrol toward player area ──────────────────────
    case 'submerged': {
      if (enemy.mesh) enemy.mesh.setEnabled(false);

      // Patrol toward player lazily when in range
      if (dPlayer < cfg.detectRange) {
        _steerToward(enemy, playerPos.x, playerPos.z, cfg.patrolSpeed, dt, subY);
      } else {
        // Patrol waypoints
        const wp = enemy._waypoints[enemy._waypointIndex];
        const dx = wp.x - px, dz = wp.z - pz;
        if (Math.sqrt(dx*dx+dz*dz) < 8) {
          enemy._waypointIndex = (enemy._waypointIndex+1) % enemy._waypoints.length;
        } else {
          _steerToward(enemy, wp.x, wp.z, cfg.patrolSpeed * 0.6, dt, subY);
        }
      }

      // Surface when close enough to fire
      if (dPlayer < cfg.fireRange) {
        enemy.state = 'surfacing';
        enemy._stateTimer = 0;
        enemy._surfaceStartY = subY;
      }
      break;
    }

    // ── Surfacing: rise from subY to waterY ──────────────────────────────────
    case 'surfacing': {
      const frac = Math.min(enemy._stateTimer / D.SURFACE_TIME, 1.0);
      const targetY = subY + (waterY - subY) * frac;

      // Show mesh as it breaks surface (halfway up)
      if (enemy.mesh) {
        if (frac >= 0.5 && !enemy.mesh.isEnabled()) enemy.mesh.setEnabled(true);
        enemy.mesh.position.set(px, targetY, pz);
      }

      const safe = safeVec3(px, targetY, pz, 'sub surfacing');
      if (safe) enemy.body.setNextKinematicTranslation(safe);

      if (frac >= 1.0) {
        if (enemy.mesh) enemy.mesh.setEnabled(true);
        enemy.state = 'firing';
        enemy._stateTimer    = 0;
        enemy._fireBurstLeft = cfg.torpedoCount;
        enemy._fireBurstTimer = 0;
        enemy._lingerTimer   = 0;
      }
      break;
    }

    // ── Firing: burst of torpedoes, then linger ───────────────────────────────
    case 'firing': {
      // Sync mesh to waterY surface
      const safe = safeVec3(px, waterY, pz, 'sub firing');
      if (safe) {
        enemy.body.setNextKinematicTranslation(safe);
        if (enemy.mesh) enemy.mesh.position.set(safe.x, waterY, safe.z);
      }

      // Face player
      const ang = Math.atan2(playerPos.x - px, playerPos.z - pz);
      enemy._heading = ang;
      if (enemy.mesh) enemy.mesh.rotation.y = ang;

      // Fire burst
      if (enemy._fireBurstLeft > 0) {
        enemy._fireBurstTimer -= dt;
        if (enemy._fireBurstTimer <= 0) {
          _fireTorpedo(enemy, playerPos, waterY);
          enemy._fireBurstLeft--;
          enemy._fireBurstTimer = cfg.torpedoInterval;
        }
      } else {
        // Burst done — linger then dive
        enemy._lingerTimer = (enemy._lingerTimer ?? 0) + dt;
        if (enemy._lingerTimer >= cfg.lingerTime) {
          enemy.state = 'diving';
          enemy._stateTimer = 0;
          enemy._diveStartY = waterY;
        }
      }
      break;
    }

    // ── Diving: sink back below waterY ───────────────────────────────────────
    case 'diving': {
      const frac = Math.min(enemy._stateTimer / D.DIVE_TIME, 1.0);
      const targetY = waterY - (waterY - subY) * frac;

      const safe = safeVec3(px, targetY, pz, 'sub diving');
      if (safe) {
        enemy.body.setNextKinematicTranslation(safe);
        if (enemy.mesh) enemy.mesh.position.set(safe.x, safe.y, safe.z);
      }

      if (frac >= 1.0) {
        if (enemy.mesh) enemy.mesh.setEnabled(false);
        enemy.state = 'submerged';
        enemy._stateTimer = 0;
        // Cooldown before next surface
        enemy._fireCooldown = cfg.fireCooldown;
        // Reposition toward player area while submerged
        _steerToward(enemy, playerPos.x, playerPos.z, cfg.patrolSpeed, 0, subY);
      }
      break;
    }

    // ── Sinking: destroyed, slowly falls ─────────────────────────────────────
    case 'sinking': {
      const sinkY = (enemy._sinkStartY ?? waterY) - enemy._stateTimer * 1.5;
      const safe = safeVec3(px, sinkY, pz, 'sub sinking');
      if (safe) {
        enemy.body.setNextKinematicTranslation(safe);
        if (enemy.mesh) {
          enemy.mesh.position.set(safe.x, safe.y, safe.z);
          enemy.mesh.rotation.z = Math.min(enemy._stateTimer * 0.5, 1.2);
        }
      }
      if (enemy._stateTimer > 6) {
        enemy.dead = true;
        if (enemy.mesh) enemy.mesh.setEnabled(false);
        setTimeout(() => _respawnSub(enemy, waterY), cfg.respawnTime * 1000);
      }
      break;
    }
  }
}

function _steerToward(enemy, tx, tz, speed, dt, targetY) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  const px = +t.x, pz = +t.z;
  const dx = tx - px, dz = tz - pz;
  const len = Math.sqrt(dx*dx+dz*dz);
  if (len < 0.5) return;

  const targetAngle = Math.atan2(dx/len, dz/len);
  let diff = targetAngle - enemy._heading;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  enemy._heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.5);

  if (dt === 0) {
    if (enemy.mesh) enemy.mesh.rotation.y = enemy._heading;
    return;
  }

  // Terrain avoidance — probe ahead, deflect toward deeper water if land detected
  const waterY = targetY + (enemy._cfg?.subDepth ?? 8); // approximate surface
  const PROBE = speed * dt * 6;
  const probeX = px + Math.sin(enemy._heading) * PROBE;
  const probeZ = pz + Math.cos(enemy._heading) * PROBE;
  if (getHeightAt(probeX, probeZ) >= waterY) {
    const leftH  = getHeightAt(px + Math.sin(enemy._heading - 0.8) * PROBE,
                                pz + Math.cos(enemy._heading - 0.8) * PROBE);
    const rightH = getHeightAt(px + Math.sin(enemy._heading + 0.8) * PROBE,
                                pz + Math.cos(enemy._heading + 0.8) * PROBE);
    enemy._heading += (leftH < rightH) ? -dt * 3.5 : dt * 3.5;
  }

  const nx2 = px + Math.sin(enemy._heading)*speed*dt;
  const nz2 = pz + Math.cos(enemy._heading)*speed*dt;
  if (getHeightAt(nx2, nz2) >= waterY) return;  // hard block

  const fwd = new BABYLON.Vector3(Math.sin(enemy._heading), 0, Math.cos(enemy._heading));
  const safe = safeVec3(nx2, targetY, nz2, 'sub steer');
  if (safe) {
    enemy.body.setNextKinematicTranslation(safe);
    if (enemy.mesh) {
      enemy.mesh.position.set(safe.x, safe.y, safe.z);
      enemy.mesh.rotation.y = enemy._heading;
    }
  }
}

// ── Torpedo ───────────────────────────────────────────────────────────────────
function _fireTorpedo(enemy, playerPos, waterY) {
  const ep = enemy.mesh?.position ?? enemy.body?.translation();
  if (!ep) return;

  const dx = playerPos.x - ep.x, dz = playerPos.z - ep.z;
  const len = Math.sqrt(dx*dx+dz*dz) || 1;

  const torp = BABYLON.MeshBuilder.CreateCylinder('subTorpedo',
    { diameter:0.22, height:1.2, tessellation:6 }, scene);
  torp.position.set(ep.x, waterY, ep.z);
  torp.rotation.x = Math.PI / 2;
  const tmat = new BABYLON.StandardMaterial('subTorpMat', scene);
  tmat.diffuseColor  = new BABYLON.Color3(0.5, 0.6, 0.15);
  tmat.emissiveColor = new BABYLON.Color3(0.25, 0.3, 0.0);
  torp.material = tmat;

  // Wake trail
  const wake = new BABYLON.ParticleSystem('subTorpWake', 40, scene);
  wake.emitter      = torp;
  wake.minSize      = 0.3; wake.maxSize = 0.9;
  wake.minLifeTime  = 0.4; wake.maxLifeTime = 1.0;
  wake.emitRate     = 35;
  wake.color1       = new BABYLON.Color4(0.7,0.9,1.0,0.6);
  wake.color2       = new BABYLON.Color4(0.5,0.7,0.9,0.0);
  wake.direction1   = new BABYLON.Vector3(-0.3,0.4,-0.2);
  wake.direction2   = new BABYLON.Vector3( 0.3,0.8, 0.2);
  wake.minEmitBox   = new BABYLON.Vector3(-0.1,0,-0.6);
  wake.maxEmitBox   = new BABYLON.Vector3( 0.1,0,-0.6);
  wake.updateSpeed  = 0.02;
  wake.start();

  _torpedoes.push({
    mesh: torp, wake,
    vx: (dx/len)*TORP_SPEED,
    vz: (dz/len)*TORP_SPEED,
    waterY,
    life: TORP_LIFE,
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

    const dx = tp.mesh.position.x - playerPos.x;
    const dz = tp.mesh.position.z - playerPos.z;
    if (Math.sqrt(dx*dx+dz*dz) < TORP_RADIUS) {
      window._playerTakeDamage?.(TORP_DAMAGE);
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
  const pos = tp.mesh?.position?.clone();
  try { tp.wake.stop(); tp.wake.dispose(); } catch(_) {}
  try { tp.mesh.dispose(); } catch(_) {}
  if (pos) _splash(pos);
}

function _splash(pos) {
  const ps = new BABYLON.ParticleSystem('subSplash', 60, scene);
  ps.emitter         = pos;
  ps.minSize         = 0.4; ps.maxSize = 1.4;
  ps.minLifeTime     = 0.4; ps.maxLifeTime = 1.4;
  ps.emitRate        = 200;
  ps.manualEmitCount = 60;
  ps.color1          = new BABYLON.Color4(0.7,0.9,1.0,0.9);
  ps.color2          = new BABYLON.Color4(0.5,0.7,0.9,0.0);
  ps.direction1      = new BABYLON.Vector3(-4,6,-4);
  ps.direction2      = new BABYLON.Vector3( 4,14, 4);
  ps.gravity         = new BABYLON.Vector3(0,-18,0);
  ps.updateSpeed     = 0.02;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch(_) {} }, 2500);
}

// ── Hit ───────────────────────────────────────────────────────────────────────
export function onSubmarineHit(enemy) {
  if (enemy.dead || enemy.state === 'sinking' || enemy.state === 'submerged') return;
  enemy.health = (enemy.health ?? D.HEALTH) - 25;
  // Flash
  if (enemy.mesh) {
    for (const m of enemy.mesh.getChildMeshes?.(false) ?? []) {
      if (m.material) {
        m.material.emissiveColor = new BABYLON.Color3(0.7, 0.15, 0.0);
        setTimeout(() => { if (m.material) m.material.emissiveColor = BABYLON.Color3.Black(); }, 120);
      }
    }
  }
  if (enemy.health <= 0) {
    enemy.state = 'sinking';
    enemy._stateTimer  = 0;
    enemy._sinkStartY  = enemy.mesh?.position?.y ?? (getWaterY() ?? 0);
    if (enemy.mesh) enemy.mesh.setEnabled(true);
    // Explosion at surface
    _splash(enemy.mesh?.position ?? { x:0, y:0, z:0 });
  }
}

// ── Respawn ───────────────────────────────────────────────────────────────────
function _respawnSub(enemy, waterY) {
  const wps = _waterWaypoints(waterY);
  const wp  = wps[Math.floor(Math.random() * wps.length)];
  const subY = waterY - enemy._cfg.subDepth;
  const spawnPos = new BABYLON.Vector3(wp.x, subY, wp.z);

  enemy.dead           = false;
  enemy.state          = 'submerged';
  enemy._stateTimer    = 0;
  enemy._fireCooldown  = enemy._cfg.fireCooldown;
  enemy._fireBurstLeft = 0;
  enemy.health         = D.HEALTH;
  enemy._subY          = subY;

  _buildSubMesh(enemy, spawnPos, null);
  if (enemy.body) enemy.body.setNextKinematicTranslation({ x:wp.x, y:subY, z:wp.z });
}

// ── Waypoints ─────────────────────────────────────────────────────────────────
function _waterWaypoints(waterY) {
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
    return candidates.slice(0, 6);
  }
  const r = 60, n = 6;
  return Array.from({length:n}, (_,i) => ({
    x: Math.cos(2*Math.PI*i/n) * r,
    y: waterY,
    z: Math.sin(2*Math.PI*i/n) * r,
  }));
}
