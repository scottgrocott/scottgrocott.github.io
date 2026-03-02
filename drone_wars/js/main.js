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

// ---- Register input callbacks (breaks circular deps) ----
registerShootCallback(shootBullet);
registerFreeCamCallback(toggleFreeCam);
registerSpawnDroneCallback(spawnDrone);

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

  tickPlayer(dt);
  tickLadders();
  tickDrones(dt);
  tickBullets(dt);
  tickBillboards();
  tickExplosions(dt);

  scene.render();
});

// ---- Boot ----
async function boot() {
  await initPhysics();
  initLadders();
  await loadScene();
  await sleep(500);
  initPlayer();
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

boot();
