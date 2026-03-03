// ============================================================
//  config.js — Game-wide constants and tuning values
// ============================================================

export const SCENE_JSON  = '/drone_wars/drone_wars_assets_dev.json';
export const GROUND_TEX  = 'https://scottgrocott.github.io/metal_throne/assets/img/gpt_ground.png';
export const LADDER_TEX  = 'https://scottgrocott.github.io/metal_throne/assets/img/ladder.png';

export const CONFIG = {
  launchPoint:       { x: -13, y: 2, z: 2.8 },
  droneRiseHeight:   200,
  droneMaxSpeed:     10,
  dronePathRadius:   4.0,
  droneFlightHeight: 2.5,
  freeFlyCamSpeed:   20,

  // ---- First-drone sky patrol --------------------------------
  // Drone #1 rises to this height and orbits the launch point
  // before descending to join the normal ground patrol.
  skyPatrolHeight:   40,    // metres above world origin
  skyPatrolRadius:   30,    // orbit radius around launch point
  skyPatrolSpeed:    20,   // radians per second (orbit angular velocity)
  skyPatrolLaps:     2,     // full 360° orbits before joining ground patrol

  // ---- Investigation -----------------------------------------
  // Speed at which a respawned drone flies to the last explosion site.
  // Set higher than droneMaxSpeed for a sense of urgency.
  investigateSpeed:  8,

  sheetGrids: {
    sheet_rocks:  { cols: 4, rows: 2 },
    sheet_veg:    { cols: 4, rows: 2 },
    sheet_veg01:  { cols: 4, rows: 2 },
    sheet_map:    { cols: 4, rows: 4 },
    sheet_map01:  { cols: 4, rows: 2 },
    sheet_map02:  { cols: 4, rows: 4 },
  },

  scatter: {
    vegSampleCount:      30000,
    vegSteepDensity:     0.9,
    vegFlatDensity:      0.35,
    vegSize:             { w: 0.6, h: 0.9 },
    sampleCount:         6000,
    flatRockDensity:     0.10,
    flatStumpDensity:    0.06,
    flatBoxDensity:      0.02,
    buildingRingRadius:  10,
    buildingRingDensity: 0.7,
    flatThreshold:       0.85,
    steepThreshold:      0.45,
    elevationSplit:      2,
    rockSize:            { w: 2.0, h: 1.8 },
    stumpSize:           { w: 1.5, h: 2.0 },
    boxSize:             { w: 4.0, h: 5.0 },
  },

  gunRange:        200,
  gunPower:        8,
  bulletSpeed:     60,
  bulletRadius:    0.12,
  bulletLife:      3.0,
  hitsToDetonate:  10,
};

export const PLAYER = {
  height:     1.6,
  radius:     0.4,
  mass:       80,
  jumpForce:  1000,
  moveSpeed:  5000,
  maxVelocity: 5,
  duckHeight: 0.9,
};

export const LADDERS = [
  { position: [-5,         0,          0       ], height:  5, width: 0.5, climbSpeed: 3 },
  { position: [ 0,        -0.60296,   -9.54734 ], height: 10, width: 1,   climbSpeed: 7 },
  { position: [-11.44083,  0,          1.05525 ], height:  8, width: 1,   climbSpeed: 7 },
  { position: [-0.83595,   0,         38.20815 ], height: 10, width: 1,   climbSpeed: 7 },
];