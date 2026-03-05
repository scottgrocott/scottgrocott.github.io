// ============================================================
//  main.js — Boot sequence and main game loop
// ============================================================

import { engine, scene }                    from './core.js';
import { SCENE_JSON, GROUND_TEX, CONFIG }   from './config.js';
import { initPhysics, stepPhysics, syncPhysicsReads, queryPhysics } from './physics.js';
import { registerShootCallback, registerFreeCamCallback, registerSpawnDroneCallback, setFreeCamActive } from './input.js';
import { player, initPlayer, tickPlayer, toggleFreeCam, playerRig } from './player.js';
import { initLadders, tickLadders }         from './ladders.js';
import { loadBuildings }                    from './buildings.js';
import { drones, flightWaypoints, yukaManager, yukaTime, spawnDrone, tickDrones, addWaypoint } from './drones.js';
import { tickBullets, shootBullet }         from './bullets.js';
import { tickExplosions }                   from './explosions.js';
import { tickShelters, shelterProgressionDone,
         destroyShelterAt, spawnNextShelter }  from './shelters.js';
import { tickBillboards, loadSpriteAssets, scatterProps } from './scatter.js';
import { initAudio, toneReady }             from './audio.js';
import { hud }                              from './hud.js';
import { dropOnRandomPeak }                 from './spawn.js';
import { tickSoundtrack }                   from './soundtrack.js';
import { pollGamepad, releaseGamepadAxes,
         registerGamepadShootCallback,
         registerGamepadFreeCamCallback,
         registerGamepadSpawnDroneCallback } from './gamepad.js';
import { initMinimap, tickMinimap }         from './minimap.js';
import { tickInputGuard }                   from './inputGuard.js';
import { initEditor, tickEditor,
         onFreeCamEnter, onFreeCamExit }    from './editor.js';
import { setLookCamera }                    from './look.js';
import { camera }                           from './core.js';

// ---- Wire look camera ----
setLookCamera(camera);

// ---- Freecam toggle — opens/closes editor panel ----
let _shootEnabled = true;

function _toggleFreeCam() {
  toggleFreeCam();
  if (player.freeCam) {
    _shootEnabled = true;   // shoot still works in freecam via setFreeCamActive
    setFreeCamActive(true);
    onFreeCamEnter();
  } else {
    _shootEnabled = true;
    setFreeCamActive(false);
    onFreeCamExit();
  }
}

// ---- Register input callbacks ----
registerShootCallback(() => { if (_shootEnabled) shootBullet(); });
registerFreeCamCallback(_toggleFreeCam);
registerSpawnDroneCallback(spawnDrone);

registerGamepadShootCallback(() => { if (_shootEnabled) shootBullet(); });
registerGamepadFreeCamCallback(_toggleFreeCam);
registerGamepadSpawnDroneCallback(spawnDrone);

// ---- Ground plane ----
(function buildGround() {
  const ground   = BABYLON.MeshBuilder.CreateGround('ground', { width: 10000, height: 10000 }, scene);
  const mat      = new BABYLON.PBRMaterial('gmat', scene);
  const tex      = new BABYLON.Texture(GROUND_TEX, scene);
  tex.uScale = 2250; tex.vScale = 2250;
  mat.albedoTexture = tex;
  mat.metallic  = 0.05; mat.roughness = 0.95;
  mat.albedoColor = BABYLON.Color3.FromHexString('#8B7355');
  ground.material       = mat;
  ground.receiveShadows = true;
})();

// ---- Scene loading ----
let _sceneData          = null;
let _spriteLoadPromise  = Promise.resolve();
let _terrainMeshes      = [];

async function loadScene() {
  const res  = await fetch(SCENE_JSON);
  const data = await res.json();
  _sceneData = data;

  _spriteLoadPromise = loadSpriteAssets(data.assets);

  data.waypoints.forEach(wp => {
    const [x, y, z] = wp.position.split(' ').map(Number);
    addWaypoint(x, y, z);
  });

  data.buildings.forEach(b => {
    const [bx, by, bz] = b.position.split(' ').map(Number);
    const r = 6, h = CONFIG.droneFlightHeight;
    [[bx + r, h + 1, bz], [bx, h - 1, bz + r], [bx - r, h + 2, bz], [bx, h, bz - r]]
      .forEach(([wx, wy, wz]) => addWaypoint(wx, wy, wz));
  });

  loadBuildings(data, subMeshes => {
    _terrainMeshes = subMeshes;

    // Compute terrain bounds for minimap
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
    subMeshes.forEach(m => {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      bounds.minX = Math.min(bounds.minX, bb.minimumWorld.x);
      bounds.maxX = Math.max(bounds.maxX, bb.maximumWorld.x);
      bounds.minZ = Math.min(bounds.minZ, bb.minimumWorld.z);
      bounds.maxZ = Math.max(bounds.maxZ, bb.maximumWorld.z);
      bounds.minY = Math.min(bounds.minY, bb.minimumWorld.y);
      bounds.maxY = Math.max(bounds.maxY, bb.maximumWorld.y);
    });
    initMinimap(bounds, subMeshes);

    setTimeout(async () => {
      await _spriteLoadPromise;
      scatterProps(_sceneData, subMeshes);
    }, 200);
  });
}

// ---- Game loop ----
let lastTime = performance.now();

engine.runRenderLoop(() => {
  const now = performance.now();
  const dt  = Math.min((now - lastTime) / 1000, 0.1);
  lastTime  = now;

  tickInputGuard();

  stepPhysics(dt);
  syncPhysicsReads(player, drones);
  queryPhysics(player, drones);
  yukaManager.update(yukaTime.update().getDelta());

  pollGamepad(dt);

  tickPlayer(dt);
  tickLadders();
  tickDrones(dt);
  tickBullets(dt);
  tickBillboards();
  tickExplosions(dt);
  tickShelters();
  tickSoundtrack(playerRig.position, dt);
  tickMinimap(playerRig.position, drones);
  tickEditor();

  releaseGamepadAxes();

  scene.render();
});

// ---- Boot ----
async function boot() {
  await initPhysics();
  initLadders();
  await loadScene();
  await _waitForTerrain();
  await sleep(100);
  initPlayer();

  // Drop player onto terrain
  dropOnRandomPeak(_terrainMeshes);
  hud.hideLoading();

  // Init editor (no-op on non-localhost)
  initEditor(() => playerRig.position);

  // Spawn first drone only after player has physically landed
  // — polling vertical velocity so we don't spawn mid-freefall
  _spawnDroneAfterLanding();

  // Audio on first user gesture
  let audioStarted = false;
  const startAudio = async () => {
    if (audioStarted) return;
    audioStarted = true;
    await initAudio();
  };
  document.addEventListener('click',   startAudio, { once: true });
  document.addEventListener('keydown', startAudio, { once: true });
}

async function _spawnDroneAfterLanding() {
  // Wait until player's vertical velocity is near zero (landed)
  const MAX_WAIT = 8000;
  const start    = performance.now();
  while (performance.now() - start < MAX_WAIT) {
    await sleep(200);
    const rb = player.rigidBody;
    if (rb) {
      const vel = rb.linvel();
      if (Math.abs(vel.y) < 1.0 && player.isGrounded) break;
    }
  }
  console.info('[main] Player landed — spawning drone');
  spawnDrone();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _waitForTerrain(timeoutMs = 15_000) {
  const start = performance.now();
  while (!_terrainMeshes.length) {
    if (performance.now() - start > timeoutMs) {
      console.warn('[spawn] Timed out waiting for terrain — dropping at origin.');
      return;
    }
    await sleep(100);
  }
  await sleep(50);
}

boot();