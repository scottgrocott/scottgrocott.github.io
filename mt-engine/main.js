// main.js — boot sequence, render loop, config switch orchestration

import { engine, scene } from './core.js';
import { CONFIG, setConfig } from './config.js';
import { setLookCamera } from './look.js';
import {
  registerShootCallback,
  registerFreeCamCallback,
  registerSpawnEnemyCallback,
  setFreeCamActive,
} from './input.js';
import { tickInputGuard, suspendMouse, resumeMouse } from './inputGuard.js';
import { initPhysics, resetPhysics, stepPhysics, syncPhysicsReads, physicsReady, addTerrainCollider, addFlatGroundCollider } from './physics.js';
import { initPlayer, tickPlayer, toggleFreeCam, player, playerRig } from './player.js';
import { initCockpit, tickCockpit, disposeCockpit } from './cockpit.js';
import { tickHUD, hudSetStatus } from './hud.js';
import { initLadders, tickLadders, clearLadders } from './ladders.js';
import { initMinimap, tickMinimap } from './minimap.js';
import { loadHeightmap } from './terrain/heightmap.js';
import { buildTerrain, getTerrainMesh, getTerrainHeightAt, getTerrainPixelData } from './terrain/terrainMesh.js';
import { buildTerrainMaterial, applyTerrainMaterial } from './terrain/terrainMaterial.js';
import { computeTerrainBounds } from './terrain/terrainBounds.js';
import { scanFlatAreas } from './flatnav.js';
import { scatterProps, clearScatter } from './scatter.js';
import { loadBuildings, clearBuildings } from './buildings.js';
import { clearStructures, tickStructures } from './structures.js';
import { dropOnStart } from './spawn.js';
import { initWeapon, shootBullet, tickBullets, clearBullets } from './weapons/basicGun.js';
import { tickYUKA, setPlayerRigRef } from './enemies/enemyBase.js';
import { clearEnemies } from './enemies/enemyRegistry.js';
import { spawnDrones, tickDrones } from './enemies/drones.js';
import { spawnCars, tickCars } from './enemies/cars.js';
import { spawnForklifts, tickForklifts } from './enemies/forklifts.js';
import { tickExplosions } from './explosions.js';
import { clearShelters, tickShelters } from './shelters/shelters.js';
import { initAudio } from './audio.js';
import { initSoundtrack, tickSoundtrack, disposeSoundtrack } from './soundtrack.js';
import { pollGamepad, releaseGamepadAxes, registerGamepadShootCallback, registerGamepadFreeCamCallback, registerGamepadSpawnEnemyCallback } from './gamepad.js';
import { initEditor, tickEditor, onFreeCamEnter, onFreeCamExit, initEditorScene } from './editor/editor.js';
import { camera } from './core.js';
import { initSky } from './sky.js';

// ENGINE_ROOT: absolute URL base of the engine (where main.js lives).
// Works regardless of where index.html is served from.
const _thisScript = document.currentScript ||
  [...document.querySelectorAll('script[type="module"]')].find(s => s.src && s.src.includes('main.js'));
const _thisUrl = _thisScript
  ? new URL(_thisScript.src, window.location.href)
  : new URL(window.location.href);
export const ENGINE_ROOT = _thisUrl.href.replace(/\/[^\/]+$/, '');

function _enginePath(rel) { return `${ENGINE_ROOT}/${rel}`; }

// Config loading:
//   1. Try 'game-config.json' next to index.html (standalone deployment)
//   2. Fall back to engine default
// Base URL of the page (directory containing index.html), no trailing slash
const _pagePath = window.location.pathname.endsWith('/')
  ? window.location.pathname.slice(0, -1)
  : window.location.pathname.replace(/\/[^\/]+$/, '');
const _pageBase  = window.location.origin + _pagePath;
const LOCAL_CONFIG   = `${_pageBase}/game-config.json`;
const DEFAULT_CONFIG = _enginePath('assets/configs/test.json');

console.log('[main] pageBase:', _pageBase, 'ENGINE_ROOT:', ENGINE_ROOT);

// GitHub Pages deployment URL for the engine.
// Set this in localStorage via the editor, or hardcode for your repo.
// e.g. 'https://username.github.io/engine'
// When set, exported index.html will reference this URL instead of the dev server.
function getDeployEngineUrl() {
  return localStorage.getItem('deploy_engine_url') || ENGINE_ROOT;
}
function setDeployEngineUrl(url) {
  localStorage.setItem('deploy_engine_url', url.replace(/\/$/, ''));
  console.log('[main] Deploy engine URL set to:', url);
}
window.setDeployEngineUrl = setDeployEngineUrl; // expose for editor panel

