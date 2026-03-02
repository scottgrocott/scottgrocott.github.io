// ============================================================
//  scatter.js — Sprite-sheet loading, billboard scattering,
//               vegetation thin-instance management
// ============================================================

import { scene }               from './core.js';
import { CONFIG }               from './config.js';
import { buildingPositions }    from './buildings.js';
import { pointerLock }          from './input.js';

// ---- Atlas cache ----
const atlasTextures = {};

export function loadSpriteAssets(assets) {
  const sheets = assets.filter(a => a.type === 'spritesheet');
  if (!sheets.length) return Promise.resolve();

  return new Promise(resolve => {
    let remaining = sheets.length;
    for (const a of sheets) {
      const tex = new BABYLON.Texture(a.src, scene, undefined, undefined, undefined,
        () => {
          tex.gammaSpace = true;
          atlasTextures[a.id] = { tex, category: a.category, id: a.id };
          if (--remaining === 0) resolve();
        },
        () => { if (--remaining === 0) resolve(); },
      );
    }
  });
}

// ---- Billboard (single plane, Y-billboard) ----
export function makeBillboard(sheetId, worldPos, w, h) {
  const mat = _makeBillboardMat(sheetId);
  if (!mat) return null;
  const mesh = BABYLON.MeshBuilder.CreatePlane('bb', { width: w, height: h }, scene);
  mesh.material      = mat;
  mesh.position.copyFrom(worldPos);
  mesh.position.y   += h * 0.5;
  mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
  return mesh;
}

// ---- Vegetation thin-instances ----
const vegInstances = [];

export function buildVegInstancedMeshes(data, capacity) {
  const cells = [];
  data.assets
    .filter(a => a.type === 'spritesheet' && a.category === 'vegetation')
    .forEach(a => {
      const grid = CONFIG.sheetGrids[a.id] || { cols: 4, rows: 2 };
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          cells.push({ sheetId: a.id, col: c, row: r, grid });
        }
      }
    });

  for (const cell of cells) {
    const entry = atlasTextures[cell.sheetId];
    if (!entry) continue;

    const t = entry.tex.clone();
    t.uScale   = 1 / cell.grid.cols;
    t.vScale   = 1 / cell.grid.rows;
    t.uOffset  = cell.col / cell.grid.cols;
    t.vOffset  = 1 - (cell.row + 1) / cell.grid.rows;

    const mat = new BABYLON.StandardMaterial('vegMat', scene);
    mat.diffuseTexture              = t;
    mat.diffuseTexture.hasAlpha     = true;
    mat.useAlphaFromDiffuseTexture  = true;
    mat.alphaCutOff                 = 0.15;
    mat.transparencyMode            = BABYLON.Material.MATERIAL_ALPHATEST;
    // Keep lighting ON so Babylon includes these meshes in the fog pipeline.
    // Drive brightness via emissive so sprites aren't shaded dark by scene lights.
    mat.emissiveColor               = BABYLON.Color3.White();
    mat.disableLighting             = false;
    mat.backFaceCulling             = false;

    const mesh = BABYLON.MeshBuilder.CreatePlane('vp', { width: 1, height: 1 }, scene);
    mesh.material = mat;

    vegInstances.push({
      mesh,
      count:      0,
      buffer:     new Float32Array(capacity * 16),
      storedData: [],
      capacity,
    });
  }
}

export function addVegInstance(x, y, z, w, h) {
  if (!vegInstances.length) return;
  const si   = Math.floor(Math.random() * vegInstances.length);
  const slot = vegInstances[si];
  if (slot.count >= slot.capacity) return;
  slot.storedData.push(x, y + h * 0.5, z, w, h);
  slot.count++;
}

let _lastBillboardYaw = null;

export function tickBillboards() {
  const camYaw = pointerLock.euler.y;
  const faceY  = camYaw + Math.PI;
  if (faceY === _lastBillboardYaw) return;

  const quat = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(0, 1, 0), faceY);

  for (const slot of vegInstances) {
    if (slot.count === 0) continue;
    for (let i = 0; i < slot.count; i++) {
      const base = i * 5;
      const p    = new BABYLON.Vector3(slot.storedData[base], slot.storedData[base + 1], slot.storedData[base + 2]);
      const s    = new BABYLON.Vector3(slot.storedData[base + 3], slot.storedData[base + 4], 1);
      BABYLON.Matrix.Compose(s, quat, p).copyToArray(slot.buffer, i * 16);
    }
    slot.mesh.thinInstanceSetBuffer('matrix', slot.buffer.subarray(0, slot.count * 16), 16, false);
  }

  _lastBillboardYaw = faceY;
}

