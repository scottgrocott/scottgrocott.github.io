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
import { initPlayer, initPlayerBody, tickPlayer, toggleFreeCam, player, playerRig } from './player.js';
import { initCockpit, tickCockpit, disposeCockpit } from './cockpit.js';
import { tickHUD, hudSetStatus } from './hud.js';
import { initLadders, tickLadders, clearLadders } from './ladders.js';
import { initMinimap, tickMinimap } from './minimap.js';
import { loadHeightmap } from './terrain/heightmap.js';
import { buildTerrain, getTerrainMesh, getTerrainHeightAt, getTerrainPixelData, getTerrainVertexData, getTerrainSubdiv } from './terrain/terrainMesh.js';
import { computeTerrainBounds } from './terrain/terrainBounds.js';
import { scanFlatAreas } from './flatnav.js';
import { scatterProps, clearScatter } from './scatter.js';
import { loadBuildings, clearBuildings } from './buildings.js';
import { clearStructures, spawnStructures } from './structures.js';
import { initLevelManager, startLevelCheck, tickLevelManager } from './levelManager.js';
import { loadEnvironment } from './environment.js';
import { initWater, clearWater } from './water.js';
import { dropOnStart } from './spawn.js';
import { initWeapon, shootBullet, tickBullets, clearBullets } from './weapons/basicGun.js';
import { tickYUKA, setPlayerRigRef } from './enemies/enemyBase.js';
import { clearEnemies } from './enemies/enemyRegistry.js';
import { spawnDrones, tickDrones } from './enemies/drones.js';
import { spawnCars, tickCars } from './enemies/cars.js';
import { spawnForklifts, tickForklifts } from './enemies/forklifts.js';
import { spawnCows, tickCows } from './enemies/cows.js';
import { spawnATSTs, tickATSTs } from './enemies/atst.js';
import { tickExplosions } from './explosions.js';
import { clearShelters, tickShelters } from './shelters/shelters.js';
import { initAudio, toneReady, updateAudioListener } from './audio.js';
import { initSoundtrack, tickSoundtrack, disposeSoundtrack, setSoundState } from './soundtrack.js';
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
const _pageBase = window.location.href.replace(/\/[^\/]*$/, '');
const LOCAL_CONFIG   = `${_pageBase}/game-config.json`;
const DEFAULT_CONFIG = _enginePath('assets/configs/test.json');

// Notify index.html of ENGINE_ROOT so config-select can be populated
window.dispatchEvent(new CustomEvent('engine-ready', { detail: { engineRoot: ENGINE_ROOT } }));

