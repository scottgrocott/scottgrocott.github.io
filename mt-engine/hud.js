// hud.js — DOM HUD overlay

import { player, playerRig } from './player.js';
import { getEnemyCount } from './enemies/enemyRegistry.js';

const elHealth  = document.getElementById('hud-health');
const elAmmo    = document.getElementById('hud-ammo');
const elEnemies = document.getElementById('hud-enemies');
const elPos     = document.getElementById('hud-pos');
const elStatus  = document.getElementById('hud-status');

let _statusTimeout = null;

export function hudSetStatus(msg, ms = 2500) {
  elStatus.textContent = msg;
  clearTimeout(_statusTimeout);
  _statusTimeout = setTimeout(() => { elStatus.textContent = ''; }, ms);
}

export function tickHUD() {
  if (!playerRig) return;

  // Health
  const hp = Math.max(0, Math.round(player.health));
  elHealth.textContent = hp;
  elHealth.style.color = hp > 50 ? '#8aee8a' : hp > 25 ? '#eebb44' : '#ee4444';

  // Enemy count
  elEnemies.textContent = getEnemyCount();

  // Position
  const p = playerRig.position;
  elPos.textContent = `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`;
}

export function hudSetAmmo(val) {
  elAmmo.textContent = val === Infinity ? '∞' : val;
}