// Notify index.html of ENGINE_ROOT so config-select can be populated
window.dispatchEvent(new CustomEvent('engine-ready', { detail: { engineRoot: ENGINE_ROOT } }));

async function _resolveStartConfig() {
  const params = new URLSearchParams(window.location.search);

  // ?config=path/to/any.json  — explicit full path (relative to page or absolute)
  const configParam = params.get('config');
  if (configParam) {
    const url = configParam.startsWith('http') ? configParam : `${_pageBase}/${configParam}`;
    console.log('[main] Config from URL param:', url);
    return url;
  }

  // ?level=N  — loads level-N.json next to index.html, e.g. level-1.json
  const levelParam = params.get('level');
  if (levelParam) {
    const url = `${_pageBase}/level-${levelParam}.json`;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) { console.log('[main] Level from URL param:', url); return url; }
      console.warn('[main] Level file not found:', url, '— falling back');
    } catch(e) {}
  }

  // Default: try game-config.json next to index.html
  try {
    const r = await fetch(LOCAL_CONFIG, { method: 'HEAD' });
    if (r.ok) { console.log('[main] Local game-config.json found'); return LOCAL_CONFIG; }
  } catch(e) {}

  console.log('[main] Using engine default config');
  return DEFAULT_CONFIG;
}

// Wait for YUKA CDN global (classic script, may lag behind ES module execution)
function _waitForYuka(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (window.YUKA) { resolve(); return; }
    console.log('[main] Waiting for YUKA CDN...');
    const start = Date.now();
    const iv = setInterval(() => {
      if (window.YUKA) { clearInterval(iv); console.log('[main] YUKA ready'); resolve(); return; }
      if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error('YUKA CDN failed to load'));
      }
    }, 50);
  });
}

let _loading = false;
let _audioStarted = false;

// ---- Loading Screen ----
function setLoadStatus(msg, pct) {
  const el  = document.getElementById('load-status');
  const bar = document.getElementById('loading-bar');
  if (el)  el.textContent = msg.toUpperCase();
  if (bar) bar.style.width = (pct || 0) + '%';
}

function hideLoadingScreen() {
  const ls = document.getElementById('loading-screen');
  if (ls) {
    ls.style.opacity = '0';
    ls.style.transition = 'opacity 0.6s';
    setTimeout(() => { ls.style.display = 'none'; }, 600);
  }
}

// ---- Boot ----
async function boot() {
  initSky();
  setLoadStatus('Setting up look & camera', 5);
  setLookCamera(camera);

  setLoadStatus('Registering callbacks', 10);
  registerShootCallback(_shoot);
  registerFreeCamCallback(_freecam);
  registerSpawnEnemyCallback(_spawnEnemy);
  registerGamepadShootCallback(_shoot);
  registerGamepadFreeCamCallback(_freecam);
  registerGamepadSpawnEnemyCallback(_spawnEnemy);

  setLoadStatus('Loading config...', 15);
  await loadGameConfig(await _resolveStartConfig());

  // Wire top-bar — all optional so exported minimal index.html works too
  document.getElementById('config-select')?.addEventListener('change', async (e) => {
    await loadGameConfig(e.target.value);
  });
  document.getElementById('btn-editor')?.addEventListener('click', _freecam);
  document.getElementById('btn-audio')?.addEventListener('click', async () => {
    await _startAudio();
    hudSetStatus('🔊 Audio ON');
  });
  document.getElementById('btn-deploy')?.addEventListener('click', () => {
    _exportGame();
  });
  document.getElementById('btn-save')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(CONFIG, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (CONFIG.meta?.id || 'config') + '.json';
    a.click();
  });

  // Init editor (no-op on non-localhost)
  initEditor(() => playerRig ? {
    x: +playerRig.position.x, y: +playerRig.position.y, z: +playerRig.position.z
  } : { x:0, y:0, z:0 });
  initEditorScene(scene);

  // Start audio on first user gesture
  const _onGesture = async () => {
    if (!_audioStarted) { await _startAudio(); }
    document.removeEventListener('click', _onGesture);
    document.removeEventListener('keydown', _onGesture);
  };
  document.addEventListener('click', _onGesture);
  document.addEventListener('keydown', _onGesture);

  // Start render loop
  let _lastTime = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt  = Math.min((now - _lastTime) / 1000, 0.05);
    _lastTime = now;

    tickInputGuard();
    stepPhysics(dt);
    syncPhysicsReads();
    pollGamepad(dt);
    tickPlayer(dt);
    tickLadders(dt);
    tickYUKA();          // drives YUKA EntityManager — must be every frame
    tickDrones(dt);
    tickCars(dt);
    tickForklifts(dt);
    tickBullets(dt);
    tickExplosions(dt);
    tickSoundtrack();
    tickShelters(dt);
    tickStructures(dt);
    tickCockpit(dt);
    tickMinimap();
    tickHUD();
    tickEditor();
    releaseGamepadAxes();
    scene.render();
  });
}

