// scatter.js — environment-aware sprite scatter with shelter placement and vegetation clustering

import { scene }           from './core.js';
import { CONFIG }           from './config.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { getAllSpriteFrames, getRandomEnvColor } from './environment.js';
import { addBoxCollider, clearBoxColliders } from './physics.js';
import { registerPanelMesh, clearPanelMeshes } from './shelterBridge.js';
import { spawnLadder }      from './ladders.js';

let _instances    = [];  // all disposable meshes/materials
let _grassMeshes  = [];  // grass tile meshes — disposed separately in clearScatter
let _generation   = 0;   // incremented on each clearScatter — cancels in-flight async scatter

const SHELTER_SPRITES_URL = 'https://scottgrocott.github.io/mt-assets/shelters/sprites.json';
let _shelterFrames  = null;  // loaded panel frames
let _panelTexCache  = null;  // single shared texture for metal_panels sheet

// Load and cache shelter panel sprite frames
async function _loadShelterFrames() {
  if (_shelterFrames) return _shelterFrames;
  try {
    const r = await fetch(SHELTER_SPRITES_URL);
    const j = await r.json();
    _shelterFrames = [];
    for (const sheet of (j.spriteSheets || [])) {
      const sheetW = sheet.columns * sheet.cellWidth;
      const sheetH = sheet.rows    * sheet.cellHeight;
      for (const frame of (sheet.frames || [])) {
        _shelterFrames.push({ url: sheet.url, frame, sheetW, sheetH });
      }
    }
    console.log('[scatter] Loaded', _shelterFrames.length, 'panel frames');
  } catch(e) {
    console.warn('[scatter] Could not load shelter sprites:', e);
    _shelterFrames = [];
  }
  return _shelterFrames;
}

// Get or create the shared panel texture
function _getPanelTex(url) {
  if (_panelTexCache) return _panelTexCache;
  _panelTexCache = new BABYLON.Texture(url, scene, false, true, BABYLON.Texture.BILINEAR_SAMPLINGMODE);
  _panelTexCache.hasAlpha = false;
  return _panelTexCache;
}

// Build a UV-clipped material for one panel frame
function _makePanelMat(name, frameInfo) {
  const { url, frame, sheetW, sheetH } = frameInfo;
  const tex = _getPanelTex(url).clone();
  tex.uOffset = frame.x / sheetW;
  tex.vOffset = 1.0 - (frame.y + frame.h) / sheetH;
  tex.uScale  = frame.w / sheetW;
  tex.vScale  = frame.h / sheetH;
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.diffuseTexture  = tex;
  mat.backFaceCulling = false;
  mat.specularColor   = new BABYLON.Color3(0.1, 0.1, 0.1);
  return mat;
}

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