async function _resolveStartConfig() {
  // ?level=level-2.json  or  ?level=2  (shorthand → level-2.json)
  const params = new URLSearchParams(window.location.search);
  const lvlParam = params.get('level');
  if (lvlParam) {
    // Normalise: bare number → "level-N.json", bare name → "name.json"
    let lvlFile = lvlParam;
    if (/^\d+$/.test(lvlFile)) lvlFile = `level-${lvlFile}.json`;
    if (!lvlFile.endsWith('.json')) lvlFile += '.json';
    const lvlUrl = `${_pageBase}/${lvlFile}`;
    console.log('[main] Level from URL param:', lvlUrl);
    return lvlUrl;
  }
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
let _wasInWater = false;   // tracks water entry/exit for sound events
let _audioStarted = false;
let _playerReady   = false;

// ---- Loading Screen ----
function setLoadStatus(msg, pct) {
  const el  = document.getElementById('load-status');
  const bar = document.getElementById('loading-bar');
  if (el)  el.textContent = msg.toUpperCase();
  if (bar) bar.style.width = (pct || 0) + '%';
}

function hideLoadingScreen() {
  // Loading screen is now dismissed by the Play button in index.html
  // so we just show the Play button rather than auto-hiding the screen
  window._splashShowPlay?.();
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

  // Wire top-bar — guard each element since not all pages include the editor UI
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

  // Start audio on splash dismissal or first user gesture
  const _onGesture = async () => {
    if (!_audioStarted) { await _startAudio(); }
    document.removeEventListener('click', _onGesture);
    document.removeEventListener('keydown', _onGesture);
    document.removeEventListener('splash-dismissed', _onGesture);
  };
  document.addEventListener('splash-dismissed', _onGesture);
  document.addEventListener('click', _onGesture);
  document.addEventListener('keydown', _onGesture);

// ── Underwater fog ───────────────────────────────────────────────────────────
let _wasSubmerged = false;
let _savedFogMode, _savedFogColor, _savedFogDensity, _savedFogStart, _savedFogEnd;

function _tickUnderwaterFog(submerged) {
  if (submerged === _wasSubmerged) return;
  _wasSubmerged = submerged;
  if (submerged) {
    _savedFogMode    = scene.fogMode;
    _savedFogColor   = scene.fogColor?.clone();
    _savedFogDensity = scene.fogDensity;
    _savedFogStart   = scene.fogStart;
    _savedFogEnd     = scene.fogEnd;
    const uwCfg      = CONFIG.underwater_fog ?? {};
    scene.fogMode    = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = uwCfg.density ?? 0.08;
    scene.fogColor   = new BABYLON.Color3(uwCfg.r ?? 0.02, uwCfg.g ?? 0.15, uwCfg.b ?? 0.35);
    console.log('[main] Underwater fog ON');
  } else {
    scene.fogMode    = _savedFogMode    ?? BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor   = _savedFogColor   ?? new BABYLON.Color3(0.7, 0.8, 0.9);
    scene.fogDensity = _savedFogDensity ?? 0.02;
    scene.fogStart   = _savedFogStart   ?? 100;
    scene.fogEnd     = _savedFogEnd     ?? 600;
    console.log('[main] Underwater fog OFF');
  }
}

  // Start render loop
  let _lastTime = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt  = Math.min((now - _lastTime) / 1000, 0.05);
    _lastTime = now;

    tickInputGuard();
    if (_playerReady) stepPhysics(dt);
    syncPhysicsReads();
    pollGamepad(dt);
    tickPlayer(dt);
    // Water entry/exit detection — drives water sound states
    if (playerRig) {
      const waterY = CONFIG.water?.enabled ? (CONFIG.water?.mesh?.position?.y ?? null) : null;
      if (waterY !== null) {
        const inWater = playerRig.position.y < waterY;
        const submerged = playerRig.position.y < waterY - 1.0;
        if (inWater !== _wasInWater) {
          _wasInWater = inWater;
          setSoundState(inWater ? 'player_enter_water' : 'player_exit_water', true);
          // Reset the event flag next frame so it can fire again
          setTimeout(() => setSoundState(inWater ? 'player_enter_water' : 'player_exit_water', false), 100);
        }
        setSoundState('player_submerged', submerged);
        _tickUnderwaterFog(submerged);
      }
    }
    // Always keep listener position up to date — enemy audio needs it regardless of toneReady
    if (playerRig) {
      updateAudioListener(
        { x: playerRig.position.x, y: playerRig.position.y + 1.6, z: playerRig.position.z }
      );
    }
    tickLadders(dt);
    tickYUKA();          // drives YUKA EntityManager — must be every frame
    tickDrones(dt);
    tickCars(dt);
    tickForklifts(dt);
    tickCows(dt);
    tickATSTs(dt);
    tickBullets(dt);
    tickExplosions(dt);
    tickSoundtrack();
    tickShelters(dt);
    tickLevelManager(dt);
    tickCockpit(dt);
    tickMinimap();
    tickHUD();
    tickEditor();
    releaseGamepadAxes();
    scene.render();
  });
}

// ---- Config Load ----
// Enemy type definitions fetched from CDN — keyed by type ('drone','car','forklift')
const _enemyTypeDefs = {};
const _ENEMY_DEF_URLS = {
  drone:    'https://scottgrocott.github.io/mt-assets/enemies/drones.json',
  car:      'https://scottgrocott.github.io/mt-assets/enemies/cars.json',
  forklift: 'https://scottgrocott.github.io/mt-assets/enemies/forklifts.json',
};

async function _loadEnemyTypeDefs() {
  for (const [type, url] of Object.entries(_ENEMY_DEF_URLS)) {
    if (_enemyTypeDefs[type]) continue;  // already loaded
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const arr = await r.json();
      // Index by id for quick lookup; also store array
      _enemyTypeDefs[type] = { list: arr, byId: Object.fromEntries(arr.map(d => [d.id, d])) };
      console.log(`[main] Enemy defs loaded: ${type} (${arr.length} variants)`);
    } catch(e) {
      console.warn(`[main] Could not load enemy defs for ${type}:`, e);
      _enemyTypeDefs[type] = { list: [], byId: {} };
    }
  }
}

