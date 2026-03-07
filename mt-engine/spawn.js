// spawn.js — drop player on a suitable start location

import { initPlayerBody } from './player.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { CONFIG, PLAYER } from './config.js';
import { safeVec3 } from './physics.js';

export function dropOnStart() {
  // Always drop at flat centre for heightmap terrain
  // Find a low flat spot near centre
  const size = (CONFIG.terrain?.size || 700) * 0.25;
  let bestX = 0, bestZ = 0, bestScore = Infinity;

  for (let i = 0; i < 60; i++) {
    const tx = (Math.random() - 0.5) * size;
    const tz = (Math.random() - 0.5) * size;
    const h  = getTerrainHeightAt(tx, tz);
    const d  = 4;
    const slope = Math.abs(getTerrainHeightAt(tx, tz+d) - getTerrainHeightAt(tx, tz-d))
                + Math.abs(getTerrainHeightAt(tx+d, tz) - getTerrainHeightAt(tx-d, tz));
    const score = slope * 3 + h * 0.2;
    if (score < bestScore) { bestScore = score; bestX = tx; bestZ = tz; }
  }

  const groundY = getTerrainHeightAt(bestX, bestZ);
  const spawnY  = groundY + PLAYER.height + 2.0;
  const pos     = safeVec3(bestX, spawnY, bestZ, 'dropOnStart');
  if (!pos) return;

  console.log('[spawn] Dropping player at', bestX.toFixed(1), spawnY.toFixed(1), bestZ.toFixed(1), '| ground:', groundY.toFixed(1));
  initPlayerBody(pos.x, pos.y, pos.z);
}
