// terrain/terrainMesh.js
// Builds BabylonJS ground mesh via manual vertex stamping (NOT CreateGroundFromHeightMap).
// This approach works with data URLs and gives us pixel-level height queries.
//
// Key exports:
//   buildTerrain(scene, cfg)              — build/rebuild mesh from config
//   getTerrainMesh()                      — current mesh
//   getTerrainHeightAt(x, z)             — sample height at world XZ (used by player, enemies, spawn)
//   getTerrainPixelData()                 — raw ImageData for physics collider
//   applyHeightmapFromDataUrl(scene, url, scale, onReady)  — editor integration
//   rescaleHeights(scale)                 — instant rescale using cached pixels

import { getConfig } from '../config.js';

let _mesh        = null;
let _lastImgData = null;   // cached pixel data — single source of truth for all height queries
let _lastSizeX   = 512;
let _lastSizeZ   = 512;
let _lastScale   = 50;
let _lastSubdiv  = 128;

// ---- Public: height query ----

/**
 * Sample terrain height at world XZ.
 * Returns 0 if no heightmap loaded (flat terrain).
 */
export function getTerrainHeightAt(wx, wz) {
  if (!_lastImgData) return 0;

  const img = _lastImgData;
  // Map world XZ → UV [0,1]
  const u =  (wx + _lastSizeX / 2) / _lastSizeX;
  const v = 1.0 - ((wz + _lastSizeZ / 2) / _lastSizeZ);  // V-flip matches vertex stamping

  const px = Math.max(0, Math.min(img.width  - 1, Math.floor(u * (img.width  - 1))));
  const py = Math.max(0, Math.min(img.height - 1, Math.floor(v * (img.height - 1))));
  const idx = (py * img.width + px) * 4;
  return (img.data[idx] / 255) * _lastScale;
}

/** Raw ImageData for physics heightfield collider — null for flat terrain */
export function getTerrainPixelData() { return _lastImgData; }

/** Current mesh */
export function getTerrainMesh() { return _mesh; }

// ---- Public: build ----

export async function buildTerrain(scene, cfg) {
  cfg = cfg || getConfig();
  const t          = cfg.terrain || {};
  _lastSizeX       = t.sizeX ?? t.size ?? 512;
  _lastSizeZ       = t.sizeZ ?? t.size ?? 512;
  _lastSubdiv      = t.subdivisions ?? 128;
  _lastScale       = t.heightScale  ?? 50;
  const heightmapUrl = t.heightmapUrl || null;

  if (_mesh) { try { _mesh.dispose(); } catch(e) {} _mesh = null; }

  if (heightmapUrl) {
    console.log('[terrain] Loading heightmap:', heightmapUrl.slice(0, 60));
    try {
      const { imageData } = await _loadImageData(heightmapUrl);
      _lastImgData = imageData;
      _mesh = _stampMesh(scene, imageData, _lastSizeX, _lastSizeZ, _lastSubdiv, _lastScale);
    } catch(e) {
      console.warn('[terrain] Heightmap load failed, falling back to flat:', e);
      _lastImgData = null;
      _mesh = _buildFlat(scene, _lastSizeX, _lastSizeZ, _lastSubdiv);
    }
  } else {
    _lastImgData = null;
    _mesh = _buildFlat(scene, _lastSizeX, _lastSizeZ, _lastSubdiv);
  }

  _applyMaterial(scene, _mesh, t);
  return _mesh;
}

/** Editor: apply a new heightmap data URL */
export async function applyHeightmapFromDataUrl(scene, dataUrl, heightScale, onReady) {
  const cfg = getConfig();
  if (!cfg.terrain) cfg.terrain = {};
  cfg.terrain.heightmapUrl = dataUrl;
  if (heightScale != null) cfg.terrain.heightScale = heightScale;
  await buildTerrain(scene, cfg);
  // Full physics rebuild — guarantees clean single collider, no stale handles
  window._fullTerrainPhysicsRebuild?.();
  if (typeof onReady === 'function') onReady();
}

/** Instant rescale using cached pixels — no re-fetch */
export function rescaleHeights(scale) {
  if (!_lastImgData || !_mesh) return;
  _lastScale = scale;
  _stampVertices(_mesh, _lastImgData, _lastSizeX, _lastSizeZ, _lastSubdiv, scale);
  window._fullTerrainPhysicsRebuild?.();
  console.log('[terrain] Rescaled to', scale);
}

// ---- Internal ----

function _loadImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve({
        imageData: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height),
        width:  canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => reject(new Error('Image load failed: ' + url.slice(0, 60)));
    img.src = url;
  });
}

function _buildFlat(scene, sizeX, sizeZ, subdiv) {
  const mesh = BABYLON.MeshBuilder.CreateGround('terrain', {
    width: sizeX, height: sizeZ, subdivisions: subdiv, updatable: true,
  }, scene);
  console.log('[terrain] Flat terrain', sizeX, 'x', sizeZ);
  _logBounds(mesh);
  return mesh;
}

function _stampMesh(scene, imgData, sizeX, sizeZ, subdiv, scale) {
  const mesh = BABYLON.MeshBuilder.CreateGround('terrain', {
    width: sizeX, height: sizeZ, subdivisions: subdiv, updatable: true,
  }, scene);
  _stampVertices(mesh, imgData, sizeX, sizeZ, subdiv, scale);
  return mesh;
}

function _stampVertices(mesh, imgData, sizeX, sizeZ, subdiv, scale) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const vCount    = (subdiv + 1) * (subdiv + 1);

  let minH = Infinity, maxH = -Infinity;

  for (let row = 0; row <= subdiv; row++) {
    for (let col = 0; col <= subdiv; col++) {
      const i = row * (subdiv + 1) + col;
      // V-flip: row 0 = image bottom
      const u =        col / subdiv;
      const v = 1.0 - (row / subdiv);
      const px = Math.min(Math.floor(u * (imgData.width  - 1)), imgData.width  - 1);
      const py = Math.min(Math.floor(v * (imgData.height - 1)), imgData.height - 1);
      const idx = (py * imgData.width + px) * 4;
      const h = (imgData.data[idx] / 255) * scale;
      positions[i * 3 + 1] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
  BABYLON.VertexData.ComputeNormals(
    positions,
    mesh.getIndices(),
    mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind)
  );
  mesh.refreshBoundingInfo();

  console.log(`[terrain] Heights stamped — scale:${scale} min:${minH.toFixed(1)} max:${maxH.toFixed(1)} verts:${subdiv+1}x${subdiv+1}`);
  _logBounds(mesh);
}

function _logBounds(mesh) {
  const bi = mesh.getBoundingInfo();
  console.log('[terrain] Mesh bounding box — min:', bi.boundingBox.minimumWorld, 'max:', bi.boundingBox.maximumWorld);
  console.log('[terrain] Mesh isVisible:', mesh.isVisible, 'vertices:', mesh.getTotalVertices());
}

function _applyMaterial(scene, mesh, t) {
  const mat = new BABYLON.StandardMaterial('terrainMat', scene);
  // Use shader layer colors if defined, otherwise default green
  const baseColor = t.shaderLayers?.[0]?.color || '#3a5a2a';
  const rgb = _hexToRgb(baseColor);
  mat.diffuseColor  = new BABYLON.Color3(rgb.r, rgb.g, rgb.b);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mesh.material = mat;
  mesh.receiveShadows = true;
  mesh.checkCollisions = false; // Rapier handles collisions
}

function _hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}