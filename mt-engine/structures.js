// structures.js — spawns villages, cities and fortresses from level config
// Each structure type has a pool of geometry templates; one is picked randomly per placement

import { scene, shadowGenerator } from './core.js';
import { getTerrainHeightAt }     from './terrain/terrainMesh.js';

let _structureMeshes = [];

export function initStructures() {
  clearStructures();
}

export function clearStructures() {
  for (const m of _structureMeshes) {
    try { m.dispose(); } catch(e) {}
  }
  _structureMeshes = [];
}

export function spawnStructures(structuresCfg) {
  if (!structuresCfg) return;
  const { fortresses = [], villages = [], cities = [] } = structuresCfg;
  let count = 0;

  for (const def of fortresses) {
    _spawnFortress(def);
    count++;
  }
  for (const def of villages) {
    _spawnVillage(def);
    count++;
  }
  for (const def of cities) {
    _spawnCity(def);
    count++;
  }
  console.log(`[structures] Spawned ${count} structures (${fortresses.length} fortresses, ${villages.length} villages, ${cities.length} cities)`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _pos(def) {
  const x = def.position?.x ?? 0;
  const z = def.position?.z ?? 0;
  const y = def.position?.y ?? getTerrainHeightAt(x, z);
  return { x, y, z };
}

function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _track(mesh) {
  _structureMeshes.push(mesh);
  return mesh;
}

function _mat(name, r, g, b, scene_) {
  const m = new BABYLON.StandardMaterial(name, scene_);
  m.diffuseColor = new BABYLON.Color3(r, g, b);
  m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  return m;
}

function _box(name, w, h, d, scene_) {
  return BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene_);
}

function _shadow(mesh) {
  if (shadowGenerator) shadowGenerator.addShadowCaster(mesh);
  mesh.receiveShadows = true;
}

// ── FORTRESS templates ────────────────────────────────────────────────────────
// Pool of 3 layouts; pick one randomly per placement

const FORTRESS_TEMPLATES = [
  _buildFortressA,
  _buildFortressB,
  _buildFortressC,
];

function _spawnFortress(def) {
  const { x, y, z } = _pos(def);
  const template = _pick(FORTRESS_TEMPLATES);
  template(x, y, z, def.name);
}

// Template A — square perimeter wall with corner towers
function _buildFortressA(ox, oy, oz, label) {
  const root = new BABYLON.TransformNode(`fortress_${label}`, scene);
  root.position.set(ox, oy, oz);

  const wallMat  = _mat('fortWallA',  0.45, 0.40, 0.32, scene);
  const towerMat = _mat('fortTowerA', 0.38, 0.34, 0.28, scene);
  const roofMat  = _mat('fortRoofA',  0.28, 0.24, 0.20, scene);

  // Perimeter walls (4 sides)
  const wallDefs = [
    { w:24, h:5, d:1.5, x:0,    z:12  },
    { w:24, h:5, d:1.5, x:0,    z:-12 },
    { w:1.5, h:5, d:24, x:12,   z:0   },
    { w:1.5, h:5, d:24, x:-12,  z:0   },
  ];
  for (const wd of wallDefs) {
    const wall = _box('fwall', wd.w, wd.h, wd.d, scene);
    wall.parent = root;
    wall.position.set(wd.x, wd.h / 2, wd.z);
    wall.material = wallMat;
    _shadow(wall);
    _track(wall);
  }

  // Corner towers
  for (const [tx, tz] of [[11,11],[11,-11],[-11,11],[-11,-11]]) {
    const tower = _box('ftower', 3, 8, 3, scene);
    tower.parent = root;
    tower.position.set(tx, 4, tz);
    tower.material = towerMat;
    _shadow(tower);
    _track(tower);

    const cap = _box('fcap', 3.6, 0.5, 3.6, scene);
    cap.parent = root;
    cap.position.set(tx, 8.25, tz);
    cap.material = roofMat;
    _track(cap);
  }

  // Keep (central building)
  const keep = _box('fkeep', 8, 10, 8, scene);
  keep.parent = root;
  keep.position.set(0, 5, 0);
  keep.material = towerMat;
  _shadow(keep);
  _track(keep);

  const keepRoof = _box('fkeeproof', 9, 0.6, 9, scene);
  keepRoof.parent = root;
  keepRoof.position.set(0, 10.3, 0);
  keepRoof.material = roofMat;
  _track(keepRoof);
}

// Template B — irregular rocky fort, two towers, open courtyard
function _buildFortressB(ox, oy, oz, label) {
  const root = new BABYLON.TransformNode(`fortress_${label}`, scene);
  root.position.set(ox, oy, oz);

  const stoneMat = _mat('fortStoneB', 0.50, 0.44, 0.36, scene);
  const darkMat  = _mat('fortDarkB',  0.30, 0.26, 0.22, scene);

  // Main hall — elongated
  const hall = _box('fhall', 18, 6, 10, scene);
  hall.parent = root;
  hall.position.set(0, 3, 0);
  hall.material = stoneMat;
  _shadow(hall);
  _track(hall);

  // Two asymmetric towers
  for (const [tx, tz, h] of [[9, 4, 10], [-9, -3, 8]]) {
    const t = _box('ftB', 4, h, 4, scene);
    t.parent = root;
    t.position.set(tx, h / 2, tz);
    t.material = darkMat;
    _shadow(t);
    _track(t);
  }

  // Ramparts along top of hall
  for (let i = -3; i <= 3; i++) {
    const merlon = _box('fmerlon', 1.2, 1.5, 1.2, scene);
    merlon.parent = root;
    merlon.position.set(i * 2.5, 7.75, 4.5);
    merlon.material = stoneMat;
    _track(merlon);
  }
}

// Template C — circular fort with radial walls
function _buildFortressC(ox, oy, oz, label) {
  const root = new BABYLON.TransformNode(`fortress_${label}`, scene);
  root.position.set(ox, oy, oz);

  const brickMat  = _mat('fortBrickC', 0.52, 0.42, 0.30, scene);
  const stoneMat  = _mat('fortStoneC', 0.40, 0.35, 0.28, scene);

  // Central tower
  const centre = _box('fcentre', 6, 12, 6, scene);
  centre.parent = root;
  centre.position.set(0, 6, 0);
  centre.material = stoneMat;
  _shadow(centre);
  _track(centre);

  // 6 radial wall segments
  const R = 10, SEGS = 6;
  for (let i = 0; i < SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    const wx = Math.cos(a) * R;
    const wz = Math.sin(a) * R;
    const seg = _box('fseg', 1.5, 5, 7, scene);
    seg.parent = root;
    seg.position.set(wx, 2.5, wz);
    seg.rotation.y = a;
    seg.material = brickMat;
    _shadow(seg);
    _track(seg);
  }
}

// ── VILLAGE templates ─────────────────────────────────────────────────────────

const VILLAGE_TEMPLATES = [
  _buildVillageA,
  _buildVillageB,
];

function _spawnVillage(def) {
  const { x, y, z } = _pos(def);
  _pick(VILLAGE_TEMPLATES)(x, y, z, def.name);
}

// Template A — cluster of small huts with a central well
function _buildVillageA(ox, oy, oz, label) {
  const root = new BABYLON.TransformNode(`village_${label}`, scene);
  root.position.set(ox, oy, oz);

  const wallMat = _mat('vilWallA', 0.78, 0.68, 0.52, scene);
  const roofMat = _mat('vilRoofA', 0.60, 0.32, 0.20, scene);
  const wellMat = _mat('vilWellA', 0.55, 0.50, 0.44, scene);

  // 6 huts in a rough circle
  const hutPositions = [
    [6, 0], [-6, 2], [2, 7], [-3, -6], [8, -4], [-7, -2],
  ];
  for (const [hx, hz] of hutPositions) {
    const w = 2.5 + Math.random() * 1.5;
    const h = 2.2 + Math.random() * 0.8;
    const hut = _box('vhut', w, h, w, scene);
    hut.parent = root;
    hut.position.set(hx, h / 2, hz);
    hut.material = wallMat;
    _shadow(hut);
    _track(hut);

    // Roof (slanted box)
    const roof = _box('vroof', w + 0.4, 0.8, w + 0.4, scene);
    roof.parent = root;
    roof.position.set(hx, h + 0.4, hz);
    roof.rotation.y = Math.random() * 0.3;
    roof.material = roofMat;
    _track(roof);
  }

  // Central well
  const well = _box('vwell', 1.2, 0.8, 1.2, scene);
  well.parent = root;
  well.position.set(0, 0.4, 0);
  well.material = wellMat;
  _track(well);
}

// Template B — linear desert settlement, walled compound
function _buildVillageB(ox, oy, oz, label) {
  const root = new BABYLON.TransformNode(`village_${label}`, scene);
  root.position.set(ox, oy, oz);

  const wallMat    = _mat('vilWallB',    0.85, 0.72, 0.50, scene);
  const roofMat    = _mat('vilRoofB',    0.55, 0.38, 0.22, scene);
  const compMat    = _mat('vilCompB',    0.70, 0.60, 0.44, scene);

  // Compound perimeter
  for (const [w, h, d, x, z] of [
    [16, 2.5, 1,  0,    8 ],
    [16, 2.5, 1,  0,   -8 ],
    [1,  2.5, 16, 8,    0 ],
    [1,  2.5, 16, -8,   0 ],
  ]) {
    const wall = _box('vwall', w, h, d, scene);
    wall.parent = root;
    wall.position.set(x, h / 2, z);
    wall.material = compMat;
    _track(wall);
  }

  // Row of 4 buildings inside
  for (let i = -1; i <= 2; i++) {
    const bld = _box('vbld', 3.5, 3.5, 3.5, scene);
    bld.parent = root;
    bld.position.set(i * 4.5, 1.75, 0);
    bld.material = wallMat;
    _shadow(bld);
    _track(bld);

    const roof = _box('vbroof', 4, 0.5, 4, scene);
    roof.parent = root;
    roof.position.set(i * 4.5, 3.75, 0);
    roof.material = roofMat;
    _track(roof);
  }
}

// ── CITY templates ────────────────────────────────────────────────────────────

const CITY_TEMPLATES = [
  _buildCityA,
  _buildCityB,
];

function _spawnCity(def) {
  const { x, y, z } = _pos(def);
  _pick(CITY_TEMPLATES)(x, y, z, def.name);
}

// Template A — grid of varied height towers (downtown core)
function _buildCityA(ox, oy, oz, label) {
  const root = new BABYLON.TransformNode(`city_${label}`, scene);
  root.position.set(ox, oy, oz);

  const concMat  = _mat('cityConcA',  0.55, 0.54, 0.52, scene);
  const glassMat = _mat('cityGlassA', 0.36, 0.44, 0.55, scene);
  glassMat.alpha = 0.85;

  const grid = [
    [-12, -12, 8],  [-4, -12, 14], [4, -12, 10],  [12, -12, 7],
    [-12, -4,  12], [-4, -4,  20], [4, -4,  16],  [12, -4,  9],
    [-12,  4,  7],  [-4,  4,  18], [4,  4,  22],  [12,  4,  11],
    [-12,  12, 6],  [-4,  12, 10], [4,  12, 8],   [12,  12, 14],
  ];

  for (const [bx, bz, bh] of grid) {
    const isGlass = bh > 14;
    const w = 5 + Math.random() * 2;
    const bld = _box('cbld', w, bh, w, scene);
    bld.parent = root;
    bld.position.set(bx, bh / 2, bz);
    bld.material = isGlass ? glassMat : concMat;
    _shadow(bld);
    _track(bld);

    // Rooftop detail
    const detail = _box('cdet', w * 0.4, 1.5, w * 0.4, scene);
    detail.parent = root;
    detail.position.set(bx, bh + 0.75, bz);
    detail.material = concMat;
    _track(detail);
  }

  // Ground plane / plaza
  const plaza = _box('cplaza', 32, 0.3, 32, scene);
  plaza.parent = root;
  plaza.position.set(0, 0.15, 0);
  plaza.material = _mat('cityPlaza', 0.42, 0.41, 0.40, scene);
  _track(plaza);
}

// Template B — industrial supergrid (warehouses, silos, pipes)
function _buildCityB(ox, oy, oz, label) {
  const root = new BABYLON.TransformNode(`city_${label}`, scene);
  root.position.set(ox, oy, oz);

  const metalMat  = _mat('cityMetalB', 0.45, 0.44, 0.42, scene);
  const rustMat   = _mat('cityRustB',  0.55, 0.32, 0.18, scene);

  // Large warehouses
  for (const [bx, bz, bw, bh, bd] of [
    [-14, -8,  20, 6,  10],
    [ 6,  -8,  12, 7,  10],
    [-10,  8,  14, 5,  12],
    [ 8,   8,  16, 8,  10],
  ]) {
    const wh = _box('cwh', bw, bh, bd, scene);
    wh.parent = root;
    wh.position.set(bx, bh / 2, bz);
    wh.material = metalMat;
    _shadow(wh);
    _track(wh);
  }

  // Silos
  for (const [sx, sz, sr, sh] of [
    [4, 2, 2, 12], [-4, 2, 2, 10], [0, 2, 2, 14],
    [16, -6, 1.5, 8], [16, -2, 1.5, 11],
  ]) {
    const silo = BABYLON.MeshBuilder.CreateCylinder('csilo',
      { diameter: sr * 2, height: sh, tessellation: 12 }, scene);
    silo.parent = root;
    silo.position.set(sx, sh / 2, sz);
    silo.material = rustMat;
    _shadow(silo);
    _structureMeshes.push(silo);
  }

  // Ground pad
  const pad = _box('cpad', 40, 0.3, 36, scene);
  pad.parent = root;
  pad.position.set(0, 0.15, 0);
  pad.material = _mat('cityPad', 0.35, 0.34, 0.33, scene);
  _track(pad);
}
