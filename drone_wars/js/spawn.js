// ============================================================
//  spawn.js — Analyse terrain, find mountain peaks,
//             drop the player onto a random one.
// ============================================================

import { scene }             from './core.js';
import { player, playerRig } from './player.js';
import { terrainProfile }    from './world.js';

// ---- Tuning ----
const SCAN_STEPS        = 80;
const PEAK_PERCENTILE   = 0.82;
const CLUSTER_RADIUS    = 18;
const DROP_HEIGHT_ABOVE = 10;
const RAY_ORIGIN_Y      = 1000;
const RAY_LENGTH        = 2000;

/**
 * Terrain profile — populated by dropOnRandomPeak(), read by soundtrack.js.
 *   elevMin / elevMax     full Y range of terrain surface
 *   peakThreshold         Y above which player is "on a peak"
 *   canyonThreshold       Y below which player is "in a canyon"
 *   centre                XZ midpoint of terrain (drone factory)
 *   factoryRadius         metres from centre where factory music fades in
 */

export function dropOnRandomPeak(terrainMeshes) {
  if (!terrainMeshes.length) return;

  const bb      = _terrainBounds(terrainMeshes);
  const bw      = bb.max.x - bb.min.x;
  const bd      = bb.max.z - bb.min.z;
  const samples = _sampleGrid(terrainMeshes, bb, bw, bd, SCAN_STEPS);

  if (!samples.length) {
    console.warn('[spawn] No terrain hits — cannot find peaks.');
    return;
  }

  const ys = samples.map(s => s.y).sort((a, b) => a - b);

  // Populate terrain profile for soundtrack.js
  terrainProfile.elevMin         = ys[0];
  terrainProfile.elevMax         = ys[ys.length - 1];
  terrainProfile.peakThreshold   = ys[Math.floor(ys.length * PEAK_PERCENTILE)];
  terrainProfile.canyonThreshold = ys[Math.floor(ys.length * 0.25)];   // bottom quartile
  terrainProfile.centre          = { x: (bb.min.x + bb.max.x) / 2, z: (bb.min.z + bb.max.z) / 2 };
  terrainProfile.ready           = true;

  console.info(
    `[spawn] Terrain profile: elev ${terrainProfile.elevMin.toFixed(1)}–${terrainProfile.elevMax.toFixed(1)}`,
    `| peak >${terrainProfile.peakThreshold.toFixed(1)}`,
    `| canyon <${terrainProfile.canyonThreshold.toFixed(1)}`,
    `| centre (${terrainProfile.centre.x.toFixed(1)}, ${terrainProfile.centre.z.toFixed(1)})`,
  );

  // Elevation cutoff with fallback
  let highSamples = samples.filter(s => s.y >= terrainProfile.peakThreshold);
  if (highSamples.length < 6) {
    highSamples = samples.filter(s => s.y >= ys[Math.floor(ys.length * 0.65)]);
  }

  const peaks = _clusterPeaks(highSamples, CLUSTER_RADIUS);
  if (!peaks.length) {
    console.warn('[spawn] No peaks clustered — spawning at origin.');
    _teleportPlayer(0, 20, 0);
    return;
  }

  const peak = peaks[Math.floor(Math.random() * peaks.length)];
  console.info(`[spawn] ${peaks.length} peaks. Dropping at (${peak.x.toFixed(1)}, ${peak.y.toFixed(1)}, ${peak.z.toFixed(1)})`);
  _teleportPlayer(peak.x, peak.y + DROP_HEIGHT_ABOVE, peak.z);
}

// ---- Private ----

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
  const samples   = [];
  const down      = new BABYLON.Vector3(0, -1, 0);
  const predicate = m => terrainMeshes.includes(m);

  for (let gx = 0; gx < steps; gx++) {
    for (let gz = 0; gz < steps; gz++) {
      const jx = (Math.random() - 0.5) * (bw / steps) * 0.4;
      const jz = (Math.random() - 0.5) * (bd / steps) * 0.4;
      const x  = bb.min.x + ((gx + 0.5) / steps) * bw + jx;
      const z  = bb.min.z + ((gz + 0.5) / steps) * bd + jz;
      const ray = new BABYLON.Ray(new BABYLON.Vector3(x, RAY_ORIGIN_Y, z), down, RAY_LENGTH);
      const hit = scene.pickWithRay(ray, predicate);
      if (hit?.hit && hit.pickedPoint) {
        samples.push({ x: hit.pickedPoint.x, y: hit.pickedPoint.y, z: hit.pickedPoint.z });
      }
    }
  }
  return samples;
}

function _clusterPeaks(samples, radius) {
  const sorted   = [...samples].sort((a, b) => b.y - a.y);
  const r2       = radius * radius;
  const clusters = [];
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
  playerRig.position.set(x, y, z);
  if (player.rigidBody) {
    player.rigidBody.setTranslation({ x, y, z }, true);
    player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    player.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}