// enemies/cows.js — Boston Dynamics Cow enemy
//
// FSM states:
//   patrol  → wandering ground waypoints
//   chase   → running at player
//   ram     → charging full speed
//   tipped  → knocked over, legs wiggling in air, random chance to get up each second
//   rising  → getting back up (short animation)
//   dead    → death ragdoll, body parts fly outward
//
// Knock-over:  any laser hit has a knockChance probability of tipping the cow,
//              regardless of remaining health.
// Get-up:      each second while tipped, roll Math.random() < getUpChance.
// Damage:      double damage while tipped or rising (vulnerable state).
// Death:       standard hitsToKill laser hits. On death → ragdoll part explosion.

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';

// ── Configurable defaults (all overridable from level JSON) ───────────────────
const D = {
  PATROL_SPEED:   3.5,
  CHASE_SPEED:    7,
  RAM_SPEED:      12,
  DETECT_RANGE:   40,
  RAM_RANGE:      5,
  KNOCK_CHANCE:   0.4,   // probability per hit of tipping
  GETUP_CHANCE:   0.35,  // probability per second of standing back up
  GETUP_DURATION: 1.2,   // seconds the rising animation takes
  HEALTH:         80,
  RESPAWN_TIME:   10,
};

const COL_BODY  = new BABYLON.Color3(0.85, 0.82, 0.78);
const COL_PATCH = new BABYLON.Color3(0.15, 0.12, 0.10);
const COL_LEG   = new BABYLON.Color3(0.20, 0.18, 0.15);
const COL_HOOF  = new BABYLON.Color3(0.10, 0.08, 0.08);
const COL_NOSE  = new BABYLON.Color3(0.75, 0.45, 0.40);
const COL_EYE   = new BABYLON.Color3(0.05, 0.05, 0.05);
const FLARE_URL = 'https://scottgrocott.github.io/mt-assets/sprites/flare.png';

// ── Spawn ─────────────────────────────────────────────────────────────────────
export function spawnCows(def) {
  const count = def.maxCount || 2;
  const groundWaypoints = getWaypoints('ground');
  const spawned = [];

  for (let i = 0; i < count; i++) {
    const wp = groundWaypoints[i % Math.max(1, groundWaypoints.length)];
    const spawnPos = wp
      ? new BABYLON.Vector3(wp.x, wp.y, wp.z)
      : new BABYLON.Vector3((Math.random() - 0.5) * 60, 0.55, (Math.random() - 0.5) * 60);

    const cfg = {
      knockChance:   def.knockChance   ?? D.KNOCK_CHANCE,
      getUpChance:   def.getUpChance   ?? D.GETUP_CHANCE,
      getUpDuration: def.getUpDuration ?? D.GETUP_DURATION,
      detectRange:   def.detectRange   ?? D.DETECT_RANGE,
      patrolSpeed:   def.patrolSpeed   ?? D.PATROL_SPEED,
      chaseSpeed:    def.chaseSpeed    ?? D.CHASE_SPEED,
      ramSpeed:      def.ramSpeed      ?? D.RAM_SPEED,
    };

    const enemy = new EnemyBase({
      scene,
      type:        'cow',
      speed:       cfg.patrolSpeed,
      health:      def.health      ?? D.HEALTH,
      respawnTime: def.respawnTime ?? D.RESPAWN_TIME,
      spawnPos,
      noVehicle:   true,
    });

    enemy.state          = 'patrol';
    enemy._cfg           = cfg;
    enemy._waypointIndex = Math.floor(Math.random() * Math.max(1, groundWaypoints.length));
    enemy._tippedTimer   = 0;
    enemy._getUpTimer    = 0;
    enemy._tiltAngle     = 0;
    enemy._legPhase      = 0;
    enemy._deadParts     = [];

    _buildCowMesh(enemy);
    _overrideTakeDamage(enemy);
    spawned.push(enemy);
  }
  return spawned;
}

// ── Mesh builder ──────────────────────────────────────────────────────────────
function _mat(color, emissiveScale = 0.08) {
  const m = new BABYLON.StandardMaterial('cm_' + Math.random(), scene);
  m.diffuseColor  = color.clone();
  m.emissiveColor = color.scale(emissiveScale);
  return m;
}

