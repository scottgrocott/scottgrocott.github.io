import * as THREE from 'three';
import {
  Fn, uniform, texture, uv, time,
  vec2, vec3, vec4, float,
  sin, cos, floor, fract, abs, mix,
  step, pow, clamp, max, min
} from 'three/tsl';
import { scene, camera } from './scene.js';
import { detectChord } from './theory.js';

/* ═══════════════════════════════════════════════════════════════
   CANVAS TEXT RESOLUTION
   ═══════════════════════════════════════════════════════════════ */
const TEX_W = 2048;
const TEX_H = 512;

/* ═══════════════════════════════════════════════════════════════
   LAYER CONFIG
   index 0 = bottom/deepest/largest (drums)
   index 9 = top/smallest (lead)
   ═══════════════════════════════════════════════════════════════ */
export const LAYER_CONFIG = [
  { ch:9,  label:'Drums',   color:'#111111', fontSize:420, zPos:-4.0, opacity:0.92, shader:'staticNoise' },
  { ch:8,  label:'Perc',    color:'#5c2e0e', fontSize:380, zPos:-3.5, opacity:0.88, shader:'embers'      },
  { ch:7,  label:'FX',      color:'#1a6b3a', fontSize:340, zPos:-3.0, opacity:0.88, shader:'matrixRain'  },
  { ch:6,  label:'Brass',   color:'#cc5500', fontSize:300, zPos:-2.5, opacity:0.88, shader:'heatDistort' },
  { ch:5,  label:'Pad',     color:'#a0522d', fontSize:260, zPos:-2.0, opacity:0.85, shader:'slowWave'    },
  { ch:4,  label:'Arp',     color:'#44dd88', fontSize:220, zPos:-1.5, opacity:0.90, shader:'glitch'      },
  { ch:3,  label:'Chords',  color:'#4488ff', fontSize:185, zPos:-1.0, opacity:0.92, shader:'scanlines'   },
  { ch:2,  label:'Bass',    color:'#ffd700', fontSize:150, zPos:-0.5, opacity:0.92, shader:'warpedGlow'  },
  { ch:1,  label:'Strings', color:'#ff8c00', fontSize:115, zPos: 0.0, opacity:0.95, shader:'chromaShift' },
  { ch:0,  label:'Lead',    color:'#ffffff', fontSize: 80, zPos: 0.5, opacity:1.00, shader:'clean'       },
];

/* ═══════════════════════════════════════════════════════════════
   TSL SHADER BUILDERS
   Key insight for r171: use texture(tex, uvNode) — pass modified
   UV as second arg. Do NOT call .sample() on a node variable inside Fn.
   Each builder receives the raw THREE.CanvasTexture and opacityU uniform
   and returns a fragmentNode (vec4 color node).
   ═══════════════════════════════════════════════════════════════ */

function shaderClean(canvasTex, opacityU) {
  return Fn(() => {
    const s = texture(canvasTex, uv());
    return vec4(s.rgb, s.a.mul(opacityU));
  })();
}

function shaderChromaShift(canvasTex, opacityU) {
  return Fn(() => {
    const shift   = sin(time.mul(0.7)).mul(0.013);
    const uvBase  = uv();
    const uvR     = vec2(uvBase.x.add(shift), uvBase.y);
    const uvB     = vec2(uvBase.x.sub(shift), uvBase.y);
    const r       = texture(canvasTex, uvR).r;
    const g       = texture(canvasTex, uvBase).g;
    const b       = texture(canvasTex, uvB).b;
    const a       = texture(canvasTex, uvBase).a;
    return vec4(r, g, b, a.mul(opacityU));
  })();
}

function shaderWarpedGlow(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const warp   = sin(uvBase.x.mul(9.0).add(time.mul(2.2))).mul(0.009);
    const uvW    = vec2(uvBase.x, uvBase.y.add(warp));
    const s      = texture(canvasTex, uvW);
    const glow   = pow(s.a, float(0.45));
    const col    = vec3(1.0, 0.82, 0.08).mul(glow.mul(0.5).add(0.5));
    return vec4(col, s.a.mul(opacityU));
  })();
}

