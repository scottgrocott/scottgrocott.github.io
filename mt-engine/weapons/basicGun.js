// weapons/basicGun.js — Han Solo DL-44 blaster (hitscan laser)
// Hitscan: instant raycast, no projectile travel time.
// VFX: muzzle flash, laser beam streak, smoke puff, scorch decal.

import { scene }        from '../core.js';
import { camera }       from '../core.js';
import { playerRig, player } from '../player.js';
import { euler }        from '../look.js';
import { getEnemies, hitEnemy } from '../enemies/enemyRegistry.js';
import { onBoatHit }    from '../enemies/boats.js';
import { onShelterHit, onFlyingPanelHit, panelMeshes, flyingPanels } from '../shelterBridge.js';
import { createWeaponBase } from './weaponBase.js';
import { CONFIG }        from '../config.js';
import { hudSetAmmo }    from '../hud.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';

let _weapon = null;

// VFX pools
const _beams    = [];   // { mesh, life }
const _smokes   = [];   // active ParticleSystem instances (auto-disposed)
const _scorches = [];   // { mesh, life, maxLife }
const _flashes  = [];   // { mesh, life }

const BEAM_LIFE    = 0.055;  // ~3 frames — parented to rig so no float
// SMOKE_LIFE removed — ParticleSystem manages its own lifetime
const SCORCH_LIFE  = 8.0;
const FLASH_LIFE   = 0.03;
const MAX_SCORCHES = 24;

// ── Sound: steel wire twang — sharp transient + fast descending pitch glide ────
// Based on the real DL-44 sound: a wrench striking a high-tension cable.
// Layers: metallic click (MetalSynth) + sine glide from ~1200Hz→80Hz + spring reverb tail
let _soundReady = false;
let _metalSynth = null;
let _glideOsc   = null;   // raw WebAudio oscillator for the fast pitch glide
let _glideGain  = null;
let _springReverb = null;

function _initSound() {
  if (_soundReady || !window.Tone || Tone.context.state !== 'running') return;
  try {
    const ctx = Tone.context.rawContext;

    // Spring reverb — short room, bright
    _springReverb = new Tone.Reverb({ decay: 0.8, preDelay: 0.005 });
    _springReverb.wet.value = 0.35;
    _springReverb.generate();
    _springReverb.toDestination();

    // Metal click — very short percussive transient
    _metalSynth = new Tone.MetalSynth({
      frequency:   400,
      envelope:    { attack: 0.001, decay: 0.04, release: 0.01 },
      harmonicity: 3.1,
      modulationIndex: 16,
      resonance:   3200,
      octaves:     1.2,
      volume:      -4,
    }).connect(_springReverb);

    // Gain node for the glide oscillator
    _glideGain = ctx.createGain();
    _glideGain.gain.value = 0;
    // Connect raw gain → Tone destination
    // _glideGain used only as template - real gain nodes created per shot

    _soundReady = true;
  } catch(e) { console.warn('[basicGun] sound init failed:', e); }
}

function _playBlasterSound() {
  _initSound();
  if (!_soundReady) return;
  try {
    const ctx = Tone.context.rawContext;
    const now = ctx.currentTime;

    // 1. Metal click transient
    _metalSynth.triggerAttackRelease('16n', Tone.now());

    // 2. Wire twang glide — new oscillator every shot (cheap, disposable)
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    // Frequency glides: 1400Hz → 55Hz over ~0.22s  (the "traveling down the wire" feel)
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.22);

    // Amplitude: sharp attack, fast decay
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55, now + 0.003);   // snap
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);  // tail

    // Add a tiny bit of spring by routing through reverb input if available
    osc.connect(gain);
    // Route through spring reverb if accessible, else straight to output
    try { gain.connect(_springReverb._wetGain ?? _springReverb.input ?? ctx.destination); }
    catch(e) { gain.connect(ctx.destination); }

    osc.start(now);
    osc.stop(now + 0.3);

    // Cleanup after stop
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch(e) {} };

  } catch(e) { console.warn('[basicGun] shot sound:', e); }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initWeapon(def) {
  _weapon = createWeaponBase(def || CONFIG.weapons?.[0] || {});
  hudSetAmmo(_weapon.ammo);
}

