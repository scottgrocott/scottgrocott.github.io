/* ═══════════════════════════════════════════════════════════════════════════
   brush.js — Per-layer paint engine

   Each of the 10 MIDI channels gets a PaintLayer:
     • A 512×512 RGBA DataTexture (JS-writable, uploaded to GPU each frame)
     • Airbrush spray deposit (soft gaussian falloff, random scatter)
     • Dwell accumulation: after 5s at same spot, paint starts to run
     • Drip simulation: gravity drips run downward with variable viscosity
     • Sheen/matte: stored as alpha in A channel, read by layer shader
     • Per-layer settings: color, size, opacity, sheen, strength, enabled

   The DataTexture is exposed via getPaintTexture(ch) for layers.js to bind.
   tickBrush(dt, ch, cursorNorm, isActive) is called every animation frame.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';

/* ─── CONSTANTS ──────────────────────────────────────────────────────────── */
const TEX_SIZE    = 512;        // paint texture resolution per layer
const N           = TEX_SIZE;
const TOTAL_PX    = N * N;

// Drip trigger: seconds of dwell before paint starts running
const DRIP_DWELL_SECS  = 5.0;
// How often we run the drip simulation step
const DRIP_TICK_RATE   = 0.04;  // seconds between drip steps

/* ─── DEFAULT BRUSH SETTINGS PER LAYER ──────────────────────────────────── */
function defaultSettings(ch) {
  return {
    enabled:      true,
    color:        '#ffffff',  // overridden by toolpanel.js on first sync
    size:         40,
    opacity:      0.55,
    sheen:        0.7,
    strength:     0.6,
    viscosity:    0.55,
  };
}

