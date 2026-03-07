// enemies/enemyBase.js
// Base class for all enemy types.
// FIXES:
//   1. YUKA EntityManager is now ticked every frame from main.js render loop.
//   2. Vehicles use FollowPathBehavior + OnPathBehavior wired to flatnav waypoints.
//   3. Enemies cycle through waypoints indefinitely (looping path).
//   4. All YUKA usage is still safely guarded with existence checks.

import { getConfig }                      from '../config.js';
import { safeVec3 }                       from '../physics.js';
import { registerEnemy, unregisterEnemy } from './enemyRegistry.js';

// ─── YUKA lazy-init helpers ──────────────────────────────────────────────────

let _entityManager = null;
let _time          = null;

/** Get (or lazily create) the YUKA EntityManager */
export function _ym() {
  if (!window.YUKA) return null;
  if (!_entityManager) {
    _entityManager = new YUKA.EntityManager();
    console.log('[enemyBase] YUKA EntityManager created');
  }
  return _entityManager;
}

/** Get (or lazily create) the YUKA Time object */
export function _yt() {
  if (!window.YUKA) return null;
  if (!_time) _time = new YUKA.Time();
  return _time;
}

/**
 * Call this from the main render loop every frame.
 * Returns false if YUKA isn't ready yet (safe to ignore).
 */
export function tickYUKA() {
  const ym = _ym();
  const yt = _yt();
  if (!ym || !yt) return false;
  const delta = yt.update().getDelta();
  ym.update(delta);
  return true;
}

// ─── Path helpers ────────────────────────────────────────────────────────────

/**
 * Build a looping YUKA.Path from a flatnav waypoint array.
 * @param {Array<{x,y,z}>} waypoints
 * @param {boolean} loop  – whether path wraps around
 */
function _buildPath(waypoints, loop = true) {
  if (!window.YUKA || !waypoints?.length) return null;
  const path = new YUKA.Path();
  path.loop = loop;
  for (const wp of waypoints) {
    path.add(new YUKA.Vector3(+wp.x, +wp.y, +wp.z));
  }
  return path;
}

/**
 * Assign a looping follow-path behaviour to a YUKA Vehicle.
 * @param {YUKA.Vehicle} vehicle
 * @param {Array<{x,y,z}>} waypoints
 * @param {number} arrivalRadius  – how close before advancing to next point
 */
export function assignPath(vehicle, waypoints, arrivalRadius = 4) {
  if (!window.YUKA || !vehicle || !waypoints?.length) return;

  const path = _buildPath(waypoints, true);
  if (!path) return;

  // Remove any existing steering behaviours
  vehicle.steering.clear();

  // FollowPathBehavior drives the vehicle along the path
  const followPath = new YUKA.FollowPathBehavior(path, arrivalRadius);
  vehicle.steering.add(followPath);

  // OnPathBehavior keeps the vehicle from drifting off the path
  const onPath = new YUKA.OnPathBehavior(path);
  onPath.weight = 0.5;
  vehicle.steering.add(onPath);

  // Teleport to first waypoint so it doesn't sprint from world origin
  const first = waypoints[0];
  vehicle.position.set(+first.x, +first.y, +first.z);

  console.log('[enemyBase] Path assigned:', waypoints.length, 'waypoints, loop=true');
}

// ─── EnemyBase class ─────────────────────────────────────────────────────────

export class EnemyBase {
  /**
   * @param {object} opts
   * @param {BABYLON.Scene} opts.scene
   * @param {BABYLON.Vector3} opts.spawnPos
   * @param {string}  opts.type      – 'drone' | 'car' | 'forklift' | 'guard'
   * @param {number}  opts.speed     – units/s
   * @param {number}  opts.health
   * @param {Array}   opts.waypoints – from flatnav
   * @param {object}  opts.rapierWorld
   */
  constructor(opts = {}) {
    this.scene      = opts.scene;
    this.type       = opts.type ?? 'guard';
    this.speed      = opts.speed ?? 6;
    this.maxHealth  = opts.health ?? 100;
    this.health     = this.maxHealth;
    this.waypoints  = opts.waypoints ?? [];
    this.rapierWorld = opts.rapierWorld ?? null;
    this.dead       = false;
    this.respawnTime = opts.respawnTime ?? 8;  // seconds
    this._respawnTimer = 0;

    // BabylonJS mesh (placeholder box until GLB models are loaded)
    this.mesh = this._createMesh(opts.spawnPos ?? new BABYLON.Vector3(0, 2, 0));

    // Rapier kinematic body (moved by YUKA, not physics-simulated)
    this.body = this._createPhysicsBody(opts.spawnPos ?? new BABYLON.Vector3(0, 2, 0));

    // YUKA vehicle
    this.vehicle = opts.noVehicle ? null : this._createVehicle(opts.spawnPos ?? new BABYLON.Vector3(0, 2, 0));

    if (this.vehicle && this.waypoints.length) {
      assignPath(this.vehicle, this.waypoints);
    }

    // Register so HUD/minimap can find us without importing this file
    registerEnemy(this);
  }

