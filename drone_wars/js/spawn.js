// ============================================================
//  spawn.js — Analyse terrain to find mountain peaks,
//             then drop the player onto a random one.
// ============================================================

import { scene }         from './core.js';
import { player, playerRig } from './player.js';

// ---- Tuning ----
const SCAN_STEPS        = 80;    // grid resolution per axis (80×80 = 6400 samples)
const PEAK_PERCENTILE   = 0.82;  // top 18% of elevation range qualifies as "high"
const CLUSTER_RADIUS    = 18;    // metres — samples within this radius share one peak
const MIN_PEAKS         = 3;     // if fewer clusters found, lower the threshold and retry
const DROP_HEIGHT_ABOVE = 10;    // metres above peak surface before freefall
const RAY_ORIGIN_Y      = 1000;
const RAY_LENGTH        = 2000;

/**
 * Scans the terrain meshes, finds distinct mountain peaks, and teleports the
 * player to a random one with DROP_HEIGHT_ABOVE metres of air beneath them.
 *
 * Call this after terrain GLBs have loaded and world matrices are ready.
 *
 * @param {BABYLON.AbstractMesh[]} terrainMeshes
 */
export function dropOnRandomPeak(terrainMeshes) {
  if (!terrainMeshes.length) return;

  // Compute terrain bounding box from all sub-meshes
  const bb = _terrainBounds(terrainMeshes);
  const bw = bb.max.x - bb.min.x;
  const bd = bb.max.z - bb.min.z;

  // ---- Pass 1: dense grid sample ----
  const samples = _sampleGrid(terrainMeshes, bb, bw, bd, SCAN_STEPS);
  if (!samples.length) {
    console.warn('[spawn] No terrain hits — cannot find peaks.');
    return;
  }

  // ---- Pass 2: elevation threshold ----
  const ys      = samples.map(s => s.y).sort((a, b) => a - b);
  const cutoff  = ys[Math.floor(ys.length * PEAK_PERCENTILE)];

  let highSamples = samples.filter(s => s.y >= cutoff);

  // Retry with lower threshold if we don't get enough candidates to cluster well
  if (highSamples.length < 6) {
    const fallback = ys[Math.floor(ys.length * 0.65)];
    highSamples    = samples.filter(s => s.y >= fallback);
  }

  // ---- Pass 3: greedy radius clustering → one representative point per peak ----
  const peaks = _clusterPeaks(highSamples, CLUSTER_RADIUS);

  if (!peaks.length) {
    console.warn('[spawn] Peak clustering returned nothing — spawning at world origin.');
    _teleportPlayer(0, 20, 0);
    return;
  }

  // ---- Pick a random peak and drop the player ----
  const peak = peaks[Math.floor(Math.random() * peaks.length)];
  const dropY = peak.y + DROP_HEIGHT_ABOVE;

  console.info(
    `[spawn] ${peaks.length} peaks found. Dropping on peak at`,
    `(${peak.x.toFixed(1)}, ${peak.y.toFixed(1)}, ${peak.z.toFixed(1)})`,
    `→ spawn Y ${dropY.toFixed(1)}`,
  );

  _teleportPlayer(peak.x, dropY, peak.z);
}

// ---- Private helpers ----

function _terrainBounds(meshes) {
  const min = new BABYLON.Vector3( Infinity,  Infinity,  Infinity);
  const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    const { minimumWorld, maximumWorld } = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(minimumWorld);
    max.maximizeInPlace(maximumWorld);
  }
  return { min, max };
}

function _sampleGrid(terrainMeshes, bb, bw, bd, steps) {
  const samples = [];
  const down    = new BABYLON.Vector3(0, -1, 0);
  const predicate = m => terrainMeshes.includes(m);

  for (let gx = 0; gx < steps; gx++) {
    for (let gz = 0; gz < steps; gz++) {
      // Slightly randomise sample within cell to avoid grid aliasing on ridgelines
      const jx = (Math.random() - 0.5) * (bw / steps) * 0.4;
      const jz = (Math.random() - 0.5) * (bd / steps) * 0.4;
      const x  = bb.min.x + ((gx + 0.5) / steps) * bw + jx;
      const z  = bb.min.z + ((gz + 0.5) / steps) * bd + jz;

      const origin = new BABYLON.Vector3(x, RAY_ORIGIN_Y, z);
      const ray    = new BABYLON.Ray(origin, down, RAY_LENGTH);
      const hit    = scene.pickWithRay(ray, predicate);

      if (hit?.hit && hit.pickedPoint) {
        samples.push({ x: hit.pickedPoint.x, y: hit.pickedPoint.y, z: hit.pickedPoint.z });
      }
    }
  }
  return samples;
}

/**
 * Greedy clustering: walk samples highest-first, start a new cluster for each
 * point that isn't already within CLUSTER_RADIUS of an existing cluster centre.
 * The cluster representative is the highest sample in that group.
 */
function _clusterPeaks(samples, radius) {
  // Sort descending by elevation so the first unmerged point is always a local peak
  const sorted  = [...samples].sort((a, b) => b.y - a.y);
  const r2      = radius * radius;
  const clusters = []; // { x, y, z } — the peak representative

  for (const s of sorted) {
    let absorbed = false;
    for (const c of clusters) {
      const dx = s.x - c.x, dz = s.z - c.z;
      if (dx * dx + dz * dz < r2) { absorbed = true; break; }
    }
    if (!absorbed) clusters.push({ x: s.x, y: s.y, z: s.z });
  }

  return clusters;
}

function _teleportPlayer(x, y, z) {
  // Move the Babylon rig immediately
  playerRig.position.set(x, y, z);

  // Snap Rapier body to the same position with zero velocity so it freefalls cleanly
  if (player.rigidBody) {
    player.rigidBody.setTranslation({ x, y, z }, true);
    player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    player.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}