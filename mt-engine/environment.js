// environment.js
// Loads environment data (colors, sprites, sounds) from mt-assets.
// Each level specifies an env_id; this module fetches and caches the full definition.

const ENVIRONMENTS_URL = 'https://scottgrocott.github.io/mt-assets/terrain/environments/environments.json';

let _envData = null;
let _envId   = null;

export async function loadEnvironment(envId) {
  if (!envId) { _envData = null; _envId = null; return null; }
  if (_envId === envId && _envData) return _envData;

  try {
    const indexResp = await fetch(ENVIRONMENTS_URL);
    const index = await indexResp.json();
    const def = index.environments.find(e => e.env_id === envId);
    if (!def) {
      console.warn('[env] Unknown environment id:', envId);
      return null;
    }

    const [colorsResp, spritesResp, soundsResp] = await Promise.all([
      fetch(def.assets.colors),
      fetch(def.assets.sprites),
      fetch(def.assets.sounds).catch(() => ({ json: async () => ({}) })),
    ]);
    const [colors, sprites, sounds] = await Promise.all([
      colorsResp.json(),
      spritesResp.json(),
      soundsResp.json(),
    ]);

    _envData = { id: envId, name: def.name, colors, sprites, sounds };
    _envId = envId;
    window._currentEnvColors = (colors && colors.colors) ? colors.colors : null;

    // Expose node material configs for terrain shader
    const assets = def.assets || {};
    window._currentEnvNodeMats = {
      rocks: assets.node_mat_rocks || null,
      dirt:  assets.node_mat_dirt  || null,
    };

    const sheetCount = (sprites && sprites.spriteSheets) ? sprites.spriteSheets.length : 0;
    const colorCount = window._currentEnvColors ? Object.keys(window._currentEnvColors).length : 0;
    console.log('[env] Loaded environment:', def.name, '| sheets:', sheetCount, '| colors:', colorCount,
      '| node mats:', Object.keys(window._currentEnvNodeMats).filter(k => window._currentEnvNodeMats[k]).join(', ') || 'none');
    return _envData;
  } catch(e) {
    console.error('[env] Failed to load environment:', envId, e);
    return null;
  }
}

export function getEnvironment() {
  return _envData;
}

export function getAllSpriteFrames() {
  if (!_envData || !_envData.sprites || !_envData.sprites.spriteSheets) return [];
  const out = [];
  for (const sheet of _envData.sprites.spriteSheets) {
    if (!sheet.frames || sheet.frames.length === 0) continue;
    const sheetW = sheet.columns * sheet.cellWidth;
    const sheetH = sheet.rows * sheet.cellHeight;

    let sheetCat = sheet.category || null;
    if (!sheetCat && sheet.url) {
      if (/cact|palm|tree|bush|plant|veg/i.test(sheet.url)) sheetCat = 'vegetation';
      else if (/rock|stone|boulder/i.test(sheet.url)) sheetCat = 'rock';
    }
    if (!sheetCat) sheetCat = 'vegetation';

    for (const frame of sheet.frames) {
      out.push({
        sheetUrl: sheet.url,
        frame,
        cellW:    sheet.cellWidth,
        cellH:    sheet.cellHeight,
        sheetW,
        sheetH,
        category: frame.category || sheetCat,
      });
    }
  }
  return out;
}

export function getRandomEnvColor() {
  const palette = _envData && _envData.colors && _envData.colors.colors;
  if (!palette) return new BABYLON.Color3(0.4, 0.55, 0.3);
  const values = Object.values(palette);
  const hex = values[Math.floor(Math.random() * values.length)];
  return BABYLON.Color3.FromHexString(hex);
}

export function getEnvColor(name) {
  const colors = _envData && _envData.colors && _envData.colors.colors;
  const hex = colors && colors[name];
  if (!hex) return new BABYLON.Color3(0.5, 0.5, 0.5);
  return BABYLON.Color3.FromHexString(hex);
}