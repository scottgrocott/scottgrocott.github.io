// scatter.js — sprite-sheet atlas billboard scatter with placeholder fallback

import { scene } from './core.js';
import { CONFIG } from './config.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { euler } from './look.js';

let _instances = [];

const CATEGORY_COLORS = {
  vegetation: new BABYLON.Color3(0.15, 0.55, 0.10),
  rock:       new BABYLON.Color3(0.45, 0.38, 0.28),
  prop:       new BABYLON.Color3(0.55, 0.55, 0.55),
};

export async function loadSpriteAssets(layers) {
  return {};
}

export function scatterProps() {
  clearScatter();

  const layers = CONFIG.scatterLayers || [];
  if (layers.length === 0) {
    _scatterLayer({ category: 'vegetation', density: 0.15, minElevation: 0, maxElevation: 1 });
    _scatterLayer({ category: 'rock',       density: 0.04, minElevation: 0, maxElevation: 0.7 });
    return;
  }
  for (const layer of layers) {
    _scatterLayer(layer);
  }
}

function _scatterLayer(layer) {
  const density   = layer.density  || 0.1;
  const category  = layer.category || 'vegetation';
  const size      = CONFIG.terrain.size || 700;
  const half      = size / 2;
  const gridCells = 60;
  const cellSize  = size / gridCells;
  const color     = CATEGORY_COLORS[category] || CATEGORY_COLORS.vegetation;

  for (let xi = 0; xi < gridCells; xi++) {
    for (let zi = 0; zi < gridCells; zi++) {
      if (Math.random() > density) continue;

      const wx = -half + xi * cellSize + Math.random() * cellSize;
      const wz = -half + zi * cellSize + Math.random() * cellSize;
      const wy = getTerrainHeightAt(wx, wz);   // ← terrain surface height

      const h = 0.5 + Math.random() * 1.2;
      const w = 0.4 + Math.random() * 0.6;

      const mesh = BABYLON.MeshBuilder.CreatePlane(
        `scatter_${_instances.length}`, { width: w, height: h }, scene);
      mesh.position.set(wx, wy + h / 2, wz);
      mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;

      const mat = new BABYLON.StandardMaterial(`scatMat_${_instances.length}`, scene);
      mat.diffuseColor  = color.clone().scale(0.8 + Math.random() * 0.4);
      mat.backFaceCulling = false;
      mat.alphaMode     = BABYLON.Engine.ALPHA_COMBINE;
      mesh.material     = mat;

      _instances.push({ mesh, wx, wz });
    }
  }
}

export function tickBillboards() {}

export function rebuildScatterLayer(layerIndex) {
  clearScatter();
  scatterProps();
}

export function clearScatter() {
  for (const inst of _instances) {
    try { inst.mesh.dispose(); } catch(e) {}
  }
  _instances = [];
}