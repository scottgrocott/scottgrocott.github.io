// ============================================================
//  minimap.js — Canvas minimap: terrain heightmap, player, drones
//
//  Coordinate convention (matches Babylon world space):
//    +X → right on map
//    +Z → DOWN on map  (Babylon Z increases "into" the world)
//  Both the terrain image pixels AND the dot positions use the
//  same _worldToMap() function so they are always aligned.
// ============================================================

// ---- Config ----
const MAP_SIZE     = 220;
const PADDING      = 10;
const MARGIN       = 16;
const PLAYER_R     = 5;
const DRONE_R      = 4;
const PULSE_PERIOD = 1400;
const TERRAIN_RES  = 80;   // grid samples per axis for the heightmap image

// ---- Elevation colour stops (normalised 0–1 elevation) ----
const ELEV_STOPS = [
  { t: 0.00, r:  22, g:  36, b:  18 },
  { t: 0.28, r:  55, g:  80, b:  38 },
  { t: 0.52, r: 105, g:  98, b:  62 },
  { t: 0.76, r: 152, g: 140, b: 100 },
  { t: 1.00, r: 205, g: 200, b: 190 },
];

// ---- Module state ----
let _canvas           = null;
let _ctx              = null;
let _bounds           = null;   // { minX, maxX, minZ, maxZ, minY, maxY }
let _terrainSnapshot  = null;   // ImageData — cached after one-time render
let _ready            = false;

// ============================================================
//  Public API
// ============================================================

export function initMinimap(bounds, terrainMeshes) {
  _bounds = bounds;
  _buildDOM();
  _renderTerrain(terrainMeshes);
  _ready = true;
  console.info(
    `[minimap] Init — X[${bounds.minX.toFixed(0)}→${bounds.maxX.toFixed(0)}]`,
    `Z[${bounds.minZ.toFixed(0)}→${bounds.maxZ.toFixed(0)}]`,
    `Y[${bounds.minY.toFixed(0)}→${bounds.maxY.toFixed(0)}]`,
  );
}

export function tickMinimap(playerPos, drones) {
  if (!_ready || !_ctx) return;
  _drawFrame(playerPos, drones);
}

// ============================================================
//  Coordinate mapping  — SINGLE SOURCE OF TRUTH
//  All callers (terrain image + dot draw) use these two fns.
// ============================================================

function _wx(worldX) {
  return PADDING + (worldX - _bounds.minX) / (_bounds.maxX - _bounds.minX)
         * (MAP_SIZE - PADDING * 2);
}

function _wz(worldZ) {
  // +Z in Babylon goes "south" — map that to down on screen (increasing canvas Y)
  return PADDING + (worldZ - _bounds.minZ) / (_bounds.maxZ - _bounds.minZ)
         * (MAP_SIZE - PADDING * 2);
}

// ============================================================
//  DOM
// ============================================================

function _buildDOM() {
  if (!document.getElementById('_mm_style')) {
    const s = document.createElement('style');
    s.id = '_mm_style';
    s.textContent = `
      #minimap-wrap {
        position: fixed; bottom: ${MARGIN}px; right: ${MARGIN}px;
        z-index: 8000; pointer-events: none; user-select: none;
      }
      #minimap-wrap canvas {
        display: block; border-radius: 5px;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 4px 20px rgba(0,0,0,0.7);
      }
      #minimap-legend {
        display: flex; justify-content: flex-end; gap: 10px;
        margin-top: 5px;
        font: 600 9px/1 'Courier New', monospace;
        letter-spacing: 0.08em; text-transform: uppercase;
      }
      .mm-item { display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.65); }
      .mm-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    `;
    document.head.appendChild(s);
  }

  const wrap = document.createElement('div');
  wrap.id = 'minimap-wrap';

  _canvas        = document.createElement('canvas');
  _canvas.width  = MAP_SIZE;
  _canvas.height = MAP_SIZE;
  _ctx           = _canvas.getContext('2d');

  const legend = document.createElement('div');
  legend.id = 'minimap-legend';
  legend.innerHTML = `
    <div class="mm-item">
      <div class="mm-dot" style="background:#00e5ff;box-shadow:0 0 5px #00e5ff"></div>
      <span>You</span>
    </div>
    <div class="mm-item">
      <div class="mm-dot" style="background:#ff3300;box-shadow:0 0 5px #ff3300"></div>
      <span>Drone</span>
    </div>
  `;

  wrap.appendChild(_canvas);
  wrap.appendChild(legend);
  document.body.appendChild(wrap);
}

// ============================================================
//  One-time terrain heightmap render
// ============================================================

