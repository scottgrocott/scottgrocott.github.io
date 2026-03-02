// ============================================================
//  world.js — Shared world state store
//
//  Zero dependencies — safe to import from any module without
//  creating circular chains.
//
//  spawn.js  writes → terrainProfile after terrain scan
//  soundtrack.js reads ← terrainProfile each zone tick
// ============================================================

/**
 * Terrain profile populated by spawn.js after the terrain grid scan.
 * soundtrack.js reads this to determine zone thresholds.
 */
export const terrainProfile = {
  elevMin:          0,
  elevMax:          0,
  peakThreshold:    0,   // Y above which player is "on a peak"
  canyonThreshold:  0,   // Y below which player is "in a canyon"
  centre:           { x: 0, z: 0 },  // XZ centre of terrain (drone factory location)
  factoryRadius:    60,  // metres from centre before factory layer fades in
  ready:            false,
};