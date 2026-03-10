// minimap.js — canvas minimap: terrain heightmap, player + enemy dots

import { playerRig } from './player.js';
import { getEnemies } from './enemies/enemyRegistry.js';
import { CONFIG }    from './config.js';
import { getTerrainHeightAt } from './terrain/terrainMesh.js';
import { euler }      from './look.js';

const SIZE = 110;
const canvas = document.getElementById('minimap-canvas');
const ctx    = canvas.getContext('2d');

let _staticCache = null;
let _terrainSize = 700;
let _lastBandsRef = null;  // detect when terrain bands change so we rebuild

export function initMinimap(bounds) {
  _terrainSize = (bounds && bounds.size) || CONFIG.terrain.size || 700;
  _buildStaticCache();
}

// Sample the terrain band palette at absolute height h
// Mirrors the same blend logic as _stampVertexColors in terrainMesh.js
function _paletteAt(h, bands, hScale) {
  if (!bands || bands.length === 0) {
    // Legacy fallback gradient
    const t = Math.min(h / (hScale || 80), 1);
    if (t < 0.3) {
      return [20 + t/0.3*30, 60 + t/0.3*40, 20 + t/0.3*10];
    } else if (t < 0.6) {
      const s = (t-0.3)/0.3;
      return [50 + s*110, 100 + s*60, 30 + s*60];
    } else {
      const s = (t-0.6)/0.4;
      return [160 + s*95, 160 + s*95, 90 + s*165];
    }
  }

  // Find blend between two adjacent bands (same as _stampVertexColors)
  let r = bands[0].r, g = bands[0].g, b = bands[0].b;
  for (let i = 0; i < bands.length - 1; i++) {
    const b0 = bands[i], b1 = bands[i + 1];
    if (h >= b0.threshold && h <= b1.threshold) {
      const span = b1.threshold - b0.threshold;
      const f = span > 0 ? (h - b0.threshold) / span : 0;
      r = b0.r + (b1.r - b0.r) * f;
      g = b0.g + (b1.g - b0.g) * f;
      b = b0.b + (b1.b - b0.b) * f;
      break;
    }
    if (h > b1.threshold) { r = b1.r; g = b1.g; b = b1.b; }
  }
  return [r * 255, g * 255, b * 255];
}

function _buildStaticCache() {
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = SIZE;
  const octx = offscreen.getContext('2d');

  const img    = octx.createImageData(SIZE, SIZE);
  const half   = _terrainSize / 2;
  const tb     = window._currentTerrainBands || {};
  const bands  = tb.bands  || [];
  const hScale = tb.hScale || CONFIG.terrain?.heightScale || 80;

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const wx = (px / SIZE) * _terrainSize - half;
      const wz = ((SIZE - py) / SIZE) * _terrainSize - half;   // flipped to match worldToMap
      const h  = getTerrainHeightAt(wx, wz);
      const [r, g, b] = _paletteAt(h, bands, hScale);

      const i = (py * SIZE + px) * 4;
      img.data[i]   = r;
      img.data[i+1] = g;
      img.data[i+2] = b;
      img.data[i+3] = 220;
    }
  }
  octx.putImageData(img, 0, 0);

  // Draw water plane overlay using getTerrainHeightAt (same function as the rest of minimap)
  const waterY = (window._CONFIG_water_y != null) ? window._CONFIG_water_y : null;
  if (waterY !== null) {
    octx.globalAlpha = 0.55;
    octx.fillStyle = '#2a6fa8';
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const wx = (px / SIZE) * _terrainSize - half;
        const wz = ((SIZE - py) / SIZE) * _terrainSize - half;   // flipped to match worldToMap
        if (getTerrainHeightAt(wx, wz) < waterY) {
          octx.fillRect(px, py, 1, 1);
        }
      }
    }
    octx.globalAlpha = 1.0;
  }

  _staticCache = offscreen;
}

let _pulse = 0;
export function tickMinimap() {
  if (!playerRig) return;
  _pulse += 0.08;

  // Rebuild terrain cache if bands just became available (terrain finished loading)
  const currentBands = window._currentTerrainBands;
  if (currentBands && currentBands !== _lastBandsRef) {
    _lastBandsRef = currentBands;
    _buildStaticCache();
  }

  ctx.clearRect(0, 0, SIZE, SIZE);

  // Draw static terrain
  if (_staticCache) ctx.drawImage(_staticCache, 0, 0);

  const half = _terrainSize / 2;

  // World → minimap pixel
  // X is flipped (SIZE - ...) to match the camera's view orientation —
  // BabylonJS +X is world-right but appears as left from the default camera perspective.
  function worldToMap(wx, wz) {
    return {
      x: ((wx + half) / _terrainSize) * SIZE,
      y: SIZE - ((wz + half) / _terrainSize) * SIZE,   // flip Z so north=up
    };
  }

  // Enemy dots
  for (const e of getEnemies()) {
    if (e.dead || !e.mesh) continue;
    const ep = e.mesh.position;
    const mp = worldToMap(ep.x, ep.z);
    ctx.beginPath();
    ctx.arc(mp.x, mp.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = e.type === 'drone' ? '#ff4444' : e.type === 'car' ? '#4488ff' : '#ffcc00';
    ctx.fill();
    // Direction tick
    ctx.beginPath();
    ctx.moveTo(mp.x, mp.y);
    ctx.lineTo(mp.x + Math.sin(e.mesh.rotation.y) * 6, mp.y + Math.cos(e.mesh.rotation.y) * 6);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Player dot (pulsing cyan)
  const pp = worldToMap(playerRig.position.x, playerRig.position.z);
  const r  = 4 + Math.sin(_pulse) * 1.5;
  ctx.beginPath();
  ctx.arc(pp.x, pp.y, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(100,255,220,${0.7 + Math.sin(_pulse)*0.3})`;
  ctx.fill();

  // Player direction
  ctx.beginPath();
  ctx.moveTo(pp.x, pp.y);
  ctx.lineTo(pp.x + Math.sin(euler.y)*9, pp.y - Math.cos(euler.y)*9);  // negate Y to match flipped Z axis
  ctx.strokeStyle = '#aaffee';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Border
  ctx.strokeStyle = '#2a4a2a';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, SIZE, SIZE);
}