// ============================================================
//  bullets.js — Projectile shooting + hit detection
// ============================================================

import { scene, camera }                     from './core.js';
import { CONFIG }                             from './config.js';
import { physicsReady }                       from './physics.js';
import { player }                             from './player.js';
import { playGunshot, playBulletHit }         from './audio.js';
import { drones, killDrone }                  from './drones.js';

const bullets = [];

export function shootBullet() {
  if (!physicsReady) return;

  Tone.start().catch(() => {});
  playGunshot();
  player.shotsFired++;

  const origin = camera.globalPosition.clone();
  // In right-handed system the camera looks down –Z
  const dir    = camera.getDirection(new BABYLON.Vector3(0, 0, -1)).normalize();

  const mesh = BABYLON.MeshBuilder.CreateSphere('bullet', { diameter: CONFIG.bulletRadius * 2, segments: 6 }, scene);
  const mat  = new BABYLON.StandardMaterial('bulletMat', scene);
  mat.diffuseColor  = new BABYLON.Color3(1, 1, 0);
  mat.emissiveColor = new BABYLON.Color3(1, 0.6, 0);
  mat.disableLighting = true;
  mesh.material = mat;
  mesh.position.copyFrom(origin);

  bullets.push({ mesh, dir, speed: CONFIG.bulletSpeed, life: CONFIG.bulletLife, dead: false });
}

export function tickBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    if (b.dead) { bullets.splice(i, 1); continue; }

    b.life -= dt;
    if (b.life <= 0) {
      b.mesh.dispose(); b.dead = true; bullets.splice(i, 1); continue;
    }

    b.mesh.position.addInPlace(b.dir.scale(b.speed * dt));

    let hitSomething = false;
    for (const drone of drones) {
      if (drone.dead || hitSomething) continue;
      if (BABYLON.Vector3.Distance(b.mesh.position, drone.group.position) < 1.0) {
        if (BABYLON.Vector3.Distance(b.mesh.position, drone.detonatorMesh.getAbsolutePosition()) < 0.35) {
          killDrone(drone);
        } else {
          drone.hitCount++;
          playBulletHit();
          drone.triggerHunt();

          // Knockback
          const knockDir = new BABYLON.Vector3(b.dir.x, 0.5, b.dir.z).normalize();
          drone.vehicle.position.x += knockDir.x * 0.5;
          drone.vehicle.position.y += knockDir.y * 0.3;
          drone.vehicle.position.z += knockDir.z * 0.5;

          // Flash white
          drone.group.getChildMeshes().forEach(child => {
            if (child.material) {
              const orig = child.material.emissiveColor.clone();
              child.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
              setTimeout(() => { child.material.emissiveColor = orig; }, 80);
            }
          });

          if (drone.hitCount >= CONFIG.hitsToDetonate) killDrone(drone);
        }
        hitSomething = true;
      }
    }

    if (hitSomething) { b.mesh.dispose(); b.dead = true; bullets.splice(i, 1); }
  }
}
