// ============================================================
//  drones.js — Drone AI, spawning, combat and lifecycle
// ============================================================

import { scene, camera }                     from './core.js';
import { CONFIG }                             from './config.js';
import { physicsWorld, physicsReady, physCache, raycastMeshes, rayQueryResults } from './physics.js';
import { player }                             from './player.js';
import { toneReady, createDroneSynth, updateDroneSpatial, disposeDroneSynth, playExplosion } from './audio.js';
import { spawnExplosionEffect }               from './explosions.js';
import { hud }                                from './hud.js';

export const drones        = [];
export const flightWaypoints = [];
let          droneCount    = 0;

export const yukaManager = new YUKA.EntityManager();
export const yukaTime    = new YUKA.Time();

// ---- Public: add waypoints ----
export function addWaypoint(x, y, z) {
  flightWaypoints.push(new YUKA.Vector3(x, y, z));
}

// ---- Spawn ----
export function spawnDrone() {
  if (!physicsReady) return;

  const R = window.RAPIER;
  const { x: ox, y: oy, z: oz } = CONFIG.launchPoint;
  const color = new BABYLON.Color3(Math.random(), Math.random() * 0.5 + 0.3, Math.random() * 0.3);

  // ---- Visuals ----
  const group = new BABYLON.TransformNode(`droneGroup_${droneCount}`, scene);
  group.position.set(ox, oy, oz);
  group.rotationQuaternion = new BABYLON.Quaternion();

  const bodyMat = new BABYLON.PBRMaterial('bmat', scene);
  bodyMat.albedoColor   = color;
  bodyMat.emissiveColor = color.scale(0.6);
  bodyMat.metallic = 0.3; bodyMat.roughness = 0.5;
  const bodyMesh = BABYLON.MeshBuilder.CreateBox('db', { width: 1.5, height: 0.25, depth: 1.5 }, scene);
  bodyMesh.material = bodyMat; bodyMesh.parent = group;

  const rotorMat = new BABYLON.PBRMaterial('rmat', scene);
  rotorMat.albedoColor   = BABYLON.Color3.FromHexString('#ff2200');
  rotorMat.emissiveColor = BABYLON.Color3.FromHexString('#ff2200');
  for (const [rx, ry, rz] of [[-0.8, 0.15, -0.8], [0.8, 0.15, -0.8], [-0.8, 0.15, 0.8], [0.8, 0.15, 0.8]]) {
    const r = BABYLON.MeshBuilder.CreateCylinder('dr', { diameter: 0.6, height: 0.05 }, scene);
    r.material = rotorMat; r.position.set(rx, ry, rz); r.parent = group;
  }

  const detMat = new BABYLON.PBRMaterial('dmat', scene);
  detMat.albedoColor   = BABYLON.Color3.FromHexString('#ff4400');
  detMat.emissiveColor = BABYLON.Color3.FromHexString('#ff0000');
  detMat.metallic = 0.8; detMat.roughness = 0.2;
  const detMesh = BABYLON.MeshBuilder.CreateCylinder('det', { diameter: 0.24, height: 0.5 }, scene);
  detMesh.material          = detMat;
  detMesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI / 2);
  detMesh.position.set(0, 0, 0.9);
  detMesh.parent = group;

  // ---- Physics ----
  const body = physicsWorld.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(ox, oy, oz),
  );
  const collider = physicsWorld.createCollider(
    R.ColliderDesc.ball(0.6).setMass(2).setFriction(0).setRestitution(0.3),
    body,
  );

  // ---- Yuka AI vehicle ----
  const vehicle = new YUKA.Vehicle();
  vehicle.maxSpeed = CONFIG.droneMaxSpeed;
  vehicle.position.set(ox, oy, oz);
  yukaManager.add(vehicle);

  // ---- State ----
  let wpIndex      = Math.floor(Math.random() * Math.max(1, flightWaypoints.length));
  const vel        = new BABYLON.Vector3(1, 0, 0);
  const pos        = new BABYLON.Vector3(ox, oy, oz);
  const heightOff  = (droneCount % 5) * 1.2 - 2.4;
  let   droneState = 'rising';
  let   huntCooldown = 0;

  function canSeePlayer() {
    const pp      = camera.globalPosition;
    const toPlayer = pp.subtract(pos);
    const dist    = toPlayer.length();
    if (dist > 60) return false;
    const ray = new BABYLON.Ray(pos, toPlayer.normalize(), dist);
    const hit = scene.pickWithRay(ray, m => raycastMeshes.includes(m));
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
      pos.addInPlace(vel.scale(dt));
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
    pos.addInPlace(vel.scale(dt));
    if (s > 0.1) BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(vel.x, vel.z), 0, 0, group.rotationQuaternion);
    _applyPos();
  }

  function _applyPos() {
    group.position.copyFrom(pos);
    try { body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z }); } catch (_) {}
  }

  // ---- Audio ----
  let synth = null;
  try {
    if (toneReady) synth = createDroneSynth(droneCount);
  } catch (_) {}

  const drone = {
    group,
    body,
    collider,
    vehicle,
    synth,
    dead:          false,
    id:            ++droneCount,
    hitCount:      0,
    detonatorMesh: detMesh,
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

// ---- Kill ----
export function killDrone(drone) {
  if (drone.dead) return;
  drone.dead = true;

  const R   = window.RAPIER;
  const pos = drone.group.position;

  playExplosion();
  spawnExplosionEffect(drone.group);

  drone.group.getChildMeshes().forEach(n => {
    if (n.material) {
      n.material = n.material.clone();
      n.material.albedoColor   = BABYLON.Color3.FromHexString('#ff8800');
      n.material.emissiveColor = BABYLON.Color3.FromHexString('#ff4400').scale(3);
    }
  });

  yukaManager.remove(drone.vehicle);

  const oldC = drone.collider;
  const oldB = drone.body;
  drone.body = physicsWorld.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z),
  );
  drone.collider = physicsWorld.createCollider(
    R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setMass(2).setRestitution(0.3).setFriction(0.5),
    drone.body,
  );
  drone.body.setLinvel({ x: (Math.random() - 0.5) * 8, y: 5, z: (Math.random() - 0.5) * 8 }, true);
  drone.body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 }, true);

  setTimeout(() => {
    try { physicsWorld.removeCollider(oldC, true); } catch (_) {}
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

// ---- Tick ----
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

    // Spin rotors (children 1–4)
    drone.group.getChildMeshes().forEach((c, i) => {
      if (i >= 1 && i <= 4) c.rotation.y += dt * 20 * (1 + drone.id * 0.3);
    });

    if (drone.detonatorArmed) _checkDetonatorCollision(drone);
  }
}

function _checkDetonatorCollision(drone) {
  if (!player.rigidBody) return;

  const detWorld = drone.detonatorMesh.getAbsolutePosition();
  const pp       = camera.globalPosition;

  if (BABYLON.Vector3.DistanceSquared(detWorld, pp) < 0.64) {
    killDrone(drone); return;
  }
  for (const other of drones) {
    if (other === drone || other.dead) continue;
    if (BABYLON.Vector3.DistanceSquared(detWorld, other.group.position) < 1.44) {
      killDrone(drone); killDrone(other); return;
    }
  }
  const res = rayQueryResults[drone.id];
  if (res?.detonatorHit) killDrone(drone);
}
