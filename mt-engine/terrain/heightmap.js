// terrain/heightmap.js — heightmap loader, getHeightAt, Rapier heightfield

import { physicsWorld, physicsReady, safeVec3 } from '../physics.js';

export let heightmapReady = false;
export let heightGrid     = null; // Float32Array [row * cols + col]

let _gridRows = 0;
let _gridCols = 0;
let _terrainSize  = 700;
let _heightScale  = 80;
let _heightCollider = null;

export async function loadHeightmap(url, terrainSize, heightScale) {
  _terrainSize = terrainSize || 700;
  _heightScale = heightScale || 80;

  if (!url) {
    // Flat plane
    _generateFlat();
    return;
  }

  try {
    await _loadFromURL(url);
  } catch (e) {
    console.warn('[heightmap] Failed to load PNG, using flat:', e);
    _generateFlat();
  }
}

function _generateFlat() {
  const N = 64;
  _gridRows = N; _gridCols = N;
  heightGrid = new Float32Array(N * N).fill(0);
  heightmapReady = true;
  _createRapierHeightfield();
}

async function _loadFromURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const N = Math.min(img.width, img.height, 256);
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = N;
      const ctx = cnv.getContext('2d');
      ctx.drawImage(img, 0, 0, N, N);
      const data = ctx.getImageData(0, 0, N, N).data;
      _gridRows = N; _gridCols = N;
      heightGrid = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) {
        heightGrid[i] = (data[i * 4] / 255) * _heightScale;
      }
      heightmapReady = true;
      _createRapierHeightfield();
      resolve();
    };
    img.onerror = reject;
    img.src = url;
  });
}

function _createRapierHeightfield() {
  if (!physicsReady || !physicsWorld) return;
  if (_heightCollider) {
    try { physicsWorld.removeCollider(_heightCollider, true); } catch(e) {}
  }
  const rows = _gridRows, cols = _gridCols;
  const scale = { x: _terrainSize, y: 1.0, z: _terrainSize };

  const bodyDesc = RAPIER.RigidBodyDesc.fixed();
  const body = physicsWorld.createRigidBody(bodyDesc);

  const cdesc = RAPIER.ColliderDesc.heightfield(rows - 1, cols - 1, heightGrid, scale);
  _heightCollider = physicsWorld.createCollider(cdesc, body);
}

// Bilinear interpolation of height at world position
export function getHeightAt(worldX, worldZ) {
  if (!heightmapReady || !heightGrid) return 0;
  const half = _terrainSize / 2;
  const normX = (worldX + half) / _terrainSize; // 0..1
  const normZ = (worldZ + half) / _terrainSize;
  const u = Math.max(0, Math.min(1, normX)) * (_gridCols - 1);
  const v = Math.max(0, Math.min(1, normZ)) * (_gridRows - 1);
  const c0 = Math.floor(u), r0 = Math.floor(v);
  const c1 = Math.min(c0 + 1, _gridCols - 1);
  const r1 = Math.min(r0 + 1, _gridRows - 1);
  const fu = u - c0, fv = v - r0;
  const h00 = heightGrid[r0 * _gridCols + c0];
  const h10 = heightGrid[r0 * _gridCols + c1];
  const h01 = heightGrid[r1 * _gridCols + c0];
  const h11 = heightGrid[r1 * _gridCols + c1];
  return h00 * (1-fu)*(1-fv) + h10 * fu*(1-fv) + h01 * (1-fu)*fv + h11 * fu*fv;
}
