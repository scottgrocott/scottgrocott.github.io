// sky.js — blue sky background, hemisphere ambient, directional sun

import { scene } from './core.js';

let _sun        = null;
let _hemisphere = null;
let _skybox     = null;

export function initSky() {
  // ── Sky colour ───────────────────────────────────────────────────────────
  scene.clearColor = new BABYLON.Color4(0.45, 0.65, 0.95, 1.0);  // cornflower blue

  // ── Hemisphere light (ambient sky/ground gradient) ───────────────────────
  _hemisphere = new BABYLON.HemisphericLight(
    'hemi', new BABYLON.Vector3(0, 1, 0), scene
  );
  _hemisphere.intensity    = 0.55;
  _hemisphere.diffuse      = new BABYLON.Color3(0.85, 0.90, 1.00);   // sky tint
  _hemisphere.groundColor  = new BABYLON.Color3(0.20, 0.18, 0.12);   // warm ground bounce
  _hemisphere.specular     = new BABYLON.Color3(0, 0, 0);

  // ── Directional sun (big, bright, casts shadows) ─────────────────────────
  _sun = new BABYLON.DirectionalLight(
    'sun', new BABYLON.Vector3(-0.6, -1.0, -0.4), scene
  );
  _sun.intensity    = 2.8;
  _sun.diffuse      = new BABYLON.Color3(1.00, 0.95, 0.82);   // warm sunlight
  _sun.specular     = new BABYLON.Color3(0.30, 0.28, 0.20);

  // Position the shadow frustum high above the map centre
  _sun.position = new BABYLON.Vector3(200, 400, 150);

  console.log('[sky] Sky and sun initialised');
  return { sun: _sun, hemisphere: _hemisphere };
}

/** Call from main.js after shadowGenerator exists to attach the sun as its light */
export function getSunLight() { return _sun; }