async function loadGameConfig(url) {
  if (_loading) return;
  _loading = true;
  setLoadStatus('Tearing down scene...', 10);

  // Full teardown
  _playerReady = false;
  clearEnemies();
  clearBullets();
  clearShelters();
  clearStructures();
  clearBuildings();
  clearWater();
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
    initLevelManager(loadGameConfig);
  startLevelCheck();
  if (_audioStarted) initSoundtrack();
  _loading = false;
    return;
  }

  setLoadStatus('Initializing physics', 30);
  await initPhysics();

  setLoadStatus('Building terrain', 45);

  // Pick a random heightmap from the heightmaps array if provided
  const _hmaps = CONFIG.terrain.heightmaps;
  if (Array.isArray(_hmaps) && _hmaps.length > 0) {
    const _pick = _hmaps[Math.floor(Math.random() * _hmaps.length)];
    if (_pick && typeof _pick === 'object') {
      CONFIG.terrain.heightmapUrl = _pick.url ?? _pick.heightmapUrl ?? '';
      const { url: _u, heightmapUrl: _hu, ...overrides } = _pick;
      for (const [k, v] of Object.entries(overrides)) {
        if (k === 'environment')   { CONFIG.terrain.environment = v; }
        else if (k === 'shelterCount' && CONFIG.shelters) { CONFIG.shelters.count = v; }
        else                       { CONFIG.terrain[k] = v; }
      }
    } else {
      CONFIG.terrain.heightmapUrl = _pick;
    }
    console.log('[main] Selected heightmap', (_hmaps.indexOf(_pick)+1) + '/' + _hmaps.length + ':', CONFIG.terrain.heightmapUrl);
  }

  // Prefix relative asset paths with ENGINE_ROOT
  if (CONFIG.terrain.heightmap && !CONFIG.terrain.heightmap.startsWith('http') && !CONFIG.terrain.heightmap.startsWith('/') && ENGINE_ROOT) {
    CONFIG.terrain.heightmap = _enginePath(CONFIG.terrain.heightmap);
  }
  if (CONFIG.terrain.heightmapUrl && !CONFIG.terrain.heightmapUrl.startsWith('data:') && !CONFIG.terrain.heightmapUrl.startsWith('http') && ENGINE_ROOT) {
    CONFIG.terrain.heightmapUrl = _enginePath(CONFIG.terrain.heightmapUrl);
  }

  if (CONFIG.terrain?.environment) {
    // environment may be an object { types: [...], shaderLayers: [...] }
    // or a plain string/array of env_id strings.
    const _env = CONFIG.terrain.environment;
    if (_env && typeof _env === 'object' && !Array.isArray(_env)) {
      // Hoist shaderLayers up to terrain config so _applyMaterial can read them
      if (_env.shaderLayers && !CONFIG.terrain.shaderLayers) {
        CONFIG.terrain.shaderLayers = _env.shaderLayers;
      }
      // Pass types array (or fall back to whole object) to loadEnvironment
      await loadEnvironment(_env.types ?? _env);
    } else {
      await loadEnvironment(_env);
    }
  }

  // If no environment loaded node materials, apply default dirt+rocks (flat=dirt, slope=rocks)
  if (!window._currentEnvNodeMats || (!window._currentEnvNodeMats.rocks && !window._currentEnvNodeMats.dirt)) {
    const _BASE = 'https://scottgrocott.github.io/mt-assets/terrain/environments/mediterranean/';
    window._currentEnvNodeMats = {
      rocks: {
        url:            _BASE + 'node_mat_rock.jpg',
        uScale:         2.0,  vScale:        2.0,
        minSlope:       0.45, maxSlope:      1.0,
        slopeFalloff:   0.15,
        minHeight:     -50.0, maxHeight:    2000.0,
        heightFalloff:  10.0,
      },
      dirt: {
        url:            _BASE + 'node_mat_dirt.jpg',
        uScale:         4.0,  vScale:        4.0,
        minSlope:       0.0,  maxSlope:      0.55,
        slopeFalloff:   0.15,
        minHeight:     -50.0, maxHeight:    1500.0,
        heightFalloff:  10.0,
      },
    };
    console.log('[main] Using default dirt+rock node materials');
  }

  await loadHeightmap(CONFIG.terrain.heightmapUrl || CONFIG.terrain.heightmap, CONFIG.terrain.size, CONFIG.terrain.heightScale);
  await buildTerrain(scene, CONFIG);
  const terrainMesh = getTerrainMesh();
  // Material applied inside buildTerrain → _applyMaterial (node mat or fallback)

  // Build Rapier heightfield collider so player walks on terrain surface
  const _pixelData = getTerrainPixelData();
  const _verts = getTerrainVertexData();
  if (_verts) {
    addTerrainCollider(_verts, getTerrainSubdiv());
  }

  if (CONFIG.water?.enabled) initWater(CONFIG.water);

  setLoadStatus('Scanning navigation', 55);
  scanFlatAreas();

  setLoadStatus('Loading buildings & structures', 60);
  await loadBuildings();
  spawnStructures(CONFIG.structures);

  setLoadStatus('Spawning player', 70);
  _playerReady = false;
  initPlayer();
  dropOnStart();
  _playerReady = true;
  initLadders();
  initCockpit();
  initWeapon(CONFIG.weapons?.[0]);

  // Give enemy tick functions a reference to the player rig
  setPlayerRigRef(playerRig);

  setLoadStatus('Scattering environment', 80);
  await scatterProps();

  const bounds = computeTerrainBounds(CONFIG.terrain);
  initMinimap(bounds);

  setLoadStatus('Spawning enemies', 88);
  await _loadEnemyTypeDefs();
  await _waitForYuka();
  _spawnEnemiesFromConfig();

  setLoadStatus('Ready!', 100);
  // Expose water level and heightScale for minimap water overlay
  window._CONFIG_water_y    = CONFIG.water?.enabled ? (CONFIG.water?.mesh?.position?.y ?? null) : null;
  window._CONFIG_heightScale = CONFIG.terrain?.heightScale ?? 80;

  // Populate splash screen content from level JSON and show Play button
  const _splashTitle = CONFIG.meta?.title || CONFIG.meta?.levels?.[0]?.title || 'Metal Throne';
  window._setSplashContent?.(_splashTitle, CONFIG.splash_screen || '');
  window._splashShowPlay?.();
  hudSetStatus(`${CONFIG.meta?.title || 'Game'} loaded`);
  initLevelManager(loadGameConfig);
  startLevelCheck();
  if (_audioStarted) initSoundtrack();
  _loading = false;
}

