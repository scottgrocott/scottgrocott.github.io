// enemies/enemyRegistry.js
// Central registry of all live enemy instances.
// Import this anywhere you need to read or iterate enemies (HUD, minimap, etc.)
// enemyBase.js registers/unregisters automatically.
//
// Usage:
//   import { getEnemies, getEnemyCount } from './enemies/enemyRegistry.js';
//   const all = getEnemies();          // EnemyBase[]
//   const alive = getEnemyCount();     // number of non-dead enemies

const _enemies = new Set();

/** Register a new enemy (called from EnemyBase constructor) */
export function registerEnemy(e)   { _enemies.add(e); }

/** Unregister an enemy (called from EnemyBase.dispose) */
export function unregisterEnemy(e) { _enemies.delete(e); }

/** All enemies (alive + dead/respawning) */
export function getEnemies()       { return [..._enemies]; }

/** Count of currently alive enemies */
export function getEnemyCount()    { return [..._enemies].filter(e => !e.dead).length; }

/** Remove all enemies — call this during config switch / level reload */
export function clearEnemies() {
  for (const e of _enemies) {
    try { e.dispose(); } catch (_) {}
  }
  _enemies.clear();
}

/**
 * Apply damage to an enemy and trigger its death/respawn cycle.
 * @param {EnemyBase} enemy
 * @param {number} [damage]  – defaults to one-shot if omitted
 */
export function hitEnemy(enemy, damage) {
  if (!enemy || enemy.dead) return;
  enemy.takeDamage(damage ?? enemy.maxHealth);
}