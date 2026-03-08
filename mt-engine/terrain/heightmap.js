// terrain/heightmap.js — load heightmap image, expose getHeightAt / heightGrid
// No physics here. Terrain collider is built in physics.js from the BabylonJS mesh.

import { CONFIG } from '../config.js';

// Public: flat Float32Array of height values, row-major, used by minimap
export let heightGrid = null;
export let heightGridSize = 0;   // N where grid is NxN

// Internal pixel data kept for getHeightAt sampling
let _imgData    = null;
let _imgWidth   = 0;
let _imgHeight  = 0;
let _worldSize  = 512;
let _heightScale = 80;

/**
 * Load a heightmap image URL and cache its pixel data.
 * @param {string} url          — remote URL or data: URI
 * @param {number} worldSize    — terrain world width/depth
 * @param {number} heightScale  — max terrain height
 */
export function loadHeightmap(url, worldSize, heightScale) {
  _worldSize   = worldSize   ?? CONFIG?.terrain?.size        ?? 512;
  _heightScale = heightScale ?? CONFIG?.terrain?.heightScale ?? 80;

  if (!url) {
    // Flat terrain — zero grid
    _buildFlatGrid();
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      try {
        _imgData   = ctx.getImageData(0, 0, canvas.width, canvas.height);
        _imgWidth  = canvas.width;
        _imgHeight = canvas.height;
      } catch(e) {
        // CORS-blocked canvas — fall back to flat
        console.warn('[heightmap] getImageData blocked (CORS?), using flat terrain:', e);
        _buildFlatGrid();
        resolve();
        return;
      }

      _buildHeightGrid();
      console.log(`[heightmap] Loaded ${_imgWidth}x${_imgHeight}, world=${_worldSize}, scale=${_heightScale}`);
      resolve();
    };

    img.onerror = (e) => {
      console.warn('[heightmap] Image load failed, using flat terrain:', url, e);
      _buildFlatGrid();
      resolve();   // resolve (not reject) so boot continues
    };

    img.src = url;
  });
}

/**
 * Sample terrain height at world position (wx, wz).
 * Matches the UV formula in terrainMesh.js.
 */
export function getHeightAt(wx, wz) {
  if (!_imgData) return 0;

  const u  = (wx + _worldSize / 2) / _worldSize;
  const v  = 1 - (wz + _worldSize / 2) / _worldSize;
  const px = Math.min(Math.max(Math.floor(u * _imgWidth),  0), _imgWidth  - 1);
  const py = Math.min(Math.max(Math.floor(v * _imgHeight), 0), _imgHeight - 1);

  const grey = _imgData.data[(py * _imgWidth + px) * 4] / 255;
  return grey * _heightScale;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _buildHeightGrid() {
  const N = 128;   // minimap resolution
  heightGridSize = N;
  heightGrid = new Float32Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const u  = col / (N - 1);
      const v  = 1 - row / (N - 1);
      const px = Math.min(Math.floor(u * _imgWidth),  _imgWidth  - 1);
      const py = Math.min(Math.floor(v * _imgHeight), _imgHeight - 1);
      const grey = _imgData.data[(py * _imgWidth + px) * 4] / 255;
      heightGrid[row * N + col] = grey * _heightScale;
    }
  }
}

function _buildFlatGrid() {
  _imgData   = null;
  _imgWidth  = 0;
  _imgHeight = 0;
  const N = 128;
  heightGridSize = N;
  heightGrid = new Float32Array(N * N);  // all zeros
}