// ---- Terrain collider rebuild ----
// Full physics rebuild after editor applies new heightmap.
// Destroys and recreates the Rapier world to guarantee zero stale colliders,
// then re-adds terrain collider + player body. Enemies re-add themselves on next tick.
async function _fullTerrainPhysicsRebuild() {
  console.log('[main] Full terrain physics rebuild... wasInFreeCam:', player.freeCam, 'body enabled:', player.rigidBody?.isEnabled());

  // Remember if player was in freecam so we restore it correctly
  const wasInFreeCam = player.freeCam;

  // Clear everything holding rigid body refs before destroying the world
  clearEnemies();
  clearBullets();

  // Tear down physics world completely
  resetPhysics();
  await initPhysics();

  // Re-add terrain collider
  _rebuildTerrainCollider();

  // Re-init player — initPlayer sets freeCam=false and body enabled
  initPlayer();

  // If we were in freecam before the rebuild, disable the new body
  // so the player stays in fly mode without falling
  if (wasInFreeCam) {
    player.freeCam = true;
    player.rigidBody.setEnabled(false);
    console.log('[main] Body disabled for freecam, isEnabled now:', player.rigidBody.isEnabled(), 'handle:', player.rigidBody.handle);
  } else {
    window._resnapPlayerToTerrain?.();
  }

  // Re-spawn enemies from config
  _spawnEnemiesFromConfig();

  console.log('[main] Terrain physics rebuild complete');
}
window._fullTerrainPhysicsRebuild = _fullTerrainPhysicsRebuild;

function _rebuildTerrainCollider() {
  const pixelData = getTerrainPixelData();
  if (pixelData) {
    const t = CONFIG.terrain || {};
    addTerrainCollider(pixelData, t.sizeX ?? t.size ?? 512, t.sizeZ ?? t.size ?? 512,
                       t.heightScale ?? 50, 64);
  } else {
    const t = CONFIG.terrain || {};
    addFlatGroundCollider(t.sizeX ?? t.size ?? 512, t.sizeZ ?? t.size ?? 512);
  }
}
window._rebuildTerrainCollider = _rebuildTerrainCollider;

