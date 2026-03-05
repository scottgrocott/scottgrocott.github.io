// minimap.js — canvas minimap: terrain heightmap, player + enemy dots

import { playerRig }   from './player.js';
import { getEnemies }  from './enemies/enemyRegistry.js';
import { CONFIG }      from './config.js';
import { heightGrid }  from './terrain/heightmap.js';
import { euler }       from './look.js';

const SIZE = 220;
const canvas = document.getElementById('minimap-canvas');
const ctx    = canvas.getContext('2d');

let _staticCache = null;
let _terrainSize = 700;

export function initMinimap(bounds) {
  _terrainSize = (bounds && bounds.size) || CONFIG.terrain.size || 700;
  _buildStaticCache();
}

function _buildStaticCache() {
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = SIZE;
  const octx = offscreen.getContext('2d');

  const img = octx.createImageData(SIZE, SIZE);
  const N = Math.sqrt(heightGrid ? heightGrid.length : 0);

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let h = 0;
      if (heightGrid && N > 0) {
        const gx = Math.floor(px / SIZE * N);
        const gz = Math.floor(py / SIZE * N);
        h = heightGrid[gz * N + gx] || 0;
      }

      const t = Math.min(h / 80, 1);
      let r, g, b;
      if (t < 0.3) {
        r = 20  + t/0.3 * 30;
        g = 60  + t/0.3 * 40;
        b = 20  + t/0.3 * 10;
      } else if (t < 0.6) {
        const s = (t-0.3)/0.3;
        r = 50  + s * 110;
        g = 100 + s * 60;
        b = 30  + s * 60;
      } else {
        const s = (t-0.6)/0.4;
        r = 160 + s * 95;
        g = 160 + s * 95;
        b = 90  + s * 165;
      }
      const i = (py * SIZE + px) * 4;
      img.data[i]   = r;
      img.data[i+1] = g;
      img.data[i+2] = b;
      img.data[i+3] = 220;
    }
  }
  octx.putImageData(img, 0, 0);
  _staticCache = offscreen;
}

let _pulse = 0;
export function tickMinimap() {
  if (!playerRig) return;
  _pulse += 0.08;

  ctx.clearRect(0, 0, SIZE, SIZE);

  if (_staticCache) ctx.drawImage(_staticCache, 0, 0);

  const half = _terrainSize / 2;

  function worldToMap(wx, wz) {
    return {
      x: ((wx + half) / _terrainSize) * SIZE,
      y: ((wz + half) / _terrainSize) * SIZE,
    };
  }

  // Enemy dots — use e.mesh (not e.group which no longer exists)
  for (const e of getEnemies()) {
    if (e.dead || !e.mesh) continue;
    const ep = e.mesh.position;
    const mp = worldToMap(ep.x, ep.z);

    const dotColor = e.type === 'drone' ? '#ff4444'
                   : e.type === 'car'   ? '#4488ff'
                   : '#ffcc00';

    ctx.beginPath();
    ctx.arc(mp.x, mp.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Direction tick — use mesh rotation (Babylon sets this from YUKA heading)
    const ry = e.mesh.rotation?.y ?? 0;
    ctx.beginPath();
    ctx.moveTo(mp.x, mp.y);
    ctx.lineTo(mp.x + Math.sin(ry) * 6, mp.y + Math.cos(ry) * 6);
    ctx.strokeStyle = dotColor;
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
  ctx.lineTo(pp.x + Math.sin(euler.y)*9, pp.y + Math.cos(euler.y)*9);
  ctx.strokeStyle = '#aaffee';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Border
  ctx.strokeStyle = '#2a4a2a';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, SIZE, SIZE);
}