// spawn.js — drop player on a suitable start location

import { playerRig, player } from './player.js';
import { getHeightAt } from './terrain/heightmap.js';
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
  const y    = getHeightAt(0, 0) + 3;
  const safe = safeVec3(0, y, 0, 'dropOnFlat');
  if (!safe) return;
  _teleport(safe.x, safe.y, safe.z);
}

function _dropOnRandomPeak() {
  if (!playerRig) return;
  const size = CONFIG.terrain.size || 700;
  let bestX = 0, bestZ = 0, bestH = 0;
  for (let i = 0; i < 50; i++) {
    const tx = (Math.random() - 0.5) * size * 0.6;
    const tz = (Math.random() - 0.5) * size * 0.6;
    const h  = getHeightAt(tx, tz);
    if (h > bestH) { bestH = h; bestX = tx; bestZ = tz; }
  }
  const y    = bestH + 3;
  const safe = safeVec3(bestX, y, bestZ, 'dropOnPeak');
  if (!safe) return;
  _teleport(safe.x, safe.y, safe.z);
}

function _teleport(x, y, z) {
  playerRig.position.set(x, y, z);

  // Sync the physics capsule mesh and zero velocity
  if (player._capsuleMesh) {
    player._capsuleMesh.position.set(x, y, z);
  }
  const body = player.aggregate?.body;
  if (body) {
    body.setLinearVelocity(BABYLON.Vector3.Zero());
    body.setAngularVelocity(BABYLON.Vector3.Zero());
    // Teleport the physics body to the new position
    player._capsuleMesh.position.set(x, y, z);
    body.disablePreStep = false;   // force Havok to re-read the transform node
  }
}