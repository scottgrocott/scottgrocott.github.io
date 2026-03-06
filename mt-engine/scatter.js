// scatter.js — environment-aware sprite scatter with shelter placement and vegetation clustering

import { scene }           from './core.js';
import { CONFIG }           from './config.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { getAllSpriteFrames, getRandomEnvColor } from './environment.js';

let _instances = [];  // all disposable meshes/materials

// ─── Create one sprite billboard using UV clip ───────────────────────────────
function _makeSpriteBillboard(name, wx, wy, wz, frameInfo, heightScale) {
  const { sheetUrl, frame, sheetW, sheetH } = frameInfo;

  const aspect = frame.w / frame.h;
  const h = heightScale * (0.7 + Math.random() * 0.6);
  const w = h * aspect;

  const mesh = BABYLON.MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
  mesh.position.set(wx, wy + h / 2, wz);
  mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
  mesh.isPickable = false;

  // Each billboard needs its own texture instance for independent UV offset
  const tex = new BABYLON.Texture(sheetUrl, scene, false, true,
    BABYLON.Texture.NEAREST_SAMPLINGMODE);
  tex.hasAlpha = true;
  tex.uOffset = frame.x / sheetW;
  tex.vOffset = 1.0 - (frame.y + frame.h) / sheetH;
  tex.uScale  = frame.w / sheetW;
  tex.vScale  = frame.h / sheetH;

  const mat = new BABYLON.StandardMaterial(name + '_mat', scene);
  mat.diffuseTexture  = tex;
  mat.opacityTexture  = tex;
  mat.backFaceCulling = false;
  mat.alphaMode       = BABYLON.Engine.ALPHA_COMBINE;

  mesh.material = mat;
  _instances.push(mesh);
  return mesh;
}

// ─── Fallback placeholder billboard (no sprite sheet) ────────────────────────
function _makePlaceholderBillboard(name, wx, wy, wz, category) {
  const COLORS = {
    vegetation: new BABYLON.Color3(0.15, 0.55, 0.10),
    rock:       new BABYLON.Color3(0.45, 0.38, 0.28),
    prop:       new BABYLON.Color3(0.55, 0.55, 0.55),
  };
  const h = 0.8 + Math.random() * 1.5;
  const w = 0.5 + Math.random() * 0.7;
  const mesh = BABYLON.MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
  mesh.position.set(wx, wy + h / 2, wz);
  mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
  mesh.isPickable = false;
  const mat = new BABYLON.StandardMaterial(name + '_mat', scene);
  const base = COLORS[category] || COLORS.vegetation;
  mat.diffuseColor = base.clone().scale(0.8 + Math.random() * 0.4);
  mat.backFaceCulling = false;
  mesh.material = mat;
  _instances.push(mesh);
  return mesh;
}

// ─── Shelter placement ───────────────────────────────────────────────────────
const SHELTERS_URL = 'https://scottgrocott.github.io/mt-assets/shelters/shelters.json';
let _shelterDefs  = null;
let _shelterPositions = [];  // { wx, wz } for vegetation cluster seeding

async function _loadShelterDefs() {
  if (_shelterDefs) return _shelterDefs;
  try {
    const r    = await fetch(SHELTERS_URL);
    const text = await r.text();
    // Fix malformed `{ [ ... ] }` — strip outer object wrapper if array is the only content
    const cleaned = text.replace(/^\s*\{\s*(\[[\s\S]*\])\s*\}\s*$/, '$1');
    const j = JSON.parse(cleaned);
    _shelterDefs = Array.isArray(j) ? j : (j.shelters || Object.values(j)[0] || []);
    console.log('[scatter] Loaded', _shelterDefs.length, 'shelter definitions');
  } catch(e) {
    console.warn('[scatter] Could not load shelters:', e);
    _shelterDefs = [];
  }
  return _shelterDefs;
}

function _buildShelterMesh(def, wx, wy, wz, rotY) {
  const PART_COLORS = {
    pole:  new BABYLON.Color3(0.40, 0.30, 0.20),
    beam:  new BABYLON.Color3(0.35, 0.28, 0.18),
    roof:  new BABYLON.Color3(0.50, 0.42, 0.30),
    floor: new BABYLON.Color3(0.45, 0.38, 0.26),
  };

  for (const part of def.parts) {
    const { type, offset, size } = part;
    const box = BABYLON.MeshBuilder.CreateBox(
      `shelter_${def.id}_${type}_${_instances.length}`,
      { width: size.w, height: size.h, depth: size.d },
      scene
    );

    // Apply rotation offset
    const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
    const ox = offset.x * cosR - offset.z * sinR;
    const oz = offset.x * sinR + offset.z * cosR;

    box.position.set(wx + ox, wy + offset.y + size.h / 2, wz + oz);
    box.rotation.y = rotY;
    box.isPickable = false;

    const mat = new BABYLON.StandardMaterial(`shelterMat_${_instances.length}`, scene);
    mat.diffuseColor = (PART_COLORS[type] || PART_COLORS.pole)
      .clone().scale(0.85 + Math.random() * 0.3);
    box.material = mat;
    _instances.push(box);
  }
}

