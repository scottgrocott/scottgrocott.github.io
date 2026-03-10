// enemies/drones.js — aerial drone enemy

import { scene, shadowGenerator } from '../core.js';
import { safeVec3 } from "../physics.js";
import { EnemyBase, _ym, distToPlayer, getPlayerPos } from './enemyBase.js';
import { getEnemies } from './enemyRegistry.js';
import { getWaypoints } from '../flatnav.js';
import { CONFIG } from '../config.js';
import { getWaterY } from '../water.js';
import { getTerrainHeightAt } from '../terrain/terrainMesh.js';
import { playExplosion }      from '../audio.js';

const RISE_TARGET_Y   = 16;
const RISE_SPEED      = 4;
const PATROL_SPEED    = 5;
const HUNT_SPEED      = 9;
const DETECT_RANGE    = 45;

export function spawnDrones(def) {
  const count = def.maxCount || 3;
  const flightWaypoints = getWaypoints('flight');
  const spawned = [];
  for (let i = 0; i < count; i++) {
    const wp = flightWaypoints[i % Math.max(1, flightWaypoints.length)];
    // Always spawn at RISE_TARGET_Y regardless of waypoint — prevents spawning inside terrain
    const spawnPos = wp
      ? new BABYLON.Vector3(wp.x, RISE_TARGET_Y, wp.z)
      : new BABYLON.Vector3((Math.random()-0.5)*60, RISE_TARGET_Y, (Math.random()-0.5)*60);

    const enemy = new EnemyBase({
      scene,
      // rapierWorld: not needed with Havok (EnemyBase ignores it)
      type: 'drone',
      speed: PATROL_SPEED,
      health: def.health ?? 60,
      spawnPos,
      // No YUKA path — drones use their own stateful tick below
      noVehicle: true,   // drones use manual tick, not YUKA steering
    });

    enemy.state = 'rising';
    _buildDroneMesh(enemy, scene);
    _setupDroneWaypoints(enemy, flightWaypoints);

    // Intercept death — trigger cinematic fall instead of instant hide
    const _baseTakeDamage = enemy.takeDamage.bind(enemy);
    enemy.takeDamage = function(amount) {
      if (this.dead || this.destroyed) return;
      this.health -= (amount ?? this.maxHealth);
      if (this.health <= 0) {
        this.dead  = true;
        this.state = 'falling';
        if (this.mesh) this.mesh.setEnabled(false); // hide instantly; _startFall re-shows for fall
        _startFall(this);
      }
    };

    spawned.push(enemy);
  }
  return spawned;
}

function _buildDroneMesh(enemy) {
  // Replace the default placeholder box with a proper drone mesh
  // Preserve spawn position before disposing the placeholder
  const _savedPos = enemy.mesh?.position?.clone() ?? new BABYLON.Vector3(0, 16, 0);
  if (enemy.mesh) enemy.mesh.dispose();

  const root = new BABYLON.TransformNode('droneRoot', scene);
  root.position.copyFrom(_savedPos);   // ← critical: start at spawn Y, not world origin
  enemy.mesh = root;  // use root as the position anchor

  const body = BABYLON.MeshBuilder.CreateBox('droneBody', { width:0.8, height:0.25, depth:0.8 }, scene);
  body.parent = root;
  const mat = new BABYLON.StandardMaterial('droneMat', scene);
  mat.diffuseColor  = new BABYLON.Color3(0.9, 0.15, 0.1);
  mat.emissiveColor = new BABYLON.Color3(0.3, 0.0, 0.0);
  body.material = mat;
  if (shadowGenerator) shadowGenerator.addShadowCaster(body);

  enemy._rotors = [];
  const rotorOffsets = [{x:0.5,z:0.5},{x:-0.5,z:0.5},{x:0.5,z:-0.5},{x:-0.5,z:-0.5}];
  for (const off of rotorOffsets) {
    const rotor = BABYLON.MeshBuilder.CreateCylinder('rotor',
      { diameter:0.4, height:0.05, tessellation:6 }, scene);
    rotor.parent = root;
    rotor.position.set(off.x, 0.05, off.z);
    const rmat = new BABYLON.StandardMaterial('rotorMat', scene);
    rmat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    rotor.material = rmat;
    enemy._rotors.push(rotor);
  }
  enemy._waypointIndex = 0;
}

