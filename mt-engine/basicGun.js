// weapons/basicGun.js — hitscan + Rapier sphere bullet pool

import { scene, shadowGenerator } from '../core.js';
import { camera }   from '../core.js';
import { playerRig } from '../player.js';
import { euler }    from '../look.js';
import { physicsWorld, physicsReady, safeVec3 } from '../physics.js';
import { getEnemies, hitEnemy } from '../enemies/enemyRegistry.js';
import { createWeaponBase } from './weaponBase.js';
import { CONFIG } from '../config.js';
import { hudSetAmmo } from '../hud.js';

let _weapon = null;
let _bullets = [];
const MAX_BULLETS = 30;
const BULLET_LIFE = 4.0;

export function initWeapon(def) {
  _weapon = createWeaponBase(def || CONFIG.weapons[0] || {});
  _bullets = [];
  hudSetAmmo(_weapon.ammo);
}

export function shootBullet() {
  if (!_weapon || !physicsReady || !playerRig) return;
  if (_weapon.cooldown > 0) return;
  if (_weapon.ammo <= 0) return;

  _weapon.cooldown = _weapon.cooldownMax;
  if (_weapon.ammo !== Infinity) {
    _weapon.ammo--;
    hudSetAmmo(_weapon.ammo);
  }

  // Spawn position: camera world position
  const origin = camera.globalPosition;
  const ox = +origin.x, oy = +origin.y, oz = +origin.z;
  if (isNaN(ox)||isNaN(oy)||isNaN(oz)) return;

  // Direction from euler look
  const yaw = euler.y, pitch = euler.x;
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
  const dirX = sinY * cosP, dirY = -sinP, dirZ = cosY * cosP;

  // Rapier sphere body
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(ox, oy, oz)
    .setLinearDamping(0.0)
    .setGravityScale(0.05);
  const body = physicsWorld.createRigidBody(bodyDesc);
  const cdesc = RAPIER.ColliderDesc.ball(_weapon.bulletRadius).setDensity(0.01).setSensor(true);
  physicsWorld.createCollider(cdesc, body);

  const spd = _weapon.bulletSpeed;
  body.setLinvel({ x: dirX*spd, y: dirY*spd, z: dirZ*spd }, true);

  // Visual bullet
  const mesh = BABYLON.MeshBuilder.CreateSphere('bullet', { diameter: _weapon.bulletRadius * 2 }, scene);
  mesh.position.set(ox, oy, oz);
  const mat = new BABYLON.StandardMaterial('bulletMat', scene);
  mat.diffuseColor  = new BABYLON.Color3(1, 0.9, 0.3);
  mat.emissiveColor = new BABYLON.Color3(1, 0.7, 0.1);
  mesh.material = mat;

  // Muzzle flash: brief scale pulse
  mesh.scaling.setAll(2.5);
  setTimeout(() => { if (mesh && !mesh.isDisposed()) mesh.scaling.setAll(1); }, 40);

  _bullets.push({ body, mesh, life: BULLET_LIFE, dead: false });
}

export function tickBullets(dt) {
  if (!_weapon) return;
  if (_weapon.cooldown > 0) _weapon.cooldown -= dt;

  for (let i = _bullets.length - 1; i >= 0; i--) {
    const b = _bullets[i];
    if (b.dead) { _bullets.splice(i, 1); continue; }

    b.life -= dt;
    if (b.life <= 0) { _killBullet(b); _bullets.splice(i, 1); continue; }

    // Sync mesh from physics — guard against stale body after physics world reset
    if (b.body) {
      let t;
      try { t = b.body.translation(); } catch(e) { _killBullet(b); _bullets.splice(i, 1); continue; }
      const bx = +t.x, by = +t.y, bz = +t.z;
      if (!isNaN(bx)) {
        b.mesh.position.set(bx, by, bz);

        // Hit detection vs enemies
        for (const enemy of getEnemies()) {
          if (enemy.dead) continue;
          const ep = enemy.mesh?.position || enemy.group?.position;
          if (!ep) continue;
          const dx = bx - ep.x, dy = by - ep.y, dz = bz - ep.z;
          if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 1.2) {
            hitEnemy(enemy);
            _killBullet(b);
            b.dead = true;
            break;
          }
        }
      }
    }
  }
}

function _killBullet(b) {
  if (b.body) {
    try { physicsWorld.removeRigidBody(b.body); } catch(e) {}
    b.body = null;
  }
  if (b.mesh) {
    try { b.mesh.dispose(); } catch(e) {}
    b.mesh = null;
  }
}

export function clearBullets() {
  for (const b of _bullets) _killBullet(b);
  _bullets = [];
}