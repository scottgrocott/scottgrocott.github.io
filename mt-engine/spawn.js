// spawn.js — drop player on a suitable start location

import { playerRig, player } from './player.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { CONFIG } from './config.js';
import { safeVec3 } from './physics.js';

export function dropOnStart() {
  const type = CONFIG.terrain.type || 'flat';
  if (type === 'flat') {
    _dropOnFlat();
  } else {
    _dropOnRandomPeak();
  }
}

function _dropOnFlat() {
  if (!playerRig) return;
  const y = getTerrainHeightAt(0, 0) + 3;
  const safe = safeVec3(0, y, 0, 'dropOnFlat');
  if (!safe) return;
  playerRig.position.set(safe.x, safe.y, safe.z);
  if (player.rigidBody) {
    player.rigidBody.setTranslation(safe, true);
    player.rigidBody.setLinvel({x:0,y:0,z:0}, true);
  }
}

function _dropOnRandomPeak() {
  if (!playerRig) return;
  const size = CONFIG.terrain.size || 700;
  let bestX = 0, bestZ = 0, bestH = 0;
  for (let i = 0; i < 50; i++) {
    const tx = (Math.random() - 0.5) * size * 0.6;
    const tz = (Math.random() - 0.5) * size * 0.6;
    const h  = getTerrainHeightAt(tx, tz);
    if (h > bestH) { bestH = h; bestX = tx; bestZ = tz; }
  }
  const y = bestH + 3;
  const safe = safeVec3(bestX, y, bestZ, 'dropOnPeak');
  if (!safe) return;
  playerRig.position.set(safe.x, safe.y, safe.z);
  if (player.rigidBody) {
    player.rigidBody.setTranslation(safe, true);
    player.rigidBody.setLinvel({x:0,y:0,z:0}, true);
  }
}