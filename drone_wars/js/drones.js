// ============================================================
//  drones.js — Drone AI, spawning, combat and lifecycle
//
//  Performance notes:
//  - Rotor meshes cached per drone at spawn — no getChildMeshes() in tick
//  - Shared materials for rotors + detonator (compiled once, reused)
//  - Per-drone scratch vectors pre-allocated — no Vector3 alloc in hot loop
//  - canSeePlayer uses pre-allocated Ray + scratch vector
//  - vel.scale(dt) replaced with manual scalar multiply (no alloc)
// ============================================================

import { scene, camera }                     from './core.js';
import { CONFIG }                             from './config.js';
import { physicsWorld, physicsReady, physCache, raycastMeshes, rayQueryResults } from './physics.js';
import { player }                             from './player.js';
import { toneReady, createDroneSynth, updateDroneSpatial, disposeDroneSynth, playExplosion } from './audio.js';
import { spawnExplosionEffect }               from './explosions.js';
import { hud }                                from './hud.js';

export const drones          = [];
export const flightWaypoints = [];
let          droneCount      = 0;

export const yukaManager = new YUKA.EntityManager();
export const yukaTime    = new YUKA.Time();

// ---- Shared materials (compiled once, reused across all drones) ----
let _rotorMat = null;
let _detMat   = null;
function _getRotorMat() {
  if (_rotorMat) return _rotorMat;
  _rotorMat = new BABYLON.PBRMaterial('sharedRotorMat', scene);
  _rotorMat.albedoColor   = BABYLON.Color3.FromHexString('#ff2200');
  _rotorMat.emissiveColor = BABYLON.Color3.FromHexString('#ff2200');
  _rotorMat.metallic = 0.4; _rotorMat.roughness = 0.5;
  return _rotorMat;
}
function _getDetMat() {
  if (_detMat) return _detMat;
  _detMat = new BABYLON.PBRMaterial('sharedDetMat', scene);
  _detMat.albedoColor   = BABYLON.Color3.FromHexString('#ff4400');
  _detMat.emissiveColor = BABYLON.Color3.FromHexString('#ff0000');
  _detMat.metallic = 0.8; _detMat.roughness = 0.2;
  return _detMat;
}

// ---- Module-level scratch objects for canSeePlayer (never reallocated) ----
const _seeRay    = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 1);
const _seeScratch = new BABYLON.Vector3();
const _rayPred   = m => raycastMeshes.includes(m);

// ---- White flash colour (shared, never reallocated) ----
const _WHITE = new BABYLON.Color3(1, 1, 1);

export function addWaypoint(x, y, z) {
  flightWaypoints.push(new YUKA.Vector3(x, y, z));
}