// ---- Config Load ----
async function loadGameConfig(url) {
  if (_loading) return;
  _loading = true;
  setLoadStatus('Tearing down scene...', 10);

  // Full teardown
  clearEnemies();
  clearBullets();
  clearShelters();
  clearStructures();
  clearBuildings();
  clearScatter();
  clearLadders();
  disposeSoundtrack();
  disposeCockpit();

  // Dispose old terrain mesh
  const oldMesh = getTerrainMesh();
  if (oldMesh) { try { oldMesh.dispose(); } catch(e) {} }

  resetPhysics();

  // Fetch config JSON
  setLoadStatus('Fetching ' + url, 20);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    setConfig(json);
  } catch(e) {
    console.error('[main] Failed to load config:', url, e);
    hudSetStatus('Config load failed: ' + url);
    _loading = false;
    return;
  }

  // Update title and loading screen as soon as config is known
  const _title = CONFIG.meta?.title || 'Metal Throne';
  document.title = _title;
  const _loadTitle = document.querySelector('#loading-screen .load-title');
  if (_loadTitle) _loadTitle.textContent = _title.toUpperCase();

  setLoadStatus('Initializing physics', 30);
  await initPhysics();

  setLoadStatus('Building terrain', 45);

  // Pick a random heightmap from the heightmaps array (if provided)
  const _hmaps = CONFIG.terrain.heightmaps;
  if (Array.isArray(_hmaps) && _hmaps.length > 0) {
    const _pick = _hmaps[Math.floor(Math.random() * _hmaps.length)];
    CONFIG.terrain.heightmapUrl = _pick;
    console.log('[main] Selected heightmap', (_hmaps.indexOf(_pick) + 1) + '/' + _hmaps.length + ':', _pick);
  }

  // Prefix relative asset paths with ENGINE_ROOT
  if (CONFIG.terrain.heightmap && !CONFIG.terrain.heightmap.startsWith('http') && !CONFIG.terrain.heightmap.startsWith('/') && ENGINE_ROOT) {
    CONFIG.terrain.heightmap = _enginePath(CONFIG.terrain.heightmap);
  }
  if (CONFIG.terrain.heightmapUrl && !CONFIG.terrain.heightmapUrl.startsWith('data:') && !CONFIG.terrain.heightmapUrl.startsWith('http') && ENGINE_ROOT) {
    CONFIG.terrain.heightmapUrl = _enginePath(CONFIG.terrain.heightmapUrl);
  }
  await loadHeightmap(CONFIG.terrain.heightmap, CONFIG.terrain.size, CONFIG.terrain.heightScale);
  await buildTerrain(scene, CONFIG);
  _rebuildTerrainCollider();
  const terrainMesh = getTerrainMesh();
  const mat = buildTerrainMaterial(CONFIG.terrain);
  if (terrainMesh) applyTerrainMaterial([terrainMesh]);

  setLoadStatus('Scanning navigation', 55);
  scanFlatAreas();

  setLoadStatus('Loading buildings & structures', 60);
  await loadBuildings();

  setLoadStatus('Spawning player', 70);
  initPlayer();
  dropOnStart();
  initLadders();
  initCockpit();
  initWeapon(CONFIG.weapons?.[0]);

  // Give enemy tick functions a reference to the player rig
  setPlayerRigRef(playerRig);

  setLoadStatus('Scattering environment', 80);
  scatterProps();

  const bounds = computeTerrainBounds(CONFIG.terrain);
  initMinimap(bounds);

  setLoadStatus('Spawning enemies', 88);
  await _waitForYuka();
  _spawnEnemiesFromConfig();

  const title = CONFIG.meta?.title || 'Metal Throne';
  const subtitle = CONFIG.meta?.subtitle || '';

  // Update page title
  document.title = title;

  // Update loading screen title (in case it's still visible during transition)
  const loadTitle = document.querySelector('#loading-screen .load-title');
  if (loadTitle) loadTitle.textContent = title.toUpperCase();
  const loadSub = document.querySelector('#loading-screen .load-sub');
  if (loadSub && subtitle) loadSub.textContent = subtitle.toUpperCase();

  setLoadStatus('Ready!', 100);
  hideLoadingScreen();
  hudSetStatus(`${title}${subtitle ? ' — ' + subtitle : ''} loaded`);
  _loading = false;
}

function _spawnEnemiesFromConfig() {
  const defs = CONFIG.enemies || [];
  for (const def of defs) {
    if (def.type === 'drone')         spawnDrones(def);
    else if (def.type === 'car')      spawnCars(def);
    else if (def.type === 'forklift') spawnForklifts(def);
  }
}

// ---- Callbacks ----
function _shoot() {
  shootBullet();
}

function _freecam() {
  const isFree = toggleFreeCam();
  setFreeCamActive(isFree);
  if (isFree) {
    onFreeCamEnter();
    hudSetStatus('🎥 FREECAM  |  shoot: click  |  F: exit');
  } else {
    onFreeCamExit();
    resumeMouse();
    const canvas = document.getElementById('renderCanvas');
    canvas.requestPointerLock();
    hudSetStatus('▶ WALK MODE');
  }
}

function _spawnEnemy() {
  if (!CONFIG.enemies?.length) {
    hudSetStatus('No enemies in config');
    return;
  }
  const def = CONFIG.enemies[Math.floor(Math.random() * CONFIG.enemies.length)];
  if (def.type === 'drone')         spawnDrones({ ...def, maxCount: 1 });
  else if (def.type === 'car')      spawnCars({ ...def, maxCount: 1 });
  else if (def.type === 'forklift') spawnForklifts({ ...def, maxCount: 1 });
  hudSetStatus('Enemy spawned');
}

async function _startAudio() {
  if (_audioStarted) return;
  _audioStarted = true;
  await initAudio();
  initSoundtrack();
}

