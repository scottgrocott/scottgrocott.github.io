// enemies/enemyBase.js — base class for all enemies (Havok)
// Physics: none — enemies are mesh-position-driven via YUKA / tick, no Havok body needed.
// YUKA: EntityManager lives in yukaManager.js; this file re-exports
//       tickYUKA and setPlayerRigRef so main.js needs no changes.

import { safeVec3 } from '../physics.js';
import { registerEnemy, unregisterEnemy } from './enemyRegistry.js';
import {
  initYUKA,
  tickYUKA     as _tickYUKA,
  getYukaManager,
  assignPath,
} from '../yuka/yukaManager.js';

// ── Re-exports for main.js ────────────────────────────────────────────────────
export { tickYUKA } from '../yuka/yukaManager.js';

export function setPlayerRigRef(rig) { setPlayerRef(rig); }

// ── Player position tracking ──────────────────────────────────────────────────
let _playerRef = null;
let _playerPos = new BABYLON.Vector3(0, 0, 0);

export function setPlayerRef(rig) { _playerRef = rig; }
export function getPlayerPos() {
  if (_playerRef) _playerPos.copyFrom(_playerRef.position);
  return _playerPos;
}
export function distToPlayer(pos) {
  const p  = getPlayerPos();
  const dx = pos.x - p.x, dy = (pos.y ?? 0) - p.y, dz = pos.z - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ── _ym() helper (used by drones.js import) ───────────────────────────────────
export function _ym() { return getYukaManager(); }

// ── EnemyBase ─────────────────────────────────────────────────────────────────
export class EnemyBase {
  constructor(opts) {
    this.scene       = opts.scene;
    this.type        = opts.type   ?? 'guard';
    this.speed       = opts.speed  ?? 5;
    this.health      = opts.health ?? 100;
    this.maxHealth   = this.health;
    this.dead        = false;
    this.destroyed   = false;   // permanent — never resets, blocks respawn
    this.respawnTime  = opts.respawnTime ?? 8;
    this._respawnTimer = 0;
    this.waypoints   = opts.waypoints ?? [];
    this.noVehicle   = opts.noVehicle ?? false;

    // rapierWorld accepted for call-site compat but unused with Havok
    this._rapierWorld = opts.rapierWorld ?? null;

    const spawnPos = opts.spawnPos ?? new BABYLON.Vector3(0, 2, 0);
    this.mesh    = this._createMesh(spawnPos);
    this.body    = this._createPhysicsBody(spawnPos);
    this.vehicle = this.noVehicle ? null : this._createVehicle(spawnPos);

    if (this.vehicle && this.waypoints.length) {
      assignPath(this.vehicle, this.waypoints);
    }

    registerEnemy(this);
  }

  // ── Mesh ───────────────────────────────────────────────────────────────────
  _createMesh(pos) {
    const colors = { drone: '#44aaff', car: '#ff4444', forklift: '#ffaa00', guard: '#44ff88' };
    const sizes  = {
      drone:    { w: 1.2, h: 0.5,  d: 1.2 },
      car:      { w: 2.0, h: 1.0,  d: 4.0 },
      forklift: { w: 1.5, h: 2.0,  d: 2.5 },
      guard:    { w: 0.8, h: 1.8,  d: 0.8 },
    };
    const s    = sizes[this.type] ?? sizes.guard;
    const mesh = BABYLON.MeshBuilder.CreateBox(
      `enemy_${this.type}_${Date.now()}`,
      { width: s.w, height: s.h, depth: s.d },
      this.scene,
    );
    mesh.position.copyFrom(pos);
    const mat = new BABYLON.StandardMaterial('em_' + this.type, this.scene);
    mat.diffuseColor  = BABYLON.Color3.FromHexString(colors[this.type] ?? '#ffffff');
    mat.emissiveColor = mat.diffuseColor.scale(0.3);
    mesh.material = mat;
    return mesh;
  }

  // ── Body (mesh-proxy only) ─────────────────────────────────────────────────
  _createPhysicsBody(pos) {
    // Enemies are purely position-driven (YUKA / tick sets mesh.position directly).
    // We don't need a Havok body at all — just return a lightweight proxy that
    // exposes the Rapier-compatible API surface (.translation(), .setNextKinematicTranslation()).
    return _makeBodyProxy(this);
  }

  // ── YUKA vehicle ───────────────────────────────────────────────────────────
  _createVehicle(pos) {
    const ym = getYukaManager();
    if (!ym || !window.YUKA) return null;

    const v = new YUKA.Vehicle();
    v.position.set(+pos.x, +pos.y, +pos.z);
    v.maxSpeed = this.speed;
    v.maxForce = this.speed * 2;
    v.mass     = 1;

    v.setRenderComponent(this.mesh, (entity, renderComponent) => {
      renderComponent.position.set(entity.position.x, entity.position.y, entity.position.z);
      if (this.body) {
        const s = safeVec3(entity.position.x, entity.position.y, entity.position.z, 'yuka sync');
        if (s) this.body.setNextKinematicTranslation(s);
      }
    });

    ym.add(v);
    return v;
  }

  // ── Damage / respawn ──────────────────────────────────────────────────────
  takeDamage(amount) {
    if (this.dead || this.destroyed) return;
    this.health -= (amount ?? this.maxHealth);
    if (this.health <= 0) {
      this.dead = true;
      if (this.mesh) this.mesh.setEnabled(false);
      // Respawn after delay — but only if level is not yet complete
      setTimeout(() => {
        // Don't respawn if levelManager has already ended the level
        if (window._levelComplete) return;
        if (this.destroyed) return;
        if (this.mesh) this.mesh.setEnabled(true);
        this.health = this.maxHealth;
        this.dead   = false;
        this.state  = 'patrol';
      }, (this.respawnTime ?? 8) * 1000);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  dispose() {
    this.dead = true;
    try { this.body?.dispose(); } catch(e) {}
    try { this.mesh?.dispose(); } catch(e) {}
    const ym = getYukaManager();
    if (ym && this.vehicle) try { ym.remove(this.vehicle); } catch(e) {}
    unregisterEnemy(this);
  }
}

// ── Body proxy — lightweight wrapper; reads enemy.mesh dynamically ────────────
// Uses a ref object so that when _buildDroneMesh (etc.) replaces enemy.mesh
// after construction, the proxy still points at the live mesh.
function _makeBodyProxy(enemy) {
  return {
    translation() {
      const p = enemy.mesh?.position;
      if (!p) return { x: 0, y: 0, z: 0 };
      return { x: p.x, y: p.y, z: p.z };
    },

    setNextKinematicTranslation(pos) {
      if (!pos || !enemy.mesh) return;
      enemy.mesh.position.set(+pos.x, +pos.y, +pos.z);
    },

    rotation() {
      const q = enemy.mesh?.rotationQuaternion;
      return q ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: 0, y: 0, z: 0, w: 1 };
    },

    dispose() {},
  };
}