function _buildShelterMesh(def, wx, wy, wz, rotY, panelFrames) {
  const PART_COLORS = {
    pole:  new BABYLON.Color3(0.40, 0.30, 0.20),
    beam:  new BABYLON.Color3(0.35, 0.28, 0.18),
    roof:  new BABYLON.Color3(0.50, 0.42, 0.30),
    floor: new BABYLON.Color3(0.45, 0.38, 0.26),
  };

  // Parent node at shelter world position
  const root = new BABYLON.TransformNode(`shelter_${def.id}_${_instances.length}`, scene);
  root.position.set(wx, wy, wz);
  root.rotation.y = rotY;
  _instances.push(root);

  const cosR = Math.cos(rotY);
  const sinR = Math.sin(rotY);

  // Helper: rotate local XZ offset into world space
  function toWorld(lx, lz) {
    return { x: wx + lx * cosR - lz * sinR, z: wz + lx * sinR + lz * cosR };
  }

  let maxY   = 0;
  let minX = 0, maxX = 0;  // actual +X and -X extents
  let minZ = 0, maxZ = 0;  // actual +Z and -Z extents

  for (const part of def.parts) {
    const { type, offset, size } = part;
    const box = BABYLON.MeshBuilder.CreateBox(
      `${root.name}_${type}`,
      { width: size.w, height: size.h, depth: size.d },
      scene
    );
    box.position.set(offset.x, offset.y + size.h / 2, offset.z);
    box.parent     = root;
    box.isPickable = false;

    const mat = new BABYLON.StandardMaterial(`${root.name}_mat_${_instances.length}`, scene);
    mat.diffuseColor = (PART_COLORS[type] || PART_COLORS.pole)
      .clone().scale(0.85 + Math.random() * 0.3);
    box.material = mat;
    _instances.push(box);

    // Rapier collider — world-space position with rotation applied
    const wPos  = toWorld(offset.x, offset.z);
    const worldY = wy + offset.y + size.h / 2 - 0.05;  // sink slightly so base never floats above terrain
    addBoxCollider(wPos.x, worldY, wPos.z, size.w / 2, size.h / 2, size.d / 2, rotY);

    const topY = offset.y + size.h;
    if (topY > maxY) maxY = topY;

    // Track actual extents of each part
    if (offset.x + size.w / 2 > maxX) maxX =  offset.x + size.w / 2;
    if (offset.x - size.w / 2 < minX) minX =  offset.x - size.w / 2;
    if (offset.z + size.d / 2 > maxZ) maxZ =  offset.z + size.d / 2;
    if (offset.z - size.d / 2 < minZ) minZ =  offset.z - size.d / 2;
  }

  // Face positions = actual outer edges
  const faceX = Math.max(Math.abs(minX), Math.abs(maxX));  // +X and -X face distance
  const faceZ = Math.max(Math.abs(minZ), Math.abs(maxZ));  // +Z and -Z face distance
  const footprintHalfW = faceX;
  const footprintHalfD = faceZ;

  // Ladder goes on the NARROWER face — panels take the wider faces
  // ladderOnZ=true means ladder is on Z face (narrower = smaller halfD)
  const ladderOnZ      = footprintHalfD <= footprintHalfW;
  const ladderStandoff = 0.0;  // node placed exactly at face edge, ladder back is z=0
  const ladderLocalX   = ladderOnZ ? 0 : (footprintHalfW + ladderStandoff);
  const ladderLocalZ   = ladderOnZ ? (footprintHalfD + ladderStandoff) : 0;
  const ladderWorld    = toWorld(ladderLocalX, ladderLocalZ);
  const ladderRotY     = ladderOnZ ? rotY : rotY + Math.PI / 2;
  spawnLadder({
    position: { x: ladderWorld.x, y: wy, z: ladderWorld.z },
    height:   maxY,
    rotY:     ladderRotY,
  });

  // Panels — skip center column of ladder face to avoid overlap
  if (panelFrames && panelFrames.length > 0) {
    _addShelterPanels(root, maxY, footprintHalfW, footprintHalfD, ladderOnZ, panelFrames);
  }
}

