// ============================================================
//  bullets.js — Projectile shooting + hit detection
//
//  Performance notes:
//  - Shared bullet material (one StandardMaterial, never recreated)
//  - b.dir.scale(dt) replaced with manual scalar multiply (no alloc)
//  - DistanceSquared used instead of Distance (no sqrt)
//  - Knockback uses manual scalar math (no Vector3 alloc)
//  - Hit flash uses pre-allocated Color3 scratch
// ============================================================

import { scene, camera }             from './core.js';
import { CONFIG }                    from './config.js';
import { physicsReady }              from './physics.js';
import { player }                    from './player.js';
import { playGunshot, playBulletHit } from './audio.js';
import { drones, killDrone }         from './drones.js';

const bullets = [];

// ---- Shared bullet material — created once, reused for every bullet ----
let _bulletMat = null;
function _getBulletMat() {
  if (_bulletMat) return _bulletMat;
  _bulletMat = new BABYLON.StandardMaterial('sharedBulletMat', scene);
  _bulletMat.diffuseColor  = new BABYLON.Color3(1, 1, 0);
  _bulletMat.emissiveColor = new BABYLON.Color3(1, 0.6, 0);
  _bulletMat.disableLighting = true;
  return _bulletMat;
}

// Scratch Color3 for hit flash — never reallocated
const _flashOrig = new BABYLON.Color3();

// Reusable direction vector for shoot (avoids alloc per shot)
const _shootDir = new BABYLON.Vector3();
const _shootFwd = new BABYLON.Vector3(0, 0, -1);

export function shootBullet() {
  if (!physicsReady) return;

  Tone.start().catch(() => {});
  playGunshot();
  player.shotsFired++;

  const origin = camera.globalPosition.clone();
  camera.getDirectionToRef(_shootFwd, _shootDir);
  _shootDir.normalizeToRef(_shootDir);

  const mesh = BABYLON.MeshBuilder.CreateSphere('bullet', { diameter: CONFIG.bulletRadius * 2, segments: 4 }, scene);
  mesh.material = _getBulletMat();
  mesh.position.copyFrom(origin);

  // Store dir as plain numbers — no Vector3 object in the bullet record
  bullets.push({
    mesh,
    dx: _shootDir.x, dy: _shootDir.y, dz: _shootDir.z,
    speed: CONFIG.bulletSpeed,
    life:  CONFIG.bulletLife,
    dead:  false,
  });
}

// Squared thresholds — avoids sqrt in hot loop
const HIT_DIST_SQ  = 1.0 * 1.0;
const DET_DIST_SQ  = 0.35 * 0.35;

export function tickBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.dead) { bullets.splice(i, 1); continue; }

    b.life -= dt;
    if (b.life <= 0) {
      b.mesh.dispose(); bullets.splice(i, 1); continue;
    }

    // Manual scalar advance — no Vector3 allocation
    const step = b.speed * dt;
    b.mesh.position.x += b.dx * step;
    b.mesh.position.y += b.dy * step;
    b.mesh.position.z += b.dz * step;

    let hitSomething = false;
    for (const drone of drones) {
      if (drone.dead || hitSomething) continue;
      if (BABYLON.Vector3.DistanceSquared(b.mesh.position, drone.group.position) < HIT_DIST_SQ) {
        if (BABYLON.Vector3.DistanceSquared(b.mesh.position, drone.detonatorMesh.getAbsolutePosition()) < DET_DIST_SQ) {
          killDrone(drone);
        } else {
          drone.hitCount++;
          playBulletHit();
          drone.triggerHunt();

          // Knockback — pure scalar, no Vector3 alloc
          const klen = Math.sqrt(b.dx * b.dx + 0.25 + b.dz * b.dz) || 1;
          drone.vehicle.position.x += (b.dx / klen) * 0.5;
          drone.vehicle.position.y += (0.5  / klen) * 0.3;
          drone.vehicle.position.z += (b.dz / klen) * 0.5;

          // Hit flash — reuse shared Color3 scratch
          for (const child of drone.rotorMeshes) {
            if (!child.material) continue;
            _flashOrig.copyFrom(child.material.emissiveColor);
            child.material.emissiveColor.set(1, 1, 1);
            const mat = child.material;
            const orig = _flashOrig.clone();   // one clone per hit is acceptable
            setTimeout(() => { mat.emissiveColor.copyFrom(orig); }, 80);
          }
          // Also flash body
          _flashOrig.copyFrom(drone.bodyMat.emissiveColor);
          const bodyOrig = _flashOrig.clone();
          drone.bodyMat.emissiveColor.set(1, 1, 1);
          setTimeout(() => { drone.bodyMat.emissiveColor.copyFrom(bodyOrig); }, 80);

          if (drone.hitCount >= CONFIG.hitsToDetonate) killDrone(drone);
        }
        hitSomething = true;
      }
    }

    if (hitSomething) { b.mesh.dispose(); bullets.splice(i, 1); }
  }
}