function _setupDroneWaypoints(enemy, flightWaypoints) {
  if (!flightWaypoints || flightWaypoints.length === 0) {
    enemy._waypoints = [
      {x:20,y:RISE_TARGET_Y,z:0},{x:0,y:RISE_TARGET_Y,z:20},
      {x:-20,y:RISE_TARGET_Y,z:0},{x:0,y:RISE_TARGET_Y,z:-20}
    ];
  } else {
    const shuffled = [...flightWaypoints].sort(() => Math.random()-0.5);
    enemy._waypoints = shuffled.slice(0, Math.min(8, shuffled.length));
  }
  enemy._waypointIndex = 0;
}

export function tickDrones(dt) {
  for (const e of getEnemies()) {
    if (e.type !== 'drone') continue;
    if (e.state === 'falling') { _tickFall(e, dt); continue; }
    if (e.dead) continue;
    _tickDrone(e, dt);
  }
}

function _tickDrone(enemy, dt) {
  if (!enemy.body) return;
  const t = enemy.body.translation();
  const px = +t.x, py = +t.y, pz = +t.z;
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return;

  // Spin rotors
  if (enemy._rotors) {
    for (const r of enemy._rotors) r.rotation.y += dt * 15;
  }

  const playerPos = getPlayerPos();
  const dPlayer   = distToPlayer({x:px, y:py, z:pz});

  let targetX = px, targetY = py, targetZ = pz;

  switch (enemy.state) {
    case 'rising': {
      targetY = RISE_TARGET_Y;
      if (Math.abs(py - RISE_TARGET_Y) < 1.0) enemy.state = 'patrol';
      break;
    }
    case 'patrol':
    case 'skyPatrol': {
      if (dPlayer < DETECT_RANGE) { enemy.state = 'hunting'; break; }
      const wp = enemy._waypoints?.[enemy._waypointIndex];
      if (wp) {
        const dx = wp.x - px, dz = wp.z - pz;
        if (Math.sqrt(dx*dx+dz*dz) < 3) {
          enemy._waypointIndex = (enemy._waypointIndex + 1) % enemy._waypoints.length;
        } else {
          targetX = wp.x;
          // Clamp waypoint Y above terrain at the waypoint's XZ too
          const _wpTerrain = getTerrainHeightAt(wp.x, wp.z);
          targetY = Math.max(wp.y ?? RISE_TARGET_Y, _wpTerrain + 5.0);
          targetZ = wp.z;
        }
      }
      break;
    }
    case 'hunting': {
      if (dPlayer > DETECT_RANGE * 1.5) { enemy.state = 'patrol'; break; }
      targetX = playerPos.x; targetY = playerPos.y + 6; targetZ = playerPos.z;
      break;
    }
    case 'investigating': {
      if (dPlayer < 6) enemy.state = 'patrol';
      break;
    }
  }

  const TERRAIN_CLEARANCE = 6.0;   // minimum metres above terrain

  // Sample terrain at BOTH current position AND target position — use the higher value
  const _floorCurrent = getTerrainHeightAt(px, pz);
  const _floorTarget  = getTerrainHeightAt(targetX, targetZ);
  const _terrainFloor = Math.max(_floorCurrent, _floorTarget);
  const _minY = _terrainFloor + TERRAIN_CLEARANCE;

  // Clamp target
  if (targetY < _minY) targetY = _minY;

  // Water floor
  const _wy = getWaterY();
  const _waterFloor = (_wy !== null) ? _wy + 2.0 : -Infinity;
  if (targetY < _waterFloor) targetY = _waterFloor;

  // Hard-correct current position if drone is already below floor this frame
  // (catches cases where physics nudged it down or it spawned wrong)
  const _hardFloor = Math.max(_floorCurrent + TERRAIN_CLEARANCE, _waterFloor);
  let corrX = px, corrY = py, corrZ = pz;
  if (py < _hardFloor) {
    corrY = _hardFloor;
    // Teleport up immediately — don't lerp, just correct
    const snapSafe = safeVec3(px, corrY, pz, 'drone floor snap');
    if (snapSafe) {
      enemy.body.setNextKinematicTranslation(snapSafe);
      if (enemy.mesh) enemy.mesh.position.set(snapSafe.x, snapSafe.y, snapSafe.z);
    }
    return; // skip normal movement this frame so snap takes effect cleanly
  }

  const spd = enemy.state === 'hunting' ? HUNT_SPEED : PATROL_SPEED;
  const dx = targetX - px, dy = targetY - py, dz = targetZ - pz;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if (len > 0.5) {
    const nx = dx/len, ny = dy/len, nz = dz/len;
    const safe = safeVec3(px + nx*spd*dt, py + ny*spd*dt, pz + nz*spd*dt, 'drone tick');
    if (safe) {
      enemy.body.setNextKinematicTranslation(safe);
      // Keep mesh in sync (YUKA not used for drones)
      if (enemy.mesh) enemy.mesh.position.set(safe.x, safe.y, safe.z);
    }
  }
}