function shaderScanlines(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const s      = texture(canvasTex, uvBase);
    const scan   = sin(uvBase.y.mul(700.0)).mul(0.5).add(0.5).mul(0.28).add(0.72);
    return vec4(s.rgb.mul(scan), s.a.mul(opacityU));
  })();
}

function shaderGlitch(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const band   = floor(uvBase.y.mul(20.0)).div(20.0);
    const n      = fract(sin(band.mul(127.1).add(time.mul(4.0))).mul(43758.5));
    const thr    = float(0.85);
    const shift  = step(thr, n).mul(n.sub(thr).mul(0.22));
    const uvG    = vec2(fract(uvBase.x.add(shift)), uvBase.y);
    const s      = texture(canvasTex, uvG);
    const isBand = step(thr, n);
    const tint   = mix(vec3(1.0), vec3(0.15, 1.0, 0.55), isBand);
    return vec4(s.rgb.mul(tint), s.a.mul(opacityU));
  })();
}

function shaderSlowWave(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const wave   = sin(uvBase.x.mul(3.14159).add(time.mul(0.5))).mul(0.016);
    const uvW    = vec2(uvBase.x, uvBase.y.add(wave));
    const s      = texture(canvasTex, uvW);
    const warm   = vec3(1.0, 0.68, 0.38);
    return vec4(s.rgb.mul(warm), s.a.mul(opacityU));
  })();
}

function shaderHeatDistort(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const hx     = sin(uvBase.y.mul(20.0).add(time.mul(5.0))).mul(0.008);
    const hy     = cos(uvBase.x.mul(14.0).add(time.mul(3.8))).mul(0.005);
    const uvH    = vec2(uvBase.x.add(hx), uvBase.y.add(hy));
    const s      = texture(canvasTex, uvH);
    const hot    = mix(s.rgb, vec3(1.0, 0.32, 0.0), float(0.35));
    return vec4(hot, s.a.mul(opacityU));
  })();
}

function shaderMatrixRain(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const col    = floor(uvBase.x.mul(36.0));
    const speed  = fract(sin(col.mul(91.3)).mul(4375.0)).mul(2.0).add(0.5);
    const rain   = fract(uvBase.y.add(time.mul(speed)));
    const bright = pow(float(1.0).sub(rain), float(5.0));
    const s      = texture(canvasTex, uvBase);
    const green  = vec3(0.05, bright, 0.15);
    return vec4(mix(s.rgb, green, bright.mul(0.75)), s.a.mul(opacityU));
  })();
}

function shaderEmbers(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const t      = time.mul(1.8);
    const nx     = fract(
      sin(uvBase.x.mul(127.1).add(uvBase.y.mul(311.7)).add(t)).mul(43758.5)
    );
    const spark  = pow(max(float(0.0), nx.sub(float(0.80))), float(3.0)).mul(10.0);
    const s      = texture(canvasTex, uvBase);
    const coal   = mix(s.rgb, vec3(1.0, 0.38, 0.04), spark.mul(s.a));
    return vec4(coal, s.a.mul(opacityU));
  })();
}

function shaderStaticNoise(canvasTex, opacityU) {
  return Fn(() => {
    const uvBase = uv();
    const t      = floor(time.mul(24.0));
    const n      = fract(
      sin(uvBase.x.mul(127.1).add(uvBase.y.mul(311.7)).add(t.mul(74.2))).mul(43758.5453)
    );
    const s      = texture(canvasTex, uvBase);
    const stat   = mix(float(0.08), float(1.0), n);
    return vec4(vec3(stat), s.a.mul(opacityU));
  })();
}

const SHADER_MAP = {
  clean:       shaderClean,
  chromaShift: shaderChromaShift,
  warpedGlow:  shaderWarpedGlow,
  scanlines:   shaderScanlines,
  glitch:      shaderGlitch,
  slowWave:    shaderSlowWave,
  heatDistort: shaderHeatDistort,
  matrixRain:  shaderMatrixRain,
  embers:      shaderEmbers,
  staticNoise: shaderStaticNoise,
};

