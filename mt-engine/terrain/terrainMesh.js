// terrain/terrainMesh.js

import { getConfig } from '../config.js';
import { addTerrainCollider } from '../physics.js';

let _mesh           = null;
let _groundMaterial = null;
let _lastImgData    = null;

function _loadPixels(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      console.log('[terrain] Pixels loaded:', c.width, 'x', c.height);
      resolve(data);
    };
    img.onerror = (e) => reject(new Error('Image load failed'));
    img.src = url;
  });
}

function _stampHeights(mesh, imgData, subdiv, heightScale) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  if (!positions) { console.error('[terrain] No PositionKind'); return; }

  const verts = subdiv + 1;
  const iw = imgData.width;
  const ih = imgData.height;

  let minH = Infinity, maxH = -Infinity;

  for (let row = 0; row < verts; row++) {
    for (let col = 0; col < verts; col++) {
      const u    = col / subdiv;
      const v    = 1.0 - (row / subdiv);   // flip V — BabylonJS ground rows run bottom→top
      const px   = Math.min(Math.floor(u * iw), iw - 1);
      const py   = Math.min(Math.floor(v * ih), ih - 1);
      const grey = imgData.data[(py * iw + px) * 4] / 255;
      const h    = grey * heightScale;
      positions[(row * verts + col) * 3 + 1] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  // Bake minH offset into vertices so lowest point = 0, mesh stays at Y=0
  if (minH > 0) {
    for (let i = 1; i < positions.length; i += 3) positions[i] -= minH;
    minH = 0;
  }

  mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions, true);
  mesh.position.y = 0;   // always at world Y=0

  // Recompute normals so hills are lit correctly
  const indices = mesh.getIndices();
  const normals = new Float32Array(positions.length);
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals, true);
  mesh.refreshBoundingInfo();

  console.log(`[terrain] Heights stamped — scale:${heightScale} min:${minH.toFixed(1)} max:${maxH.toFixed(1)} offset:${(-minH).toFixed(1)} verts:${verts}x${verts}`);
  return { minH, maxH };
}

function _applyMaterial(scene, mesh) {
  if (!_groundMaterial) {
    _groundMaterial = new BABYLON.StandardMaterial('terrainMat', scene);
    _groundMaterial.diffuseColor  = new BABYLON.Color3(0.35, 0.52, 0.22);
    _groundMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    _groundMaterial.backFaceCulling = false;  // visible from any angle while debugging
  }
  mesh.material        = _groundMaterial;
  mesh.receiveShadows  = true;
  mesh.checkCollisions = true;
  mesh.isVisible       = true;
  mesh.isPickable      = true;
}

export async function buildTerrain(scene, cfg) {
  cfg = cfg || getConfig();
  const t            = cfg.terrain    || {};
  const sizeX        = t.sizeX        ?? 512;
  const sizeZ        = t.sizeZ        ?? 512;
  const subdiv       = t.subdivisions ?? 150;
  const heightScale  = t.heightScale  ?? 50;
  const heightmapUrl = t.heightmapUrl || null;

  if (_mesh) { _mesh.dispose(); _mesh = null; }
  _lastImgData = null;

  _mesh = BABYLON.MeshBuilder.CreateGround('terrain', {
    width:        sizeX,
    height:       sizeZ,
    subdivisions: subdiv,
    updatable:    true,
  }, scene);

  _mesh.position.set(0, 0, 0);
  _applyMaterial(scene, _mesh);

  if (heightmapUrl) {
    try {
      _lastImgData = await _loadPixels(heightmapUrl);
      _stampHeights(_mesh, _lastImgData, subdiv, heightScale);
      // Rebuild physics collider to match new terrain
      addTerrainCollider(_lastImgData, sizeX, sizeZ, heightScale, 64);
    } catch(e) {
      console.warn('[terrain] Heightmap failed:', e.message);
    }
  } else {
    console.log('[terrain] Flat terrain', sizeX, 'x', sizeZ);
  }

  // Log bounding box so we know where it actually is in world space
  const bb = _mesh.getBoundingInfo().boundingBox;
  console.log('[terrain] Mesh bounding box — min:', bb.minimumWorld, 'max:', bb.maximumWorld);
  console.log('[terrain] Mesh isVisible:', _mesh.isVisible, 'vertices:', _mesh.getTotalVertices());

  return _mesh;
}

export function rescaleHeights(heightScale) {
  if (!_mesh || !_lastImgData) { console.warn('[terrain] rescaleHeights: nothing cached'); return; }
  const cfg    = getConfig();
  const t      = cfg.terrain || {};
  const subdiv = t.subdivisions ?? 150;
  _stampHeights(_mesh, _lastImgData, subdiv, heightScale);
  if (cfg.terrain) cfg.terrain.heightScale = heightScale;
  addTerrainCollider(_lastImgData, t.sizeX ?? 512, t.sizeZ ?? 512, heightScale, 64);
}

export function getTerrainMesh() { return _mesh; }
export function getTerrainPixelData() { return _lastImgData; }

/**
 * Sample world-space Y at any (x, z) from the cached heightmap.
 * Returns 0 if no heightmap loaded. Accounts for mesh.position.y offset.
 * Use this in spawn.js, enemies, flatnav to place things on the surface.
 */
export function getTerrainHeightAt(wx, wz) {
  if (!_lastImgData || !_mesh) return 0;
  const cfg    = getConfig();
  const t      = cfg.terrain || {};
  const sizeX  = t.sizeX  ?? 512;
  const sizeZ  = t.sizeZ  ?? 512;
  const scale  = t.heightScale ?? 50;
  const iw     = _lastImgData.width;
  const ih     = _lastImgData.height;

  // World → UV [0,1]
  const u = (wx + sizeX / 2) / sizeX;
  const v = 1.0 - (wz + sizeZ / 2) / sizeZ;   // same flip as _stampHeights

  const px   = Math.min(Math.max(Math.floor(u * iw), 0), iw - 1);
  const py   = Math.min(Math.max(Math.floor(v * ih), 0), ih - 1);
  const grey = _lastImgData.data[(py * iw + px) * 4] / 255;

  return grey * scale;  // mesh.position.y is always 0
}

export async function applyHeightmapFromDataUrl(scene, dataUrl, heightScale, onReady) {
  const cfg = getConfig();
  if (!cfg.terrain) cfg.terrain = {};
  cfg.terrain.heightmapUrl = dataUrl;
  if (heightScale != null) cfg.terrain.heightScale = heightScale;
  await buildTerrain(scene, cfg);
  if (onReady) onReady();
}