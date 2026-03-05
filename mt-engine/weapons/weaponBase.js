// weapons/weaponBase.js — shared weapon base

export function createWeaponBase(def) {
  return {
    id:         def.id || 'weapon',
    bulletSpeed: def.bulletSpeed || 60,
    bulletRadius: def.bulletRadius || 0.12,
    range:      def.range || 200,
    hitsToKill: def.hitsToKill || 10,
    ammo:       Infinity,
    cooldown:   0,
    cooldownMax: 0.12, // seconds between shots
  };
}