// ============================================================
//  Spawn
// ============================================================
export function spawnDrone() {
  if (!physicsReady) return;

  const R     = window.RAPIER;
  const { x: ox, y: oy, z: oz } = CONFIG.launchPoint;
  const color = new BABYLON.Color3(Math.random(), Math.random() * 0.5 + 0.3, Math.random() * 0.3);

  // ---- Visuals ----
  const group = new BABYLON.TransformNode(`droneGroup_${droneCount}`, scene);
  group.position.set(ox, oy, oz);
  group.rotationQuaternion = new BABYLON.Quaternion();

  // Body — unique material per drone (color varies)
  const bodyMat = new BABYLON.PBRMaterial(`bodyMat_${droneCount}`, scene);
  bodyMat.albedoColor   = color;
  bodyMat.emissiveColor = color.scale(0.6);
  bodyMat.metallic = 0.3; bodyMat.roughness = 0.5;
  const bodyMesh = BABYLON.MeshBuilder.CreateBox('db', { width: 1.5, height: 0.25, depth: 1.5 }, scene);
  bodyMesh.material = bodyMat;
  bodyMesh.parent   = group;

  // Rotors — shared material
  const rotorMat  = _getRotorMat();
  const rotorMeshes = [];
  for (const [rx, ry, rz] of [[-0.8, 0.15, -0.8], [0.8, 0.15, -0.8], [-0.8, 0.15, 0.8], [0.8, 0.15, 0.8]]) {
    const r = BABYLON.MeshBuilder.CreateCylinder('dr', { diameter: 0.6, height: 0.05 }, scene);
    r.material = rotorMat;
    r.position.set(rx, ry, rz);
    r.parent = group;
    rotorMeshes.push(r);   // ← cached reference, never call getChildMeshes() in tick
  }

  // Detonator — shared material
  const detMesh = BABYLON.MeshBuilder.CreateCylinder('det', { diameter: 0.24, height: 0.5 }, scene);
  detMesh.material          = _getDetMat();
  detMesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI / 2);
  detMesh.position.set(0, 0, 0.9);
  detMesh.parent = group;

  // ---- Physics ----
  const body = physicsWorld.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(ox, oy, oz),
  );
  physicsWorld.createCollider(
    R.ColliderDesc.ball(0.6).setMass(2).setFriction(0).setRestitution(0.3),
    body,
  );

  // ---- Yuka AI ----
  const vehicle = new YUKA.Vehicle();
  vehicle.maxSpeed = CONFIG.droneMaxSpeed;
  vehicle.position.set(ox, oy, oz);
  yukaManager.add(vehicle);

  // ---- Per-drone scratch vectors (pre-allocated, reused in closures) ----
  const vel       = new BABYLON.Vector3(1, 0, 0);
  const pos       = new BABYLON.Vector3(ox, oy, oz);
  const _velScale = new BABYLON.Vector3();   // scratch for vel*dt without alloc

  const heightOff   = (droneCount % 5) * 1.2 - 2.4;
  let   droneState  = 'rising';
  let   huntCooldown = 0;
  let   wpIndex     = Math.floor(Math.random() * Math.max(1, flightWaypoints.length));

  // ---- canSeePlayer — reuses module-level Ray + scratch, no allocation ----
  function canSeePlayer() {
    const pp = camera.globalPosition;
    _seeScratch.set(pp.x - pos.x, pp.y - pos.y, pp.z - pos.z);
    const dist = _seeScratch.length();
    if (dist > 60) return false;
    _seeScratch.normalizeToRef(_seeScratch);
    _seeRay.origin.copyFrom(pos);
    _seeRay.direction.copyFrom(_seeScratch);
    _seeRay.length = dist;
    const hit = scene.pickWithRay(_seeRay, _rayPred);
    return !hit.hit;
  }

  function updateMovement(dt, wallPush) {
    if (!flightWaypoints.length) return;

    if (droneState === 'rising') {
      const dy = CONFIG.droneRiseHeight - pos.y;
      vel.set(0, dy > 0 ? CONFIG.droneMaxSpeed * 0.6 : 0, 0);
      pos.y += vel.y * dt;
      if (pos.y >= CONFIG.droneRiseHeight) { pos.y = CONFIG.droneRiseHeight; droneState = 'patrol'; }
      _applyPos();
      return;
    }

    if (droneState === 'patrol' && canSeePlayer()) { droneState = 'hunting'; huntCooldown = 4.0; }

    if (droneState === 'hunting') {
      huntCooldown -= dt;
      const pp  = camera.globalPosition;
      const dx  = pp.x - pos.x, dy = pp.y - pos.y, dz = pp.z - pos.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const inv = len > 0.01 ? 1 / len : 0;
      const spd = CONFIG.droneMaxSpeed * 1.6;
      const trn = Math.min(1, dt * 5);
      vel.x += (dx * inv * spd - vel.x) * trn;
      vel.y += (dy * inv * spd - vel.y) * trn;
      vel.z += (dz * inv * spd - vel.z) * trn;
      if (wallPush) { vel.x += wallPush.x * 0.12; vel.z += wallPush.z * 0.12; }
      const s = vel.length(); if (s > spd) vel.scaleInPlace(spd / s);
      // Manual scale-add: pos += vel * dt  (no temporary Vector3)
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      if (s > 0.1) BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(vel.x, vel.z), 0, 0, group.rotationQuaternion);
      _applyPos();
      if (huntCooldown <= 0 && !canSeePlayer()) droneState = 'patrol';
      return;
    }

    // Patrol
    const target = flightWaypoints[wpIndex % flightWaypoints.length];
    const ty     = CONFIG.droneFlightHeight + heightOff;
    const dx     = target.x - pos.x, dy = ty - pos.y, dz = target.z - pos.z;
    if (Math.sqrt(dx * dx + dz * dz) < CONFIG.dronePathRadius) {
      wpIndex = (wpIndex + 1) % flightWaypoints.length;
    }
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const inv = len > 0.01 ? 1 / len : 0;
    const spd = CONFIG.droneMaxSpeed;
    const trn = Math.min(1, dt * 4);
    vel.x += (dx * inv * spd - vel.x) * trn;
    vel.y += (dy * inv * spd - vel.y) * trn;
    vel.z += (dz * inv * spd - vel.z) * trn;
    if (wallPush) { vel.x += wallPush.x * 0.15; vel.z += wallPush.z * 0.15; }
    const s = vel.length(); if (s > spd) vel.scaleInPlace(spd / s);
    pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
    if (s > 0.1) BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(vel.x, vel.z), 0, 0, group.rotationQuaternion);
    _applyPos();
  }

  function _applyPos() {
    group.position.copyFrom(pos);
    try { body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z }); } catch (_) {}
  }

  // ---- Audio ----
  let synth = null;
  try { if (toneReady) synth = createDroneSynth(droneCount); } catch (_) {}

  const drone = {
    group,
    body,
    vehicle,
    synth,
    rotorMeshes,       // cached — used in tickDrones rotor spin
    bodyMat,           // kept for kill flash
    dead:           false,
    id:             ++droneCount,
    hitCount:       0,
    detonatorMesh:  detMesh,
    color,
    detonatorArmed: false,
    updateMovement,
    getState:    () => droneState,
    triggerHunt: () => { droneState = 'hunting'; huntCooldown = 6.0; },
  };

  setTimeout(() => { if (!drone.dead) drone.detonatorArmed = true; }, 2500);
  drones.push(drone);
  hud.setDrones(drones.filter(d => !d.dead).length);
}

