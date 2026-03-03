// ============================================================
//  main.js — Boot sequence and main game loop
// ============================================================

import { engine, scene, camera }             from './core.js';
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
import { initAudio }                        from './audio.js';
import { hud }                              from './hud.js';
import { dropOnRandomPeak }                 from './spawn.js';
import { tickSoundtrack }                   from './soundtrack.js';
import { pollGamepad, releaseGamepadAxes,
         registerGamepadShootCallback,
         registerGamepadFreeCamCallback,
         registerGamepadSpawnDroneCallback } from './gamepad.js';
import { scanFlatAreas, getTerrainMaxY }     from './flatnav.js';
import { initMinimap, tickMinimap }          from './minimap.js';
import { buildTerrainNodeMaterial,
         applyTerrainNodeMaterial }         from './terrainmaterial.js';

// ---- Register input callbacks ----
registerShootCallback(shootBullet);
registerFreeCamCallback(toggleFreeCam);
registerSpawnDroneCallback(spawnDrone);
registerGamepadShootCallback(shootBullet);
registerGamepadFreeCamCallback(toggleFreeCam);
registerGamepadSpawnDroneCallback(spawnDrone);

// ---- Ground plane ----
(function buildGround() {
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 10000, height: 10000 }, scene);
  const mat    = new BABYLON.PBRMaterial('gmat', scene);
  const tex    = new BABYLON.Texture(GROUND_TEX, scene);
  tex.uScale = 2250; tex.vScale = 2250;
  mat.albedoTexture = tex;
  mat.metallic  = 0.05; mat.roughness = 0.95;
  mat.albedoColor = BABYLON.Color3.FromHexString('#8B7355');
  ground.material       = mat;
  ground.receiveShadows = true;
})();

// ---- State ----
let _sceneData         = null;
let _spriteLoadPromise = Promise.resolve();
let _terrainMeshes     = [];

// ---- Scene loading ----
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

  loadBuildings(data, async subMeshes => {
    _terrainMeshes = subMeshes;

    // Rocky-dirt slope material
    try {
      const terrainMat = await buildTerrainNodeMaterial();
      applyTerrainNodeMaterial(terrainMat, subMeshes);
    } catch (e) {
      console.warn('[main] Terrain mat failed:', e);
    }

    // ── All heavy world-build tasks run sequentially so they don't
    //    compete on the main thread. Play button appears only after
    //    everything is done AND a short GPU-settle pause has elapsed.
    setTimeout(async () => {

      // 1. Flat-area nav scan (raycast-heavy — finish before scatter starts)
      _setLoadingStatus('Building nav mesh…');
      try {
        const n = await scanFlatAreas(subMeshes);
        console.info(`[main] flatnav: ${n} waypoints`);
      } catch (e) { console.warn('[main] flatnav:', e); }

      // 2. Wait for sprite atlas textures to finish downloading
      _setLoadingStatus('Loading textures…');
      await _spriteLoadPromise;

      // 3. Scatter props (async internally but we await full completion)
      _setLoadingStatus('Scattering world…');
      await scatterProps(_sceneData, subMeshes);

      // 4. Settling pause
      _setLoadingStatus('Almost ready…');
      await sleep(800);

      // 5. Init minimap — terrain bounds come from the bounding box we already computed
      try {
        const mmBounds = _terrainBounds(subMeshes);
        mmBounds.maxY = getTerrainMaxY();
        initMinimap(mmBounds, subMeshes);
      } catch (e) { console.warn('[main] Minimap init failed:', e); }

      console.info('[main] World ready — showing Play button');
      _showPlayButton();

    }, 200);
  });
}

// ---- Loading status helper ----
// Updates any existing loading screen text element while we wait.
function _setLoadingStatus(text) {
  const el = document.getElementById('loading-status')
           ?? document.querySelector('.loading-status')
           ?? document.querySelector('[data-loading-status]');
  if (el) el.textContent = text;
}

