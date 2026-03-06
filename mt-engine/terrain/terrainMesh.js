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
  const u =        (wx + _lastSizeX / 2) / _lastSizeX;
  const v = 1.0 - ((wz + _lastSizeZ / 2) / _lastSizeZ);

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

  let minH = Infinity, maxH = -Infinity;

  // Read each vertex's actual X/Z world position and sample heightmap at that point.
  // This avoids any assumption about Babylon's internal row/col → world layout.
  for (let i = 0; i < positions.length / 3; i++) {
    const wx = positions[i * 3 + 0];
    const wz = positions[i * 3 + 2];

    // Map world XZ → UV, then → pixel
    const u =        (wx + sizeX / 2) / sizeX;
    const v = 1.0 - ((wz + sizeZ / 2) / sizeZ);

    const px = Math.max(0, Math.min(imgData.width  - 1, Math.floor(u * (imgData.width  - 1))));
    const py = Math.max(0, Math.min(imgData.height - 1, Math.floor(v * (imgData.height - 1))));
    const h  = (imgData.data[(py * imgData.width + px) * 4] / 255) * scale;

    positions[i * 3 + 1] = h;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }

  mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
  BABYLON.VertexData.ComputeNormals(
    positions,
    mesh.getIndices(),
    mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind)
  );
  mesh.refreshBoundingInfo();

  console.log(`[terrain] Heights stamped — scale:${scale} min:${minH.toFixed(1)} max:${maxH.toFixed(1)} verts:${positions.length / 3}`);
  _logBounds(mesh);
}

function _logBounds(mesh) {
  const bi = mesh.getBoundingInfo();
  console.log('[terrain] Mesh bounding box — min:', bi.boundingBox.minimumWorld, 'max:', bi.boundingBox.maximumWorld);
  console.log('[terrain] Mesh isVisible:', mesh.isVisible, 'vertices:', mesh.getTotalVertices());
}

function _applyMaterial(scene, mesh, t) {
  if (!mesh) return;
  if (mesh.material) { try { mesh.material.dispose(); } catch(e) {} }

  const hScale   = t.heightScale ?? 50;
  const env      = window._currentEnvColors;
  const nodeMats = window._currentEnvNodeMats;  // { node_mat_rocks, node_mat_dirt } from environment.js
  const bands    = _buildHeightBands(env, hScale);
  window._currentTerrainBands = { bands, hScale };  // minimap reads this

  // Bake height-based palette colors into vertex color buffer
  _stampVertexColors(mesh, bands, hScale);

  // Also bake slope into vertex alpha — used by node material shader to blend textures
  if (nodeMats) {
    _stampSlopeAlpha(mesh);
  }

  if (nodeMats && (nodeMats.rocks || nodeMats.dirt)) {
    _applyNodeMaterial(scene, mesh, nodeMats, hScale);
  } else {
    // Fallback: plain StandardMaterial with vertex colors
    const mat = new BABYLON.StandardMaterial('terrainMat', scene);
    mat.specularColor    = new BABYLON.Color3(0, 0, 0);
    mat.diffuseColor     = new BABYLON.Color3(1, 1, 1);
    mat.useVertexColors  = true;
    mat.backFaceCulling  = true;
    mesh.material        = mat;
  }

  mesh.receiveShadows  = true;
  mesh.checkCollisions = false;
  console.log('[terrain] Height bands:', bands.map(b => `${b.threshold.toFixed(0)}=${b.hex}`).join(' | '));
}

// Bake world-space slope (dot(normal, up)) into vertex alpha channel
// alpha=1 → flat ground (dirt texture), alpha=0 → steep slope (rock texture)
function _stampSlopeAlpha(mesh) {
  const normals   = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  if (!normals || !positions) return;
  const vCount = positions.length / 3;
  const colors = mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind) || new Float32Array(vCount * 4);

  for (let i = 0; i < vCount; i++) {
    const ny  = normals[i * 3 + 1];  // Y component of normal = dot with up
    const slope = Math.max(0, Math.min(1, ny));  // 1=flat, 0=vertical
    colors[i * 4 + 3] = slope;  // write into alpha
  }
  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors, false);
}