// ── Falling death ─────────────────────────────────────────────────────────────

function _startFall(enemy) {
  // Dim rotors
  if (enemy._rotors) {
    for (const r of enemy._rotors) {
      if (r.material) r.material.emissiveColor = new BABYLON.Color3(0.5, 0.1, 0);
    }
  }
  // Initial tumble velocity — slight upward kick then gravity takes over
  enemy._fvx = (Math.random() - 0.5) * 7;
  enemy._fvy = 1.5 + Math.random() * 2;
  enemy._fvz = (Math.random() - 0.5) * 7;
  enemy._fallT   = 0;
  enemy._smokeT  = 0;
  enemy._smokeSystems = [];
  if (enemy.mesh) enemy.mesh.setEnabled(true);  // re-show for fall animation
}

function _tickFall(enemy, dt) {
  const p  = enemy.mesh.position;
  const px = p.x, py = p.y, pz = p.z;

  // Gravity
  enemy._fvy -= 20 * dt;
  const nx = px + enemy._fvx * dt;
  const ny = py + enemy._fvy * dt;
  const nz = pz + enemy._fvz * dt;

  // Tumble
  enemy.mesh.rotation.x += dt * 4.2;
  enemy.mesh.rotation.z += dt * 3.1;

  // Smoke trail burst every 80ms
  enemy._smokeT -= dt;
  if (enemy._smokeT <= 0) {
    enemy._smokeT = 0.08;
    _burstSmoke(px, py, pz, enemy._smokeSystems);
  }
  // Prune dead systems
  for (let i = enemy._smokeSystems.length - 1; i >= 0; i--) {
    const ps = enemy._smokeSystems[i];
    if (!ps.isStarted()) { try { ps.dispose(); } catch(e) {} enemy._smokeSystems.splice(i, 1); }
  }

  enemy._fallT += dt;
  const floor = Math.max(getTerrainHeightAt(nx, nz), (getWaterY() ?? -999));

  if (ny <= floor + 0.4 || enemy._fallT > 14) {
    // Kill smoke
    for (const ps of enemy._smokeSystems) { try { ps.stop(); ps.dispose(); } catch(e) {} }
    enemy._smokeSystems = [];
    // Boom
    _explode(nx, floor + 0.4, nz);
    try { playExplosion({ x: nx, y: floor, z: nz }); } catch(e) {}
    // Hide + schedule respawn
    enemy.mesh.setEnabled(false);
    setTimeout(() => {
      if (window._levelComplete || enemy.destroyed) return;
      if (enemy.state !== 'falling') return; // already respawned or re-killed
      enemy.mesh.rotation.set(0, 0, 0);
      const wp = enemy._waypoints?.[0];
      const rx = wp?.x ?? 0, rz = wp?.z ?? 0;
      enemy.mesh.position.set(rx, RISE_TARGET_Y, rz);
      enemy.mesh.setEnabled(true);
      if (enemy._rotors) {
        for (const r of enemy._rotors) {
          if (r.material) r.material.emissiveColor = new BABYLON.Color3(0, 0, 0);
        }
      }
      enemy.health = enemy.maxHealth;
      enemy.dead   = false;
      enemy.state  = 'rising';
    }, 8000);
    return;
  }

  enemy.mesh.position.set(nx, ny, nz);
}

