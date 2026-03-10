// weapons/basicGun.js — bullet pool (kinematic, no physics body)
// Bullets are moved manually each frame — no PhysicsAggregate needed.
// This avoids collision with the player capsule and removes the bounce-back bug.

import { scene }      from '../core.js';
import { camera }     from '../core.js';
import { playerRig }  from '../player.js';
import { euler }      from '../look.js';
import { physicsReady } from '../physics.js';
import { getEnemies, hitEnemy } from '../enemies/enemyRegistry.js';
import { onBoatHit } from '../enemies/boats.js';
import { onSubmarineHit } from '../enemies/submarines.js';
import { onShelterHit, panelMeshes } from '../shelterBridge.js';
import { createWeaponBase } from './weaponBase.js';
import { CONFIG }     from '../config.js';
import { hudSetAmmo } from '../hud.js';

let _weapon  = null;
let _bullets = [];
const MAX_BULLETS = 30;
const BULLET_LIFE = 4.0;

export function initWeapon(def) {
  _weapon  = createWeaponBase(def || CONFIG.weapons?.[0] || {});
  _bullets = [];
  hudSetAmmo(_weapon.ammo);
}

export function shootBullet() {
  if (!_weapon || !playerRig) return;
  if (_weapon.cooldown > 0) return;
  if (_weapon.ammo <= 0)    return;

  _weapon.cooldown = _weapon.cooldownMax;
  if (_weapon.ammo !== Infinity) { _weapon.ammo--; hudSetAmmo(_weapon.ammo); }

  const origin = camera.globalPosition;
  const ox = +origin.x, oy = +origin.y, oz = +origin.z;
  if (isNaN(ox) || isNaN(oy) || isNaN(oz)) return;

  const yaw  = euler.y, pitch = euler.x;
  const sinY = Math.sin(yaw),  cosY  = Math.cos(yaw);
  const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
  const dirX = sinY * cosP, dirY = -sinP, dirZ = cosY * cosP;

  // Offset spawn 0.8m forward so bullet starts past the player capsule
  const r    = _weapon.bulletRadius ?? 0.08;
  const mesh = BABYLON.MeshBuilder.CreateSphere('bullet', { diameter: r * 2, segments: 4 }, scene);
  mesh.position.set(ox + dirX * 0.8, oy + dirY * 0.8, oz + dirZ * 0.8);
  mesh.isPickable = false;

  const mat = new BABYLON.StandardMaterial('bulletMat_' + Date.now(), scene);
  mat.diffuseColor  = new BABYLON.Color3(1, 0.9, 0.3);
  mat.emissiveColor = new BABYLON.Color3(1, 0.7, 0.1);
  mesh.material = mat;

  const spd = _weapon.bulletSpeed ?? 60;
  _bullets.push({
    mesh,
    vx: dirX * spd,
    vy: dirY * spd,
    vz: dirZ * spd,
    life: BULLET_LIFE,
    dead: false,
  });

  if (_bullets.length > MAX_BULLETS) {
    _killBullet(_bullets.shift());
  }
}

const GRAVITY = 9.8 * 0.05;  // gentle bullet drop (matches old gravityFactor 0.05)

export function tickBullets(dt) {
  if (!_weapon) return;
  if (_weapon.cooldown > 0) _weapon.cooldown -= dt;

  for (let i = _bullets.length - 1; i >= 0; i--) {
    const b = _bullets[i];
    if (b.dead) { _bullets.splice(i, 1); continue; }

    b.life -= dt;
    if (b.life <= 0) { _killBullet(b); _bullets.splice(i, 1); continue; }

    // Manual kinematic movement
    b.vy -= GRAVITY * dt;
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.z += b.vz * dt;

    const { x: bx, y: by, z: bz } = b.mesh.position;
    if (isNaN(bx)) { _killBullet(b); _bullets.splice(i, 1); continue; }

    // Distance-based hit detection against all live enemies
    for (const enemy of getEnemies()) {
      if (enemy.dead) continue;
      const ep = enemy.mesh?.position;
      if (!ep) continue;
      const dx = bx - ep.x, dy = by - ep.y, dz = bz - ep.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1.4) {
        if (enemy.type === 'boat') {
          onBoatHit(enemy);
        } else if (enemy.type === 'submarine') {
          onSubmarineHit(enemy);
        } else {
          hitEnemy(enemy);
        }
        _killBullet(b);
        b.dead = true;
        break;
      }
    }
    if (b.dead) continue;

    // Shelter / panel hit — distance check against all panel meshes (same pattern as enemies)
    if (!b.dead) {
      const dir = new BABYLON.Vector3(b.vx, b.vy, b.vz).normalize();
      for (const pm of panelMeshes) {
        if (pm.isDisposed() || !pm.isEnabled()) continue;
        const pp = pm.getAbsolutePosition();  // panel.parent = root so position is local
        const dx = bx - pp.x, dy = by - pp.y, dz = bz - pp.z;
        if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 0.8) {
          onShelterHit(pm, b.mesh.position.clone(), dir);
          _killBullet(b);
          b.dead = true;
          break;
        }
      }
    }
  }
}

function _killBullet(b) {
  try { b.mesh?.dispose(); } catch(e) {}
  b.mesh = null;
}

export function clearBullets() {
  for (const b of _bullets) _killBullet(b);
  _bullets = [];
}