// Node material: dirt texture on flat areas, rock texture on slopes
// All config values baked into shader source as GLSL constants — avoids Babylon ShaderMaterial uniform API issues
function _applyNodeMaterial(scene, mesh, nodeMats, hScale) {
  const rocks = nodeMats.rocks || {};
  const dirt  = nodeMats.dirt  || {};
  const hasRock = !!nodeMats.rocks;
  const hasDirt = !!nodeMats.dirt;

  // Bake all values as GLSL float literals
  const rUS  = (rocks.uScale       ?? 2.0).toFixed(2);
  const rVS  = (rocks.vScale       ?? 2.0).toFixed(2);
  const rMin = (1.0 - (rocks.maxSlope    ?? 1.0)).toFixed(3);
  const rFal = (rocks.slopeFalloff  ?? 0.1).toFixed(3);

  const dUS  = (dirt.uScale        ?? 4.0).toFixed(2);
  const dVS  = (dirt.vScale        ?? 4.0).toFixed(2);
  const dMax = (1.0 - (dirt.minSlope     ?? 0.0)).toFixed(3);
  const dFal = (dirt.slopeFalloff   ?? 0.1).toFixed(3);

  // Unique shader name per config to avoid stale cached shaders
  const shaderKey = `tN_${rUS}_${dUS}`;

  BABYLON.Effect.ShadersStore[shaderKey + 'VertexShader'] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    attribute vec4 color;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;
    void main() {
      vNormal = normalize(mat3(world) * normal);
      vUV     = uv;
      vColor  = color;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  BABYLON.Effect.ShadersStore[shaderKey + 'FragmentShader'] = `
    precision highp float;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;
    uniform sampler2D dirtTex;
    uniform sampler2D rockTex;

    void main() {
      float slope = clamp(vNormal.y, 0.0, 1.0);

      // Rock: steep slopes (slope near 0)
      float rockW = 1.0 - smoothstep(${rMin} - ${rFal}, ${rMin} + ${rFal}, slope);
      rockW = clamp(rockW, 0.0, 1.0);

      // Dirt: flat areas (slope near 1)
      float dirtW = smoothstep(${dMax} - ${dFal}, ${dMax} + ${dFal}, slope);
      dirtW = clamp(dirtW, 0.0, 1.0);

      vec4 rockCol = ${hasRock} ? texture2D(rockTex, vUV * vec2(${rUS}, ${rVS})) : vec4(0.55, 0.48, 0.38, 1.0);
      vec4 dirtCol = ${hasDirt} ? texture2D(dirtTex, vUV * vec2(${dUS}, ${dVS})) : vec4(0.62, 0.54, 0.40, 1.0);

      // Blend: flat=dirt, steep=rock
      vec4 texCol = mix(dirtCol, rockCol, rockW);

      // Multiply by vertex color palette bands
      vec3 col = texCol.rgb * vColor.rgb * 1.65;

      // Diffuse lighting from fixed sun direction
      float diff  = max(dot(vNormal, normalize(vec3(0.4, 1.0, 0.6))), 0.0);
      float light = 0.45 + 0.55 * diff;
      gl_FragColor = vec4(col * light, 1.0);
    }
  `;

  const mat = new BABYLON.ShaderMaterial('terrainNodeMat', scene,
    { vertex: shaderKey, fragment: shaderKey },
    {
      attributes: ['position', 'normal', 'uv', 'color'],
      uniforms:   ['worldViewProjection', 'world'],
      samplers:   ['dirtTex', 'rockTex'],
    }
  );

  const greyPx = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  mat.setTexture('rockTex', new BABYLON.Texture(rocks.url || greyPx, scene));
  mat.setTexture('dirtTex', new BABYLON.Texture(dirt.url  || greyPx, scene));
  mat.backFaceCulling = true;

  mesh.material = mat;
  console.log('[terrain] Node material applied | rock:', rocks.url?.split('/').pop(), '| dirt:', dirt.url?.split('/').pop());
}


// Write per-vertex colors based on height, blending between palette bands
function _stampVertexColors(mesh, bands, hScale) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  if (!positions) return;
  const vCount = positions.length / 3;
  const colors = new Float32Array(vCount * 4);  // RGBA per vertex

  for (let i = 0; i < vCount; i++) {
    const h = positions[i * 3 + 1];  // Y = height

    // Find which two bands to blend between
    let r = bands[0].r, g = bands[0].g, b = bands[0].b;
    for (let bi = 0; bi < bands.length - 1; bi++) {
      const b0 = bands[bi];
      const b1 = bands[bi + 1];
      if (h >= b0.threshold && h <= b1.threshold) {
        const range = b1.threshold - b0.threshold;
        const t = range > 0 ? (h - b0.threshold) / range : 0;
        // Smoothstep blend
        const s = t * t * (3 - 2 * t);
        r = b0.r + (b1.r - b0.r) * s;
        g = b0.g + (b1.g - b0.g) * s;
        b = b0.b + (b1.b - b0.b) * s;
        break;
      } else if (h > b1.threshold) {
        r = b1.r; g = b1.g; b = b1.b;
      }
    }
    colors[i * 4 + 0] = r;
    colors[i * 4 + 1] = g;
    colors[i * 4 + 2] = b;
    colors[i * 4 + 3] = 1.0;
  }

  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors, false);
}

// Sort palette colors by brightness and assign evenly-spaced height thresholds
function _buildHeightBands(env, hScale) {
  const fallback = [
    { r: 0.45, g: 0.38, b: 0.28, threshold: 0,            hex: '#fallback' },
    { r: 0.55, g: 0.47, b: 0.35, threshold: hScale * 0.3, hex: '#fallback' },
    { r: 0.65, g: 0.57, b: 0.42, threshold: hScale * 0.6, hex: '#fallback' },
    { r: 0.80, g: 0.75, b: 0.65, threshold: hScale * 0.85, hex: '#fallback' },
  ];

  if (!env || Object.keys(env).length === 0) return fallback;

  // Convert all palette colors to RGB + brightness
  const entries = Object.entries(env).map(([key, hex]) => {
    const c = _hexToRgb(hex);
    const brightness = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    return { ...c, hex, key, brightness };
  });

  // Sort darkest to lightest
  entries.sort((a, b) => a.brightness - b.brightness);

  // Assign thresholds: spread evenly 0 → hScale, with slight bias so
  // lowlands get more range than peaks
  const count = Math.min(entries.length, 6);
  const selected = entries.slice(0, count);
  selected.forEach((e, i) => {
    // Quadratic bias: lower bands cover more area
    const t = i / Math.max(count - 1, 1);
    e.threshold = t * t * hScale;
  });
  selected[0].threshold = 0;  // always start at 0

  return selected;
}

function _hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0.55, g: 0.48, b: 0.35 };
  const h = hex.replace('#', '').padEnd(6, '0');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return { r: isNaN(r) ? 0.55 : r, g: isNaN(g) ? 0.48 : g, b: isNaN(b) ? 0.35 : b };
}