/* ─── PER-LAYER PAINT STATE ──────────────────────────────────────────────── */
class PaintLayer {
  constructor(ch) {
    this.ch       = ch;
    this.settings = defaultSettings(ch);
    this.dirty    = false;

    // RGBA float32 buffer — R,G,B = paint color, A = paint amount * sheen flag
    this.data     = new Float32Array(TOTAL_PX * 4);

    // Separate thickness buffer: how much paint is at each pixel (0-1)
    // Used for drip simulation independent of color
    this.thickness = new Float32Array(TOTAL_PX);

    this.tex = new THREE.DataTexture(
      this.data,
      N, N,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.tex.minFilter   = THREE.LinearFilter;
    this.tex.magFilter   = THREE.LinearFilter;
    this.tex.wrapS       = THREE.ClampToEdgeWrapping;
    this.tex.wrapT       = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;  // must be true before shader compilation

    // Dwell tracking
    this.dwellPos   = null;  // { x, y } texture coords of dwell
    this.dwellSecs  = 0;
    this.dripTimer  = 0;

    // Active spray state
    this.spraying   = false;
  }

  /* ── Parse hex color → [r,g,b] 0-1 ── */
  get rgb() {
    const hex = this.settings.color.replace('#','');
    return [
      parseInt(hex.slice(0,2),16)/255,
      parseInt(hex.slice(2,4),16)/255,
      parseInt(hex.slice(4,6),16)/255,
    ];
  }

  /* ── Deposit airbrush spray at texture coords (tx,ty) ── */
  spray(tx, ty, dt) {
    const s      = this.settings;
    if (!s.enabled) return;

    const r      = Math.max(4, s.size);
    const amount = s.opacity * s.strength * Math.min(dt * 60, 2.5);
    const [pr, pg, pb] = this.rgb;
    const particles = Math.ceil(r * 1.2);  // scatter count scales with radius

    for (let i = 0; i < particles; i++) {
      // Gaussian-ish scatter: box-muller
      const u1 = Math.random(); const u2 = Math.random();
      const gx = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
      const gy = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.sin(2 * Math.PI * u2);

      const px = Math.round(tx + gx * r * 0.45);
      const py = Math.round(ty + gy * r * 0.45);

      if (px < 0 || px >= N || py < 0 || py >= N) continue;

      // Distance falloff from centre
      const dx   = px - tx;
      const dy   = py - ty;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const fall = Math.max(0, 1 - dist / r);
      const dep  = amount * fall * (0.3 + Math.random() * 0.7);

      const idx = (py * N + px) * 4;

      // Blend paint color into existing
      const existing = this.thickness[py * N + px];
      const blend    = Math.min(dep, 1 - existing) * 0.8 + dep * 0.2;

      this.data[idx    ] = this.data[idx    ] * existing + pr * blend;
      this.data[idx + 1] = this.data[idx + 1] * existing + pg * blend;
      this.data[idx + 2] = this.data[idx + 2] * existing + pb * blend;

      // A channel: thickness * sheen factor (shader uses this for specular + refraction)
      const newThick  = Math.min(1, existing + blend);
      this.thickness[py * N + px] = newThick;
      this.data[idx+3] = newThick * (0.4 + s.sheen * 0.6);

      this.dirty = true;
    }
  }

  /* ── Drip simulation step ── */
  stepDrips() {
    const viscosity = this.settings.viscosity;
    // Drip speed: low viscosity = fast, high = slow
    const flowRate  = (1.0 - viscosity) * 0.18 + 0.02;

    // Process bottom-to-top so drips don't double-move
    for (let y = N - 2; y >= 0; y--) {
      for (let x = 0; x < N; x++) {
        const idx  = (y * N + x) * 4;
        const t    = this.thickness[y * N + x];
        if (t < 0.05) continue;

        // Amount that flows down
        const flow = t * flowRate * (0.5 + Math.random() * 0.5);
        if (flow < 0.01) continue;

        const dy = y + 1;
        const didx = (dy * N + x) * 4;

        // Slight random spread: sometimes drip goes diagonally
        const spread = Math.random() < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        const dx2 = Math.max(0, Math.min(N-1, x + spread));
        const sidx = (dy * N + dx2) * 4;
        const targetIdx = spread !== 0 ? sidx : didx;
        const targetX   = spread !== 0 ? dx2 : x;

        // Move paint downward
        const srcT  = this.thickness[y * N + x];
        const dstT  = this.thickness[dy * N + targetX];

        this.data[targetIdx    ] = (this.data[targetIdx    ] * dstT + this.data[idx    ] * flow) / (dstT + flow + 1e-6);
        this.data[targetIdx + 1] = (this.data[targetIdx + 1] * dstT + this.data[idx + 1] * flow) / (dstT + flow + 1e-6);
        this.data[targetIdx + 2] = (this.data[targetIdx + 2] * dstT + this.data[idx + 2] * flow) / (dstT + flow + 1e-6);

        const newDst = Math.min(1, dstT + flow);
        this.thickness[dy * N + targetX] = newDst;
        this.data[targetIdx+3] = newDst * (0.4 + this.settings.sheen * 0.6);

        // Erode source
        const newSrc = Math.max(0, srcT - flow);
        this.thickness[y * N + x] = newSrc;
        this.data[idx+3] = newSrc * (0.4 + this.settings.sheen * 0.6);
        // If almost empty, clear color too
        if (newSrc < 0.01) {
          this.data[idx] = 0; this.data[idx+1] = 0; this.data[idx+2] = 0;
        }

        this.dirty = true;
      }
    }
  }

  /* ── Erase at texture coords (tx, ty) ── */
  erase(tx, ty, dt) {
    const r      = Math.max(8, this.settings.size * 1.5);
    const amount = 0.15 * Math.min(dt * 60, 2.5);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = tx + dx, py = ty + dy;
        if (px < 0 || px >= N || py < 0 || py >= N) continue;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > r) continue;
        const fall = (1 - dist / r) * amount;
        const idx  = (py * N + px) * 4;
        const cur  = this.thickness[py * N + px];
        const next = Math.max(0, cur - fall);
        this.thickness[py * N + px] = next;
        this.data[idx    ] *= next / (cur + 1e-6);
        this.data[idx + 1] *= next / (cur + 1e-6);
        this.data[idx + 2] *= next / (cur + 1e-6);
        this.data[idx + 3]  = next * (0.4 + this.settings.sheen * 0.6);
        if (next < 0.01) {
          this.data[idx] = this.data[idx+1] = this.data[idx+2] = this.data[idx+3] = 0;
          this.thickness[py * N + px] = 0;
        }
        this.dirty = true;
      }
    }
  }

  /* ── Main tick — isSpraying is already gated by gesture externally ── */
  tick(dt, cursorNorm, isSpraying) {
    this.dripTimer += dt;

    if (!isSpraying) {
      this.spraying  = false;
      this.dwellPos  = null;
      this.dwellSecs = 0;
    } else {
      // Convert normalised cursor to texture coords
      const tx = Math.floor(cursorNorm.x * N);
      const ty = Math.floor(cursorNorm.y * N);

      this.spray(tx, ty, dt);
      this.spraying = true;

      // Dwell accumulation for drip trigger
      if (this.dwellPos) {
        const dxp = Math.abs(tx - this.dwellPos.x);
        const dyp = Math.abs(ty - this.dwellPos.y);
        if (dxp < 20 && dyp < 20) {
          this.dwellSecs += dt;
        } else {
          this.dwellPos  = { x: tx, y: ty };
          this.dwellSecs = 0;
        }
      } else {
        this.dwellPos  = { x: tx, y: ty };
        this.dwellSecs = 0;
      }
    }

    // Run drip simulation if dwell threshold exceeded or paint is thick
    if (this.dripTimer >= DRIP_TICK_RATE) {
      this.dripTimer = 0;
      const hasDrip = this.dwellSecs >= DRIP_DWELL_SECS;
      if (hasDrip) this.stepDrips();
      // Passive slow drip for very thick paint even without dwell
      else {
        // Check if any pixel is near-saturated
        let hasThick = false;
        for (let i = 0; i < TOTAL_PX; i += 64) {
          if (this.thickness[i] > 0.88) { hasThick = true; break; }
        }
        if (hasThick) this.stepDrips();
      }
    }

    // Upload texture to GPU if data changed
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }

  clear() {
    this.data.fill(0);
    this.thickness.fill(0);
    this.dirty     = true;
    this.dwellPos  = null;
    this.dwellSecs = 0;
  }
}

