// ============================================================
//  utils.js — Shared game utilities
//
//  Hooks into shelters.js and exposes helpers used by editor.js
// ============================================================

import { createShelter } from './shelters.js';

// ---- Shelter placement ----

/**
 * Place a shelter at the player's current position after a
 * countdown delay so the player can step aside.
 *
 * @param {Function} getPlayerPos   — returns { x, y, z }
 * @param {number}   delayMs        — milliseconds to wait (default 3000)
 * @param {Function} onCountdown    — optional cb(secondsLeft) for UI feedback
 * @param {Function} onDone         — optional cb() when shelter is placed
 */
export function placeShelterAtPlayer(getPlayerPos, delayMs = 3000, onCountdown, onDone) {
  const totalSeconds = Math.ceil(delayMs / 1000);
  let   remaining    = totalSeconds;

  // Snapshot position NOW — before the player moves away
  const spawnPos = getPlayerPos();

  onCountdown?.(remaining);

  const interval = setInterval(() => {
    remaining--;
    onCountdown?.(remaining);
    if (remaining <= 0) {
      clearInterval(interval);
      if (spawnPos) {
        createShelter(spawnPos);
        onDone?.();
      }
    }
  }, 1000);

  return () => clearInterval(interval);
}

// ---- World position helpers ----

/**
 * Returns the player's current world position from a Rapier rigid body.
 * @param {*} playerRigidBody
 * @returns {{ x, y, z } | null}
 */
export function getPlayerWorldPos(playerRigidBody) {
  try {
    const t = playerRigidBody.translation();
    return { x: t.x, y: t.y, z: t.z };
  } catch (_) {
    return null;
  }
}

/**
 * Format a world position as a compact string for display / export.
 * @param {{ x, y, z }} pos
 * @returns {string}
 */
export function formatPos(pos) {
  if (!pos) return 'unknown';
  return `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
}

/**
 * Generate a JSON snippet for a shelter definition at a given position.
 * Paste this into your scene JSON to make shelters persistent.
 */
export function shelterToJSON(pos, label = '') {
  return JSON.stringify({
    type: 'shelter',
    label,
    position: {
      x: parseFloat(pos.x.toFixed(3)),
      y: parseFloat(pos.y.toFixed(3)),
      z: parseFloat(pos.z.toFixed(3)),
    },
  }, null, 2);
}