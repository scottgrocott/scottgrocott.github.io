// config.js — runtime config store, populated from JSON each load

export let CONFIG = {
  meta: { id: 'test', title: 'Test / Sandbox', description: 'Sandbox' },
  terrain: {
    type: 'flat', size: 700, heightmap: null,
    heightScale: 80, groundTexture: null, shaderLayers: []
  },
  enemies: [],
  weapons: [{ id: 'basic_gun', module: './weapons/basicGun.js', bulletSpeed: 60, bulletRadius: 0.12, range: 200, hitsToKill: 10 }],
  shelters: [], structures: [], scatterLayers: [], ladders: [], waypoints: [], assets: [],
  audio: {
    outerZone: { radius: 280, track: 'wind' },
    midZone:   { radius: 150, track: 'adventure' },
    innerZone: { radius: 60,  track: 'battle' }
  }
};

export const PLAYER = {
  walkSpeed: 12,
  runSpeed: 20,
  jumpImpulse: 8,
  height: 1.8,
  radius: 0.35,
  mass: 75,
  freeFlyCamSpeed: 20,
};

export const LADDERS = {
  climbSpeed: 4,
  detachThreshold: 0.4,
};

export function setConfig(newConfig) {
  // Deep merge new config over defaults
  CONFIG = Object.assign({}, CONFIG, newConfig);
  // Ensure nested objects exist
  CONFIG.terrain  = Object.assign({ type:'flat', size:700, heightmap:null, heightScale:80, groundTexture:null, shaderLayers:[] }, newConfig.terrain || {});
  CONFIG.audio    = Object.assign({ outerZone:{radius:280,track:'wind'}, midZone:{radius:150,track:'adventure'}, innerZone:{radius:60,track:'battle'} }, newConfig.audio || {});
  CONFIG.enemies  = newConfig.enemies  || [];
  CONFIG.weapons  = newConfig.weapons  || CONFIG.weapons;
  CONFIG.shelters = newConfig.shelters || [];
  CONFIG.structures  = newConfig.structures  || [];
  CONFIG.scatterLayers = newConfig.scatterLayers || [];
  CONFIG.ladders  = newConfig.ladders  || [];
  CONFIG.waypoints = newConfig.waypoints || [];
  CONFIG.assets   = newConfig.assets   || [];
}

export function getConfig() { return CONFIG; }
