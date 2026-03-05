// explosions.js — particle bursts on enemy kill

import { scene } from './core.js';

let _explosions = [];

export function spawnExplosion(worldPos) {
  const px = +worldPos.x, py = +worldPos.y, pz = +worldPos.z;
  if (isNaN(px)) return;

  // Particle system
  const ps = new BABYLON.ParticleSystem('explosion', 80, scene);
  ps.emitter = new BABYLON.Vector3(px, py, pz);
  ps.minEmitBox = new BABYLON.Vector3(-0.3, -0.3, -0.3);
  ps.maxEmitBox = new BABYLON.Vector3( 0.3,  0.3,  0.3);

  ps.color1       = new BABYLON.Color4(1.0, 0.6, 0.1, 1);
  ps.color2       = new BABYLON.Color4(0.8, 0.2, 0.0, 1);
  ps.colorDead    = new BABYLON.Color4(0.2, 0.1, 0.0, 0);

  ps.minSize = 0.2; ps.maxSize = 0.8;
  ps.minLifeTime = 0.3; ps.maxLifeTime = 0.9;
  ps.emitRate = 200;
  ps.gravity  = new BABYLON.Vector3(0, -6, 0);
  ps.direction1 = new BABYLON.Vector3(-4, 4, -4);
  ps.direction2 = new BABYLON.Vector3( 4, 8,  4);
  ps.minAngularSpeed = 0;
  ps.maxAngularSpeed = Math.PI;
  ps.minEmitPower = 4; ps.maxEmitPower = 8;
  ps.updateSpeed = 0.02;

  ps.start();

  // Flash sphere
  const flash = BABYLON.MeshBuilder.CreateSphere('flash', { diameter: 2 }, scene);
  flash.position.set(px, py, pz);
  const mat = new BABYLON.StandardMaterial('flashMat', scene);
  mat.diffuseColor  = new BABYLON.Color3(1, 0.7, 0.2);
  mat.emissiveColor = new BABYLON.Color3(1, 0.5, 0.1);
  flash.material = mat;

  const entry = { ps, flash, life: 0.8, t: 0 };
  _explosions.push(entry);
}

export function tickExplosions(dt) {
  for (let i = _explosions.length - 1; i >= 0; i--) {
    const ex = _explosions[i];
    ex.t += dt;
    if (ex.t > 0.05 && ex.flash) {
      try { ex.flash.dispose(); } catch(e) {}
      ex.flash = null;
    }
    if (ex.t > ex.life) {
      try { ex.ps.stop(); ex.ps.dispose(); } catch(e) {}
      _explosions.splice(i, 1);
    }
  }
}