// ---- Terrain prop scatter ----
export async function scatterProps(data, terrainMeshes) {
  const SC  = CONFIG.scatter;
  const rng = (min, max) => min + Math.random() * (max - min);

  const byCategory = {};
  data.assets.filter(a => a.type === 'spritesheet').forEach(a => {
    (byCategory[a.category] ??= []).push(a.id);
  });

  const rockSheets  = byCategory['rocks']     ?? [];
  const stumpSheets = byCategory['stumps']    ?? [];
  const wallSheets  = byCategory['buildings'] ?? [];
  const randSheet   = arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

  // Compute terrain bounding box
  const tb = {
    min: new BABYLON.Vector3(Infinity, Infinity, Infinity),
    max: new BABYLON.Vector3(-Infinity, -Infinity, -Infinity),
  };
  terrainMeshes.forEach(m => {
    m.computeWorldMatrix(true);
    const { minimumWorld, maximumWorld } = m.getBoundingInfo().boundingBox;
    tb.min.minimizeInPlace(minimumWorld);
    tb.max.maximizeInPlace(maximumWorld);
  });
  const bmin = tb.min;
  const bw   = tb.max.x - tb.min.x;
  const bd   = tb.max.z - tb.min.z;

  // ---- Vegetation grid pass ----
  const vegCells = Math.ceil(Math.sqrt(SC.vegSampleCount));
  const vegCellW = bw / vegCells;
  const vegCellD = bd / vegCells;
  buildVegInstancedMeshes(data, Math.ceil(SC.vegSampleCount * SC.vegFlatDensity * 1.8));

  for (let gx = 0; gx < vegCells; gx++) {
    if (gx % 60 === 0) await _yieldFrame();
    for (let gz = 0; gz < vegCells; gz++) {
      const x = bmin.x + (gx + Math.random()) * vegCellW;
      const z = bmin.z + (gz + Math.random()) * vegCellD;
      const s = _sampleTerrainAt(x, z, terrainMeshes);
      if (!s) continue;

      const slopeUp = BABYLON.Vector3.Dot(s.normal, new BABYLON.Vector3(0, 1, 0));
      const isSteep = slopeUp <= SC.steepThreshold;
      const isFlat  = slopeUp >= SC.flatThreshold;
      const density = isSteep ? SC.vegSteepDensity : isFlat ? SC.vegFlatDensity : 0;
      if (density === 0 || Math.random() >= density) continue;

      const sc = rng(0.6, 1.4);
      addVegInstance(x, s.y, z, SC.vegSize.w * sc, SC.vegSize.h * sc);

      if (isSteep && Math.random() < 0.6) {
        addVegInstance(
          x + rng(-0.8, 0.8), s.y, z + rng(-0.8, 0.8),
          SC.vegSize.w * rng(0.5, 1.1), SC.vegSize.h * rng(0.5, 1.1),
        );
      }
    }
  }

  // ---- Props grid pass ----
  const propCells = Math.ceil(Math.sqrt(SC.sampleCount));
  const propCellW = bw / propCells;
  const propCellD = bd / propCells;

  for (let gx = 0; gx < propCells; gx++) {
    if (gx % 60 === 0) await _yieldFrame();
    for (let gz = 0; gz < propCells; gz++) {
      const x = bmin.x + (gx + Math.random()) * propCellW;
      const z = bmin.z + (gz + Math.random()) * propCellD;
      const s = _sampleTerrainAt(x, z, terrainMeshes);
      if (!s || BABYLON.Vector3.Dot(s.normal, new BABYLON.Vector3(0, 1, 0)) < SC.flatThreshold) continue;

      const roll = Math.random();
      const pos  = new BABYLON.Vector3(x, s.y, z);

      if (s.y > SC.elevationSplit) {
        if      (roll < SC.flatRockDensity                                   && rockSheets.length)  makeBillboard(randSheet(rockSheets),  pos, SC.rockSize.w  * rng(0.8, 1.5), SC.rockSize.h  * rng(0.7, 1.3));
        else if (roll < SC.flatRockDensity + SC.flatStumpDensity             && stumpSheets.length) makeBillboard(randSheet(stumpSheets), pos, SC.stumpSize.w * rng(0.8, 1.2), SC.stumpSize.h * rng(0.8, 1.2));
        else if (roll < SC.flatRockDensity + SC.flatStumpDensity + SC.flatBoxDensity && wallSheets.length)  makeBillboard(randSheet(wallSheets),  pos, SC.boxSize.w  * rng(0.7, 1.3), SC.boxSize.h  * rng(0.7, 1.3));
      } else if (roll < SC.flatBoxDensity && wallSheets.length) {
        makeBillboard(randSheet(wallSheets), pos, SC.boxSize.w * rng(0.8, 1.4), SC.boxSize.h * rng(0.8, 1.4));
      }
    }
  }

  // ---- Building ring vegetation ----
  for (const bp of buildingPositions) {
    const hx = bp.hx || SC.buildingRingRadius;
    const hz = bp.hz || SC.buildingRingRadius;

    const layers = [
      { offset: -0.5, density: 1.00, sizeMin: 1.1, sizeMax: 2.4, spacing: 0.9 },
      { offset:  0.5, density: 0.98, sizeMin: 0.9, sizeMax: 2.0, spacing: 1.0 },
      { offset:  1.8, density: 0.85, sizeMin: 0.7, sizeMax: 1.6, spacing: 1.2 },
      { offset:  3.5, density: 0.65, sizeMin: 0.5, sizeMax: 1.2, spacing: 1.6 },
      { offset:  6.0, density: 0.35, sizeMin: 0.4, sizeMax: 0.9, spacing: 2.2 },
    ];

    for (const layer of layers) {
      const ox = hx + layer.offset;
      const oz = hz + layer.offset;
      const sp = layer.spacing;

      const sides = [
        { axis: 'x', from: -ox, to: ox, fixed: -oz, fx: false },
        { axis: 'x', from: -ox, to: ox, fixed: +oz, fx: false },
        { axis: 'z', from: -oz, to: oz, fixed: -ox, fx: true  },
        { axis: 'z', from: -oz, to: oz, fixed: +ox, fx: true  },
      ];

      for (const side of sides) {
        const len   = side.to - side.from;
        const steps = Math.ceil(len / sp);
        for (let i = 0; i <= steps; i++) {
          if (Math.random() > layer.density) continue;
          const t    = side.from + (i / steps) * len + rng(-sp * 0.35, sp * 0.35);
          const perp = rng(-0.6, 0.6);
          const wx   = bp.x + (side.fx ? side.fixed + perp : t);
          const wz   = bp.z + (side.fx ? t : side.fixed + perp);
          const st   = _sampleTerrainAt(wx, wz, terrainMeshes);
          const sc   = rng(layer.sizeMin, layer.sizeMax);
          addVegInstance(wx, st ? st.y : bp.y, wz, SC.vegSize.w * sc, SC.vegSize.h * sc);
        }
      }
    }
  }
}