/* ─── LAYER INSTANCES (one per MIDI channel 0-9) ────────────────────────── */
const paintLayers = [];
for (let ch = 0; ch < 10; ch++) {
  paintLayers[ch] = new PaintLayer(ch);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tick all active layers. cursorState = { x, y, active, layerIndex, gesture } */
export function tickBrushEngine(dt, cursorState) {
  for (let ch = 0; ch < 10; ch++) {
    const layer = paintLayers[ch];
    if (!layer) continue;
    const isThisLayer = cursorState.active && cursorState.layerIndex === ch;
    const gesture     = cursorState.gesture;

    // draw gesture → spray. erase gesture → erase. pointing/null → nothing.
    if (isThisLayer && gesture === 'erase') {
      layer.erase(
        Math.floor(cursorState.x * N),
        Math.floor(cursorState.y * N),
        dt
      );
    } else {
      const isDrawing = isThisLayer && gesture === 'draw';
      layer.tick(dt, { x: cursorState.x, y: cursorState.y }, isDrawing);
    }
  }
}

/** Get the THREE.DataTexture for a channel (bind into layer shader) */
export function getPaintTexture(ch) {
  return paintLayers[ch]?.tex ?? null;
}

/** Get/set brush settings for a channel */
export function getBrushSettings(ch) {
  return paintLayers[ch]?.settings ?? null;
}

export function setBrushSettings(ch, patch) {
  const layer = paintLayers[ch];
  if (!layer) return;
  Object.assign(layer.settings, patch);
}

/** Clear all paint on a channel */
export function clearPaint(ch) {
  paintLayers[ch]?.clear();
}

/** Get dwell progress 0-1 for UI feedback */
export function getDwellProgress(ch) {
  const layer = paintLayers[ch];
  if (!layer) return 0;
  return Math.min(1, layer.dwellSecs / DRIP_DWELL_SECS);
}