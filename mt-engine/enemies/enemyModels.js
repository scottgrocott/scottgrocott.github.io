// enemies/enemyModels.js
//
// Loads GLTF enemy models from the CDN and provides a piece-by-piece
// override system so individual parts can be swapped at runtime or via config.
//
// Usage:
//   import { loadEnemyModel } from './enemyModels.js';
//
//   const root = await loadEnemyModel(scene, 'drone', {
//     overrides: {
//       drone_body: 'https://my-cdn.com/custom_body.gltf',
//     }
//   });
//   root.position.copyFrom(spawnPos);
//   enemy.mesh = root;
//
// Model manifest — defines every piece for every enemy type.
// Keys are the canonical piece names used in the _full.gltf and in code.
// Values are CDN paths relative to MODEL_BASE.
//
// To swap a piece, pass { overrides: { piece_name: 'https://full-url-to-replacement.gltf' } }
// or set window._enemyModelOverrides[type][piece_name] = url globally.

const MODEL_BASE = 'https://scottgrocott.github.io/mt-assets/enemies/default_models/';

export const MODEL_MANIFEST = {
  drone: {
    _full:        'drones/drone_full.gltf',
    drone_body:   'drones/drone_body.gltf',
    drone_rotor:  'drones/drone_rotor.gltf',
  },
  car: {
    _full:        'cars/car_full.gltf',
    car_body:     'cars/car_body.gltf',
    car_wheel:    'cars/car_wheel.gltf',
  },
  forklift: {
    _full:        'forklifts/forklift_full.gltf',
    forklift_body: 'forklifts/forklift_body.gltf',
    forklift_fork: 'forklifts/forklift_fork.gltf',
  },
  cow: {
    _full:        'cows/cow_full.gltf',
    cow_body:     'cows/cow_body.gltf',
    cow_head:     'cows/cow_head.gltf',
    cow_leg:      'cows/cow_leg.gltf',
  },
  atst: {
    _full:        'atst/atst_full.gltf',
    atst_cab:     'atst/atst_cab.gltf',
    atst_leg:     'atst/atst_leg.gltf',
    atst_cannon:  'atst/atst_cannon.gltf',
  },
  boat: {
    _full:        'boats/boat_full.gltf',
    boat_hull:    'boats/boat_hull.gltf',
    boat_cabin:   'boats/boat_cabin.gltf',
  },
  submarine: {
    _full:        'submarines/submarine_full.gltf',
    submarine_hull:  'submarines/submarine_hull.gltf',
    submarine_tower: 'submarines/submarine_tower.gltf',
  },
};

// Cache loaded GLTF containers so we don't re-fetch the same file
const _cache = new Map();

// ── Load a full enemy model or override individual pieces ─────────────────────
//
// Returns a BABYLON.TransformNode that is the root of the loaded model.
// Named child meshes match the names in the .gltf files (e.g. 'drone_body',
// 'drone_rotor_0' ... 'drone_rotor_3') so callers can grab them by name.
//
// opts:
//   overrides   — { piece_name: url }  per-call piece overrides
//   shadowGen   — BABYLON.ShadowGenerator (adds all meshes as casters)
//   position    — BABYLON.Vector3 (sets root position)
//   fallback    — if true, silently fall back to procedural mesh on load failure

