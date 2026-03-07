// weapons/basicGun.js — bullet pool, no per-bullet Rapier bodies, shared material

import { scene }      from '../core.js';
import { camera }     from '../core.js';
import { playerRig }  from '../player.js';
import { euler }      from '../look.js';
import { physicsReady } from '../physics.js';
import { getEnemies, hitEnemy } from '../enemies/enemyRegistry.js';
import { createWeaponBase } from './weaponBase.js';
import { CONFIG }     from '../config.js';
import { hudSetAmmo } from '../hud.js';

let _weapon   = null;
let _bullets  = [];

const MAX_BULLETS   = 40;
const BULLET_LIFE   = 3.0;    // seconds before auto-expire
const HIT_RADIUS    = 1.5;    // world units — hit sphere around enemy centre
const HIT_RADIUS_SQ = HIT_RADIUS * HIT_RADIUS;

// ── Shared material (created once, reused by every bullet mesh) ─────────────
let _bulletMat = null;
function _getMat() {
  if (_bulletMat) return _bulletMat;
  _bulletMat = new BABYLON.StandardMaterial('_bulletMat', scene);
  _bulletMat.diffuseColor  = new BABYLON.Color3(1, 0.9, 0.3);
  _bulletMat.emissiveColor = new BABYLON.Color3(1, 0.7, 0.1);
  _bulletMat.freeze();   // prevents shader recompile each frame
  return _bulletMat;
}

// ── Mesh pool ────────────────────────────────────────────────────────────────
// Meshes are hidden (setEnabled false) when idle, re-used on fire.
const _pool = [];

function _acquireMesh(radius) {
  for (const m of _pool) {
    if (!m.isEnabled()) {
      m.setEnabled(true);
      return m;
    }
  }
  const m = BABYLON.MeshBuilder.CreateSphere('bullet',
    { diameter: radius * 2, segments: 4 }, scene);
  m.material   = _getMat();
  m.isPickable = false;
  _pool.push(m);
  return m;
}

function _releaseMesh(m) {
  if (m) m.setEnabled(false);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initWeapon(def) {
  _weapon = createWeaponBase(def || CONFIG.weapons?.[0] || {});
  clearBullets();
  hudSetAmmo(_weapon.ammo);
}

export function shootBullet() {
  if (!_weapon || !physicsReady || !playerRig) return;
  if (_weapon.cooldown > 0) return;
  if (_weapon.ammo <= 0)    return;
  if (_bullets.length >= MAX_BULLETS) return;

  _weapon.cooldown = _weapon.cooldownMax;
  if (_weapon.ammo !== Infinity) {
    _weapon.ammo--;
    hudSetAmmo(_weapon.ammo);
  }

  const origin = camera.globalPosition;
  const ox = +origin.x, oy = +origin.y, oz = +origin.z;
  if (isNaN(ox) || isNaN(oy) || isNaN(oz)) return;

  const yaw = euler.y, pitch = euler.x;
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
  const dirX = sinY * cosP, dirY = -sinP, dirZ = cosY * cosP;

  const r   = _weapon.bulletRadius ?? 0.12;
  const spd = _weapon.bulletSpeed  ?? 60;

  const mesh = _acquireMesh(r);
  mesh.position.set(ox, oy, oz);
  mesh.scaling.setAll(2.5);
  setTimeout(() => { if (mesh.isEnabled()) mesh.scaling.setAll(1); }, 40);

  _bullets.push({
    mesh,
    vx: dirX * spd, vy: dirY * spd, vz: dirZ * spd,
    life: BULLET_LIFE,
    dead: false,
  });
}

export function tickBullets(dt) {
  if (!_weapon) return;
  if (_weapon.cooldown > 0) _weapon.cooldown -= dt;

  const enemies = getEnemies();

  for (let i = _bullets.length - 1; i >= 0; i--) {
    const b = _bullets[i];
    if (b.dead) {
      _releaseMesh(b.mesh);
      _bullets.splice(i, 1);
      continue;
    }

    b.life -= dt;
    if (b.life <= 0) {
      _releaseMesh(b.mesh);
      _bullets.splice(i, 1);
      continue;
    }

    // Manual movement — 5% gravity droop, no Rapier body per bullet
    b.vy -= 9.8 * 0.05 * dt;
    const bx = b.mesh.position.x + b.vx * dt;
    const by = b.mesh.position.y + b.vy * dt;
    const bz = b.mesh.position.z + b.vz * dt;
    b.mesh.position.set(bx, by, bz);

    // Squared-distance hit check — no sqrt until a hit is confirmed
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const ep = enemy.mesh?.position;
      if (!ep) continue;
      const dx = bx - ep.x, dy = by - ep.y, dz = bz - ep.z;
      if (dx*dx + dy*dy + dz*dz < HIT_RADIUS_SQ) {
        hitEnemy(enemy);
        _releaseMesh(b.mesh);
        b.dead = true;
        break;
      }
    }
  }
}

export function clearBullets() {
  for (const b of _bullets) _releaseMesh(b.mesh);
  _bullets = [];
}