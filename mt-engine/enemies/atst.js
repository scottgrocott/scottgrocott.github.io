// enemies/atst.js — AT-ST Walker enemy
//
// FSM states:
//   patrol   → stomping toward ground waypoints
//   chase    → targeting player
//   fire     → stopped, shooting cannon bursts at player
//   tipped   → knocked over sideways, legs flailing
//   rising   → getting back up
//   dead     → ragdoll, cab + legs fly apart
//
// Legs:  hittable — each has independent HP. Shooting a leg reduces its
//        movement contribution. Both legs at 0 HP → enemy is instantly tipped.
//        Legs regenerate slowly while the AT-ST is upright.
// Knock: same knock-chance roll on any hit as the cow.
// Death: standard laser hitsToKill. On death → cab and all leg segments explode.

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 } from '../physics.js';
import { EnemyBase, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';

// ── Defaults ──────────────────────────────────────────────────────────────────
const D = {
  PATROL_SPEED:   3,
  CHASE_SPEED:    6,
  DETECT_RANGE:   55,
  FIRE_RANGE:     30,
  FIRE_COOLDOWN:  1.8,   // seconds between shots
  LEG_HP:         3,     // hits to disable one leg
  LEG_REGEN_RATE: 0.3,   // HP per second while upright
  KNOCK_CHANCE:   0.30,
  GETUP_CHANCE:   0.25,
  GETUP_DURATION: 1.8,
  HEALTH:         120,
  RESPAWN_TIME:   14,
};

const COL_HULL   = new BABYLON.Color3(0.22, 0.28, 0.20);  // olive drab
const COL_DARK   = new BABYLON.Color3(0.10, 0.13, 0.10);  // near-black panel seams
const COL_LENS   = new BABYLON.Color3(0.80, 0.30, 0.10);  // red sensor
const COL_CANNON = new BABYLON.Color3(0.15, 0.15, 0.18);  // gun metal
const COL_LEG_HI = new BABYLON.Color3(0.28, 0.35, 0.25);  // healthy leg
const COL_LEG_LO = new BABYLON.Color3(0.55, 0.15, 0.10);  // damaged leg (goes red)
const FLARE_URL  = 'https://scottgrocott.github.io/mt-assets/sprites/flare.png';

// ── Spawn ─────────────────────────────────────────────────────────────────────
export function spawnATSTs(def) {
  const count = def.maxCount || 1;
  const groundWaypoints = getWaypoints('ground');
  const spawned = [];

  for (let i = 0; i < count; i++) {
    const wp = groundWaypoints[i % Math.max(1, groundWaypoints.length)];
    const spawnPos = wp
      ? new BABYLON.Vector3(wp.x, wp.y, wp.z)
      : new BABYLON.Vector3((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80);

    const cfg = {
      knockChance:   def.knockChance   ?? D.KNOCK_CHANCE,
      getUpChance:   def.getUpChance   ?? D.GETUP_CHANCE,
      getUpDuration: def.getUpDuration ?? D.GETUP_DURATION,
      detectRange:   def.detectRange   ?? D.DETECT_RANGE,
      fireRange:     def.fireRange     ?? D.FIRE_RANGE,
      fireCooldown:  def.fireCooldown  ?? D.FIRE_COOLDOWN,
      patrolSpeed:   def.patrolSpeed   ?? D.PATROL_SPEED,
      chaseSpeed:    def.chaseSpeed    ?? D.CHASE_SPEED,
      legHP:         def.legHP         ?? D.LEG_HP,
      legRegenRate:  def.legRegenRate  ?? D.LEG_REGEN_RATE,
    };

    const enemy = new EnemyBase({
      scene,
      type:        'atst',
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
    enemy._fireCooldown  = 0;
    enemy._deadParts     = [];

    // Leg HP — left and right tracked independently
    enemy._legHP = { L: cfg.legHP, R: cfg.legHP };

    _buildATSTMesh(enemy);
    _overrideTakeDamage(enemy);
    spawned.push(enemy);
  }
  return spawned;
}

// ── Mesh builder ──────────────────────────────────────────────────────────────
function _mat(color, emissive = 0.08) {
  const m = new BABYLON.StandardMaterial('atm_' + Math.random(), scene);
  m.diffuseColor  = color.clone();
  m.emissiveColor = color.scale(emissive);
  return m;
}

function _buildATSTMesh(enemy) {
  if (enemy.mesh) enemy.mesh.dispose();

  const root = new BABYLON.TransformNode('atstRoot_' + Date.now(), scene);
  enemy.mesh = root;

  // Tilt node (used for knock-over)
  const tilt = new BABYLON.TransformNode('atstTilt', scene);
  tilt.parent = root;
  enemy._tiltNode = tilt;

  // ── Cab (the main box body) ──────────────────────────────────────────────
  const cab = BABYLON.MeshBuilder.CreateBox('atstCab',
    { width: 1.8, height: 1.4, depth: 1.6 }, scene);
  cab.parent = tilt;
  cab.position.set(0, 2.2, 0);
  cab.material = _mat(COL_HULL);
  if (shadowGenerator) shadowGenerator.addShadowCaster(cab);

  // Chin gun box
  const chinBox = BABYLON.MeshBuilder.CreateBox('atstChin',
    { width: 0.9, height: 0.35, depth: 0.5 }, scene);
  chinBox.parent = tilt;
  chinBox.position.set(0, 1.6, 0.82);
  chinBox.material = _mat(COL_DARK);
  if (shadowGenerator) shadowGenerator.addShadowCaster(chinBox);

  // Twin cannon barrels
  enemy._cannons = [];
  for (const side of [-0.22, 0.22]) {
    const barrel = BABYLON.MeshBuilder.CreateCylinder('atstBarrel_' + side,
      { diameter: 0.11, height: 0.80, tessellation: 7 }, scene);
    barrel.parent = tilt;
    barrel.position.set(side, 1.60, 1.22);
    barrel.rotation.x = Math.PI / 2;
    barrel.material = _mat(COL_CANNON, 0.25);
    if (shadowGenerator) shadowGenerator.addShadowCaster(barrel);
    enemy._cannons.push(barrel);
  }

  // Side sensor pods
  for (const side of [-1, 1]) {
    const pod = BABYLON.MeshBuilder.CreateBox('atstPod_' + side,
      { width: 0.30, height: 0.55, depth: 0.55 }, scene);
    pod.parent = tilt;
    pod.position.set(side * 1.06, 2.2, 0);
    pod.material = _mat(COL_DARK, 0.05);
    if (shadowGenerator) shadowGenerator.addShadowCaster(pod);

    // Red lens on each pod
    const lens = BABYLON.MeshBuilder.CreateSphere('atstLens_' + side,
      { diameter: 0.18, segments: 5 }, scene);
    lens.parent = tilt;
    lens.position.set(side * 1.21, 2.25, 0.12);
    lens.material = _mat(COL_LENS, 0.8);
    enemy['_lens' + (side < 0 ? 'L' : 'R')] = lens;
  }

  // Armour ridge on top
  const ridge = BABYLON.MeshBuilder.CreateBox('atstRidge',
    { width: 1.6, height: 0.18, depth: 1.5 }, scene);
  ridge.parent = tilt;
  ridge.position.set(0, 2.98, 0);
  ridge.material = _mat(COL_HULL, 0.04);
  if (shadowGenerator) shadowGenerator.addShadowCaster(ridge);

  // ── Neck (connects cab to legs) ──────────────────────────────────────────
  const neck = BABYLON.MeshBuilder.CreateCylinder('atstNeck',
    { diameter: 0.45, height: 0.70, tessellation: 8 }, scene);
  neck.parent = tilt;
  neck.position.set(0, 1.05, 0);
  neck.material = _mat(COL_DARK, 0.1);
  if (shadowGenerator) shadowGenerator.addShadowCaster(neck);

  // Hip plate
  const hip = BABYLON.MeshBuilder.CreateBox('atstHip',
    { width: 1.2, height: 0.22, depth: 0.55 }, scene);
  hip.parent = tilt;
  hip.position.set(0, 0.70, 0);
  hip.material = _mat(COL_HULL);
  if (shadowGenerator) shadowGenerator.addShadowCaster(hip);

  // ── Legs ─────────────────────────────────────────────────────────────────
  // Each leg: hip pivot → thigh → knee → shin → foot
  enemy._legNodes = {};
  enemy._legMeshes = {};   // for colour updates on damage

  for (const side of ['L', 'R']) {
    const xOff = side === 'L' ? 0.48 : -0.48;

    const legRoot = new BABYLON.TransformNode('legRoot_' + side, scene);
    legRoot.parent = tilt;
    legRoot.position.set(xOff, 0.68, 0);
    enemy._legNodes[side] = legRoot;

    const thigh = BABYLON.MeshBuilder.CreateBox('thigh_' + side,
      { width: 0.22, height: 0.55, depth: 0.22 }, scene);
    thigh.parent = legRoot;
    thigh.position.set(0, -0.28, 0);
    thigh.material = _mat(COL_LEG_HI, 0.12);
    if (shadowGenerator) shadowGenerator.addShadowCaster(thigh);

    const knee = BABYLON.MeshBuilder.CreateSphere('knee_' + side,
      { diameter: 0.28, segments: 5 }, scene);
    knee.parent = legRoot;
    knee.position.set(0, -0.62, 0);
    knee.material = _mat(COL_DARK, 0.15);

    const shin = BABYLON.MeshBuilder.CreateBox('shin_' + side,
      { width: 0.18, height: 0.70, depth: 0.20 }, scene);
    shin.parent = legRoot;
    shin.position.set(0, -1.08, 0.06);
    shin.material = _mat(COL_LEG_HI, 0.12);
    if (shadowGenerator) shadowGenerator.addShadowCaster(shin);

    const foot = BABYLON.MeshBuilder.CreateBox('foot_' + side,
      { width: 0.35, height: 0.18, depth: 0.55 }, scene);
    foot.parent = legRoot;
    foot.position.set(0, -1.52, 0.18);
    foot.material = _mat(COL_DARK, 0.1);
    if (shadowGenerator) shadowGenerator.addShadowCaster(foot);

    enemy._legMeshes[side] = { thigh, shin };
  }
}

// ── takeDamage override ───────────────────────────────────────────────────────
function _overrideTakeDamage(enemy) {
  enemy.takeDamage = function (amount, hitMeshName) {
    if (this.dead || this.destroyed) return;

    // Check if a specific leg was hit
    const legSide = _hitLeg(hitMeshName);
    if (legSide && this.state !== 'tipped' && this.state !== 'rising') {
      this._legHP[legSide] = Math.max(0, this._legHP[legSide] - (amount ?? 1));
      _updateLegColour(this, legSide);

      // Both legs disabled → instant tip
      if (this._legHP.L <= 0 && this._legHP.R <= 0) {
        this.state        = 'tipped';
        this._tippedTimer = 0;
      }
      return; // leg hit does not reduce main health
    }

    // Double damage while tipped / rising
    const dmg = (this.state === 'tipped' || this.state === 'rising')
      ? (amount ?? this.maxHealth) * 2
      : (amount ?? this.maxHealth);

    this.health -= dmg;

    if (this.health <= 0) {
      this.dead  = true;
      this.state = 'dead';
      _startATSTDeath(this);
      return;
    }

    // Knock-over roll
    if (this.state !== 'tipped' && this.state !== 'rising') {
      if (Math.random() < (this._cfg.knockChance ?? D.KNOCK_CHANCE)) {
        this.state        = 'tipped';
        this._tippedTimer = 0;
      }
    }
  };
}

function _hitLeg(meshName) {
  if (!meshName) return null;
  if (meshName.includes('_L')) return 'L';
  if (meshName.includes('_R')) return 'R';
  return null;
}

function _updateLegColour(enemy, side) {
  const maxHP  = enemy._cfg.legHP ?? D.LEG_HP;
  const ratio  = Math.max(0, enemy._legHP[side] / maxHP);
  // Lerp from damaged red → healthy green
  const color  = BABYLON.Color3.Lerp(COL_LEG_LO, COL_LEG_HI, ratio);
  const meshes = enemy._legMeshes?.[side];
  if (!meshes) return;
  for (const m of Object.values(meshes)) {
    if (m?.material) {
      m.material.diffuseColor  = color.clone();
      m.material.emissiveColor = color.scale(0.12);
    }
  }
}

// ── Per-frame tick ────────────────────────────────────────────────────────────
export function tickATSTs(dt) {
  const groundWaypoints = getWaypoints('ground');
  for (const e of getEnemies()) {
    if (e.type !== 'atst') continue;
    if (e.state === 'dead') { _tickATSTRagdoll(e, dt); continue; }
    if (e.dead) continue;
    _tickATST(e, dt, groundWaypoints);
  }
}

function _tickATST(enemy, dt, groundWaypoints) {
  const t  = enemy.body.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) return;

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({ x: px, y: py, z: pz });
  const cfg       = enemy._cfg;

  // Leg regen (slow, only while upright)
  for (const side of ['L', 'R']) {
    const wasDisabled = enemy._legHP[side] <= 0;
    enemy._legHP[side] = Math.min(cfg.legHP, enemy._legHP[side] + cfg.legRegenRate * dt);
    if (wasDisabled && enemy._legHP[side] > 0) _updateLegColour(enemy, side);
  }

  // Speed reduction from leg damage
  const legRatio = (enemy._legHP.L + enemy._legHP.R) / (cfg.legHP * 2);
  const speedMul = 0.3 + legRatio * 0.7;  // 30% speed minimum

  let targetX = px, targetZ = pz;
  let spd = cfg.patrolSpeed * speedMul;

  // Pulse lenses red while targeting
  const lensIntensity = (enemy.state === 'chase' || enemy.state === 'fire')
    ? 0.5 + Math.sin(Date.now() * 0.01) * 0.3
    : 0.4;
  for (const side of ['L', 'R']) {
    const lens = enemy['_lens' + side];
    if (lens?.material) lens.material.emissiveColor = COL_LENS.scale(lensIntensity);
  }

  switch (enemy.state) {

    case 'patrol': {
      if (dPlayer < cfg.detectRange) { enemy.state = 'chase'; break; }
      if (groundWaypoints.length > 0) {
        const wp = groundWaypoints[enemy._waypointIndex % groundWaypoints.length];
        const dx = wp.x - px, dz = wp.z - pz;
        if (Math.sqrt(dx * dx + dz * dz) < 5) {
          enemy._waypointIndex = (enemy._waypointIndex + 1) % groundWaypoints.length;
        } else { targetX = wp.x; targetZ = wp.z; }
      }
      break;
    }

    case 'chase': {
      if (dPlayer > cfg.detectRange * 1.4) { enemy.state = 'patrol'; break; }
      if (dPlayer < cfg.fireRange) {
        enemy.state = 'fire';
        break;
      }
      targetX = playerPos.x; targetZ = playerPos.z;
      spd = cfg.chaseSpeed * speedMul;
      break;
    }

    case 'fire': {
      if (dPlayer > cfg.fireRange * 1.4) { enemy.state = 'chase'; break; }
      // Face player while stationary
      if (enemy.mesh) {
        const dx = playerPos.x - px, dz = playerPos.z - pz;
        enemy.mesh.rotation.y = Math.atan2(dx, dz);
      }
      // Fire cannon burst
      enemy._fireCooldown = (enemy._fireCooldown || 0) - dt;
      if (enemy._fireCooldown <= 0) {
        enemy._fireCooldown = cfg.fireCooldown;
        _fireCannonBurst(enemy, playerPos);
      }
      // Animate cannon recoil
      if (enemy._cannons) {
        const recoil = Math.max(0, 0.15 * (1 - enemy._fireCooldown / cfg.fireCooldown));
        for (const c of enemy._cannons) c.position.z = 1.22 - recoil;
      }
      return; // stationary while firing
    }

    case 'tipped': {
      enemy._tiltAngle = Math.min(enemy._tiltAngle + dt * 3.5, Math.PI / 2);
      if (enemy._tiltNode) enemy._tiltNode.rotation.z = enemy._tiltAngle;

      // Flail legs
      if (enemy._legNodes) {
        const t2 = Date.now() * 0.004;
        enemy._legNodes.L.rotation.x = Math.sin(t2)       * 0.5;
        enemy._legNodes.R.rotation.x = Math.sin(t2 + Math.PI) * 0.5;
      }

      enemy._tippedTimer += dt;
      if (enemy._tippedTimer >= 1.0) {
        enemy._tippedTimer = 0;
        if (Math.random() < (cfg.getUpChance ?? D.GETUP_CHANCE)) {
          enemy.state       = 'rising';
          enemy._getUpTimer = cfg.getUpDuration ?? D.GETUP_DURATION;
          // Restore leg HP to minimum functional on get-up
          enemy._legHP.L = Math.max(enemy._legHP.L, 1);
          enemy._legHP.R = Math.max(enemy._legHP.R, 1);
          _updateLegColour(enemy, 'L');
          _updateLegColour(enemy, 'R');
        }
      }
      return;
    }

    case 'rising': {
      enemy._getUpTimer -= dt;
      const duration = cfg.getUpDuration ?? D.GETUP_DURATION;
      enemy._tiltAngle = (Math.PI / 2) * Math.max(0, enemy._getUpTimer / duration);
      if (enemy._tiltNode) enemy._tiltNode.rotation.z = enemy._tiltAngle;

      if (enemy._getUpTimer <= 0) {
        enemy._tiltAngle = 0;
        if (enemy._tiltNode) enemy._tiltNode.rotation.z = 0;
        if (enemy._legNodes) {
          enemy._legNodes.L.rotation.x = 0;
          enemy._legNodes.R.rotation.x = 0;
        }
        enemy.state = dPlayer < cfg.detectRange ? 'chase' : 'patrol';
      }
      return;
    }
  }

  // Walk animation — alternating leg swing
  const moving = Math.abs(targetX - px) > 0.5 || Math.abs(targetZ - pz) > 0.5;
  if (moving && enemy._legNodes) {
    enemy._legPhase = (enemy._legPhase || 0) + dt * spd * 1.4;
    enemy._legNodes.L.rotation.x =  Math.sin(enemy._legPhase)        * 0.45;
    enemy._legNodes.R.rotation.x =  Math.sin(enemy._legPhase + Math.PI) * 0.45;
    // Slight cab sway
    if (enemy._tiltNode) {
      enemy._tiltNode.rotation.z = Math.sin(enemy._legPhase * 2) * 0.04;
    }
  }

  // Move
  const dx = targetX - px, dz = targetZ - pz;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 0.5) {
    const nx = dx / len, nz = dz / len;
    const terrainY = getTerrainHeightAt(px, pz) + 0.1;
    const safe = safeVec3(px + nx * spd * dt, terrainY, pz + nz * spd * dt, 'atst tick');
    if (safe) {
      enemy.body.setNextKinematicTranslation(safe);
      if (enemy.mesh) {
        enemy.mesh.position.set(safe.x, safe.y, safe.z);
        enemy.mesh.rotation.y = Math.atan2(nx, nz);
      }
    }
  }
}

// ── Cannon VFX (muzzle flash burst, no actual projectile) ────────────────────
function _fireCannonBurst(enemy, targetPos) {
  if (!enemy._cannons?.length) return;
  const barrel = enemy._cannons[Math.floor(Math.random() * enemy._cannons.length)];
  const muzzlePos = barrel.getAbsolutePosition();

  const ps = new BABYLON.ParticleSystem('atstMuzzle', 20, scene);
  ps.emitter         = muzzlePos.clone();
  ps.particleTexture = new BABYLON.Texture(FLARE_URL, scene);
  ps.minSize = 0.05; ps.maxSize = 0.25;
  ps.minLifeTime = 0.05; ps.maxLifeTime = 0.15;
  ps.emitRate = 0; ps.manualEmitCount = 20;
  ps.minEmitPower = 3; ps.maxEmitPower = 9;
  const dir = targetPos.subtract(muzzlePos).normalize();
  ps.direction1 = dir.scale(0.8).add(new BABYLON.Vector3(-0.2, -0.2, -0.2));
  ps.direction2 = dir.scale(1.2).add(new BABYLON.Vector3(0.2, 0.2, 0.2));
  ps.color1    = new BABYLON.Color4(1.0, 0.7, 0.2, 1.0);
  ps.color2    = new BABYLON.Color4(1.0, 0.4, 0.1, 0.8);
  ps.colorDead = new BABYLON.Color4(0.3, 0.1, 0.0, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch (_) {} }, 600);
}

// ── Death ragdoll ─────────────────────────────────────────────────────────────
function _startATSTDeath(enemy) {
  if (!enemy.mesh) return;
  const origin = enemy.mesh.position.clone();

  const parts = enemy._tiltNode
    ? enemy._tiltNode.getChildMeshes(false)
    : enemy.mesh.getChildMeshes(false);

  for (const m of parts) {
    const worldPos = m.getAbsolutePosition().clone();
    m.parent = null;
    m.position.copyFrom(worldPos);
    const spread = () => (Math.random() - 0.5) * 12;
    m._vel  = new BABYLON.Vector3(spread(), 5 + Math.random() * 9, spread());
    m._spin = new BABYLON.Vector3(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
    );
    m._life = 4 + Math.random() * 2;
    m._age  = 0;
  }

  enemy._deadParts = [...parts];
  enemy.mesh.setEnabled(false);

  _atstExplosion(origin);

  setTimeout(() => {
    if (enemy.destroyed || window._levelComplete) return;
    for (const m of (enemy._deadParts || [])) {
      try { m.dispose(); } catch (_) {}
    }
    enemy._deadParts = [];
    _buildATSTMesh(enemy);
    _overrideTakeDamage(enemy);
    enemy.mesh.setEnabled(true);
    enemy.health     = enemy.maxHealth;
    enemy.dead       = false;
    enemy.state      = 'patrol';
    enemy._tiltAngle = 0;
    enemy._legPhase  = 0;
    enemy._legHP     = { L: enemy._cfg.legHP, R: enemy._cfg.legHP };
  }, (enemy.respawnTime ?? D.RESPAWN_TIME) * 1000);
}

function _tickATSTRagdoll(enemy, dt) {
  if (!enemy._deadParts?.length) return;
  const GRAVITY = -20;
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
      m._vel.y    *= -0.25;
      m._vel.x    *= 0.6;
      m._vel.z    *= 0.6;
    }
    const remaining = m._life - m._age;
    if (remaining < 1.0 && m.material) m.material.alpha = remaining;
  }
}

