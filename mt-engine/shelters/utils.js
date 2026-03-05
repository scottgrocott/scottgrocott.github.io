// shelters/utils.js — position snapshot, formatting

import { playerRig } from '../player.js';

// Capture spawn point at button-press time — player moving during countdown does not change it
export function capturePlayerPosition() {
  if (!playerRig) return { x: 0, y: 0, z: 0 };
  const pos = playerRig.position;
  return { x: +pos.x, y: +pos.y, z: +pos.z }; // explicit extraction, not spread
}

export function formatPos(pos) {
  return `(${(+pos.x).toFixed(1)}, ${(+pos.y).toFixed(1)}, ${(+pos.z).toFixed(1)})`;
}