function _renderTerrain(terrainMeshes) {
  const imgData = _ctx.createImageData(MAP_SIZE, MAP_SIZE);

  // Default fill — dark out-of-bounds colour
  for (let i = 0; i < imgData.data.length; i += 4) {
    imgData.data[i]     = 14;
    imgData.data[i + 1] = 18;
    imgData.data[i + 2] = 10;
    imgData.data[i + 3] = 200;
  }

  if (terrainMeshes && terrainMeshes.length) {
    const scene    = terrainMeshes[0].getScene();
    const rayDir   = new BABYLON.Vector3(0, -1, 0);
    const pred     = m => terrainMeshes.includes(m);
    const elevRange = (_bounds.maxY - _bounds.minY) || 1;

    for (let sx = 0; sx < TERRAIN_RES; sx++) {
      for (let sz = 0; sz < TERRAIN_RES; sz++) {
        // World position for this sample
        const wx = _bounds.minX + (sx / (TERRAIN_RES - 1)) * (_bounds.maxX - _bounds.minX);
        const wz = _bounds.minZ + (sz / (TERRAIN_RES - 1)) * (_bounds.maxZ - _bounds.minZ);

        const hit = scene.pickWithRay(
          new BABYLON.Ray(new BABYLON.Vector3(wx, 650, wz), rayDir, 700),
          pred,
        );
        if (!hit?.hit) continue;

        const elev = Math.max(0, Math.min(1, (hit.pickedPoint.y - _bounds.minY) / elevRange));
        const col  = _elevColor(elev);

        // Map the world sample position to canvas pixels using the SAME functions
        // used for dots — guarantees pixel-perfect alignment.
        const cx = Math.round(_wx(wx));
        const cz = Math.round(_wz(wz));

        // Paint a small block so adjacent samples don't leave gaps
        const bSize = Math.ceil(MAP_SIZE / TERRAIN_RES) + 1;
        for (let bx = 0; bx < bSize; bx++) {
          for (let bz = 0; bz < bSize; bz++) {
            const px = cx + bx - 1;
            const pz = cz + bz - 1;
            if (px < 0 || pz < 0 || px >= MAP_SIZE || pz >= MAP_SIZE) continue;
            const idx = (pz * MAP_SIZE + px) * 4;
            imgData.data[idx]     = col.r;
            imgData.data[idx + 1] = col.g;
            imgData.data[idx + 2] = col.b;
            imgData.data[idx + 3] = 215;
          }
        }
      }
    }
  }

  _ctx.putImageData(imgData, 0, 0);

  // Subtle vignette
  const vg = _ctx.createRadialGradient(
    MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.28,
    MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.72,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  _ctx.fillStyle = vg;
  _ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  _terrainSnapshot = _ctx.getImageData(0, 0, MAP_SIZE, MAP_SIZE);
}

// ============================================================
//  Per-frame draw
// ============================================================

function _drawFrame(playerPos, drones) {
  if (_terrainSnapshot) {
    _ctx.putImageData(_terrainSnapshot, 0, 0);
  } else {
    _ctx.fillStyle = '#0e1209';
    _ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  }

  // Thin border
  _ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  _ctx.lineWidth = 1;
  _ctx.strokeRect(0.5, 0.5, MAP_SIZE - 1, MAP_SIZE - 1);

  // ---- Drones ----
  for (const drone of drones) {
    if (!drone.group) continue;
    const p  = drone.group.position;
    const mx = _wx(p.x);
    const mz = _wz(p.z);

    _ctx.save();
    _ctx.globalAlpha = drone.dead ? 0.3 : 1.0;

    // Glow
    const g = _ctx.createRadialGradient(mx, mz, 0, mx, mz, DRONE_R * 2.8);
    g.addColorStop(0, 'rgba(255,60,0,0.55)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    _ctx.fillStyle = g;
    _ctx.beginPath();
    _ctx.arc(mx, mz, DRONE_R * 2.8, 0, Math.PI * 2);
    _ctx.fill();

    // Dot
    _ctx.fillStyle = drone.dead ? '#663322' : '#ff3300';
    _ctx.beginPath();
    _ctx.arc(mx, mz, DRONE_R, 0, Math.PI * 2);
    _ctx.fill();

    // Facing direction tick
    if (!drone.dead && drone.group.rotationQuaternion) {
      const q   = drone.group.rotationQuaternion;
      const yaw = Math.atan2(
        2 * (q.w * q.y + q.x * q.z),
        1 - 2 * (q.y * q.y + q.z * q.z),
      );
      _ctx.strokeStyle = 'rgba(255,140,100,0.9)';
      _ctx.lineWidth   = 1.5;
      _ctx.beginPath();
      _ctx.moveTo(mx, mz);
      _ctx.lineTo(mx + Math.sin(yaw) * (DRONE_R + 6), mz + Math.cos(yaw) * (DRONE_R + 6));
      _ctx.stroke();
    }

    _ctx.restore();
  }

  // ---- Player ----
  if (playerPos) {
    const mx    = _wx(playerPos.x);
    const mz    = _wz(playerPos.z);
    const phase = (Date.now() % PULSE_PERIOD) / PULSE_PERIOD;
    const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);

    // Pulse ring
    _ctx.save();
    _ctx.globalAlpha = pulse * 0.45;
    const pg = _ctx.createRadialGradient(mx, mz, 0, mx, mz, PLAYER_R * 3.5);
    pg.addColorStop(0, 'rgba(0,229,255,0.9)');
    pg.addColorStop(1, 'rgba(0,229,255,0)');
    _ctx.fillStyle = pg;
    _ctx.beginPath();
    _ctx.arc(mx, mz, PLAYER_R * 3.5, 0, Math.PI * 2);
    _ctx.fill();
    _ctx.restore();

    // Dot
    _ctx.fillStyle   = '#00e5ff';
    _ctx.shadowColor = '#00e5ff';
    _ctx.shadowBlur  = 7;
    _ctx.beginPath();
    _ctx.arc(mx, mz, PLAYER_R, 0, Math.PI * 2);
    _ctx.fill();
    _ctx.shadowBlur = 0;
  }
}

// ============================================================
//  Helpers
// ============================================================

function _elevColor(t) {
  let lo = ELEV_STOPS[0], hi = ELEV_STOPS[ELEV_STOPS.length - 1];
  for (let i = 0; i < ELEV_STOPS.length - 1; i++) {
    if (t >= ELEV_STOPS[i].t && t <= ELEV_STOPS[i + 1].t) {
      lo = ELEV_STOPS[i]; hi = ELEV_STOPS[i + 1]; break;
    }
  }
  const f = lo.t === hi.t ? 0 : (t - lo.t) / (hi.t - lo.t);
  return {
    r: Math.round(lo.r + (hi.r - lo.r) * f),
    g: Math.round(lo.g + (hi.g - lo.g) * f),
    b: Math.round(lo.b + (hi.b - lo.b) * f),
  };
}