// ============================================================
//  Kill
// ============================================================
export function killDrone(drone) {
  if (drone.dead) return;
  drone.dead = true;

  const R   = window.RAPIER;
  const pos = drone.group.position;

  playExplosion();
  spawnExplosionEffect(drone.group);

  // Flash body orange — only touch body material (rotors/det are shared)
  drone.bodyMat.albedoColor.set(1, 0.53, 0);
  drone.bodyMat.emissiveColor.set(1, 0.27, 0);

  yukaManager.remove(drone.vehicle);

  const oldB = drone.body;
  drone.body = physicsWorld.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z),
  );
  drone.collider = physicsWorld.createCollider(
    R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setMass(2).setRestitution(0.3).setFriction(0.5),
    drone.body,
  );
  drone.body.setLinvel({ x: (Math.random() - 0.5) * 8, y: 5, z: (Math.random() - 0.5) * 8 }, true);
  drone.body.setAngvel({ x: (Math.random()-0.5)*10, y: (Math.random()-0.5)*10, z: (Math.random()-0.5)*10 }, true);

  setTimeout(() => {
    try { physicsWorld.removeRigidBody(oldB); } catch (_) {}
  }, 50);

  disposeDroneSynth(drone.synth);
  drone.synth = null;

  setTimeout(() => {
    drone.group.dispose();
    try { physicsWorld.removeCollider(drone.collider, true); } catch (_) {}
    try { physicsWorld.removeRigidBody(drone.body); } catch (_) {}
    const idx = drones.indexOf(drone);
    if (idx >= 0) drones.splice(idx, 1);
    hud.setDrones(drones.filter(d => !d.dead).length);
  }, 5000);
}

// ============================================================
//  Tick
// ============================================================
const _rotorSpeeds = [20, 22, 18, 24];   // slight variation per rotor

export function tickDrones(dt) {
  for (const drone of drones) {
    if (drone.dead && drone.body) {
      const cached = physCache.deadDrones[drone.id];
      if (cached) {
        drone.group.position.set(cached.pos.x, cached.pos.y, cached.pos.z);
        drone.group.rotationQuaternion.copyFromFloats(
          cached.rot.x, cached.rot.y, cached.rot.z, cached.rot.w,
        );
      }
      continue;
    }

    const qr = rayQueryResults[drone.id];
    drone.updateMovement(dt, qr?.wallPush ?? null);
    if (drone.synth) updateDroneSpatial(drone.synth, drone.group.position);

    // Spin rotors using cached refs — no getChildMeshes() allocation
    for (let i = 0; i < drone.rotorMeshes.length; i++) {
      drone.rotorMeshes[i].rotation.y += dt * _rotorSpeeds[i] * (1 + drone.id * 0.15);
    }

    if (drone.detonatorArmed) _checkDetonatorCollision(drone);
  }
}

// ---- Detonator collision (no new allocations) ----
function _checkDetonatorCollision(drone) {
  if (!player.rigidBody) return;
  const detWorld = drone.detonatorMesh.getAbsolutePosition();
  const pp       = camera.globalPosition;
  if (BABYLON.Vector3.DistanceSquared(detWorld, pp) < 0.64) { killDrone(drone); return; }
  for (const other of drones) {
    if (other === drone || other.dead) continue;
    if (BABYLON.Vector3.DistanceSquared(detWorld, other.group.position) < 1.44) {
      killDrone(drone); killDrone(other); return;
    }
  }
  if (rayQueryResults[drone.id]?.detonatorHit) killDrone(drone);
}