// ── Trail smoke — dark oily puffs ─────────────────────────────────────────────

function _burstSmoke(x, y, z, list) {
  try {
    const ps = new BABYLON.ParticleSystem('ds_' + Date.now(), 12, scene);
    ps.particleTexture = new BABYLON.Texture(
      'https://playground.babylonjs.com/textures/flare.png', scene);
    ps.emitter    = new BABYLON.Vector3(x, y, z);
    ps.minEmitBox = new BABYLON.Vector3(-0.1, 0, -0.1);
    ps.maxEmitBox = new BABYLON.Vector3( 0.1, 0,  0.1);
    // Dark oily smoke — near black with slight brown
    ps.color1    = new BABYLON.Color4(0.12, 0.09, 0.07, 0.95);
    ps.color2    = new BABYLON.Color4(0.22, 0.16, 0.10, 0.80);
    ps.colorDead = new BABYLON.Color4(0.05, 0.05, 0.05, 0.0);
    ps.minSize = 0.25; ps.maxSize = 0.6;
    ps.minLifeTime = 0.7; ps.maxLifeTime = 1.3;
    ps.emitRate = 0;
    ps.direction1 = new BABYLON.Vector3(-0.4, 0.6, -0.4);
    ps.direction2 = new BABYLON.Vector3( 0.4, 2.0,  0.4);
    ps.minEmitPower = 0.3; ps.maxEmitPower = 0.9;
    ps.updateSpeed  = 0.016;
    ps.addSizeGradient(0,   0.25);
    ps.addSizeGradient(0.4, 0.55);
    ps.addSizeGradient(1.0, 0.9);
    ps.minAngularSpeed = -2.5; ps.maxAngularSpeed = 2.5;
    ps.gravity    = new BABYLON.Vector3(0, 0.15, 0);
    ps.blendMode  = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.manualEmitCount = 8;
    ps.start();
    setTimeout(() => { try { ps.stop(); } catch(e) {} }, 80);
    list.push(ps);
  } catch(e) {}
}

// ── Explosion — three layered particle systems + flying debris ────────────────