export async function loadEnemyModel(scene, type, opts = {}) {
  const manifest  = MODEL_MANIFEST[type];
  if (!manifest) throw new Error(`[enemyModels] Unknown enemy type: ${type}`);

  // Merge global overrides + per-call overrides
  // Strip empty strings, _note keys, and any non-string values — these are
  // placeholder slots in the level JSON that the user hasn't filled in yet.
  const globalOvr = window._enemyModelOverrides?.[type] ?? {};
  const callOvr   = opts.overrides ?? {};
  const rawOverrides = { ...globalOvr, ...callOvr };
  const overrides = Object.fromEntries(
    Object.entries(rawOverrides).filter(([k, v]) =>
      k !== '_note' && typeof v === 'string' && v.trim() !== ''
    )
  );

  const root = new BABYLON.TransformNode(`${type}Root_${Date.now()}`, scene);
  if (opts.position) root.position.copyFrom(opts.position);

  const hasPieceOverride = Object.keys(overrides).some(k => k !== '_full');

  if (hasPieceOverride) {
    // Load full model as base, then apply piece overrides on top
    await _loadGltfInto(scene, _resolveUrl(manifest._full), root, opts.shadowGen);
    for (const [pieceName, url] of Object.entries(overrides)) {
      if (pieceName === '_full') continue;
      await _swapPiece(scene, root, pieceName, url, opts.shadowGen);
    }
  } else if (overrides._full) {
    // Full model replacement
    await _loadGltfInto(scene, overrides._full, root, opts.shadowGen);
  } else {
    // Default — load full model from CDN
    await _loadGltfInto(scene, _resolveUrl(manifest._full), root, opts.shadowGen);
  }

  return root;
}

// ── Swap a single named piece inside an existing loaded root ──────────────────
//
// Finds all child meshes whose names start with pieceName, disposes them,
// then loads the replacement .gltf and parents the new meshes to root.

export async function swapEnemyPiece(scene, root, pieceName, url, shadowGen) {
  await _swapPiece(scene, root, pieceName, url, shadowGen);
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _resolveUrl(path) {
  if (path.startsWith('http')) return path;
  return MODEL_BASE + path;
}

async function _loadGltfInto(scene, url, parentNode, shadowGen) {
  // Try cache first (keyed by url)
  // Note: we can't reuse the same container twice in BabylonJS — we must
  // instantiate from it. So we cache the raw container and call instantiateModelsToScene.
  if (!_cache.has(url)) {
    try {
      const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(
        '', url, scene, null, '.gltf'
      );
      _cache.set(url, container);
    } catch (e) {
      console.warn(`[enemyModels] Failed to load ${url}:`, e);
      return;
    }
  }

  const container = _cache.get(url);
  const result    = container.instantiateModelsToScene(
    name => `${parentNode.name}_${name}`,
    false,
    { doNotInstantiate: false }
  );

  // Parent all root nodes of the instance to our parentNode
  for (const node of result.rootNodes) {
    node.parent = parentNode;
    node.position.setAll(0);
  }

  // Register shadow casters
  if (shadowGen) {
    for (const mesh of result.rootNodes.flatMap(n => n.getChildMeshes(false))) {
      shadowGen.addShadowCaster(mesh);
    }
  }

  return result;
}

async function _swapPiece(scene, root, pieceName, url, shadowGen) {
  // Dispose existing meshes matching this piece name
  const existing = root.getChildMeshes(false).filter(m => m.name.includes(pieceName));
  for (const m of existing) {
    try { m.dispose(); } catch (_) {}
  }

  // Load replacement
  const tempRoot = new BABYLON.TransformNode(`_swap_${pieceName}_${Date.now()}`, scene);
  await _loadGltfInto(scene, url, tempRoot, shadowGen);

  // Re-parent loaded pieces to the real root
  for (const child of tempRoot.getChildTransformNodes(true).concat(tempRoot.getChildMeshes(false))) {
    child.parent = root;
  }
  tempRoot.dispose();
  console.log(`[enemyModels] Swapped piece "${pieceName}" on ${root.name}`);
}

// ── Named mesh accessors ──────────────────────────────────────────────────────
// Helpers for enemy tick functions that need to grab specific animated parts.

export function findPiece(root, pieceName) {
  // Finds first child mesh/node whose name includes pieceName
  const meshes = root.getChildMeshes(false);
  return meshes.find(m => m.name.includes(pieceName)) ?? null;
}

export function findPieces(root, pieceName) {
  return root.getChildMeshes(false).filter(m => m.name.includes(pieceName));
}

export function findNode(root, nodeName) {
  const nodes = root.getChildTransformNodes(false);
  return nodes.find(n => n.name.includes(nodeName)) ?? null;
}