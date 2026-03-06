// water.js — water plane from level config
// Requires Babylon.js WaterMaterial (loaded via CDN in index.html)

import { scene } from './core.js';

let _waterMesh = null;

export function initWater(cfg) {
  clearWater();
  if (!cfg || !cfg.enabled) return;

  const meshCfg = cfg.mesh     || {};
  const matCfg  = cfg.material || {};

  const w = meshCfg.width       ?? 700;
  const h = meshCfg.height      ?? 700;
  const s = meshCfg.subdivisions ?? 32;
  const y = meshCfg.position?.y  ?? 10;

  // Water mesh
  _waterMesh = BABYLON.MeshBuilder.CreateGround('waterPlane', { width: w, height: h, subdivisions: s }, scene);
  _waterMesh.position.y = y;
  _waterMesh.isPickable = false;

  // WaterMaterial — requires the CDN extension to be loaded
  let mat;
  try {
    mat = new BABYLON.WaterMaterial('waterMat', scene, new BABYLON.Vector2(
      matCfg.renderTargetSize ?? 512,
      matCfg.renderTargetSize ?? 512
    ));
  } catch(e) {
    // Fallback if WaterMaterial not available — use a transparent StandardMaterial
    console.warn('[water] WaterMaterial not available, using fallback:', e.message);
    const fallback = new BABYLON.StandardMaterial('waterFallback', scene);
    const wc = matCfg.waterColor || { r: 0.05, g: 0.3, b: 0.5 };
    fallback.diffuseColor = new BABYLON.Color3(wc.r, wc.g, wc.b);
    fallback.alpha = 0.7;
    fallback.specularColor = new BABYLON.Color3(0.8, 0.9, 1.0);
    _waterMesh.material = fallback;
    console.log('[water] Fallback water plane at y=' + y);
    return;
  }

  // Bump texture
  if (matCfg.bumpTexture) {
    mat.bumpTexture = new BABYLON.Texture(matCfg.bumpTexture, scene);
  }

  // Wind
  const wd = matCfg.windDirection || { x: 1, y: 0.5 };
  mat.windForce     = matCfg.windForce  ?? 6;
  mat.windDirection = new BABYLON.Vector2(wd.x, wd.y);
  mat.waveHeight    = matCfg.waveHeight ?? 0.4;
  mat.bumpHeight    = matCfg.bumpHeight ?? 0.1;
  mat.waveLength    = matCfg.waveLength ?? 0.1;
  mat.waveSpeed     = matCfg.waveSpeed  ?? 20;

  // Colors
  const wc  = matCfg.waterColor  || { r: 0.05, g: 0.3,  b: 0.5 };
  const wc2 = matCfg.waterColor2 || { r: 0.1,  g: 0.4,  b: 0.6 };
  mat.waterColor        = new BABYLON.Color3(wc.r,  wc.g,  wc.b);
  mat.waterColor2       = new BABYLON.Color3(wc2.r, wc2.g, wc2.b);
  mat.colorBlendFactor  = matCfg.colorBlendFactor  ?? 0.2;
  mat.colorBlendFactor2 = matCfg.colorBlendFactor2 ?? 0.2;

  if (matCfg.disableClipPlane !== undefined) {
    mat.disableClipPlane = matCfg.disableClipPlane;
  }

  // WaterMaterial needs to know what meshes to reflect/refract
  // Add all meshes currently in scene (terrain, structures)
  scene.meshes.forEach(m => {
    if (m !== _waterMesh && m.isVisible) {
      try { mat.addToRenderList(m); } catch(e) {}
    }
  });

  _waterMesh.material = mat;
  console.log('[water] Water plane created at y=' + y + ' size=' + w + 'x' + h);
}

export function clearWater() {
  if (_waterMesh) {
    try { _waterMesh.material?.dispose(); } catch(e) {}
    try { _waterMesh.dispose(); } catch(e) {}
    _waterMesh = null;
  }
}

export function getWaterMesh() { return _waterMesh; }