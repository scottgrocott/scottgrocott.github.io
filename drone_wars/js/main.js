// ============================================================
//  main.js — Boot sequence and main game loop
// ============================================================

import { engine, scene }                    from './core.js';
import { SCENE_JSON, GROUND_TEX, CONFIG }   from './config.js';
import { initPhysics, stepPhysics, syncPhysicsReads, queryPhysics } from './physics.js';
import { registerShootCallback, registerFreeCamCallback, registerSpawnDroneCallback } from './input.js';
import { player, initPlayer, tickPlayer, toggleFreeCam, playerRig } from './player.js';
import { initLadders, tickLadders }         from './ladders.js';
import { loadBuildings }                    from './buildings.js';
import { drones, flightWaypoints, yukaManager, yukaTime, spawnDrone, tickDrones, addWaypoint } from './drones.js';
import { tickBullets, shootBullet }         from './bullets.js';
import { tickExplosions }                   from './explosions.js';
import { tickBillboards, loadSpriteAssets, scatterProps } from './scatter.js';
import { initAudio, toneReady }             from './audio.js';
import { hud }                              from './hud.js';
import { dropOnRandomPeak }                 from './spawn.js';
import { tickSoundtrack }                   from './soundtrack.js';
import { pollGamepad, releaseGamepadAxes,
         registerGamepadShootCallback,
         registerGamepadFreeCamCallback,
         registerGamepadSpawnDroneCallback } from './gamepad.js';

// ---- Register input callbacks (breaks circular deps) ----
registerShootCallback(shootBullet);
registerFreeCamCallback(toggleFreeCam);
registerSpawnDroneCallback(spawnDrone);

// Gamepad uses the same callbacks — both devices fire the same actions
registerGamepadShootCallback(shootBullet);
registerGamepadFreeCamCallback(toggleFreeCam);
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
let _terrainMeshes      = [];  // populated by onTerrainReady, used for peak scan

async function loadScene() {
  const res  = await fetch(SCENE_JSON);
  const data = await res.json();
  _sceneData = data;

  _spriteLoadPromise = loadSpriteAssets(data.assets);

  // Register waypoints from JSON
  data.waypoints.forEach(wp => {
    const [x, y, z] = wp.position.split(' ').map(Number);
    addWaypoint(x, y, z);
  });

  // Extra waypoints around buildings
  data.buildings.forEach(b => {
    const [bx, by, bz] = b.position.split(' ').map(Number);
    const r = 6, h = CONFIG.droneFlightHeight;
    [[bx + r, h + 1, bz], [bx, h - 1, bz + r], [bx - r, h + 2, bz], [bx, h, bz - r]]
      .forEach(([wx, wy, wz]) => addWaypoint(wx, wy, wz));
  });

  loadBuildings(data, subMeshes => {
    // Called when terrain finishes loading
    _terrainMeshes = subMeshes;
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

  stepPhysics(dt);
  syncPhysicsReads(player, drones);
  queryPhysics(player, drones);
  yukaManager.update(yukaTime.update().getDelta());

  pollGamepad(dt);        // gamepad → inputState (before tick so player reads it)

  tickPlayer(dt);
  tickLadders();
  tickDrones(dt);
  tickBullets(dt);
  tickBillboards();
  tickExplosions(dt);
  tickSoundtrack(playerRig.position, dt);  // contextual music zone update

  releaseGamepadAxes();   // clear axis-driven booleans after tick

  scene.render();
});

// ---- Boot ----
async function boot() {
  await initPhysics();
  initLadders();
  await loadScene();

  // Wait for terrain GLB to finish loading so world matrices are ready for ray-casts.
  // loadBuildings fires onTerrainReady synchronously inside the ImportMeshAsync .then(),
  // so we poll _terrainMeshes with a short back-off rather than adding another promise chain.
  await _waitForTerrain();

  await sleep(100);
  initPlayer();

  // Scan terrain and freefall onto a random mountain peak
  dropOnRandomPeak(_terrainMeshes);

  hud.hideLoading();

  // Audio must be started on a user gesture
  let audioStarted = false;
  const startAudio = async () => {
    if (audioStarted) return;
    audioStarted = true;
    await initAudio();
  };
  document.addEventListener('click',   startAudio, { once: true });
  document.addEventListener('keydown', startAudio, { once: true });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Poll until the terrain GLB has loaded (onTerrainReady populated _terrainMeshes). */
async function _waitForTerrain(timeoutMs = 15_000) {
  const start = performance.now();
  while (!_terrainMeshes.length) {
    if (performance.now() - start > timeoutMs) {
      console.warn('[spawn] Timed out waiting for terrain — dropping at origin.');
      return;
    }
    await sleep(100);
  }
  // One extra frame to let Babylon finalise world matrices after the mesh is added
  await sleep(50);
}

boot();