// ── Shoot ─────────────────────────────────────────────────────────────────────
export function shootBullet() {
  if (!_weapon || !playerRig) return;
  if (_weapon.cooldown > 0)   return;
  if (_weapon.ammo <= 0)      return;

  _weapon.cooldown = _weapon.cooldownMax;
  if (_weapon.ammo !== Infinity) { _weapon.ammo--; hudSetAmmo(_weapon.ammo); }

  _playBlasterSound();

  if (!playerRig) return;
  // Read directly from Havok body translation — always current, never lags movement
  const _bt = player.aggregate?.body?.getTranslation?.() ?? player.aggregate?.body?.translation?.();
  const eyeY = +camera.position.y;  // local offset (0.7 standing, 0.2 ducking)
  const ox = +(_bt?.x ?? playerRig.position.x);
  const oy = +(_bt?.y ?? playerRig.position.y) + eyeY;
  const oz = +(_bt?.z ?? playerRig.position.z);
  if (isNaN(ox)) return;

  const yaw = euler.y, pitch = euler.x;
  const sinY = Math.sin(yaw),  cosY = Math.cos(yaw);
  const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
  const dirX = sinY * cosP, dirY = -sinP, dirZ = cosY * cosP;

  // Barrel offset: right + down from crosshair. NO back offset — causes lag artefact.
  // Beam origin is pushed slightly forward so it never spawns inside the player.
  const rightX = cosY, rightZ = -sinY;
  const BARREL_RIGHT   = 0.17;   // shifted left ~one beam diameter
  const BARREL_DOWN    = 0.13;   // shifted down ~one beam diameter
  const BARREL_FORWARD = 0.55;
  const box = ox + rightX * BARREL_RIGHT + dirX * BARREL_FORWARD;
  const boy = oy - BARREL_DOWN           + dirY * BARREL_FORWARD;
  const boz = oz + rightZ * BARREL_RIGHT + dirZ * BARREL_FORWARD;

  const RANGE = _weapon.range ?? 200;

  _spawnMuzzleFlash(box, boy, boz);

  // ── Hitscan ───────────────────────────────────────────────────────────────
  let hitDist = RANGE;
  let hitPos  = null;
  let hitType = null;
  let hitObj  = null;

  // 1. Enemies
  for (const enemy of getEnemies()) {
    if (enemy.dead) continue;
    const ep = enemy.mesh?.position;
    if (!ep) continue;
    const d = _raySphereDist(ox, oy, oz, dirX, dirY, dirZ, ep.x, ep.y, ep.z, 1.4);
    if (d !== null && d < hitDist) {
      hitDist = d; hitPos = new BABYLON.Vector3(ox+dirX*d, oy+dirY*d, oz+dirZ*d);
      hitType = 'enemy'; hitObj = enemy;
    }
  }

  // 2. Panels
  for (const pm of panelMeshes) {
    if (pm.isDisposed() || !pm.isEnabled()) continue;
    const pp = pm.getAbsolutePosition();
    const d  = _raySphereDist(ox, oy, oz, dirX, dirY, dirZ, pp.x, pp.y, pp.z, 0.8);
    if (d !== null && d < hitDist) {
      hitDist = d; hitPos = new BABYLON.Vector3(ox+dirX*d, oy+dirY*d, oz+dirZ*d);
      hitType = 'panel'; hitObj = pm;
    }
  }

  // 3. Flying panels (already launched — chase and shoot them)
  for (const pm of flyingPanels) {
    if (pm.isDisposed()) { flyingPanels.delete(pm); continue; }
    const pp = pm.getAbsolutePosition();
    const d  = _raySphereDist(ox, oy, oz, dirX, dirY, dirZ, pp.x, pp.y, pp.z, 0.9);
    if (d !== null && d < hitDist) {
      hitDist = d; hitPos = new BABYLON.Vector3(ox+dirX*d, oy+dirY*d, oz+dirZ*d);
      hitType = 'flyingPanel'; hitObj = pm;
    }
  }

  // 4. Terrain — step along ray
  if (!hitPos) {
    const STEPS = 40;
    for (let s = 1; s <= STEPS; s++) {
      const t  = (RANGE / STEPS) * s;
      const rx = ox + dirX * t, ry = oy + dirY * t, rz = oz + dirZ * t;
      if (ry <= getTerrainHeightAt(rx, rz)) {
        hitDist = t;
        hitPos  = new BABYLON.Vector3(rx, getTerrainHeightAt(rx, rz), rz);
        hitType = 'terrain';
        break;
      }
    }
  }

  // ── Beam ──────────────────────────────────────────────────────────────────
  const beamEnd = hitPos ?? new BABYLON.Vector3(ox+dirX*RANGE, oy+dirY*RANGE, oz+dirZ*RANGE);
  _spawnBeam(box, boy, boz, beamEnd);

  // ── Apply damage / effects ────────────────────────────────────────────────
  if (hitPos) {
    _spawnSmokePuff(hitPos.x, hitPos.y, hitPos.z);
    if      (hitType === 'enemy')       { hitObj.type === 'boat' ? onBoatHit(hitObj) : hitEnemy(hitObj); }
    else if (hitType === 'panel')       { onShelterHit(hitObj, hitPos, new BABYLON.Vector3(dirX, dirY, dirZ)); }
    else if (hitType === 'flyingPanel') { onFlyingPanelHit(hitObj, new BABYLON.Vector3(dirX, dirY, dirZ)); }
    else if (hitType === 'terrain')     { _spawnScorchMark(hitPos.x, hitPos.y + 0.02, hitPos.z); }
  }
}