async function _scatterShelters(count, frames) {
  const defs = await _loadShelterDefs();
  if (!defs.length) return;

  const size = CONFIG.terrain.size || 700;
  const half = size / 2;
  const margin = 30;
  _shelterPositions = [];

  for (let i = 0; i < count; i++) {
    const def  = defs[Math.floor(Math.random() * defs.length)];
    const wx   = (Math.random() - 0.5) * (size - margin * 2);
    const wz   = (Math.random() - 0.5) * (size - margin * 2);
    const wy   = getTerrainHeightAt(wx, wz);
    const rotY = Math.random() * Math.PI * 2;

    _buildShelterMesh(def, wx, wy, wz, rotY);
    _shelterPositions.push({ wx, wz });
  }

  console.log('[scatter] Placed', count, 'shelters');
}

// ─── Main scatter layer ───────────────────────────────────────────────────────
function _scatterLayer(layer, frames) {
  const density   = layer.density  ?? 0.1;
  const category  = layer.category || 'vegetation';
  const size      = CONFIG.terrain.size || 700;
  const half      = size / 2;
  const gridCells = 60;
  const cellSize  = size / gridCells;

  // Filter to matching category, fall back to all frames if none match
  let useFrames = frames.filter(f => f.category === category);
  if (useFrames.length === 0) useFrames = frames;
  if (useFrames.length === 0) useFrames = null;

  for (let xi = 0; xi < gridCells; xi++) {
    for (let zi = 0; zi < gridCells; zi++) {
      if (Math.random() > density) continue;
      const wx = -half + xi * cellSize + Math.random() * cellSize;
      const wz = -half + zi * cellSize + Math.random() * cellSize;

      // Skip cells too close to any shelter — keep structures clear
      const tooClose = _shelterPositions.some(s => {
        const dx = wx - s.wx, dz = wz - s.wz;
        return Math.sqrt(dx*dx + dz*dz) < 6;
      });
      if (tooClose) continue;

      const wy = getTerrainHeightAt(wx, wz);
      const name = `scatter_${_instances.length}`;

      if (useFrames) {
        const f = useFrames[Math.floor(Math.random() * useFrames.length)];
        _makeSpriteBillboard(name, wx, wy, wz, f, 2.0);
      } else {
        _makePlaceholderBillboard(name, wx, wy, wz, category);
      }
    }
  }
}

// ─── Vegetation cluster around each shelter ───────────────────────────────────
function _scatterVegClusters(frames) {
  // Dense ring just outside each shelter, thinning with distance
  for (const { wx: sx, wz: sz } of _shelterPositions) {
    const count = 12 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      // Gaussian-ish distribution: most sprites 2-5 units out, few up to 8
      const dist = 2.5 + Math.pow(Math.random(), 0.5) * 5.5;
      const wx = sx + Math.cos(angle) * dist;
      const wz = sz + Math.sin(angle) * dist;
      const wy = getTerrainHeightAt(wx, wz);
      const name = `shelterVeg_${_instances.length}`;
      // Slightly smaller than open terrain sprites
      const scale = 1.0 + Math.random() * 0.8;
      if (frames.length > 0) {
        const f = frames[Math.floor(Math.random() * frames.length)];
        _makeSpriteBillboard(name, wx, wy, wz, f, scale);
      } else {
        _makePlaceholderBillboard(name, wx, wy, wz, 'vegetation');
      }
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────
export async function scatterProps() {
  clearScatter();

  const frames  = getAllSpriteFrames();  // empty array if no env loaded
  const layers  = CONFIG.scatterLayers?.length
    ? CONFIG.scatterLayers
    : [{ category: 'vegetation', density: 0.12 }, { category: 'rock', density: 0.04 }];

  // 1. Scatter shelters first so we have positions for clustering
  const shelterCount = CONFIG.terrain?.shelterCount ?? 8;
  await _scatterShelters(shelterCount, frames);

  // 2. Regular scatter layers
  for (const layer of layers) {
    _scatterLayer(layer, frames);
  }

  // 3. Vegetation clusters around each shelter
  const vegFrames = frames.filter(f => f.category === 'vegetation');
  const clusterFrames = vegFrames.length > 0 ? vegFrames : frames;
  _scatterVegClusters(clusterFrames);

  console.log('[scatter] Total instances:', _instances.length,
    '| shelters:', _shelterPositions.length);
}

export function clearScatter() {
  for (const m of _instances) {
    try { if (m.material) m.material.dispose(); } catch(e) {}
    try { m.dispose(); } catch(e) {}
  }
  _instances = [];
  _shelterPositions = [];
}

export function rebuildScatterLayer() {
  scatterProps();
}

export function tickBillboards() {
  // BabylonJS BILLBOARDMODE_Y handles rotation automatically
}