function _atstExplosion(pos) {
  // Main fireball
  const fire = new BABYLON.ParticleSystem('atstFire', 60, scene);
  fire.emitter        = pos.clone();
  fire.particleTexture = new BABYLON.Texture(FLARE_URL, scene);
  fire.minSize = 0.5; fire.maxSize = 2.2;
  fire.minLifeTime = 0.3; fire.maxLifeTime = 0.9;
  fire.emitRate = 0; fire.manualEmitCount = 60;
  fire.minEmitPower = 3; fire.maxEmitPower = 10;
  fire.direction1 = new BABYLON.Vector3(-1, 1, -1);
  fire.direction2 = new BABYLON.Vector3(1, 4, 1);
  fire.color1    = new BABYLON.Color4(1.0, 0.6, 0.1, 1.0);
  fire.color2    = new BABYLON.Color4(0.9, 0.3, 0.05, 0.9);
  fire.colorDead = new BABYLON.Color4(0.1, 0.1, 0.1, 0);
  fire.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  fire.start();

  // Smoke
  const smoke = new BABYLON.ParticleSystem('atstSmoke', 35, scene);
  smoke.emitter        = pos.clone();
  smoke.particleTexture = new BABYLON.Texture(FLARE_URL, scene);
  smoke.minSize = 0.8; smoke.maxSize = 3.0;
  smoke.minLifeTime = 1.2; smoke.maxLifeTime = 2.5;
  smoke.emitRate = 0; smoke.manualEmitCount = 35;
  smoke.minEmitPower = 1; smoke.maxEmitPower = 4;
  smoke.direction1 = new BABYLON.Vector3(-0.4, 1.5, -0.4);
  smoke.direction2 = new BABYLON.Vector3(0.4, 3.5, 0.4);
  smoke.color1    = new BABYLON.Color4(0.15, 0.12, 0.10, 0.9);
  smoke.color2    = new BABYLON.Color4(0.05, 0.05, 0.05, 0.7);
  smoke.colorDead = new BABYLON.Color4(0.0, 0.0, 0.0, 0);
  smoke.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  smoke.start();

  setTimeout(() => {
    try { fire.dispose();  } catch (_) {}
    try { smoke.dispose(); } catch (_) {}
  }, 3000);
}
