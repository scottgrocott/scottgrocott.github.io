// ============================================================
//  explosions.js — CPU particle explosion effects
// ============================================================

import { scene } from './core.js';

// ---- Shared particle textures ----
function makeParticleTex(innerColor, outerColor, size = 64) {
  const tex = new BABYLON.DynamicTexture('ptex', { width: size, height: size }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  const r   = size / 2;
  const grd = ctx.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0,   innerColor);
  grd.addColorStop(0.4, outerColor);
  grd.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  return tex;
}

const _texFireCore = makeParticleTex('rgba(255,255,220,1)',   'rgba(255,160,0,0.7)');
const _texFireMid  = makeParticleTex('rgba(255,120,0,0.95)', 'rgba(200,40,0,0.5)');
const _texFlame    = makeParticleTex('rgba(255,80,0,0.9)',   'rgba(255,200,0,0.4)');
const _texSmokeLt  = makeParticleTex('rgba(180,170,160,0.7)','rgba(120,115,110,0.0)');
const _texSmokeDk  = makeParticleTex('rgba(60,55,50,0.8)',   'rgba(30,28,25,0.0)');
const _texEmber    = makeParticleTex('rgba(255,240,80,1)',   'rgba(255,100,0,0.0)', 32);

// Shared source geometry (invisible, cloned per particle)
const _pGeo = BABYLON.MeshBuilder.CreatePlane('_pGeo', { width: 1, height: 1 }, scene);
_pGeo.isVisible = false;

// ---- Particle helpers ----
function makePartMat(tex, additive = false) {
  const mat = new BABYLON.StandardMaterial('pm', scene);
  mat.diffuseTexture              = tex;
  mat.diffuseTexture.hasAlpha     = true;
  mat.useAlphaFromDiffuseTexture  = true;
  mat.emissiveColor               = new BABYLON.Color3(1, 1, 1);
  mat.disableLighting             = true;
  mat.alphaMode                   = additive ? BABYLON.Engine.ALPHA_ADD : BABYLON.Engine.ALPHA_COMBINE;
  mat.backFaceCulling             = false;
  mat.depthWrite                  = false;
  return mat;
}

function makeParticle(tex, pos, vel, life, size, growRate, fadeStart, additive = false) {
  const mat  = makePartMat(tex, additive);
  mat.alpha  = 1.0;
  const mesh = _pGeo.clone('p');
  mesh.isVisible    = true;
  mesh.material     = mat;
  mesh.position.copyFrom(pos);
  mesh.scaling.setAll(size);
  mesh.rotation.z   = Math.random() * Math.PI * 2;
  mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  return { mesh, vel: vel.clone(), life, maxLife: life, size, growRate, fadeStart, mat };
}

// ---- Spawn helpers ----
function spawnFireball(group) {
  const particles = [];
  for (let i = 0; i < 32; i++) {
    const isCore = i < 10;
    const p = makeParticle(
      isCore ? _texFireCore : _texFireMid,
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3((Math.random() - 0.5) * 7, Math.random() * 6 + 2, (Math.random() - 0.5) * 7),
      0.25 + Math.random() * 0.45,
      isCore ? 1.0 + Math.random() * 1.2 : 0.5 + Math.random() * 0.9,
      2.5, 0.5, true,
    );
    p.mesh.parent = group;
    particles.push(p);
  }
  return particles;
}

function spawnFlames(group) {
  const particles = [];
  for (let i = 0; i < 20; i++) {
    const p = makeParticle(
      _texFlame,
      new BABYLON.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3),
      new BABYLON.Vector3((Math.random() - 0.5) * 1.4, 2 + Math.random() * 3, (Math.random() - 0.5) * 1.4),
      0.4 + Math.random() * 0.6, 0.5 + Math.random() * 0.7, 1.2, 0.4, true,
    );
    p.mesh.parent = group;
    particles.push(p);
  }
  return particles;
}

