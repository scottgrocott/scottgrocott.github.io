// flatnav.js — scan terrain → ground + flight waypoints

import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { CONFIG } from './config.js';

// Internal arrays — written by scanFlatAreas(), read via getWaypoints()
let groundWaypoints = [];
let flightWaypoints = [];

const FLAT_THRESHOLD = 0.85;
const GRID_STEPS     = 20;
const FLIGHT_HEIGHT  = 18;

export function scanFlatAreas() {
  groundWaypoints = [];
  flightWaypoints = [];

  const size = CONFIG.terrain.size || 700;
  const half = size / 2;
  const step = size / GRID_STEPS;

  const samples = [];

  for (let xi = 0; xi < GRID_STEPS; xi++) {
    for (let zi = 0; zi < GRID_STEPS; zi++) {
      const wx = -half + xi * step + step * 0.5;
      const wz = -half + zi * step + step * 0.5;
      const wy = getTerrainHeightAt(wx, wz);

      const hN = getTerrainHeightAt(wx,        wz + step);
      const hS = getTerrainHeightAt(wx,        wz - step);
      const hE = getTerrainHeightAt(wx + step, wz);
      const hW = getTerrainHeightAt(wx - step, wz);
      const slopeX = (hE - hW) / (2 * step);
      const slopeZ = (hN - hS) / (2 * step);
      const normalY = 1.0 / Math.sqrt(1 + slopeX*slopeX + slopeZ*slopeZ);

      if (normalY >= FLAT_THRESHOLD) {
        samples.push({ x: wx, y: wy + 0.5, z: wz });
      }
    }
  }

  groundWaypoints = _kmeansCluster(samples, Math.min(12, samples.length));

  for (let xi = 0; xi < 8; xi++) {
    for (let zi = 0; zi < 8; zi++) {
      const wx = -half * 0.7 + (xi / 7) * size * 0.7;
      const wz = -half * 0.7 + (zi / 7) * size * 0.7;
      flightWaypoints.push({ x: wx, y: FLIGHT_HEIGHT, z: wz });
    }
  }

  console.log(`[flatnav] ${groundWaypoints.length} ground, ${flightWaypoints.length} flight waypoints`);
}

function _kmeansCluster(points, k) {
  if (points.length === 0) return [];
  if (points.length <= k)  return points;

  let centroids = [];
  for (let i = 0; i < k; i++) {
    centroids.push({ ...points[Math.floor(i * points.length / k)] });
  }

  for (let iter = 0; iter < 10; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    for (const p of points) {
      let best = 0, bestD = Infinity;
      for (let ci = 0; ci < k; ci++) {
        const dx = p.x - centroids[ci].x, dz = p.z - centroids[ci].z;
        const d = dx*dx + dz*dz;
        if (d < bestD) { bestD = d; best = ci; }
      }
      clusters[best].push(p);
    }
    for (let ci = 0; ci < k; ci++) {
      if (clusters[ci].length === 0) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const p of clusters[ci]) { sx += p.x; sy += p.y; sz += p.z; }
      centroids[ci] = {
        x: sx / clusters[ci].length,
        y: sy / clusters[ci].length,
        z: sz / clusters[ci].length,
      };
    }
  }
  return centroids;
}

/**
 * Get waypoints from the last scanFlatAreas() call.
 * @param {'ground'|'flight'} type
 * @returns {Array<{x:number, y:number, z:number}>}
 */
export function getWaypoints(type = 'ground') {
  return type === 'flight' ? flightWaypoints : groundWaypoints;
}

/** True if at least one scan has completed. */
export function waypointsReady() {
  return groundWaypoints.length > 0;
}