// ── Tick VFX ──────────────────────────────────────────────────────────────────
export function tickBullets(dt) {
  if (!_weapon) return;
  if (_weapon.cooldown > 0) _weapon.cooldown -= dt;

  for (let i = _beams.length - 1; i >= 0; i--) {
    const b = _beams[i]; b.life -= dt;
    if (b.life <= 0) { try { b.mesh.dispose(); } catch(e) {} _beams.splice(i, 1); continue; }
    if (b.mesh.material) b.mesh.material.alpha = b.life / BEAM_LIFE;
  }

  for (let i = _flashes.length - 1; i >= 0; i--) {
    const f = _flashes[i]; f.life -= dt;
    if (f.life <= 0) { try { f.mesh.dispose(); } catch(e) {} _flashes.splice(i, 1); continue; }
    const s = f.life / FLASH_LIFE;
    f.mesh.scaling.setAll(s * 0.5);
    if (f.mesh.material) f.mesh.material.alpha = s;
  }

  // Smoke: ParticleSystem auto-ticks — just prune stopped systems
  for (let i = _smokes.length - 1; i >= 0; i--) {
    const ps = _smokes[i];
    if (!ps.isStarted()) { try { ps.dispose(); } catch(e) {} _smokes.splice(i, 1); }
  }

  for (let i = _scorches.length - 1; i >= 0; i--) {
    const sc = _scorches[i]; sc.life -= dt;
    if (sc.life <= 0) { try { sc.mesh.dispose(); } catch(e) {} _scorches.splice(i, 1); continue; }
    if (sc.mesh.material) sc.mesh.material.alpha = Math.min(0.85, sc.life / sc.maxLife * 1.5);
  }
}

export function clearBullets() {
  [..._beams, ..._flashes].forEach(b => { try { b.mesh.dispose(); } catch(e) {} });
  _smokes.forEach(ps => { try { ps.dispose(); } catch(e) {} });
  _scorches.forEach(s => { try { s.mesh.dispose(); } catch(e) {} });
  _beams.length = _flashes.length = _smokes.length = _scorches.length = 0;
}

// ── VFX spawners ──────────────────────────────────────────────────────────────