function _spawnEnemiesFromConfig() {
  const defs = CONFIG.enemies || [];
  for (const def of defs) {
    if (def.enabled === false) continue;
    if ((def.maxCount ?? 1) <= 0) continue;
    // Merge CDN type def (audio, model, movingParts) into level-JSON def.
    // Level JSON picks the variant via def.variantId; falls back to first in list.
    const typeDefs = _enemyTypeDefs[def.type];
    const variantDef = typeDefs
      ? (def.variantId ? typeDefs.byId[def.variantId] : typeDefs.list[0])
      : null;
    const merged = variantDef ? { ...variantDef, ...def } : def;

    if (merged.type === 'drone')         spawnDrones(merged);
    else if (merged.type === 'car')      spawnCars(merged);
    else if (merged.type === 'forklift') spawnForklifts(merged);
    else if (merged.type === 'cow')      spawnCows(merged);
    else if (merged.type === 'atst')     spawnATSTs(merged);
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
  const enabled = (CONFIG.enemies || []).filter(
    d => d.enabled !== false && (d.maxCount ?? 1) > 0
  );
  if (!enabled.length) {
    hudSetStatus('No enabled enemies in config');
    return;
  }
  const def = enabled[Math.floor(Math.random() * enabled.length)];
  if (def.type === 'drone')         spawnDrones({ ...def, maxCount: 1 });
  else if (def.type === 'car')      spawnCars({ ...def, maxCount: 1 });
  else if (def.type === 'forklift') spawnForklifts({ ...def, maxCount: 1 });
  else if (def.type === 'cow')      spawnCows({ ...def, maxCount: 1 });
  else if (def.type === 'atst')     spawnATSTs({ ...def, maxCount: 1 });
  hudSetStatus('Enemy spawned');
}

async function _startAudio() {
  if (_audioStarted) return;
  _audioStarted = true;
  await initAudio();
  initSoundtrack();
}

// ---- Export Game ----
function _exportGame() {
  // 1. Save game-config.json (the current config)
  const cfgBlob = new Blob([JSON.stringify(CONFIG, null, 2)], { type: 'application/json' });
  const cfgA = document.createElement('a');
  cfgA.href = URL.createObjectURL(cfgBlob);
  cfgA.download = 'game-config.json';
  cfgA.click();

  // 2. Build and save a standalone index.html that points back at the engine
  const engineSrc = ENGINE_ROOT + '/main.js';
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
    <div class="load-title">${CONFIG.meta?.title || 'METAL THRONE'}</div>
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
  <script type="module" src="${engineSrc}"><\/script>
</body>
</html>`;

  setTimeout(() => {
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const htmlA = document.createElement('a');
    htmlA.href = URL.createObjectURL(htmlBlob);
    htmlA.download = 'index.html';
    htmlA.click();
    if (typeof hudSetStatus === 'function') hudSetStatus('📦 Exported! Drop index.html + game-config.json anywhere.');
  }, 300);
}

// Kick off
boot();