// Tile corrugated panels on the wider shelter faces (ladder is on narrower face)
function _addShelterPanels(root, maxY, halfW, halfD, ladderOnZFace, panelFrames) {
  const PANEL_W     = 1.0;
  const PANEL_H     = 2.0;
  const PANEL_THICK = 0.04;
  const PANEL_INSET = 0.01;  // sit right against the face

  // ladderOnZFace=true  → ladder on Z face → panels on the two X faces
  // ladderOnZFace=false → ladder on X face → panels on the two Z faces
  // For Z-axis face: panel spans X (faceHalf=halfW), sits at z=±halfD (faceDepth=halfD)
  // For X-axis face: panel spans Z (faceHalf=halfD), sits at x=±halfW (faceDepth=halfW)
  const faces = ladderOnZFace
    ? [
        { axis: 'x', sign:  1, faceHalf: halfD, faceDepth: halfW },
        { axis: 'x', sign: -1, faceHalf: halfD, faceDepth: halfW },
      ]
    : [
        { axis: 'z', sign:  1, faceHalf: halfW, faceDepth: halfD },
        { axis: 'z', sign: -1, faceHalf: halfW, faceDepth: halfD },
      ];

  for (const face of faces) {
    const wallW      = face.faceHalf * 2;
    const panelCount = Math.max(1, Math.floor(wallW / PANEL_W));
    const startX     = -(panelCount * PANEL_W) / 2 + PANEL_W / 2;
    const startY     = 0.3 + Math.random() * 0.3;
    const rows       = Math.max(1, Math.floor((maxY - startY) / PANEL_H));
    const facePos    = face.faceDepth + PANEL_INSET;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < panelCount; col++) {
        if (Math.random() < 0.2) continue;  // occasional gap for variety

        const localU = startX + col * PANEL_W;
        const localY = startY + row * PANEL_H + PANEL_H / 2;

        const panel = BABYLON.MeshBuilder.CreateBox(
          `${root.name}_panel_${face.axis}${face.sign}_${row}_${col}`,
          {
            width:  face.axis === 'z' ? PANEL_W     : PANEL_THICK,
            height: PANEL_H,
            depth:  face.axis === 'z' ? PANEL_THICK : PANEL_W,
          },
          scene
        );
        panel.position.set(
          face.axis === 'z' ? localU             : face.sign * facePos,
          localY,
          face.axis === 'z' ? face.sign * facePos : localU
        );
        panel.parent     = root;
        panel.isPickable = true;

        const fi = panelFrames[Math.floor(Math.random() * panelFrames.length)];
        panel.material = _makePanelMat(`${root.name}_pmat_${_instances.length}`, fi);
        _instances.push(panel);
        registerPanelMesh(panel);
      }
    }
  }
}