function _buildCowMesh(enemy) {
  if (enemy.mesh) enemy.mesh.dispose();

  const root = new BABYLON.TransformNode('cowRoot_' + Date.now(), scene);
  enemy.mesh = root;

  // Tilt node — rotate on Z to tip the whole animal sideways
  const tilt = new BABYLON.TransformNode('cowTilt', scene);
  tilt.parent = root;
  enemy._tiltNode = tilt;

  // Body
  const body = BABYLON.MeshBuilder.CreateBox('cowBody',
    { width: 1.0, height: 0.65, depth: 1.8 }, scene);
  body.parent = tilt;
  body.position.set(0, 0.9, 0);
  body.material = _mat(COL_BODY);
  if (shadowGenerator) shadowGenerator.addShadowCaster(body);

  // Dark patch
  const patch = BABYLON.MeshBuilder.CreateBox('cowPatch',
    { width: 0.42, height: 0.35, depth: 0.55 }, scene);
  patch.parent = tilt;
  patch.position.set(0.51, 1.05, 0.2);
  patch.material = _mat(COL_PATCH, 0.04);
  if (shadowGenerator) shadowGenerator.addShadowCaster(patch);

  // Head
  const head = BABYLON.MeshBuilder.CreateBox('cowHead',
    { width: 0.6, height: 0.55, depth: 0.70 }, scene);
  head.parent = tilt;
  head.position.set(0, 1.1, 1.05);
  head.material = _mat(COL_BODY);
  if (shadowGenerator) shadowGenerator.addShadowCaster(head);

  // Snout
  const snout = BABYLON.MeshBuilder.CreateBox('cowSnout',
    { width: 0.38, height: 0.28, depth: 0.22 }, scene);
  snout.parent = tilt;
  snout.position.set(0, 0.90, 1.40);
  snout.material = _mat(COL_NOSE, 0.12);

  // Eyes
  for (const side of [-1, 1]) {
    const eye = BABYLON.MeshBuilder.CreateSphere('cowEye',
      { diameter: 0.10, segments: 4 }, scene);
    eye.parent = tilt;
    eye.position.set(side * 0.28, 1.22, 1.22);
    eye.material = _mat(COL_EYE, 0.5);
  }

  // Horns
  for (const side of [-1, 1]) {
    const horn = BABYLON.MeshBuilder.CreateCylinder('cowHorn',
      { diameterTop: 0.03, diameterBottom: 0.10, height: 0.30, tessellation: 6 }, scene);
    horn.parent = tilt;
    horn.position.set(side * 0.22, 1.52, 1.0);
    horn.rotation.z = side * 0.35;
    const hm = new BABYLON.StandardMaterial('hornMat', scene);
    hm.diffuseColor = new BABYLON.Color3(0.90, 0.85, 0.60);
    horn.material = hm;
  }

  // Legs — 4 × (legNode → upper cylinder + lower cylinder + hoof box)
  enemy._legs = [];
  const legOffsets = [
    { x:  0.38, z:  0.6, name: 'FL' },
    { x: -0.38, z:  0.6, name: 'FR' },
    { x:  0.38, z: -0.6, name: 'RL' },
    { x: -0.38, z: -0.6, name: 'RR' },
  ];
  for (const off of legOffsets) {
    const legNode = new BABYLON.TransformNode('legNode_' + off.name, scene);
    legNode.parent = tilt;
    legNode.position.set(off.x, 0.57, off.z);

    const upper = BABYLON.MeshBuilder.CreateCylinder('legU_' + off.name,
      { diameter: 0.14, height: 0.44, tessellation: 6 }, scene);
    upper.parent = legNode;
    upper.position.set(0, -0.22, 0);
    upper.material = _mat(COL_LEG, 0.15);
    if (shadowGenerator) shadowGenerator.addShadowCaster(upper);

    const lower = BABYLON.MeshBuilder.CreateCylinder('legL_' + off.name,
      { diameter: 0.10, height: 0.38, tessellation: 6 }, scene);
    lower.parent = legNode;
    lower.position.set(0, -0.60, 0);
    lower.material = _mat(COL_LEG, 0.15);
    if (shadowGenerator) shadowGenerator.addShadowCaster(lower);

    const hoof = BABYLON.MeshBuilder.CreateBox('hoof_' + off.name,
      { width: 0.15, height: 0.12, depth: 0.20 }, scene);
    hoof.parent = legNode;
    hoof.position.set(0, -0.84, 0.04);
    hoof.material = _mat(COL_HOOF, 0.2);
    if (shadowGenerator) shadowGenerator.addShadowCaster(hoof);

    enemy._legs.push({ node: legNode, isFront: off.z > 0 });
  }

  // Tail
  const tail = BABYLON.MeshBuilder.CreateCylinder('cowTail',
    { diameterTop: 0.05, diameterBottom: 0.09, height: 0.55, tessellation: 5 }, scene);
  tail.parent = tilt;
  tail.position.set(0, 0.85, -0.98);
  tail.rotation.x = -0.6;
  tail.material = _mat(COL_BODY);
}