function spawnSmokePuff(offset, group) {
  const particles = [];
  for (let i = 0; i < 8; i++) {
    const p = makeParticle(
      Math.random() < 0.5 ? _texSmokeDk : _texSmokeLt,
      offset.clone().add(new BABYLON.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5)),
      new BABYLON.Vector3((Math.random() - 0.5) * 1.0, -0.6 - Math.random() * 1.8, (Math.random() - 0.5) * 1.0),
      1.0 + Math.random() * 1.2, 0.6 + Math.random() * 1.0, 3.0, 0.3, false,
    );
    p.mesh.parent = group;
    particles.push(p);
  }
  return particles;
}

function spawnEmbers(group) {
  const particles = [];
  for (let i = 0; i < 24; i++) {
    const p = makeParticle(
      _texEmber,
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3((Math.random() - 0.5) * 11, Math.random() * 9 + 2, (Math.random() - 0.5) * 11),
      0.7 + Math.random() * 1.6, 0.08 + Math.random() * 0.14, 0, 0.6, true,
    );
    p.mesh.parent = group;
    particles.push(p);
  }
  return particles;
}

// ---- Active effects list ----
const activeEffects = [];

export function spawnExplosionEffect(droneGroup) {
  const fxGroup    = new BABYLON.TransformNode('fx', scene);
  fxGroup.parent   = droneGroup;

  const allParticles   = [...spawnFireball(fxGroup), ...spawnEmbers(fxGroup)];
  const flameParticles = [];

  activeEffects.push({
    fxGroup, allParticles, flameParticles,
    smokeTimer: 0, flamesSpawned: false, elapsed: 0, totalLife: 5.0,

    update(dt) {
      this.elapsed += dt;
      const t = this.elapsed;

      if (!this.flamesSpawned && t > 0.05) {
        this.flamesSpawned = true;
        const fp = spawnFlames(fxGroup);
        this.flameParticles.push(...fp);
        this.allParticles.push(...fp);
      }

      // Recycle flame particles
      if (t < 3.8) {
        for (const p of this.flameParticles) {
          if (p.life <= 0) {
            p.mesh.isVisible = true;
            p.mesh.position.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4);
            p.vel.set((Math.random() - 0.5) * 1.4, 2 + Math.random() * 3, (Math.random() - 0.5) * 1.4);
            p.life = 0.4 + Math.random() * 0.6; p.maxLife = p.life;
            p.size = 0.5 + Math.random() * 0.7;
            p.mesh.scaling.setAll(p.size);
            p.mat.alpha = 1.0;
          }
        }
      }

      // Continuous smoke puffs
      this.smokeTimer += dt;
      if (t < 4.2 && this.smokeTimer >= 0.07) {
        this.smokeTimer = 0;
        const sp = spawnSmokePuff(
          new BABYLON.Vector3((Math.random() - 0.5) * 0.3, -0.1, (Math.random() - 0.5) * 0.3),
          fxGroup,
        );
        this.allParticles.push(...sp);
      }

      // Tick all particles
      for (const p of this.allParticles) {
        if (p.life <= 0) continue;
        p.life -= dt;
        const norm = Math.max(0, p.life / p.maxLife);
        p.mesh.position.addInPlace(p.vel.scale(dt));
        p.vel.y += -3.5 * dt;
        p.mesh.scaling.setAll(p.size * (1 + p.growRate * (1 - norm)));
        p.mat.alpha = norm < p.fadeStart ? norm / p.fadeStart : 1.0;
        p.mesh.rotation.z += dt * 0.4 * (p.size > 0.5 ? 1 : -1);
        if (p.life <= 0) p.mesh.isVisible = false;
      }
    },
  });
}

export function tickExplosions(dt) {
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const fx = activeEffects[i];
    fx.update(dt);
    if (fx.elapsed >= fx.totalLife) activeEffects.splice(i, 1);
  }
}