  // ── Mesh ──────────────────────────────────────────────────────────────────
  _createMesh(pos) {
    const colors = { drone: '#44aaff', car: '#ff4444', forklift: '#ffaa00', guard: '#44ff88' };
    const sizes  = {
      drone:   { w: 1.2, h: 0.5, d: 1.2 },
      car:     { w: 2.0, h: 1.0, d: 4.0 },
      forklift:{ w: 1.5, h: 2.0, d: 2.5 },
      guard:   { w: 0.8, h: 1.8, d: 0.8 },
    };
    const s = sizes[this.type] ?? sizes.guard;
    const mesh = BABYLON.MeshBuilder.CreateBox(`enemy_${this.type}_${Date.now()}`,
      { width: s.w, height: s.h, depth: s.d }, this.scene);
    mesh.position.copyFrom(pos);

    const mat = new BABYLON.StandardMaterial('em_' + this.type, this.scene);
    mat.diffuseColor = BABYLON.Color3.FromHexString(colors[this.type] ?? '#ffffff');
    mat.emissiveColor = mat.diffuseColor.scale(0.3);
    mesh.material = mat;
    return mesh;
  }

  // ── Rapier kinematic body ─────────────────────────────────────────────────
  _createPhysicsBody(pos) {
    if (!this.rapierWorld || !window.RAPIER) return null;
    try {
      const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(+pos.x, +pos.y, +pos.z);
      const body = this.rapierWorld.createRigidBody(desc);
      // Collider — match mesh roughly
      const hx = 0.6, hy = 0.9, hz = 0.6;
      const cdesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
      this.rapierWorld.createCollider(cdesc, body);
      return body;
    } catch (e) {
      console.warn('[enemyBase] Rapier body creation failed:', e);
      return null;
    }
  }

  // ── YUKA Vehicle ──────────────────────────────────────────────────────────
  _createVehicle(pos) {
    const ym = _ym();
    if (!ym) return null;

    const v = new YUKA.Vehicle();
    v.position.set(+pos.x, +pos.y, +pos.z);
    v.maxSpeed    = this.speed;
    v.maxForce    = this.speed * 2;   // responsiveness
    v.mass        = 1;

    // Sync YUKA position → BabylonJS mesh every frame
    v.setRenderComponent(this.mesh, (entity, renderComponent) => {
      renderComponent.position.set(entity.position.x, entity.position.y, entity.position.z);
      // Also drive the Rapier kinematic body so physics collisions stay in sync
      if (this.body) {
        this.body.setNextKinematicTranslation(
          safeVec3(entity.position.x, entity.position.y, entity.position.z)
        );
      }
    });

    ym.add(v);
    return v;
  }

  // ── Damage / death / respawn ──────────────────────────────────────────────
  takeDamage(amount) {
    if (this.dead) return;
    this.health -= amount;
    if (this.health <= 0) this._die();
  }

  _die() {
    this.dead = true;
    this.health = 0;
    this._respawnTimer = this.respawnTime;
    if (this.mesh)    this.mesh.setEnabled(false);
    if (this.vehicle) this.vehicle.active = false;
    console.log(`[enemyBase] ${this.type} died`);
    // TODO: trigger explosion effect here
  }

  _respawn(pos) {
    this.dead   = false;
    this.health = this.maxHealth;
    const p = pos ?? this.waypoints[0];
    if (p && this.mesh) {
      this.mesh.position.set(+p.x, +p.y, +p.z);
      this.mesh.setEnabled(true);
    }
    if (this.vehicle) {
      if (p) this.vehicle.position.set(+p.x, +p.y, +p.z);
      this.vehicle.active = true;
    }
    console.log(`[enemyBase] ${this.type} respawned`);
  }

  /**
   * Per-frame update — call from the entity's subclass tick or from enemyManager.
   * @param {number} dt  – seconds since last frame (from YUKA Time or BabylonJS delta)
   */
  update(dt) {
    if (this.dead) {
      this._respawnTimer -= dt;
      if (this._respawnTimer <= 0) this._respawn();
    }
  }

  dispose() {
    const ym = _ym();
    if (ym && this.vehicle) ym.remove(this.vehicle);
    if (this.mesh) this.mesh.dispose();
    if (this.body && this.rapierWorld) this.rapierWorld.removeRigidBody(this.body);
    unregisterEnemy(this);
  }
}

// ─── Player position helpers (used by subclass tick functions) ───────────────

let _playerRig = null;

/** Call once from main.js after player spawns: setPlayerRigRef(playerRig) */
export function setPlayerRigRef(rig) { _playerRig = rig; }

/** Returns {x,y,z} of player, or origin if not ready */
export function getPlayerPos() {
  if (!_playerRig) return { x:0, y:0, z:0 };
  return { x: _playerRig.position.x, y: _playerRig.position.y, z: _playerRig.position.z };
}

/** Euclidean distance from a world point {x,y,z} to the player */
export function distToPlayer(pos) {
  const p = getPlayerPos();
  const dx = pos.x - p.x, dy = pos.y - p.y, dz = pos.z - p.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}