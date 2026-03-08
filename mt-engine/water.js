// water.js — water plane from level config
// Requires Babylon.js WaterMaterial (loaded via CDN in index.html)

import { scene } from './core.js';

let _waterMesh = null;

export function initWater(cfg) {
  clearWater();
  if (!cfg || !cfg.enabled) return;

  const matCfg  = cfg.material || {};

  // Size: always near-infinite. Only Y comes from level JSON.
  // Width/height are ignored — water is always a large plane.
  const WATER_SIZE = 4000;
  const y = cfg.mesh?.position?.y ?? 10;

  // Water mesh — low subdiv (visual only, no physics body ever)
  _waterMesh = BABYLON.MeshBuilder.CreateGround('waterPlane', {
    width: WATER_SIZE,
    height: WATER_SIZE,
    subdivisions: 4,   // minimal geometry — just needs to catch reflections
  }, scene);
  _waterMesh.position.y = y;
  _waterMesh.isPickable       = false;
  _waterMesh.checkCollisions  = false;   // no BabylonJS collision
  _waterMesh.receiveShadows   = false;
  // Explicitly exclude from any physics picking
  _waterMesh.metadata = { noPhysics: true, isWater: true };

  // WaterMaterial — requires the CDN extension to be loaded
  let mat;
  try {
    mat = new BABYLON.WaterMaterial('waterMat', scene, new BABYLON.Vector2(
      matCfg.renderTargetSize ?? 512,
      matCfg.renderTargetSize ?? 512
    ));
  } catch(e) {
    // Fallback if WaterMaterial not available
    console.warn('[water] WaterMaterial not available, using fallback:', e.message);
    const fallback = new BABYLON.StandardMaterial('waterFallback', scene);
    const wc = matCfg.waterColor || { r: 0.05, g: 0.3, b: 0.5 };
    fallback.diffuseColor = new BABYLON.Color3(wc.r, wc.g, wc.b);
    fallback.alpha = 0.75;
    fallback.backFaceCulling = true;
    _waterMesh.material = fallback;
    console.log('[water] Fallback water plane at y=' + y);
    return;
  }

  // Bump texture
  if (matCfg.bumpTexture) {
    mat.bumpTexture = new BABYLON.Texture(matCfg.bumpTexture, scene);
  }

  // Wind / wave params
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

  // IMPORTANT: Only add the terrain mesh to the render list.
  // Adding ALL scene meshes doubles draw calls and can cause physics stutter
  // (heavy frame → variable dt → physics accumulator overshoots → jitter).
  // We defer this one frame so the terrain mesh is guaranteed to exist.
  setTimeout(() => {
    if (!_waterMesh) return;  // was cleared before timeout fired
    const terrainMesh = scene.getMeshByName('terrain');
    if (terrainMesh) {
      try { mat.addToRenderList(terrainMesh); } catch(e) {}
    }
    // Also add any structure meshes that are large/prominent
    scene.meshes.forEach(m => {
      if (m === _waterMesh || !m.isVisible) return;
      if (m.metadata?.noPhysics) return;  // skip other water-type meshes
      // Only add meshes that are actually in/near water level
      const bb = m.getBoundingInfo?.();
      if (bb && bb.boundingBox.minimumWorld.y < (y + 20)) {
        try { mat.addToRenderList(m); } catch(e) {}
      }
    });
  }, 0);

  _waterMesh.material = mat;
  console.log('[water] Water plane at y=' + y + ' size=' + WATER_SIZE + 'x' + WATER_SIZE);
}

export function clearWater() {
  if (_waterMesh) {
    try { _waterMesh.material?.dispose(); } catch(e) {}
    try { _waterMesh.dispose(); } catch(e) {}
    _waterMesh = null;
  }
}

export function getWaterMesh() { return _waterMesh; }