// ── takeDamage override ───────────────────────────────────────────────────────
function _overrideTakeDamage(enemy) {
  enemy.takeDamage = function (amount) {
    if (this.dead || this.destroyed) return;

    // Tipped or rising = double damage (vulnerable state)
    const dmg = (this.state === 'tipped' || this.state === 'rising')
      ? (amount ?? this.maxHealth) * 2
      : (amount ?? this.maxHealth);

    this.health -= dmg;

    if (this.health <= 0) {
      this.dead  = true;
      this.state = 'dead';
      _startCowDeath(this);
      return;
    }

    // Knock-over roll — only from upright states
    if (this.state !== 'tipped' && this.state !== 'rising') {
      if (Math.random() < (this._cfg.knockChance ?? D.KNOCK_CHANCE)) {
        this.state        = 'tipped';
        this._tippedTimer = 0;
      }
    }
  };
}

// ── Per-frame tick ────────────────────────────────────────────────────────────
export function tickCows(dt) {
  const groundWaypoints = getWaypoints('ground');
  for (const e of getEnemies()) {
    if (e.type !== 'cow') continue;
    if (e.state === 'dead') { _tickCowRagdoll(e, dt); continue; }
    if (e.dead) continue;
    _tickCow(e, dt, groundWaypoints);
  }
}

function _tickCow(enemy, dt, groundWaypoints) {
  const t  = enemy.body.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) return;

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({ x: px, y: py, z: pz });
  const cfg       = enemy._cfg;

  let targetX = px, targetZ = pz;
  let spd = cfg.patrolSpeed;

  switch (enemy.state) {

    case 'patrol': {
      if (dPlayer < cfg.detectRange) { enemy.state = 'chase'; break; }
      if (groundWaypoints.length > 0) {
        const wp = groundWaypoints[enemy._waypointIndex % groundWaypoints.length];
        const dx = wp.x - px, dz = wp.z - pz;
        if (Math.sqrt(dx * dx + dz * dz) < 4) {
          enemy._waypointIndex = (enemy._waypointIndex + 1) % groundWaypoints.length;
        } else { targetX = wp.x; targetZ = wp.z; }
      }
      break;
    }

    case 'chase': {
      if (dPlayer > cfg.detectRange * 1.5) { enemy.state = 'patrol'; break; }
      if (dPlayer < D.RAM_RANGE)            { enemy.state = 'ram';    break; }
      targetX = playerPos.x; targetZ = playerPos.z;
      spd = cfg.chaseSpeed;
      break;
    }

    case 'ram': {
      if (dPlayer > D.RAM_RANGE * 2.5) { enemy.state = 'chase'; break; }
      targetX = playerPos.x; targetZ = playerPos.z;
      spd = cfg.ramSpeed;
      break;
    }

    case 'tipped': {
      // Animate tilt to 90°
      enemy._tiltAngle = Math.min(enemy._tiltAngle + dt * 4.5, Math.PI / 2);
      if (enemy._tiltNode) enemy._tiltNode.rotation.z = enemy._tiltAngle;

      // Wiggle legs in air
      if (enemy._legs) {
        const wiggle = Math.sin(Date.now() * 0.005) * 0.45;
        for (const leg of enemy._legs) leg.node.rotation.x = wiggle;
      }

      // Random get-up roll every second
      enemy._tippedTimer += dt;
      if (enemy._tippedTimer >= 1.0) {
        enemy._tippedTimer = 0;
        if (Math.random() < (cfg.getUpChance ?? D.GETUP_CHANCE)) {
          enemy.state       = 'rising';
          enemy._getUpTimer = cfg.getUpDuration ?? D.GETUP_DURATION;
        }
      }
      return; // no movement while tipped
    }

    case 'rising': {
      enemy._getUpTimer -= dt;
      const duration = cfg.getUpDuration ?? D.GETUP_DURATION;
      const progress  = 1 - Math.max(0, enemy._getUpTimer / duration);
      enemy._tiltAngle = (Math.PI / 2) * (1 - progress);
      if (enemy._tiltNode) enemy._tiltNode.rotation.z = enemy._tiltAngle;

      if (enemy._getUpTimer <= 0) {
        enemy._tiltAngle = 0;
        if (enemy._tiltNode) enemy._tiltNode.rotation.z = 0;
        if (enemy._legs) for (const l of enemy._legs) l.node.rotation.x = 0;
        enemy.state = dPlayer < cfg.detectRange ? 'chase' : 'patrol';
      }
      return; // no movement while rising
    }
  }

  // Walk animation
  const moving = Math.abs(targetX - px) > 0.5 || Math.abs(targetZ - pz) > 0.5;
  if (moving && enemy._legs) {
    enemy._legPhase = (enemy._legPhase || 0) + dt * spd * 2.2;
    for (const leg of enemy._legs) {
      const phase = leg.isFront ? enemy._legPhase : enemy._legPhase + Math.PI;
      leg.node.rotation.x = Math.sin(phase) * 0.35;
    }
  }

  // Move
  const dx = targetX - px, dz = targetZ - pz;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 0.5) {
    const nx = dx / len, nz = dz / len;
    const terrainY = getTerrainHeightAt(px, pz) + 0.55;
    const safe = safeVec3(px + nx * spd * dt, terrainY, pz + nz * spd * dt, 'cow tick');
    if (safe) {
      enemy.body.setNextKinematicTranslation(safe);
      if (enemy.mesh) {
        enemy.mesh.position.set(safe.x, safe.y, safe.z);
        enemy.mesh.rotation.y = Math.atan2(nx, nz);
      }
    }
  }
}