function _explode(x, y, z) {
  _psBurst(x, y, z, {   // fireball
    n: 45, life: [0.25, 0.6],
    c1: new BABYLON.Color4(1.0, 0.65, 0.1, 1.0),
    c2: new BABYLON.Color4(1.0, 0.25, 0.0, 0.9),
    cd: new BABYLON.Color4(0.2, 0.05, 0.0, 0.0),
    sz: [0.3, 1.6], pow: [4, 10],
    dir: [new BABYLON.Vector3(-5, 2, -5), new BABYLON.Vector3(5, 9, 5)],
    blend: BABYLON.ParticleSystem.BLENDMODE_ADD,
    grav: new BABYLON.Vector3(0, -3, 0),
  });
  _psBurst(x, y + 0.4, z, {   // smoke cloud
    n: 35, life: [1.0, 2.4],
    c1: new BABYLON.Color4(0.22, 0.17, 0.13, 0.9),
    c2: new BABYLON.Color4(0.13, 0.10, 0.08, 0.7),
    cd: new BABYLON.Color4(0.04, 0.04, 0.04, 0.0),
    sz: [0.4, 2.0], pow: [1, 3],
    dir: [new BABYLON.Vector3(-2, 1, -2), new BABYLON.Vector3(2, 5, 2)],
    blend: BABYLON.ParticleSystem.BLENDMODE_STANDARD,
    grav: new BABYLON.Vector3(0, 0.4, 0),
    sizeGrad: [[0, 0.4], [0.3, 1.8], [1.0, 3.2]],
  });
  _psBurst(x, y, z, {   // sparks
    n: 30, life: [0.3, 0.8],
    c1: new BABYLON.Color4(1.0, 0.95, 0.5, 1.0),
    c2: new BABYLON.Color4(1.0, 0.6,  0.1, 0.8),
    cd: new BABYLON.Color4(0.4, 0.1,  0.0, 0.0),
    sz: [0.04, 0.16], pow: [6, 16],
    dir: [new BABYLON.Vector3(-9, 2, -9), new BABYLON.Vector3(9, 14, 9)],
    blend: BABYLON.ParticleSystem.BLENDMODE_ADD,
    grav: new BABYLON.Vector3(0, -12, 0),
  });
  // Flying debris chunks
  for (let i = 0; i < 7; i++) _debris(x, y, z);
}

function _psBurst(x, y, z, o) {
  try {
    const ps = new BABYLON.ParticleSystem('exp_' + Date.now() + Math.random(), o.n, scene);
    ps.particleTexture = new BABYLON.Texture(
      'https://playground.babylonjs.com/textures/flare.png', scene);
    ps.emitter    = new BABYLON.Vector3(x, y, z);
    ps.minEmitBox = new BABYLON.Vector3(-0.3, 0, -0.3);
    ps.maxEmitBox = new BABYLON.Vector3( 0.3, 0.3, 0.3);
    ps.color1 = o.c1; ps.color2 = o.c2; ps.colorDead = o.cd;
    ps.minSize = o.sz[0]; ps.maxSize = o.sz[1];
    ps.minLifeTime = o.life[0]; ps.maxLifeTime = o.life[1];
    ps.emitRate = 0;
    ps.direction1 = o.dir[0]; ps.direction2 = o.dir[1];
    ps.minEmitPower = o.pow[0]; ps.maxEmitPower = o.pow[1];
    ps.updateSpeed  = 0.016;
    ps.gravity  = o.grav;
    ps.blendMode = o.blend;
    if (o.sizeGrad) o.sizeGrad.forEach(([t, s]) => ps.addSizeGradient(t, s));
    ps.manualEmitCount = o.n;
    ps.start();
    setTimeout(() => { try { ps.stop(); ps.dispose(); } catch(e) {} },
      (o.life[1] + 0.6) * 1000);
  } catch(e) {}
}

function _debris(x, y, z) {
  try {
    const sz   = 0.07 + Math.random() * 0.18;
    const mesh = BABYLON.MeshBuilder.CreateBox('dbr', { size: sz }, scene);
    mesh.position.set(x, y + Math.random() * 0.4, z);
    const mat  = new BABYLON.StandardMaterial('dbrM', scene);
    mat.diffuseColor  = new BABYLON.Color3(0.18, 0.15, 0.12);
    mat.emissiveColor = new BABYLON.Color3(0.55, 0.22, 0.0);
    mesh.material = mat;
    let vx = (Math.random() - 0.5) * 18, vy = 5 + Math.random() * 9,
        vz = (Math.random() - 0.5) * 18, life = 2.2;
    const obs = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() * 0.001;
      vy -= 20 * dt;
      mesh.position.x += vx * dt;
      mesh.position.y += vy * dt;
      mesh.position.z += vz * dt;
      mesh.rotation.x += dt * 7;
      mesh.rotation.z += dt * 5;
      life -= dt;
      if (life <= 0) {
        scene.onBeforeRenderObservable.remove(obs);
        try { mesh.dispose(); } catch(e) {}
      }
    });
  } catch(e) {}
}