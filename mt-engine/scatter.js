// scatter.js — environment-aware sprite scatter with shelter placement and vegetation clustering

import { scene }           from './core.js';
import { CONFIG }           from './config.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { getAllSpriteFrames, getRandomEnvColor } from './environment.js';
import { addBoxCollider, clearBoxColliders } from './physics.js';
import { spawnLadder }      from './ladders.js';

let _instances = [];  // all disposable meshes/materials
let _generation = 0;  // incremented on each clearScatter — cancels in-flight async scatter

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
        panel.isPickable = false;

        const fi = panelFrames[Math.floor(Math.random() * panelFrames.length)];
        panel.material = _makePanelMat(`${root.name}_pmat_${_instances.length}`, fi);
        _instances.push(panel);
      }
    }
  }
}


async function _scatterShelters(count, frames, gen) {
  const defs = await _loadShelterDefs();
  if (_generation !== gen || !defs.length) return;

  const panelFrames = await _loadShelterFrames();
  if (_generation !== gen) return;

  const size   = CONFIG.terrain.size || 700;
  const half   = size / 2;
  const margin = 30;
  _shelterPositions = [];

  for (let i = 0; i < count; i++) {
    const def  = defs[Math.floor(Math.random() * defs.length)];
    const wx   = (Math.random() - 0.5) * (size - margin * 2);
    const wz   = (Math.random() - 0.5) * (size - margin * 2);
    const rotY = Math.random() * Math.PI * 2;

    // Sample terrain height at centre + 4 corners of ~6m footprint.
    // Use the MAX so the shelter never sinks into a slope — sits on the high side.
    const r = 3;
    const wy = Math.max(
      getTerrainHeightAt(wx, wz),
      getTerrainHeightAt(wx - r, wz - r),
      getTerrainHeightAt(wx + r, wz - r),
      getTerrainHeightAt(wx - r, wz + r),
      getTerrainHeightAt(wx + r, wz + r)
    );

    _buildShelterMesh(def, wx, wy, wz, rotY, panelFrames);
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

// ── Grass — SolidParticleSystem (single draw call) ───────────────────────────
// All grass blades (water edge + structure edge) are merged into ONE SPS mesh.
// This means 1 draw call total regardless of blade count.

let _grassSPS  = null;   // the SPS instance
let _grassMat  = null;   // shared material

function _getGrassMat() {
  if (_grassMat) return _grassMat;
  _grassMat = new BABYLON.StandardMaterial('_grassMat', scene);
  _grassMat.diffuseColor    = new BABYLON.Color3(0.20, 0.55, 0.14);
  _grassMat.emissiveColor   = new BABYLON.Color3(0.04, 0.14, 0.02);
  _grassMat.backFaceCulling = false;
  _grassMat.freeze();
  return _grassMat;
}

// Build a grass SPS from a collected array of {x, z, h} positions.
// One particle per clump. Material has backFaceCulling=false so both sides render.
// Random Y rotation gives enough visual variety from all angles.
function _buildGrassSPS(clumps, tag) {
  if (!clumps.length) return null;

  const template = BABYLON.MeshBuilder.CreatePlane('_gt_' + tag, {
    width: 0.07, height: 0.65,
  }, scene);
  template.isVisible = false;

  const sps = new BABYLON.SolidParticleSystem('grassSPS_' + tag, scene, { updatable: false });
  sps.addShape(template, clumps.length);
  template.dispose();

  const mesh = sps.buildMesh();
  mesh.material   = _getGrassMat();
  mesh.isPickable = false;
  // Do NOT freezeWorldMatrix — that locks the bbox at origin and causes frustum culling
  // to discard the entire grass mesh. Use alwaysSelectAsActiveMesh as the perf substitute.
  mesh.alwaysSelectAsActiveMesh = true;

  // Safe iteration — use actual sps.particles.length, not clumps.length
  sps.initParticles = () => {
    const total = sps.particles.length;
    for (let i = 0; i < total; i++) {
      const c = clumps[i];
      if (!c) break;
      const p = sps.particles[i];
      if (!p) break;
      p.position.set(c.x, c.h + 0.325, c.z);
      p.rotation.y = Math.random() * Math.PI;
    }
  };
  sps.initParticles();
  sps.setParticles();
  sps.refreshVisibleSize();  // compute real bounding box from all particle positions

  _instances.push(mesh);
  console.log('[scatter] Grass SPS "' + tag + '": ' + sps.particles.length + ' blades — 1 draw call');
  return sps;
}

// Collect water-edge positions
function _collectWaterEdgeGrass(waterY) {
  const size   = CONFIG.terrain?.size || 700;
  const half   = size / 2;
  // Step matches heightmap resolution: 700/128 ≈ 5.5 units per pixel.
  // Use 4.0 so we sample denser than the pixel grid and never skip a shoreline.
  const STEP   = 4.0;
  // Band: from 1 unit BELOW waterline up to 8 units above.
  // Wide enough to always catch the shore on coarse heightmaps (5.5u/pixel).
  // Submerged lower edge catches the exact waterline junction.
  const BAND_LO = waterY - 1.0;
  const BAND_HI = waterY + 8.0;
  const JITTER  = 2.0;
  const MAX     = 5000;
  const out     = [];

  for (let wx = -half; wx < half && out.length < MAX; wx += STEP) {
    for (let wz = -half; wz < half && out.length < MAX; wz += STEP) {
      const h = getTerrainHeightAt(wx, wz);
      if (h < BAND_LO || h > BAND_HI) continue;
      const ox = wx + (Math.random() - 0.5) * JITTER;
      const oz = wz + (Math.random() - 0.5) * JITTER;
      const oh = getTerrainHeightAt(ox, oz);
      if (oh < BAND_LO || oh > BAND_HI) continue;
      out.push({ x: ox, z: oz, h: Math.max(oh, waterY) });
    }
  }
  console.log('[scatter] Water grass candidates: ' + out.length + ' (waterY=' + waterY + ' band ' + BAND_LO.toFixed(1) + '-' + BAND_HI.toFixed(1) + ')');
  return out;
}

// Collect structure-edge positions
function _collectStructureEdgeGrass(positions) {
  const RING_INNER = 2.0;
  const RING_OUTER = 7.0;
  const PER_STRUCT = 40;
  const out = [];
  for (const { wx, wz } of positions) {
    for (let i = 0; i < PER_STRUCT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = RING_INNER + Math.random() * (RING_OUTER - RING_INNER);
      const ox = wx + Math.cos(angle) * dist;
      const oz = wz + Math.sin(angle) * dist;
      const oh = getTerrainHeightAt(ox, oz);
      if (oh <= 0) continue;
      out.push({ x: ox, z: oz, h: oh });
    }
  }
  return out;
}

// Public entry points — called from scatterProps
function _scatterWaterEdgeGrass(waterY, myGen) {
  if (_generation !== myGen) return;
  const clumps = _collectWaterEdgeGrass(waterY);
  _grassSPS = _buildGrassSPS(clumps, 'water');
}

function _scatterStructureEdgeGrass(positions, myGen) {
  if (_generation !== myGen) return;
  // Water grass SPS already built — build a second SPS for structures
  // (keeps them separate so water grass can exist without structures and vice versa)
  const clumps = _collectStructureEdgeGrass(positions);
  if (clumps.length) _buildGrassSPS(clumps, 'struct');
}

export async function scatterProps() {
  clearScatter();
  const myGen = _generation;  // snapshot — if clearScatter() runs again, myGen !== _generation

  const frames  = getAllSpriteFrames();  // empty array if no env loaded
  const layers  = CONFIG.scatterLayers?.length
    ? CONFIG.scatterLayers
    : [{ category: 'vegetation', density: 0.12 }, { category: 'rock', density: 0.04 }];

  // 1. Scatter shelters first so we have positions for clustering
  const shelterCount = CONFIG.terrain?.shelterCount ?? 8;
  await _scatterShelters(shelterCount, frames, myGen);
  if (_generation !== myGen) return;  // level reloaded while we were fetching — abort

  // 2. Regular scatter layers
  for (const layer of layers) {
    _scatterLayer(layer, frames);
  }

  // 3. Vegetation clusters around each shelter
  const vegFrames = frames.filter(f => f.category === 'vegetation');
  const clusterFrames = vegFrames.length > 0 ? vegFrames : frames;
  _scatterVegClusters(clusterFrames);

  // 4. Grass — water edge + structure edge
  const waterY = CONFIG.water?.enabled ? (CONFIG.water?.mesh?.position?.y ?? null) : null;
  if (waterY !== null) _scatterWaterEdgeGrass(waterY, myGen);
  // Combine shelter positions with structure positions from level config
  const _allStructurePositions = [..._shelterPositions];
  const _structs = CONFIG.structures || {};
  for (const group of ['fortresses','villages','cities']) {
    for (const s of (_structs[group] || [])) {
      if (s.position) _allStructurePositions.push({ wx: s.position.x, wz: s.position.z });
    }
  }
  _scatterStructureEdgeGrass(_allStructurePositions, myGen);

  console.log('[scatter] Total instances:', _instances.length,
    '| shelters:', _shelterPositions.length);
}

export function clearScatter() {
  _generation++;  // invalidate any in-flight scatterProps call
  for (const m of _instances) {
    try { if (m.material && m.material !== _grassMat) m.material.dispose(); } catch(e) {}
    try { m.dispose(); } catch(e) {}
  }
  _instances = [];
  _shelterPositions = [];
  if (_grassSPS)  { try { _grassSPS.dispose();  } catch(e) {} _grassSPS  = null; }
  if (_grassMat)  { try { _grassMat.dispose();  } catch(e) {} _grassMat  = null; }
  clearBoxColliders();  // remove all Rapier box bodies — prevent phantom colliders on reload
}

export function rebuildScatterLayer() {
  scatterProps();
}

export function tickBillboards() {
  // BabylonJS BILLBOARDMODE_Y handles rotation automatically
}