// ---- Play button ----
function _showPlayButton() {
  if (!document.getElementById('play-btn-style')) {
    const style = document.createElement('style');
    style.id = 'play-btn-style';
    style.textContent = `
      #play-overlay {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        background: rgba(0,0,0,0.62);
        font-family: 'Arial Black', Arial, sans-serif;
        transition: opacity 0.4s ease;
      }
      #play-overlay h1 {
        color: #fff; font-size: 2.6rem; letter-spacing: 0.15em;
        text-transform: uppercase; margin: 0 0 0.4rem;
        text-shadow: 0 2px 24px rgba(0,0,0,0.9);
      }
      #play-overlay p {
        color: rgba(255,255,255,0.55); font-size: 0.9rem;
        margin: 0 0 2.8rem; letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      #play-btn {
        padding: 1rem 4rem; font-size: 1.5rem; font-weight: 900;
        letter-spacing: 0.25em; text-transform: uppercase;
        background: linear-gradient(135deg, #ff5500, #cc1100);
        color: #fff; border: none; border-radius: 6px;
        cursor: pointer;
        box-shadow: 0 4px 28px rgba(255,70,0,0.55);
        transition: transform 0.12s ease, box-shadow 0.12s ease;
      }
      #play-btn:hover {
        transform: scale(1.07);
        box-shadow: 0 8px 40px rgba(255,70,0,0.8);
      }
      #play-btn:active { transform: scale(0.97); }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = 'play-overlay';
  overlay.innerHTML = `
    <h1>Drone Wars</h1>
    <p>Drop into the battlefield</p>
    <button id="play-btn">PLAY</button>
  `;
  document.body.appendChild(overlay);

  document.getElementById('play-btn').addEventListener('click', _startGame, { once: true });
}

async function _startGame() {
  const overlay = document.getElementById('play-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 420);
  }

  hud.hideLoading();

  // Drop player — dropOnRandomPeak teleports the physics body to a peak
  dropOnRandomPeak(_terrainMeshes);

  // Audio on user gesture
  try { await initAudio(); } catch (_) {}

  // Wait for the player to physically land before spawning drone #1.
  // dropOnRandomPeak puts the player in freefall — we poll until vertical
  // velocity is near zero and Y has stabilised, then read the landed position.
  await _waitForPlayerToLand();

  const landedPos = {
    x: player.rigidBody?.translation().x ?? camera.globalPosition.x,
    y: player.rigidBody?.translation().y ?? camera.globalPosition.y,
    z: player.rigidBody?.translation().z ?? camera.globalPosition.z,
  };

  // Set sky patrol height to just above the highest terrain point so the
  // drone clears every peak on its way to the player. Add 20m headroom.
  const terrainTop = getTerrainMaxY();
  if (terrainTop > 0) {
    CONFIG.skyPatrolHeight = terrainTop + 20;
    console.info(`[main] skyPatrolHeight set to ${CONFIG.skyPatrolHeight.toFixed(1)} (terrain top: ${terrainTop.toFixed(1)})`);
  }

  console.info(`[main] Player landed at (${landedPos.x.toFixed(1)}, ${landedPos.y.toFixed(1)}, ${landedPos.z.toFixed(1)}) — spawning drone`);
  spawnDrone(landedPos);
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

  pollGamepad(dt);

  tickPlayer(dt);
  tickLadders();
  tickDrones(dt);
  tickBullets(dt);
  tickBillboards();
  tickExplosions(dt);
  tickSoundtrack(playerRig.position, dt);
  tickMinimap(
    player.rigidBody ? player.rigidBody.translation() : null,
    drones,
  );

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
  // Loading screen stays visible — _startGame() dismisses it after Play click
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _waitForTerrain(timeoutMs = 15_000) {
  const start = performance.now();
  while (!_terrainMeshes.length) {
    if (performance.now() - start > timeoutMs) {
      console.warn('[spawn] Timed out waiting for terrain.');
      return;
    }
    await sleep(100);
  }
  await sleep(50);
}

/** Compute world bounding box from terrain sub-meshes. */
function _terrainBounds(terrainMeshes) {
  const min = new BABYLON.Vector3( Infinity,  Infinity,  Infinity);
  const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of terrainMeshes) {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(bb.minimumWorld);
    max.maximizeInPlace(bb.maximumWorld);
  }
  return { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z, minY: min.y, maxY: max.y };
}

/** Poll until the player's rigid body has landed (vertical velocity near zero). */
async function _waitForPlayerToLand(timeoutMs = 8000) {
  const start = performance.now();
  // First wait a minimum time for physics to kick in after the teleport
  await sleep(400);
  while (performance.now() - start < timeoutMs) {
    try {
      const vel = player.rigidBody?.linvel();
      if (vel && Math.abs(vel.y) < 0.5) return;   // settled
    } catch (_) {}
    await sleep(100);
  }
  console.warn('[main] Timed out waiting for player to land — spawning drone anyway');
}

boot();