/* ═══════════════════════════════════════════════════════════════
   PLANE SIZE HELPER
   ═══════════════════════════════════════════════════════════════ */
function planeSize(zPos) {
  const dist = camera.position.z - zPos;
  const h    = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist;
  return { w: h * camera.aspect, h };
}

/* ═══════════════════════════════════════════════════════════════
   RUNTIME LAYER STORE
   layers[chIndex] = { mesh, canvasTex, canvas, ctx, opacityU, cfg }
   ═══════════════════════════════════════════════════════════════ */
const layers = [];

/* ═══════════════════════════════════════════════════════════════
   BUILD — call after renderer.init() resolves
   ═══════════════════════════════════════════════════════════════ */
export function buildLayers() {
  LAYER_CONFIG.forEach((cfg, renderIdx) => {
    /* offscreen canvas for text */
    const canvas = document.createElement('canvas');
    canvas.width  = TEX_W;
    canvas.height = TEX_H;
    const ctx = canvas.getContext('2d');

    /* canvas texture — passed directly to texture() in TSL */
    const canvasTex = new THREE.CanvasTexture(canvas);
    canvasTex.colorSpace = THREE.SRGBColorSpace;

    /* opacity uniform */
    const opacityU = uniform(float(0.0));

    /* build TSL fragment node */
    const builderFn  = SHADER_MAP[cfg.shader] ?? shaderClean;
    const fragmentNode = builderFn(canvasTex, opacityU);

    /* NodeMaterial */
    const mat = new THREE.NodeMaterial();
    mat.transparent  = true;
    mat.depthWrite   = false;
    mat.fragmentNode = fragmentNode;

    /* mesh */
    const { w, h } = planeSize(cfg.zPos);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.z  = cfg.zPos;
    mesh.renderOrder = renderIdx;
    scene.add(mesh);

    layers[cfg.ch] = { mesh, mat, canvasTex, canvas, ctx, opacityU, cfg };
  });
}

/* ─── RESIZE ────────────────────────────────────────────────── */
window.addEventListener('resize', () => {
  layers.forEach(layer => {
    if (!layer) return;
    const { w, h } = planeSize(layer.cfg.zPos);
    layer.mesh.geometry.dispose();
    layer.mesh.geometry = new THREE.PlaneGeometry(w, h);
  });
});

/* ═══════════════════════════════════════════════════════════════
   RENDER TEXT → CANVAS TEXTURE
   ═══════════════════════════════════════════════════════════════ */
function renderText(layer, label) {
  const { canvas, ctx, cfg } = layer;
  ctx.clearRect(0, 0, TEX_W, TEX_H);

  if (!label) {
    layer.canvasTex.needsUpdate = true;
    return;
  }

  let fs = cfg.fontSize;
  ctx.font = `${fs}px 'Bebas Neue', sans-serif`;
  while (ctx.measureText(label).width > TEX_W * 0.94 && fs > 16) {
    fs -= 4;
    ctx.font = `${fs}px 'Bebas Neue', sans-serif`;
  }

  ctx.fillStyle    = cfg.color;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, TEX_W / 2, TEX_H / 2);
  layer.canvasTex.needsUpdate = true;
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════ */
export function updateLayer(chIndex, activeKeysForChannel) {
  const layer = layers[chIndex];
  if (!layer) return;

  const midiNums = activeKeysForChannel.map(k => parseInt(k.split(':')[1], 10));

  if (!midiNums.length) {
    layer.opacityU.value = 0.0;
    renderText(layer, '');
    return;
  }

  renderText(layer, detectChord(midiNums));
  layer.opacityU.value = layer.cfg.opacity;
}

export function clearAllLayers() {
  layers.forEach(layer => {
    if (!layer) return;
    layer.opacityU.value = 0.0;
    renderText(layer, '');
  });
}

export function getActiveSummary() {
  const active = LAYER_CONFIG.filter(cfg => (layers[cfg.ch]?.opacityU.value ?? 0) > 0);
  return active.length ? active.map(c => c.label).join(' · ') : 'Play a note or chord';
}