function _spawnBeam(ox, oy, oz, endPos) {
  try {
    const start  = new BABYLON.Vector3(ox, oy, oz);
    const dir    = endPos.subtract(start);
    const length = dir.length();
    if (length < 0.1) return;
    const mid  = BABYLON.Vector3.Lerp(start, endPos, 0.5);
    const norm = dir.normalize();
    const quat = _alignToDir(norm);

    // Outer glow
    const beam = BABYLON.MeshBuilder.CreateCylinder('laserBeam', {
      height: length, diameter: 0.03, tessellation: 5, cap: BABYLON.Mesh.NO_CAP,
    }, scene);
    beam.position.copyFrom(mid);
    beam.rotationQuaternion = quat;
    beam.isPickable = false;
    // Parent to playerRig — moves with player. playerRig has no rotation so
    // local = world - rig.position. Rotation quaternion stays world-space.
    if (playerRig) {
      beam.parent = playerRig;
      beam.position.set(
        mid.x - playerRig.position.x,
        mid.y - playerRig.position.y,
        mid.z - playerRig.position.z);
    }
    const mat = new BABYLON.StandardMaterial('laserMat_' + Date.now(), scene);
    mat.diffuseColor = new BABYLON.Color3(1.0, 0.08, 0.02);
    mat.emissiveColor = new BABYLON.Color3(1.2, 0.45, 0.1);
    mat.alpha = 1.0; mat.backFaceCulling = false; mat.disableLighting = true;
    beam.material = mat;

    // Bright white core
    const core = BABYLON.MeshBuilder.CreateCylinder('laserCore', {
      height: length, diameter: 0.018, tessellation: 4, cap: BABYLON.Mesh.NO_CAP,
    }, scene);
    core.rotationQuaternion = quat.clone();
    core.isPickable = false;
    if (playerRig) {
      core.parent = playerRig;
      core.position.copyFrom(beam.position);  // same local pos as beam
    } else {
      core.position.copyFrom(mid);
    }
    const cmat = new BABYLON.StandardMaterial('laserCoreMat_' + Date.now(), scene);
    cmat.emissiveColor = new BABYLON.Color3(1, 0.9, 0.75);
    cmat.disableLighting = true;
    core.material = cmat;

    _beams.push({ mesh: beam, life: BEAM_LIFE });
    _beams.push({ mesh: core, life: BEAM_LIFE });
  } catch(e) { console.warn('[basicGun] beam spawn:', e); }
}

function _spawnMuzzleFlash(x, y, z) {
  try {
    const flash = BABYLON.MeshBuilder.CreateSphere('mflash', { diameter: 0.12, segments: 4 }, scene);
    flash.isPickable = false;
    if (playerRig) {
      flash.parent = playerRig;
      flash.position.set(
        x - playerRig.position.x,
        y - playerRig.position.y,
        z - playerRig.position.z);
    } else {
      flash.position.set(x, y, z);
    }
    const mat = new BABYLON.StandardMaterial('mflashMat_' + Date.now(), scene);
    mat.emissiveColor = new BABYLON.Color3(1, 0.65, 0.15);
    mat.disableLighting = true; mat.alpha = 1.0;
    flash.material = mat;
    _flashes.push({ mesh: flash, life: FLASH_LIFE });
  } catch(e) {}
}

