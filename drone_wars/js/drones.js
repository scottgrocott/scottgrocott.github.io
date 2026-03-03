// ============================================================
//  drones.js — Drone AI, spawning, combat and lifecycle
//
//  New behaviours:
//  - Drone #1 rises to skyPatrolHeight and orbits the player
//    launch point in a wide circle before joining normal patrol.
//  - Each time a drone is killed its world position is recorded.
//    The next spawned drone starts in 'investigating' state and
//    flies directly to that location before switching to patrol.
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

// ---- Last explosion position — passed to the next spawned drone ----
// null means no explosion has happened yet (or next drone has already consumed it)
let _pendingInvestigatePos = null;   // { x, y, z }

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
const _seeRay     = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 1);
const _seeScratch = new BABYLON.Vector3();
const _rayPred    = m => raycastMeshes.includes(m);

export function addWaypoint(x, y, z) {
  flightWaypoints.push(new YUKA.Vector3(x, y, z));
}

// ============================================================
//  Spawn
// ============================================================

// playerSpawnPos: optional {x,y,z} — passed by main.js after the player
// has actually landed so drone #1 knows where to fly to.
export function spawnDrone(playerSpawnPos) {
  if (!physicsReady) return;

  const R     = window.RAPIER;
  const { x: ox, y: oy, z: oz } = CONFIG.launchPoint;
  const color = new BABYLON.Color3(Math.random(), Math.random() * 0.5 + 0.3, Math.random() * 0.3);

  // ---- Visuals ----
  const group = new BABYLON.TransformNode(`droneGroup_${droneCount}`, scene);
  group.position.set(ox, oy, oz);
  group.rotationQuaternion = new BABYLON.Quaternion();

  const bodyMat = new BABYLON.PBRMaterial(`bodyMat_${droneCount}`, scene);
  bodyMat.albedoColor   = color;
  bodyMat.emissiveColor = color.scale(0.6);
  bodyMat.metallic = 0.3; bodyMat.roughness = 0.5;
  const bodyMesh = BABYLON.MeshBuilder.CreateBox('db', { width: 1.5, height: 0.25, depth: 1.5 }, scene);
  bodyMesh.material = bodyMat;
  bodyMesh.parent   = group;

  const rotorMat    = _getRotorMat();
  const rotorMeshes = [];
  for (const [rx, ry, rz] of [[-0.8, 0.15, -0.8], [0.8, 0.15, -0.8], [-0.8, 0.15, 0.8], [0.8, 0.15, 0.8]]) {
    const r = BABYLON.MeshBuilder.CreateCylinder('dr', { diameter: 0.6, height: 0.05 }, scene);
    r.material = rotorMat;
    r.position.set(rx, ry, rz);
    r.parent = group;
    rotorMeshes.push(r);
  }

  const detMesh = BABYLON.MeshBuilder.CreateCylinder('det', { diameter: 0.24, height: 0.5 }, scene);
  detMesh.material           = _getDetMat();
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

  // ---- Per-drone scratch vectors ----
  const vel = new BABYLON.Vector3(1, 0, 0);
  const pos = new BABYLON.Vector3(ox, oy, oz);

  const heightOff    = (droneCount % 5) * 1.2 - 2.4;
  let   huntCooldown = 0;
  let   wpIndex      = Math.floor(Math.random() * Math.max(1, flightWaypoints.length));
  let   _stuckTimer     = 0;
  let   _preEscapeState = null;

  // ---- Determine initial state for this drone ----
  // Drone #1 (droneCount === 0 before increment): sky patrol above spawn
  // Any drone spawned after an explosion: investigate that position first
  // All others: normal rising → patrol
  const isFirstDrone      = droneCount === 0;
  const investigateTarget = !isFirstDrone ? _pendingInvestigatePos : null;
  if (investigateTarget) _pendingInvestigatePos = null;   // consume it

  // Sky patrol orbit state (first drone only)
  let   skyOrbitAngle  = 0;
  let   skyTotalAngle  = 0;   // accumulated — lap count = skyTotalAngle / (2π)
  // Orbit centre — use the explicitly passed spawn position if available,
  // otherwise fall back to camera position at the moment we reach SKY_H.
  let   skyOrbitCX     = playerSpawnPos ? playerSpawnPos.x : null;
  let   skyOrbitCZ     = playerSpawnPos ? playerSpawnPos.z : null;
  const SKY_H          = CONFIG.skyPatrolHeight  ?? 40;
  const SKY_R          = CONFIG.skyPatrolRadius  ?? 30;
  const SKY_SPD        = CONFIG.skyPatrolSpeed   ?? 0.6;   // radians/sec
  const SKY_LAPS       = CONFIG.skyPatrolLaps    ?? 2;
  const SKY_DONE_ANGLE = Math.PI * 2 * SKY_LAPS;
  const INV_SPD        = CONFIG.investigateSpeed ?? CONFIG.droneMaxSpeed * 1.4;
  const INV_ARRIVE_R   = 6;

  let droneState = isFirstDrone      ? 'risingToSky'
                 : investigateTarget ? 'rising'
                 : 'rising';
  // First drone states: risingToSky → flyingToSky → skyPatrol → patrol
  // Other drones:       rising → investigating (if explosion pending) → patrol

  // For investigation drones we switch to 'investigating' once they finish rising
  const _investigateAfterRise = !!investigateTarget;
  const _investigatePos = investigateTarget
    ? { x: investigateTarget.x, y: investigateTarget.y, z: investigateTarget.z }
    : null;

  // ---- canSeePlayer ----
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

  function updateMovement(dt, wallPush, groundY, wallHitCount) {

    // ── Stuck detection — climb escape ───────────────────────────
    if (droneState === 'climbEscape') {
      const targetY  = (CONFIG.skyPatrolHeight ?? 80);
      const climbSpd = CONFIG.droneMaxSpeed * 3;
      pos.y += climbSpd * dt;
      vel.x *= 0.7;
      vel.z *= 0.7;
      vel.y  = climbSpd;
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      _applyPos();
      // Only exit once we've fully cleared the highest terrain point
      if (pos.y >= targetY) {
        pos.y       = targetY;
        droneState  = _preEscapeState ?? 'patrol';
        _stuckTimer = 0;
        console.info(`[drone] Climb escape complete at Y=${targetY} — resuming ${droneState}`);
      }
      return;
    }

    // Only check for new stuck condition when NOT already escaping
    if (droneState !== 'risingToSky' && droneState !== 'flyingToSky') {
      if ((wallHitCount ?? 0) >= 3) {
        _stuckTimer += dt;
        if (_stuckTimer > 0.4) {
          _preEscapeState = droneState;
          droneState      = 'climbEscape';
          _stuckTimer     = 0;
          console.info(`[drone] Stuck detected — climbing escape`);
        }
      } else {
        _stuckTimer = Math.max(0, _stuckTimer - dt * 2);
      }
    }

    // ── Sky patrol sequence (drone #1 only) ─────────────────────
    //  Stage 1: risingToSky  — rise slowly from launch point
    //  Stage 2: flyingToSky  — fly horizontally at SKY_H toward player
    //  Stage 3: skyPatrol    — orbit above player for SKY_LAPS then descend
    // ─────────────────────────────────────────────────────────────

    if (droneState === 'risingToSky') {
      // Rise at a visible speed — half of droneMaxSpeed so player can watch it climb
      const riseSpd = CONFIG.droneMaxSpeed * 0.5;
      pos.y += riseSpd * dt;
      vel.set(0, riseSpd, 0);
      if (pos.y >= SKY_H) {
        pos.y = SKY_H;
        if (skyOrbitCX === null) {
          skyOrbitCX = camera.globalPosition.x;
          skyOrbitCZ = camera.globalPosition.z;
        }
        droneState = 'flyingToSky';
      }
      // No terrain avoidance during sky rise — we want to go straight up
      _applyPos();
      return;
    }

    if (droneState === 'flyingToSky') {
      // Fly at SKY_H toward the player spawn position
      const spd = CONFIG.droneMaxSpeed;
      const dx  = skyOrbitCX - pos.x;
      const dz  = skyOrbitCZ - pos.z;
      const dyH = SKY_H - pos.y;
      const hDist = Math.sqrt(dx * dx + dz * dz);

      // Arrived above player — start orbiting
      if (hDist < SKY_R * 0.5) {
        skyOrbitAngle = Math.atan2(pos.z - skyOrbitCZ, pos.x - skyOrbitCX);
        skyTotalAngle = 0;
        droneState    = 'skyPatrol';
        return;
      }

      const inv = 1 / hDist;
      vel.x += (dx * inv * spd - vel.x) * Math.min(1, dt * 3);
      vel.y += (dyH - vel.y) * Math.min(1, dt * 2);
      vel.z += (dz * inv * spd - vel.z) * Math.min(1, dt * 3);
      const s = vel.length(); if (s > spd) vel.scaleInPlace(spd / s);
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      if (s > 0.1) BABYLON.Quaternion.RotationYawPitchRollToRef(
        Math.atan2(vel.x, vel.z), 0, 0, group.rotationQuaternion
      );
      // Terrain avoidance while flying to player at height
      _applyTerrainAvoidance(groundY);
      _applyPos();
      return;
    }

    if (droneState === 'skyPatrol') {
      const step    = SKY_SPD * dt;
      skyOrbitAngle += step;
      skyTotalAngle += step;

      // Target point on the orbit circle around player spawn
      const tx  = skyOrbitCX + Math.cos(skyOrbitAngle) * SKY_R;
      const tz  = skyOrbitCZ + Math.sin(skyOrbitAngle) * SKY_R;
      const dx  = tx - pos.x;
      const dz  = tz - pos.z;
      const dyH = SKY_H - pos.y;
      const spd = CONFIG.droneMaxSpeed;

      vel.x += (dx - vel.x) * Math.min(1, dt * 4);
      vel.y += (dyH - vel.y) * Math.min(1, dt * 3);
      vel.z += (dz - vel.z) * Math.min(1, dt * 4);
      const s = vel.length(); if (s > spd) vel.scaleInPlace(spd / s);
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      if (s > 0.1) BABYLON.Quaternion.RotationYawPitchRollToRef(
        Math.atan2(vel.x, vel.z), 0, 0, group.rotationQuaternion
      );
      _applyTerrainAvoidance(groundY);
      _applyPos();

      if (skyTotalAngle >= SKY_DONE_ANGLE) {
        droneState = 'patrol';
        console.info('[drone#1] Sky patrol complete — joining ground patrol');
      }
      return;
    }

    // ── Normal rise ─────────────────────────────────────────────
    if (droneState === 'rising') {
      const dy = CONFIG.droneRiseHeight - pos.y;
      vel.set(0, dy > 0 ? CONFIG.droneMaxSpeed * 0.6 : 0, 0);
      pos.y += vel.y * dt;
      if (pos.y >= CONFIG.droneRiseHeight) {
        pos.y = CONFIG.droneRiseHeight;
        droneState = _investigateAfterRise ? 'investigating' : 'patrol';
      }
      _applyPos();
      return;
    }

    // ── Investigate last explosion ───────────────────────────────
    if (droneState === 'investigating') {
      if (!_investigatePos) { droneState = 'patrol'; return; }
      const dx  = _investigatePos.x - pos.x;
      const dy  = _investigatePos.y - pos.y;
      const dz  = _investigatePos.z - pos.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < INV_ARRIVE_R) {
        // Arrived — hover briefly then join patrol
        droneState = 'patrol';
        console.info(`[drone#${drone.id}] Investigation complete`);
        return;
      }
      const inv = 1 / len;
      const trn = Math.min(1, dt * 4);
      vel.x += (dx * inv * INV_SPD - vel.x) * trn;
      vel.y += (dy * inv * INV_SPD - vel.y) * trn;
      vel.z += (dz * inv * INV_SPD - vel.z) * trn;
      const s = vel.length(); if (s > INV_SPD) vel.scaleInPlace(INV_SPD / s);
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      if (s > 0.1) BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(vel.x, vel.z), 0, 0, group.rotationQuaternion);
      _applyTerrainAvoidance(groundY);
      _applyPos();
      // If player spotted during approach — switch to hunt
      if (canSeePlayer()) { droneState = 'hunting'; huntCooldown = 6.0; }
      return;
    }

    // ── Patrol / hunt (unchanged from original) ──────────────────
    if (!flightWaypoints.length) return;

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
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      if (s > 0.1) BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(vel.x, vel.z), 0, 0, group.rotationQuaternion);
      _applyTerrainAvoidance(groundY);
      _applyPos();
      if (huntCooldown <= 0 && !canSeePlayer()) droneState = 'patrol';
      return;
    }

    // Patrol waypoints
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
    _applyTerrainAvoidance(groundY);
    _applyPos();
  }

  // Minimum metres the drone must stay above the terrain surface.
  // Applied every frame regardless of state so the drone never clips.
  const MIN_CLEARANCE     = 4.0;   // soft floor — start pushing up here
  const HARD_CLEARANCE    = 2.0;   // hard floor — teleport up if somehow below
  const TERRAIN_PUSH_SPD  = CONFIG.droneMaxSpeed * 2.5;

  function _applyTerrainAvoidance(groundY) {
    if (groundY === null || groundY === undefined) return;
    const clearance = pos.y - groundY;
    if (clearance < HARD_CLEARANCE) {
      // Hard correction — drone has clipped into terrain, snap it out immediately
      pos.y = groundY + HARD_CLEARANCE;
      if (vel.y < 0) vel.y = 0;
    } else if (clearance < MIN_CLEARANCE) {
      // Soft push — ramp up upward velocity proportional to how close we are
      const urgency = 1 - (clearance / MIN_CLEARANCE);   // 0 at MIN_CLEARANCE, 1 at surface
      vel.y = Math.max(vel.y, urgency * TERRAIN_PUSH_SPD);
    }
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
    rotorMeshes,
    bodyMat,
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

  // Record explosion position for the next spawned drone to investigate
  _pendingInvestigatePos = { x: pos.x, y: pos.y, z: pos.z };

  playExplosion();
  spawnExplosionEffect(drone.group);

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

  // Respawn — the new drone will pick up _pendingInvestigatePos
  setTimeout(() => { spawnDrone(); }, 5000);
}

// ============================================================
//  Tick
// ============================================================
const _rotorSpeeds = [20, 22, 18, 24];

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
    drone.updateMovement(dt, qr?.wallPush ?? null, qr?.groundY ?? null, qr?.wallHitCount ?? 0);
    if (drone.synth) updateDroneSpatial(drone.synth, drone.group.position);

    for (let i = 0; i < drone.rotorMeshes.length; i++) {
      drone.rotorMeshes[i].rotation.y += dt * _rotorSpeeds[i] * (1 + drone.id * 0.15);
    }

    if (drone.detonatorArmed) _checkDetonatorCollision(drone);
  }
}

// ---- Detonator collision ----
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