// ---- Private helpers ----
function _sampleTerrainAt(x, z, terrainMeshes) {
  const ray = new BABYLON.Ray(new BABYLON.Vector3(x, 300, z), new BABYLON.Vector3(0, -1, 0), 600);
  const hit = scene.pickWithRay(ray, m => terrainMeshes.includes(m));
  if (!hit?.hit) return null;
  return { y: hit.pickedPoint.y, normal: hit.getNormal(true) };
}

function _makeBillboardMat(sheetId) {
  const entry = atlasTextures[sheetId];
  if (!entry) return null;

  const grid = CONFIG.sheetGrids[sheetId] || { cols: 4, rows: 2 };
  const col  = Math.floor(Math.random() * grid.cols);
  const row  = Math.floor(Math.random() * grid.rows);
  const t    = entry.tex.clone();
  t.uScale   = 1 / grid.cols; t.vScale   = 1 / grid.rows;
  t.uOffset  = col / grid.cols;
  t.vOffset  = 1 - (row + 1) / grid.rows;

  const mat = new BABYLON.StandardMaterial('bbMat', scene);
  mat.diffuseTexture             = t;
  mat.diffuseTexture.hasAlpha    = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.alphaCutOff                = 0.15;
  mat.transparencyMode           = BABYLON.Material.MATERIAL_ALPHATEST;
  // Keep lighting ON for fog. emissiveColor white prevents shading from scene lights.
  mat.emissiveColor              = BABYLON.Color3.White();
  mat.disableLighting            = false;
  mat.backFaceCulling            = false;
  return mat;
}

function _yieldFrame() { return new Promise(r => setTimeout(r, 0)); }