function _spawnSmokePuff(x, y, z) {
  try {
    // BabylonJS ParticleSystem — GPU-driven, proper alpha blending, no geometry waste
    const ps = new BABYLON.ParticleSystem('smoke_' + Date.now(), 18, scene);

    // Use a procedural white circle texture — no external asset needed
    ps.particleTexture = new BABYLON.Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAApklEQVR42u2WMQ6AIAxFe/9LuxgTQkL4DXIT' +
      'Hxj6aWlLKS8BAkDz3nu990EIIYRQ8nHOOSmlVErpnHMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICn' +
      'tdbee+89pZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYPsAzwAAAP//AwDI' +
      'AAAB2ElEQVR42u2WMQ6AIAxFe/9LuxgTQkL4DXIT', scene);

    // Better: use built-in white dot by setting to null and using color gradient
    ps.particleTexture = new BABYLON.Texture(
      'https://playground.babylonjs.com/textures/flare.png', scene);

    ps.emitter = new BABYLON.Vector3(x, y, z);
    ps.minEmitBox = new BABYLON.Vector3(-0.05, 0, -0.05);
    ps.maxEmitBox = new BABYLON.Vector3( 0.05, 0,  0.05);

    // Particle appearance
    ps.color1     = new BABYLON.Color4(0.55, 0.50, 0.45, 0.6);   // warm grey
    ps.color2     = new BABYLON.Color4(0.35, 0.32, 0.28, 0.4);   // cooler grey
    ps.colorDead  = new BABYLON.Color4(0.2,  0.2,  0.2,  0.0);

    ps.minSize = 0.08;  ps.maxSize = 0.22;
    ps.minLifeTime = 0.5;  ps.maxLifeTime = 0.9;
    ps.emitRate = 0;  // burst only

    // Upward drift + gentle scatter
    ps.direction1 = new BABYLON.Vector3(-0.3, 1.2, -0.3);
    ps.direction2 = new BABYLON.Vector3( 0.3, 2.2,  0.3);
    ps.minEmitPower = 0.4;  ps.maxEmitPower = 1.1;
    ps.updateSpeed  = 0.016;

    // Particles grow and slow as they rise
    ps.addSizeGradient(0,    0.08);
    ps.addSizeGradient(0.4,  0.3);
    ps.addSizeGradient(1.0,  0.55);

    // Angular speed for wisp rotation
    ps.minAngularSpeed = -1.5;
    ps.maxAngularSpeed =  1.5;

    // Gravity: very light drag upward
    ps.gravity = new BABYLON.Vector3(0, 0.3, 0);

    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;

    // Fire burst of 12 particles then stop
    ps.manualEmitCount = 12;
    ps.start();

    // Stop emitter after one burst frame, particles live out their lifetime
    setTimeout(() => { try { ps.stop(); } catch(e) {} }, 50);

    _smokes.push(ps);
  } catch(e) { console.warn('[basicGun] smoke:', e); }
}

function _spawnScorchMark(x, y, z) {
  if (_scorches.length >= MAX_SCORCHES) {
    const old = _scorches.shift(); try { old.mesh.dispose(); } catch(e) {}
  }
  try {
    const scorch = BABYLON.MeshBuilder.CreateDisc('scorch', { radius: 0.28, tessellation: 10 }, scene);
    scorch.position.set(x, y, z);
    scorch.rotation.x = Math.PI / 2;
    scorch.rotation.y = Math.random() * Math.PI * 2;
    scorch.isPickable = false;
    const mat = new BABYLON.StandardMaterial('scorchMat_' + Date.now(), scene);
    mat.diffuseColor  = new BABYLON.Color3(0.07, 0.05, 0.03);
    mat.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0.01);
    mat.alpha = 0.85; mat.backFaceCulling = false; mat.zOffset = -1;
    scorch.material = mat;
    _scorches.push({ mesh: scorch, life: SCORCH_LIFE, maxLife: SCORCH_LIFE });
  } catch(e) {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _alignToDir(norm) {
  const up  = new BABYLON.Vector3(0, 1, 0);
  const dot = BABYLON.Vector3.Dot(up, norm);
  if (Math.abs(dot) > 0.9999) {
    return dot < 0
      ? BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1,0,0), Math.PI)
      : BABYLON.Quaternion.Identity();
  }
  const axis  = BABYLON.Vector3.Cross(up, norm).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return BABYLON.Quaternion.RotationAxis(axis, angle);
}

function _raySphereDist(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const ex = ox-cx, ey = oy-cy, ez = oz-cz;
  const a  = dx*dx + dy*dy + dz*dz;
  const b  = 2*(ex*dx + ey*dy + ez*dz);
  const c  = ex*ex + ey*ey + ez*ez - r*r;
  const disc = b*b - 4*a*c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2*a);
  return t > 0.1 ? t : null;
}