// ---- Export Game ----
function _dl(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

window._exportGameFromEditor = function() { _exportGame(); };
function _exportGame() {
  // Build and save a standalone index.html that points back at the engine
  const engineSrc = getDeployEngineUrl() + '/main.js';
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${CONFIG.meta?.title || 'Metal Throne Game'}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#000; overflow:hidden; font-family:'Courier New',monospace; }
    #top-bar { position:fixed;top:0;left:0;right:0;z-index:10000;height:36px;
      background:rgba(8,12,8,0.92);border-bottom:1px solid #2a3a2a;
      display:flex;align-items:center;gap:12px;padding:0 12px; }
    #top-bar button { background:#0e1e0e;border:1px solid #3a6a3a;color:#8aee8a;
      font-family:inherit;font-size:11px;padding:3px 8px;cursor:pointer;border-radius:2px; }
    #renderCanvas { width:100vw;height:100vh;display:block;touch-action:none; }
    #hud { position:fixed;top:42px;left:12px;z-index:9000;color:#8aee8a;font-size:11px;
      pointer-events:none;display:flex;flex-direction:column;gap:4px; }
    #hud .hud-row { display:flex;gap:10px; }
    #hud .hud-label { color:#4a7a4a; }
    #crosshair { position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      width:16px;height:16px;pointer-events:none;z-index:9000; }
    #crosshair::before,#crosshair::after { content:'';position:absolute;background:rgba(138,238,138,0.8); }
    #crosshair::before { width:2px;height:16px;left:7px;top:0; }
    #crosshair::after  { width:16px;height:2px;top:7px;left:0; }
    #loading-screen { position:fixed;inset:0;background:#000d00;z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      color:#8aee8a;font-family:'Courier New',monospace; }
    #loading-screen .load-title { font-size:22px;letter-spacing:0.3em;margin-bottom:18px; }
    #loading-screen .load-sub   { font-size:11px;color:#4a7a4a;letter-spacing:0.15em; }
    #loading-bar-wrap { width:280px;height:4px;background:#1a2a1a;border-radius:2px;margin-top:18px; }
    #loading-bar { height:4px;background:#4aee4a;border-radius:2px;width:0%;transition:width 0.3s; }
    #minimap-canvas { position:fixed;bottom:12px;right:12px;z-index:9000;border:1px solid #2a4a2a;border-radius:2px; }
  </style>
  <script src="https://cdn.babylonjs.com/babylon.js"><\/script>
  <script src="https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js"><\/script>
  <script src="https://cdn.babylonjs.com/materialsLibrary/babylonjs.materials.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/yuka@0.7.8/build/yuka.min.js"><\/script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js"><\/script>
</head>
<body>
  <div id="loading-screen">
    <div class="load-title">${(CONFIG.meta?.title || 'METAL THRONE').toUpperCase()}</div>
    <div class="load-sub" id="load-status">INITIALIZING...</div>
    <div id="loading-bar-wrap"><div id="loading-bar"></div></div>
  </div>
  <div id="top-bar">
    <button id="btn-audio">🔊 Audio</button>
    <button id="btn-help">? Help</button>
  </div>
  <canvas id="renderCanvas"></canvas>
  <div id="crosshair"></div>
  <div id="hud">
    <div class="hud-row">
      <span class="hud-label">HP</span><span id="hud-health">100</span>
      <span class="hud-label">AMMO</span><span id="hud-ammo">∞</span>
      <span class="hud-label">ENEMIES</span><span id="hud-enemies">0</span>
    </div>
    <div class="hud-row"><span class="hud-label">POS</span><span id="hud-pos">0,0,0</span></div>
    <div class="hud-row"><span id="hud-status"></span></div>
  </div>
  <canvas id="minimap-canvas" width="220" height="220"></canvas>
  <!-- Auto-detect engine: local dev vs deployed — engineSrc baked in as fallback -->
  <script>
    const _local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const _src = _local ? 'http://localhost:83/mt-engine/main.js' : '${engineSrc}';
    const _s = document.createElement('script');
    _s.type = 'module'; _s.src = _src;
    document.head.appendChild(_s);
  <\/script>
</body>
</html>`;

  // Download HTML first, then JSON after a short gap (browser blocks simultaneous downloads)
  _dl('index.html', new Blob([html], { type: 'text/html' }));
  setTimeout(() => {
    _dl('game-config.json', new Blob([JSON.stringify(CONFIG, null, 2)], { type: 'application/json' }));
    hudSetStatus('📦 Exported! Drop index.html + game-config.json anywhere with a web server.');
  }, 500);
}

// Kick off
boot();