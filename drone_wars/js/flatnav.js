// ============================================================
//  flatnav.js — Terrain-aware flat-area navigation mesh
//
//  How it works:
//  1. After terrain loads, scanFlatAreas() casts a grid of
//     downward rays across the terrain bounding box.
//  2. Any sample whose surface normal Y >= FLAT_THRESHOLD is
//     considered a "flat" navigable point (canyon floor,
//     plateau, high flat land, etc.)
//  3. Those points are clustered so waypoints aren't too
//     tightly packed — one waypoint per CLUSTER_RADIUS metres.
//  4. The resulting waypoints are pushed into flightWaypoints
//     (from drones.js) so drone patrol AI automatically
//     explores the whole terrain instead of just the centre.
//  5. An optional debug visualisation can be toggled with
//     showFlatNavDebug(true/false).
// ============================================================

import { scene }            from './core.js';
import { CONFIG }           from './config.js';
import { addWaypoint }      from './drones.js';

// ---- Tuning ----
const SCAN_GRID_STEP   = 18;    // metres between each ray sample
const FLAT_THRESHOLD   = 0.82;  // normal.y must be >= this (matches scatter.js flatThreshold)
const CLUSTER_RADIUS   = 22;    // merge waypoints closer than this (metres)
const FLIGHT_HEIGHT_ABOVE = 4;  // metres above the surface for the waypoint Y
const RAY_FROM_HEIGHT  = 500;   // cast ray downward from this absolute Y

// ---- Module state ----
let _debugMeshes = [];
let _debugVisible = false;
let _flatPoints  = [];   // { x, y, z } world positions on the flat surface

// ============================================================
//  Public API
// ============================================================

/**
 * Call this once after terrain GLB meshes are ready.
 * Scans the terrain, builds clustered flat-area waypoints,
 * and registers them with the drone flight system.
 *
 * @param {BABYLON.AbstractMesh[]} terrainMeshes  sub-meshes from loadBuildings onTerrainReady
 * @returns {number} count of waypoints added
 */
export async function scanFlatAreas(terrainMeshes) {
  if (!terrainMeshes || !terrainMeshes.length) return 0;

  // 1. Compute terrain bounding box
  const min = new BABYLON.Vector3( Infinity,  Infinity,  Infinity);
  const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of terrainMeshes) {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(bb.minimumWorld);
    max.maximizeInPlace(bb.maximumWorld);
  }

  const bw = max.x - min.x;
  const bd = max.z - min.z;
  const stepsX = Math.ceil(bw / SCAN_GRID_STEP);
  const stepsZ = Math.ceil(bd / SCAN_GRID_STEP);

  console.info(`[flatnav] Scanning ${stepsX * stepsZ} terrain cells (${stepsX}×${stepsZ}) …`);

  const rayDir = new BABYLON.Vector3(0, -1, 0);
  const rawFlat = [];

  // Predicate: only hit these terrain meshes
  const pred = m => terrainMeshes.includes(m);

  // 2. Grid scan — yield every 50 rows so the main thread isn't blocked
  for (let ix = 0; ix <= stepsX; ix++) {
    if (ix % 50 === 0) await _yieldFrame();
    for (let iz = 0; iz <= stepsZ; iz++) {
      // Slight jitter so a perfectly regular grid doesn't look artificial
      const jx = (Math.random() - 0.5) * SCAN_GRID_STEP * 0.3;
      const jz = (Math.random() - 0.5) * SCAN_GRID_STEP * 0.3;
      const x  = min.x + ix * SCAN_GRID_STEP + jx;
      const z  = min.z + iz * SCAN_GRID_STEP + jz;

      const ray = new BABYLON.Ray(
        new BABYLON.Vector3(x, RAY_FROM_HEIGHT, z),
        rayDir,
        RAY_FROM_HEIGHT + 50,
      );

      const hit = scene.pickWithRay(ray, pred);
      if (!hit?.hit || !hit.pickedPoint) continue;

      const normal = hit.getNormal(true);
      if (!normal) continue;

      const slopeUp = BABYLON.Vector3.Dot(normal, BABYLON.Vector3.Up());
      if (slopeUp >= FLAT_THRESHOLD) {
        rawFlat.push({
          x: hit.pickedPoint.x,
          y: hit.pickedPoint.y,
          z: hit.pickedPoint.z,
        });
      }
    }
  }

  console.info(`[flatnav] ${rawFlat.length} flat samples found — clustering …`);

  // 3. Greedy spatial cluster: keep one representative per CLUSTER_RADIUS
  const clustered = _clusterPoints(rawFlat, CLUSTER_RADIUS);
  _flatPoints = clustered;

  console.info(`[flatnav] ${clustered.length} navmesh waypoints after clustering`);

  // 4. Register with drone flight system
  const droneFlightY = CONFIG.droneFlightHeight ?? 3;
  for (const p of clustered) {
    const waypointY = p.y + FLIGHT_HEIGHT_ABOVE + droneFlightY;
    addWaypoint(p.x, waypointY, p.z);
  }

  return clustered.length;
}

/**
 * Toggle a debug visualisation: blue spheres on flat waypoints,
 * red lines connecting adjacent ones.
 */
export function showFlatNavDebug(visible) {
  _debugVisible = visible;

  // Remove old debug meshes
  for (const m of _debugMeshes) m.dispose();
  _debugMeshes = [];

  if (!visible || !_flatPoints.length) return;

  const mat = new BABYLON.StandardMaterial('flatNavDbgMat', scene);
  mat.diffuseColor  = new BABYLON.Color3(0.2, 0.5, 1.0);
  mat.emissiveColor = new BABYLON.Color3(0.1, 0.3, 0.8);
  mat.wireframe     = false;

  for (const p of _flatPoints) {
    const sphere = BABYLON.MeshBuilder.CreateSphere('fnDbg', { diameter: 1.2 }, scene);
    sphere.position.set(p.x, p.y + 0.6, p.z);
    sphere.material = mat;
    _debugMeshes.push(sphere);
  }

  console.info(`[flatnav] Debug: ${_debugMeshes.length} markers rendered`);
}

/**
 * Returns a copy of the raw flat surface points (not flight height adjusted).
 * Useful for other systems (e.g. enemy spawn, loot placement).
 */
export function getFlatPoints() {
  return _flatPoints.slice();
}

// ============================================================
//  Private helpers
// ============================================================

/**
 * Greedy cluster: iterate points in order; any point within
 * clusterRadius of an already-kept point is discarded.
 * O(n²) worst case but n is typically < 5 000 here — fast enough.
 */
function _clusterPoints(points, radius) {
  const r2 = radius * radius;
  const kept = [];
  for (const p of points) {
    let tooClose = false;
    for (const k of kept) {
      const dx = p.x - k.x, dz = p.z - k.z;
      if (dx * dx + dz * dz < r2) { tooClose = true; break; }
    }
    if (!tooClose) kept.push(p);
  }
  return kept;
}

function _yieldFrame() { return new Promise(r => setTimeout(r, 0)); }