async function _scatterShelters(count, frames, gen) {
  const defs = await _loadShelterDefs();
  if (_generation !== gen || !defs.length) return;

  const panelFrames = await _loadShelterFrames();
  if (_generation !== gen) return;

  const size      = CONFIG.terrain.size || 700;
  const half      = size / 2;
  const margin    = 30;
  // Water clearance: shelters must be at least 2m above waterline
  const waterY    = CONFIG.water?.enabled ? (CONFIG.water?.waterY ?? CONFIG.water?.mesh?.position?.y ?? null) : null;
  const WATER_MIN = waterY !== null ? waterY + 2.0 : -Infinity;
  const MAX_SLOPE = 3.0;   // max height delta across ~3m footprint — flatter sites preferred
  _shelterPositions = [];

  let placed = 0;
  let tries  = 0;
  const MAX_TRIES = count * 30;

  while (placed < count && tries < MAX_TRIES) {
    tries++;
    const wx   = (Math.random() - 0.5) * (size - margin * 2);
    const wz   = (Math.random() - 0.5) * (size - margin * 2);
    const r    = 3;

    // Sample 5 points in a ~3m footprint
    const h0 = getTerrainHeightAt(wx,     wz    );
    const h1 = getTerrainHeightAt(wx - r, wz - r);
    const h2 = getTerrainHeightAt(wx + r, wz - r);
    const h3 = getTerrainHeightAt(wx - r, wz + r);
    const h4 = getTerrainHeightAt(wx + r, wz + r);
    const hMin = Math.min(h0,h1,h2,h3,h4);
    const hMax = Math.max(h0,h1,h2,h3,h4);

    // Skip if in water or on a steep slope
    if (hMin < WATER_MIN)           continue;
    if (hMax - hMin > MAX_SLOPE)    continue;

    // Skip if too close to another shelter (min 20m apart)
    const tooClose = _shelterPositions.some(s => {
      const dx = wx - s.wx, dz = wz - s.wz;
      return Math.sqrt(dx*dx + dz*dz) < 20;
    });
    if (tooClose) continue;

    const def  = defs[Math.floor(Math.random() * defs.length)];
    const rotY = Math.random() * Math.PI * 2;

    _buildShelterMesh(def, wx, hMin, wz, rotY, panelFrames);
    _shelterPositions.push({ wx, wz });
    placed++;
  }

  console.log(`[scatter] Placed ${placed}/${count} shelters (${tries} tries, waterY=${waterY?.toFixed(1)??'n/a'})`);
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

// ── Grass — tiled ThinInstances with frustum culling ─────────────────────────
//
// PERFORMANCE DESIGN:
//   • World split into TILE_SIZE×TILE_SIZE cells. Each cell = 1 ThinInstance mesh.
//   • BabylonJS frustum-culls tiles natively (no alwaysSelectAsActiveMesh).
//   • At TILE_SIZE=40 a 700m map = ~18×18 = 324 tiles. Typically <20 visible/frame.
//   • Single-plane blade (not crossed-quad) — half the vertices, same look at distance.
//   • No per-frame allocation in matrix loop — reuse temp objects.
//   • Materials frozen, meshes not pickable.
//   • Waterline gets a denser dedicated pass (same tile system, separate collection).

const TILE_SIZE   = 40;    // world units per tile cell
const DRAW_DIST   = 120;   // beyond this, tiles simply won't be in frustum
const LAND_STEP   = 0.7;   // base grid step for shore grass
const WATER_STEP  = 0.9;   // base grid step for underwater grass
const CLUMP_STEP  = 0.22;  // tight waterline band step
const CLUMP_BAND  = 0.8;   // metres above waterY for clump pass
const CLUMP_JIT   = 0.06;  // minimal jitter so blades nearly touch
const SHORE_BAND  = 9.0;   // metres above waterY for general shore
const UNDER_DEPTH = 14.0;  // metres below waterY for underwater

// Shared pre-alloc for matrix composition (no GC per blade)
const _tmpScale = new BABYLON.Vector3(1, 1, 1);
const _tmpQuat  = new BABYLON.Quaternion();
const _tmpPos   = new BABYLON.Vector3();
const _tmpMat   = new BABYLON.Matrix();

// Frozen shared materials
let _matLand  = null;
let _matUnder = null;
function _getLandMat() {
  if (_matLand) return _matLand;
  _matLand = new BABYLON.StandardMaterial('_gLand', scene);
  _matLand.diffuseColor  = new BABYLON.Color3(0.16, 0.58, 0.12);
  _matLand.emissiveColor = new BABYLON.Color3(0.04, 0.12, 0.02);
  _matLand.backFaceCulling = false;
  _matLand.freeze();
  return _matLand;
}
function _getUnderMat() {
  if (_matUnder) return _matUnder;
  _matUnder = new BABYLON.StandardMaterial('_gUnder', scene);
  _matUnder.diffuseColor  = new BABYLON.Color3(0.07, 0.40, 0.36);
  _matUnder.emissiveColor = new BABYLON.Color3(0.01, 0.08, 0.06);
  _matUnder.backFaceCulling = false;
  _matUnder.alpha = 0.88;
  _matUnder.freeze();
  return _matUnder;
}

// Single-plane blade (one quad — half vertices vs crossed-quad, fine at distance)
function _createBladeMesh(name, w, h, mat) {
  const m = BABYLON.MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
  m.material     = mat;
  m.isPickable   = false;
  m.receiveShadows = false;
  m.material.freeze();
  return m;
}

// Build one tile's ThinInstance mesh from a flat positions array [{x,z,h,sy}]
// bladeW/bladeH: quad dimensions. Returns mesh or null.
function _buildTile(positions, name, mat, bladeW, bladeH) {
  if (!positions.length) return null;

  const base = _createBladeMesh(name, bladeW, bladeH, mat);
  const buf  = new Float32Array(positions.length * 16);

  for (let i = 0; i < positions.length; i++) {
    const { x, z, h, sy = 1.0 } = positions[i];
    const scaleY = sy * (0.55 + Math.random() * 0.9);
    const scaleX = 0.6 + Math.random() * 0.8;
    _tmpScale.set(scaleX, scaleY, scaleX);
    BABYLON.Quaternion.RotationAxisToRef(
      BABYLON.Axis.Y, Math.random() * Math.PI * 2, _tmpQuat
    );
    _tmpPos.set(x, h + (bladeH * scaleY) / 2, z);
    BABYLON.Matrix.ComposeToRef(_tmpScale, _tmpQuat, _tmpPos, _tmpMat);
    _tmpMat.copyToArray(buf, i * 16);
  }

  base.thinInstanceSetBuffer('matrix', buf, 16, false);
  base.thinInstanceCount = positions.length;
  // DO NOT set alwaysSelectAsActiveMesh — let BJS frustum-cull tiles naturally
  base.freezeWorldMatrix();
  return base;
}

// Collect positions for a single tile cell given world-space bounds
function _collectTile(x0, z0, x1, z1, waterY) {
  const ABOVE_HI = waterY + SHORE_BAND;
  const BELOW_LO = waterY - UNDER_DEPTH;

  const land  = [];
  const under = [];

  // Base grid pass
  for (let wx = x0; wx < x1; wx += LAND_STEP) {
    for (let wz = z0; wz < z1; wz += WATER_STEP) {
      const h = getTerrainHeightAt(wx, wz);
      const jx = wx + (Math.random() - 0.5) * 1.0;
      const jz = wz + (Math.random() - 0.5) * 1.0;
      const jh = getTerrainHeightAt(jx, jz);
      if (h > waterY && h <= ABOVE_HI) {
        land.push({ x: jx, z: jz, h: jh });
      } else if (h >= BELOW_LO && h < waterY) {
        under.push({ x: jx, z: jz, h: jh, sy: 1.7 });
      }
    }
  }

  // Tight waterline clump pass (only if this tile has shoreline)
  for (let wx = x0; wx < x1; wx += CLUMP_STEP) {
    for (let wz = z0; wz < z1; wz += CLUMP_STEP) {
      const h = getTerrainHeightAt(wx, wz);
      if (h <= waterY || h > waterY + CLUMP_BAND) continue;
      const jx = wx + (Math.random() - 0.5) * CLUMP_JIT;
      const jz = wz + (Math.random() - 0.5) * CLUMP_JIT;
      land.push({ x: jx, z: jz, h: getTerrainHeightAt(jx, jz), sy: 0.7 });
    }
  }

  return { land, under };
}

// Build all grass tiles. Called once from _spawnGrass.
// Returns array of meshes pushed into _grassMeshes.
function _buildGrassTiles(waterY, half) {
  const tileCount = Math.ceil((half * 2) / TILE_SIZE);
  const landMat   = _getLandMat();
  const underMat  = _getUnderMat();
  let   totalLand = 0, totalUnder = 0, tiles = 0;

  for (let tx = 0; tx < tileCount; tx++) {
    for (let tz = 0; tz < tileCount; tz++) {
      // World-space centre of this tile
      const cx = (tx * TILE_SIZE) - half + TILE_SIZE / 2;
      const cz = (tz * TILE_SIZE) - half + TILE_SIZE / 2;

      const { land, under } = _collectTile(
        cx - TILE_SIZE / 2, cz - TILE_SIZE / 2,
        cx + TILE_SIZE / 2, cz + TILE_SIZE / 2,
        waterY
      );

      if (land.length) {
        const m = _buildTile(land,  `gL_${tx}_${tz}`, landMat,  0.028, 0.55);
        if (m) {
          // Set bounding box manually so BJS can frustum-cull the tile
          m.setBoundingInfo(new BABYLON.BoundingInfo(
            new BABYLON.Vector3(cx - TILE_SIZE / 2, 0,   cz - TILE_SIZE / 2),
            new BABYLON.Vector3(cx + TILE_SIZE / 2, 2.5, cz + TILE_SIZE / 2),
          ));
          _grassMeshes.push(m);
          totalLand += land.length;
          tiles++;
        }
      }
      if (under.length) {
        const m = _buildTile(under, `gU_${tx}_${tz}`, underMat, 0.022, 0.70);
        if (m) {
          m.setBoundingInfo(new BABYLON.BoundingInfo(
            new BABYLON.Vector3(cx - TILE_SIZE / 2, -UNDER_DEPTH, cz - TILE_SIZE / 2),
            new BABYLON.Vector3(cx + TILE_SIZE / 2, waterY,       cz + TILE_SIZE / 2),
          ));
          _grassMeshes.push(m);
          totalUnder += under.length;
        }
      }
    }
  }

  console.log(`[scatter] Grass tiles:${tiles} land:${totalLand} under:${totalUnder} — frustum culled`);
}

// Structure footprint grass — small ring around shelters, single mesh (no tile needed)
function _buildStructureGrass(structurePositions) {
  if (!structurePositions.length) return;
  const PER = 120;
  const positions = [];
  for (const { wx, wz } of structurePositions) {
    for (let i = 0; i < PER; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 0.8 + Math.pow(Math.random(), 0.5) * 8.0;
      const ox    = wx + Math.cos(angle) * dist;
      const oz    = wz + Math.sin(angle) * dist;
      const oh    = getTerrainHeightAt(ox, oz);
      if (oh > 0.05) positions.push({ x: ox, z: oz, h: oh });
    }
  }
  if (!positions.length) return;
  const m = _buildTile(positions, 'gStruct', _getLandMat(), 0.028, 0.48);
  if (m) _grassMeshes.push(m);
  console.log(`[scatter] Structure grass: ${positions.length} blades`);
}

function _spawnGrass(waterY, structurePositions) {
  const size = CONFIG.terrain?.size || 700;
  const half = size / 2;

  if (waterY !== null) {
    _buildGrassTiles(waterY, half);
  }
  _buildStructureGrass(structurePositions);
}


export async function scatterProps() {
  clearScatter();
  const myGen = _generation;

  const frames = getAllSpriteFrames();
  const layers = CONFIG.scatterLayers?.length
    ? CONFIG.scatterLayers
    : [{ category: 'vegetation', density: 0.12 }, { category: 'rock', density: 0.04 }];

  // 1. Shelters first — positions needed for grass + clustering
  const shelterCount = CONFIG.terrain?.shelterCount ?? 8;
  await _scatterShelters(shelterCount, frames, myGen);
  if (_generation !== myGen) return;

  // 2. Regular scatter layers
  for (const layer of layers) {
    _scatterLayer(layer, frames);
  }

  // 3. Veg clusters around shelters
  const vegFrames = frames.filter(f => f.category === 'vegetation');
  _scatterVegClusters(vegFrames.length > 0 ? vegFrames : frames);

  // 4. Grass — water shore + underwater + structure footprints
  const waterY = CONFIG.water?.enabled ? (CONFIG.water?.waterY ?? CONFIG.water?.mesh?.position?.y ?? null) : null;
  const allStructPos = [..._shelterPositions];
  const structs = CONFIG.structures || {};
  for (const group of ['fortresses', 'villages', 'cities']) {
    for (const s of (structs[group] || [])) {
      if (s.position) allStructPos.push({ wx: s.position.x, wz: s.position.z });
    }
  }
  _spawnGrass(waterY, allStructPos);

  console.log('[scatter] Total instances:', _instances.length, '| shelters:', _shelterPositions.length);
}

export function clearScatter() {
  _generation++;
  // Dispose scatter props (shelters, vegetation objects)
  for (const m of _instances) {
    try { if (m.material && !['_gLand','_gUnder'].includes(m.material.name)) m.material.dispose(); } catch(e) {}
    try { m.dispose(); } catch(e) {}
  }
  // Dispose grass tile meshes (not in _instances — tracked separately)
  for (const m of _grassMeshes) {
    try { m.dispose(); } catch(e) {}
  }
  // Reset cached materials so they rebuild fresh on next scatter
  try { _matLand?.dispose();  } catch(e) {}
  try { _matUnder?.dispose(); } catch(e) {}
  _matLand        = null;
  _matUnder       = null;
  _instances      = [];
  _shelterPositions = [];
  _grassMeshes    = [];
  clearPanelMeshes();
  clearBoxColliders();
}

export function rebuildScatterLayer() { scatterProps(); }
export function tickBillboards() {}