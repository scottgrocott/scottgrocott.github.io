// ============================================================
//  utils.js — Shared game utilities
// ============================================================

import { createShelter, spawnNextShelter } from './shelters.js';

// ============================================================
//  placeShelterAtPlayer
//
//  IMPORTANT: position is snapshotted at call time so the
//  player can step away during the countdown without moving
//  the spawn point.
// ============================================================

export function placeShelterAtPlayer(getPlayerPos, delayMs = 3000, onCountdown, onDone, designId) {
  // Snapshot NOW — freeze spawn point immediately.
  // Explicitly extract x/y/z so BabylonJS Vector3 prototype getters are read correctly.
  const _raw     = getPlayerPos();
  const spawnPos = { x: +_raw.x, y: +_raw.y, z: +_raw.z };
  const totalSecs = Math.ceil(delayMs / 1000);
  let   remaining = totalSecs;
  let   cancelled = false;

  onCountdown?.(remaining);

  const interval = setInterval(() => {
    if (cancelled) return;
    remaining--;
    onCountdown?.(remaining);
    if (remaining <= 0) {
      clearInterval(interval);
      if (spawnPos) {
        createShelter(spawnPos, designId || 'basic');
        onDone?.();
      }
    }
  }, 1000);

  return () => { cancelled = true; clearInterval(interval); };
}

// ============================================================
//  World position helpers
// ============================================================

export function getPlayerWorldPos(playerRigidBody) {
  try {
    const t = playerRigidBody.translation();
    return { x: t.x, y: t.y, z: t.z };
  } catch (_) {
    return null;
  }
}

export function formatPos(pos) {
  if (!pos) return 'unknown';
  return `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
}

export function shelterToJSON(pos, label = '') {
  return JSON.stringify({
    type: 'shelter', label,
    position: {
      x: parseFloat(pos.x.toFixed(3)),
      y: parseFloat(pos.y.toFixed(3)),
      z: parseFloat(pos.z.toFixed(3)),
    },
  }, null, 2);
}