// ── Death ragdoll ─────────────────────────────────────────────────────────────
function _startCowDeath(enemy) {
  if (!enemy.mesh) return;
  const origin = enemy.mesh.position.clone();

  // Detach all child meshes from the hierarchy and launch them
  const parts = enemy._tiltNode
    ? enemy._tiltNode.getChildMeshes(false)
    : enemy.mesh.getChildMeshes(false);

  for (const m of parts) {
    const worldPos = m.getAbsolutePosition().clone();
    m.parent = null;
    m.position.copyFrom(worldPos);
    const spread = () => (Math.random() - 0.5) * 14;
    m._vel  = new BABYLON.Vector3(spread(), 4 + Math.random() * 8, spread());
    m._spin = new BABYLON.Vector3(
      (Math.random() - 0.5) * 7,
      (Math.random() - 0.5) * 7,
      (Math.random() - 0.5) * 7,
    );
    m._life = 3.5 + Math.random() * 1.5;
    m._age  = 0;
  }

  enemy._deadParts = [...parts];
  enemy.mesh.setEnabled(false);

  _burstParticles(origin);

  setTimeout(() => {
    if (enemy.destroyed || window._levelComplete) return;
    for (const m of (enemy._deadParts || [])) {
      try { m.dispose(); } catch (_) {}
    }
    enemy._deadParts = [];
    _buildCowMesh(enemy);
    _overrideTakeDamage(enemy);
    enemy.mesh.setEnabled(true);
    enemy.health     = enemy.maxHealth;
    enemy.dead       = false;
    enemy.state      = 'patrol';
    enemy._tiltAngle = 0;
    enemy._legPhase  = 0;
  }, (enemy.respawnTime ?? D.RESPAWN_TIME) * 1000);
}

function _tickCowRagdoll(enemy, dt) {
  if (!enemy._deadParts?.length) return;
  const GRAVITY = -18;
  for (const m of enemy._deadParts) {
    if (!m || m.isDisposed()) continue;
    m._age += dt;
    if (m._age > m._life) { m.setEnabled(false); continue; }
    m._vel.y += GRAVITY * dt;
    m.position.addInPlace(m._vel.scale(dt));
    m.rotation.addInPlace(m._spin.scale(dt));
    const floor = getTerrainHeightAt(m.position.x, m.position.z) + 0.1;
    if (m.position.y < floor) {
      m.position.y = floor;
      m._vel.y    *= -0.28;
      m._vel.x    *= 0.65;
      m._vel.z    *= 0.65;
    }
    const remaining = m._life - m._age;
    if (remaining < 0.8 && m.material) m.material.alpha = remaining / 0.8;
  }
}

function _burstParticles(pos) {
  const ps = new BABYLON.ParticleSystem('cowBurst', 45, scene);
  ps.emitter          = pos.clone();
  ps.particleTexture  = new BABYLON.Texture(FLARE_URL, scene);
  ps.minSize = 0.2; ps.maxSize = 1.0;
  ps.minLifeTime = 0.4; ps.maxLifeTime = 1.0;
  ps.emitRate = 0; ps.manualEmitCount = 45;
  ps.minEmitPower = 2; ps.maxEmitPower = 8;
  ps.direction1 = new BABYLON.Vector3(-1, 1.5, -1);
  ps.direction2 = new BABYLON.Vector3(1, 4, 1);
  ps.color1    = new BABYLON.Color4(0.9, 0.8, 0.6, 1.0);
  ps.color2    = new BABYLON.Color4(0.6, 0.4, 0.2, 0.8);
  ps.colorDead = new BABYLON.Color4(0.2, 0.2, 0.2, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch (_) {} }, 2200);
}
