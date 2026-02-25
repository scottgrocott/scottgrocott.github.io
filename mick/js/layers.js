import * as THREE from 'three';
import {
  Fn, uniform, uv, time,
  vec2, vec3, vec4, float,
  sin, cos, floor, fract, abs, mix,
  step, pow, clamp, max, min, atan2, sqrt
} from 'three/tsl';
import { scene, camera } from './scene.js';

const PI  = float(Math.PI);
const TAU = float(Math.PI * 2);

/* ═══════════════════════════════════════════════════════════════
   LAYER CONFIG
   ═══════════════════════════════════════════════════════════════ */
export const LAYER_CONFIG = [
  { ch:9,  label:'Drums',   color:'#111111', zPos:-4.0, opacity:0.92, shader:'staticNoise', modeN:1, modeM:2 },
  { ch:8,  label:'Perc',    color:'#5c2e0e', zPos:-3.5, opacity:0.88, shader:'embers',      modeN:2, modeM:3 },
  { ch:7,  label:'FX',      color:'#1a6b3a', zPos:-3.0, opacity:0.88, shader:'matrixRain',  modeN:3, modeM:4 },
  { ch:6,  label:'Brass',   color:'#cc5500', zPos:-2.5, opacity:0.88, shader:'heatDistort', modeN:2, modeM:5 },
  { ch:5,  label:'Pad',     color:'#a0522d', zPos:-2.0, opacity:0.85, shader:'slowWave',    modeN:3, modeM:5 },
  { ch:4,  label:'Arp',     color:'#44dd88', zPos:-1.5, opacity:0.90, shader:'glitch',      modeN:4, modeM:5 },
  { ch:3,  label:'Chords',  color:'#4488ff', zPos:-1.0, opacity:0.92, shader:'scanlines',   modeN:3, modeM:7 },
  { ch:2,  label:'Bass',    color:'#ffd700', zPos:-0.5, opacity:0.92, shader:'warpedGlow',  modeN:1, modeM:3 },
  { ch:1,  label:'Strings', color:'#ff8c00', zPos: 0.0, opacity:0.95, shader:'chromaShift', modeN:4, modeM:7 },
  { ch:0,  label:'Lead',    color:'#ffffff', zPos: 0.5, opacity:1.00, shader:'clean',       modeN:5, modeM:8 },
];

export const GEO_ALGORITHMS = [
  { id: 'chladni',      label: 'Chladni Figures'   },
  { id: 'lissajous',    label: 'Lissajous Curves'  },
  { id: 'cymatics',     label: 'Cymatics / Radial' },
  { id: 'interference', label: 'Wave Interference' },
  { id: 'harmonograph', label: 'Harmonograph'      },
  { id: 'rose',         label: 'Rose Curves'       },
  { id: 'fourier',      label: 'Fourier Epicycles' },
  { id: 'orbits',       label: 'Orbital Resonance' },
];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ═══════════════════════════════════════════════════════════════
   TSL HELPERS
   ═══════════════════════════════════════════════════════════════ */
function smoothstepNode(edge0, edge1, x) {
  const t = clamp(x.sub(edge0).div(edge1.sub(edge0)), float(0.0), float(1.0));
  return t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
}
function lineMask(field, width) {
  return float(1.0).sub(smoothstepNode(float(0.0), width, abs(field)));
}

/* ═══════════════════════════════════════════════════════════════
   GEOMETRY FIELD FUNCTIONS
   Each returns scalar [0,1].
   ampU drives lineWidth so louder = thicker lines.
   ═══════════════════════════════════════════════════════════════ */

function geoChladni(cx, cy, nU, mU, lwU) {
  const piN = PI.mul(nU);
  const piM = PI.mul(mU);
  const f   = cos(piN.mul(cx)).mul(cos(piM.mul(cy)))
               .sub(cos(piM.mul(cx)).mul(cos(piN.mul(cy))));
  return lineMask(f, lwU);
}

function geoLissajous(cx, cy, nU, mU, lwU, tAnim) {
  const sx    = clamp(cx.mul(0.7), float(-0.95), float(0.95));
  const sy    = clamp(cy.mul(0.7), float(-0.95), float(0.95));
  const phase = tAnim.mul(0.3);
  const asinA = (v) => v.add(v.mul(v).mul(v).mul(float(0.1667)))
                         .add(v.mul(v).mul(v).mul(v).mul(v).mul(float(0.075)));
  const f = sin(nU.mul(asinA(sx)).mul(PI))
             .sub(sin(mU.mul(asinA(sy)).mul(PI).add(phase)));
  return lineMask(f, lwU.mul(1.4));
}

function geoCymatics(cx, cy, nU, mU, lwU, freqU) {
  const r      = sqrt(cx.mul(cx).add(cy.mul(cy)));
  const theta  = atan2(cy, cx);
  const k      = freqU.mul(0.04);
  const f      = sin(r.mul(k)).mul(sin(theta.mul(nU)));
  return lineMask(f, lwU.mul(0.8));
}

function geoInterference(cx, cy, nU, mU, lwU, freqU) {
  const d  = float(0.5);
  const r1 = sqrt(cx.sub(d).mul(cx.sub(d)).add(cy.mul(cy)));
  const r2 = sqrt(cx.add(d).mul(cx.add(d)).add(cy.mul(cy)));
  const k  = freqU.mul(0.05);
  return lineMask(cos(r1.mul(k)).add(cos(r2.mul(k))), lwU.mul(1.2));
}

function geoHarmonograph(cx, cy, nU, mU, lwU, tAnim) {
  const r      = sqrt(cx.mul(cx).add(cy.mul(cy)));
  const theta  = atan2(cy, cx);
  const spiral = float(2.5);
  const f1 = sin(nU.mul(theta.add(r.mul(spiral))).add(tAnim.mul(0.2)));
  const f2 = sin(mU.mul(theta.sub(r.mul(spiral))).sub(tAnim.mul(0.15)));
  return lineMask(f1.mul(f2), lwU.mul(0.7));
}

function geoRose(cx, cy, nU, mU, lwU) {
  const r     = sqrt(cx.mul(cx).add(cy.mul(cy)));
  const theta = atan2(cy, cx);
  const rRose = abs(cos(theta.mul(nU.div(mU))));
  return lineMask(r.sub(rRose.mul(float(0.9))), lwU.mul(1.5));
}

function geoFourier(cx, cy, nU, mU, lwU, tAnim) {
  const r     = sqrt(cx.mul(cx).add(cy.mul(cy)));
  const theta = atan2(cy, cx);
  const f1 = sin(nU.mul(float(0.5)).mul(r.mul(float(6.28)).sub(theta)).add(tAnim.mul(0.4)));
  const f2 = sin(mU.mul(float(0.5)).mul(r.mul(float(4.0)).add(theta.mul(float(2.0)))).sub(tAnim.mul(0.3)));
  return lineMask(f1.add(f2).mul(float(0.5)), lwU);
}

function geoOrbits(cx, cy, nU, mU, lwU) {
  const r      = sqrt(cx.mul(cx).add(cy.mul(cy)));
  const theta  = atan2(cy, cx);
  const e      = float(0.5);
  const rOrbit = float(0.75).mul(float(1.0).sub(e.mul(e)))
                   .div(float(1.0).add(e.mul(cos(theta.mul(nU.div(mU))))));
  const shells = sin(r.mul(PI).mul(mU));
  return lineMask(r.sub(rOrbit).mul(float(0.7)).add(shells.mul(float(0.3))), lwU.mul(1.3));
}

/* ═══════════════════════════════════════════════════════════════
   MASTER GEOMETRY SELECTOR
   ampU widens the line as amplitude rises (louder = thicker).
   ═══════════════════════════════════════════════════════════════ */
function makeGeoField(freqU, nU, mU, lwU, algU, ampU) {
  return Fn(() => {
    const uvp   = uv();
    const scale = freqU.mul(0.018);
    const cx    = uvp.x.mul(2.0).sub(1.0).mul(scale);
    const cy    = uvp.y.mul(2.0).sub(1.0).mul(scale);
    const tA    = time;

    // Amplitude widens lines: louder = fatter nodal bands
    const lw = lwU.add(ampU.mul(float(0.10)));

    const g0 = geoChladni    (cx, cy, nU, mU, lw);
    const g1 = geoLissajous  (cx, cy, nU, mU, lw, tA);
    const g2 = geoCymatics   (cx, cy, nU, mU, lw, freqU);
    const g3 = geoInterference(cx, cy, nU, mU, lw, freqU);
    const g4 = geoHarmonograph(cx, cy, nU, mU, lw, tA);
    const g5 = geoRose       (cx, cy, nU, mU, lw);
    const g6 = geoFourier    (cx, cy, nU, mU, lw, tA);
    const g7 = geoOrbits     (cx, cy, nU, mU, lw);

    const s = (i) => clamp(algU.sub(float(i - 0.5)).mul(float(100.0)), float(0.0), float(1.0));
    return mix(mix(mix(mix(mix(mix(mix(g0,g1,s(1)),g2,s(2)),g3,s(3)),g4,s(4)),g5,s(5)),g6,s(6)),g7,s(7));
  })();
}

/* ═══════════════════════════════════════════════════════════════
   SHADER BUILDERS
   Each shader now receives all 4 audio uniforms:
     ampU        [0,1] RMS level
     attackU     [0,1] ADSR envelope position
     brightnessU [0,1] spectral centroid
     onsetU      [0,1] attack transient spike
   and uses them in ways appropriate to each visual personality.
   ═══════════════════════════════════════════════════════════════ */

/* CLEAN — Lead
   amp: overall brightness pulse
   attack: scale breathes with envelope
   brightness: cold→warm colour shift
   onset: white flash burst on attack */
function shaderClean(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const sand  = makeGeoField(freqU, nU, mU, lwU, algU, ampU);
    // Brightness shifts color temperature: col → warm white
    const warm  = mix(col, vec3(1.0, 0.95, 0.8), brightnessU.mul(0.4));
    // Onset: flash the whole layer white briefly
    const flash = mix(warm, vec3(1.0, 1.0, 1.0), onsetU.mul(0.7));
    // Attack: envelope drives glow halo around lines
    const glow  = sand.add(pow(sand, float(3.0)).mul(attackU.mul(0.6)));
    return vec4(flash, clamp(glow, float(0.0), float(1.0)).mul(opacityU));
  })();
}

/* CHROMA SHIFT — Strings
   amp: chroma split width scales with amplitude
   attack: envelope fades in the split
   brightness: hue rotation between R and B channels
   onset: hard cut to full separation on attack */
function shaderChromaShift(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    // amp + onset both widen the chroma split
    const splitAmt = ampU.mul(0.02).add(onsetU.mul(0.04)).add(float(0.003));
    const mkS = (dx) => makeGeoField(freqU.add(dx.mul(float(50.0))), nU, mU, lwU, algU, ampU);
    const r = mkS(splitAmt);
    const g = makeGeoField(freqU, nU, mU, lwU, algU, ampU);
    const b = mkS(splitAmt.negate());
    // brightness shifts the tint hue
    const tint = mix(col, vec3(col.b, col.r, col.g), brightnessU.mul(0.3));
    return vec4(tint.r.mul(r), tint.g.mul(g), tint.b.mul(b), g.mul(opacityU).mul(attackU.mul(0.4).add(0.6)));
  })();
}

/* WARPED GLOW — Bass
   amp: warp intensity swells with amplitude
   attack: envelope controls glow halo size
   brightness: glow colour from warm→electric
   onset: snap to maximum warp on attack */
function shaderWarpedGlow(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp   = uv();
    // Warp magnitude driven by amp + onset
    const warpAmt = ampU.mul(0.025).add(onsetU.mul(0.04)).add(float(0.005));
    const warp    = sin(uvp.x.mul(9.0).add(time.mul(2.2))).mul(warpAmt);
    const mWarp   = mU.add(warp.mul(float(3.0)));
    const sand    = makeGeoField(freqU, nU, mWarp, lwU, algU, ampU);
    // Glow halo: attack swells the halo
    const glow    = pow(sand, float(1.0).sub(attackU.mul(0.5)));
    // Brightness shifts glow colour: gold → electric cyan
    const glowCol = mix(col, vec3(0.1, 0.9, 1.0), brightnessU.mul(0.5));
    return vec4(glowCol, glow.mul(opacityU));
  })();
}

/* SCANLINES — Chords
   amp: scanline density increases with amplitude
   attack: scanlines sweep direction reverses on attack
   brightness: scanline colour tint
   onset: scanlines flash bright then decay */
function shaderScanlines(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp  = uv();
    const sand = makeGeoField(freqU, nU, mU, lwU, algU, ampU);
    // amp increases scanline frequency (more lines when louder)
    const lineFreq = float(400.0).add(ampU.mul(float(500.0)));
    // onset flashes lines bright
    const scanBright = float(0.72).add(onsetU.mul(0.28));
    const scan = sin(uvp.y.mul(lineFreq)).mul(0.5).add(0.5).mul(0.28).add(scanBright);
    // brightness tints toward white
    const tint = mix(col, vec3(0.9, 0.95, 1.0), brightnessU.mul(0.35));
    return vec4(tint.mul(scan), sand.mul(opacityU).mul(attackU.mul(0.3).add(0.7)));
  })();
}

/* GLITCH — Arp
   amp: glitch band frequency scales with amplitude
   attack: envelope triggers new glitch band positions
   brightness: tint goes green→magenta with brightness
   onset: hard wide glitch jump on attack */
function shaderGlitch(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp  = uv();
    const band = floor(uvp.y.mul(float(20.0).add(ampU.mul(float(20.0))))).div(float(20.0).add(ampU.mul(float(20.0))));
    const n    = fract(sin(band.mul(127.1).add(time.mul(4.0))).mul(43758.5));
    const thr  = float(0.85).sub(onsetU.mul(0.25));  // onset lowers threshold → more bands glitch
    const shift = step(thr, n).mul(n.sub(thr).mul(0.22).add(onsetU.mul(0.08)));
    const freqG = freqU.add(shift.mul(float(80.0)));
    const sand  = makeGeoField(freqG, nU, mU, lwU, algU, ampU);
    const isBand = step(thr, n);
    // brightness shifts glitch tint hue
    const tintA = mix(col, vec3(0.15, 1.0, 0.55), isBand);
    const tintB = mix(tintA, vec3(1.0, 0.1, 0.8), brightnessU.mul(isBand).mul(0.5));
    return vec4(tintB, sand.mul(opacityU).mul(attackU.mul(0.2).add(0.8)));
  })();
}

/* SLOW WAVE — Pad
   amp: wave frequency and depth scale with amplitude
   attack: slow swell — envelope drives wave depth
   brightness: wave speed changes with spectral content
   onset: ripple burst from centre */
function shaderSlowWave(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp  = uv();
    // Wave depth scales with amp, speed with brightness
    const waveDepth = float(0.012).add(ampU.mul(0.025));
    const waveSpeed = float(0.4).add(brightnessU.mul(0.6));
    const wave  = sin(uvp.x.mul(3.14159).add(time.mul(waveSpeed))).mul(waveDepth);
    // Onset: radial ripple burst from centre
    const dist  = sqrt(uvp.x.sub(0.5).mul(uvp.x.sub(0.5)).add(uvp.y.sub(0.5).mul(uvp.y.sub(0.5))));
    const ripple = sin(dist.mul(float(30.0)).sub(time.mul(8.0))).mul(onsetU.mul(0.03));
    const mWave = mU.add(wave.add(ripple).mul(float(2.0)));
    const sand  = makeGeoField(freqU, nU, mWave, lwU, algU, ampU);
    // Attack: envelope drives fade-in (pad swells in)
    return vec4(col, sand.mul(opacityU).mul(attackU.mul(0.5).add(0.5)));
  })();
}

/* HEAT DISTORT — Brass
   amp: distortion intensity scales with amplitude
   attack: attack sharpens the heat shimmer
   brightness: temperature colour from orange→white-hot
   onset: shockwave distortion burst */
function shaderHeatDistort(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp   = uv();
    const dist  = sqrt(uvp.x.sub(0.5).mul(uvp.x.sub(0.5)).add(uvp.y.sub(0.5).mul(uvp.y.sub(0.5))));
    // Onset shockwave: radial displacement pulse
    const shock = onsetU.mul(float(0.03)).mul(sin(dist.mul(float(40.0)).sub(time.mul(20.0))));
    const heatScale = float(0.008).add(ampU.mul(0.015));
    const hx  = sin(uvp.y.mul(20.0).add(time.mul(5.0))).mul(heatScale).add(shock);
    const hy  = cos(uvp.x.mul(14.0).add(time.mul(3.8))).mul(heatScale.mul(0.7));
    const sand = makeGeoField(freqU.add(hx.add(hy).mul(float(60.0))), nU, mU, lwU, algU, ampU);
    // Brightness drives colour: col (orange) → white-hot
    const hot  = mix(col, vec3(1.0, 0.95, 0.7), brightnessU.mul(0.6).add(ampU.mul(0.3)));
    return vec4(hot, sand.mul(opacityU));
  })();
}

/* MATRIX RAIN — FX
   amp: rain speed scales with amplitude
   attack: envelope brightens the streaks
   brightness: green hue shifts toward cyan with brightness
   onset: flash white column burst */
function shaderMatrixRain(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp    = uv();
    const colIdx = floor(uvp.x.mul(36.0));
    const speed  = fract(sin(colIdx.mul(91.3)).mul(4375.0)).mul(2.0).add(0.5);
    // amp drives rain speed
    const rainSpeed = float(1.0).add(ampU.mul(float(4.0)));
    const rain   = fract(uvp.y.add(time.mul(speed).mul(rainSpeed)));
    const bright = pow(float(1.0).sub(rain), float(4.0));
    const sand   = makeGeoField(freqU, nU, mU, lwU, algU, ampU);
    // brightness shifts green→cyan
    const green  = mix(
      vec3(0.05, bright.mul(0.8).add(0.2), 0.12),
      vec3(0.1,  bright.mul(0.8).add(0.2), bright.mul(0.6).add(0.3)),
      brightnessU.mul(0.6)
    );
    // onset: column of white
    const onsetFlash = onsetU.mul(bright).mul(0.8);
    const finalCol = mix(green, vec3(1.0), onsetFlash);
    return vec4(finalCol, sand.mul(opacityU).mul(attackU.mul(0.2).add(0.8)));
  })();
}

/* EMBERS — Perc
   amp: ember spawn rate and brightness
   attack: envelope makes embers larger on attack
   brightness: ember colour from coal→magnesium white
   onset: explosion of embers on hit */
function shaderEmbers(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp  = uv();
    const t    = time.mul(float(1.8).add(ampU.mul(float(3.0))));
    const nx   = fract(sin(uvp.x.mul(127.1).add(uvp.y.mul(311.7)).add(t)).mul(43758.5));
    // onset lowers threshold → explosion of sparks
    const sparkThr = float(0.80).sub(onsetU.mul(0.3)).sub(ampU.mul(0.1));
    const spark = pow(max(float(0.0), nx.sub(sparkThr)), float(3.0))
                   .mul(float(10.0).add(onsetU.mul(float(20.0))));
    const sand  = makeGeoField(freqU, nU, mU, lwU, algU, ampU);
    // brightness shifts coal→magnesium white
    const emberCol = mix(
      mix(col, vec3(1.0, 0.38, 0.04), spark.mul(sand)),
      vec3(1.0, 0.95, 0.8),
      brightnessU.mul(0.4).add(onsetU.mul(0.3))
    );
    return vec4(emberCol, sand.mul(opacityU));
  })();
}

/* STATIC NOISE — Drums
   amp: noise gain tracks amplitude (louder = more static)
   attack: not meaningful for drums — used for frame rate pulse
   brightness: static colour: grey→white→pink
   onset: full frame white noise burst on hit */
function shaderStaticNoise(freqU, nU, mU, lwU, algU, opacityU, col, ampU, attackU, brightnessU, onsetU) {
  return Fn(() => {
    const uvp  = uv();
    // onset slows frame quantization → smoother burst
    const fps  = floor(time.mul(float(24.0).sub(onsetU.mul(float(18.0)))));
    const n    = fract(sin(uvp.x.mul(127.1).add(uvp.y.mul(311.7)).add(fps.mul(74.2))).mul(43758.5453));
    const sand = makeGeoField(freqU, nU, mU, lwU, algU, ampU);
    // amp drives noise floor: quiet = mostly black, loud = full static
    const noiseFloor = float(0.03).add(ampU.mul(0.12));
    const stat = mix(noiseFloor, float(1.0), n);
    // onset: blast of pure white noise ignoring sand mask
    const blastMask = mix(sand, float(1.0), onsetU.mul(0.8));
    // brightness: grey→pink tint
    const noiseTint = mix(vec3(stat), vec3(stat.mul(1.1), stat.mul(0.7), stat.mul(0.9)), brightnessU.mul(0.4));
    return vec4(noiseTint, blastMask.mul(opacityU));
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
   layers[ch] = { mesh, mat, opacityU, freqU, nU, mU, lwU, algU,
                  ampU, attackU, brightnessU, onsetU, cfg }
   ═══════════════════════════════════════════════════════════════ */
const layers = [];

/* ═══════════════════════════════════════════════════════════════
   BUILD
   ═══════════════════════════════════════════════════════════════ */
export function buildLayers() {
  LAYER_CONFIG.forEach((cfg, renderIdx) => {
    // Existing uniforms
    const opacityU = uniform(float(0.0));
    const freqU    = uniform(float(261.63));
    const nU       = uniform(float(cfg.modeN));
    const mU       = uniform(float(cfg.modeM));
    const lwU      = uniform(float(0.12));
    const algU     = uniform(float(0.0));

    // Audio-reactive uniforms
    const ampU        = uniform(float(0.0));  // RMS level [0,1]
    const attackU     = uniform(float(0.0));  // ADSR envelope [0,1]
    const brightnessU = uniform(float(0.0));  // spectral centroid [0,1]
    const onsetU      = uniform(float(0.0));  // transient spike [0,1]

    const hex = cfg.color === '#111111' ? '#333333' : cfg.color;
    const r   = parseInt(hex.slice(1,3), 16) / 255;
    const g   = parseInt(hex.slice(3,5), 16) / 255;
    const b   = parseInt(hex.slice(5,7), 16) / 255;
    const col = vec3(r, g, b);

    const builderFn    = SHADER_MAP[cfg.shader] ?? shaderClean;
    const fragmentNode = builderFn(
      freqU, nU, mU, lwU, algU, opacityU, col,
      ampU, attackU, brightnessU, onsetU
    );

    const mat = new THREE.NodeMaterial();
    mat.transparent  = true;
    mat.depthWrite   = false;
    mat.fragmentNode = fragmentNode;

    const { w, h } = planeSize(cfg.zPos);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.z  = cfg.zPos;
    mesh.renderOrder = renderIdx;
    scene.add(mesh);

    layers[cfg.ch] = {
      mesh, mat, cfg,
      opacityU, freqU, nU, mU, lwU, algU,
      ampU, attackU, brightnessU, onsetU,
    };
  });
}

/* ─── RESIZE ─────────────────────────────────────────────────── */
window.addEventListener('resize', () => {
  layers.forEach(layer => {
    if (!layer) return;
    const { w, h } = planeSize(layer.cfg.zPos);
    layer.mesh.geometry.dispose();
    layer.mesh.geometry = new THREE.PlaneGeometry(w, h);
  });
});

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════ */
export function updateLayer(chIndex, activeKeysForChannel) {
  const layer = layers[chIndex];
  if (!layer) return;

  const midiNums = activeKeysForChannel.map(k => parseInt(k.split(':')[1], 10));

  if (!midiNums.length) {
    layer.opacityU.value = 0.0;
    return;
  }

  const rootMidi = Math.min(...midiNums);
  layer.freqU.value    = midiToFreq(rootMidi);
  layer.opacityU.value = layer.cfg.opacity;

  if (midiNums.length > 1) {
    const interval = Math.max(...midiNums) - rootMidi;
    layer.mU.value = layer.cfg.modeM + (interval % 7) * 0.15;
  } else {
    layer.mU.value = layer.cfg.modeM;
  }
}

/* Called every frame by audio.js tickAudio() */
export function setAudioUniforms(ch, amp, attack, brightness, onset) {
  const layer = layers[ch];
  if (!layer) return;
  layer.ampU.value        = amp;
  layer.attackU.value     = attack;
  layer.brightnessU.value = brightness;
  layer.onsetU.value      = onset;
}

export function setLayerAlgorithm(chIndex, algIndex) {
  const layer = layers[chIndex];
  if (!layer) return;
  layer.algU.value = algIndex;
}

export function clearAllLayers() {
  layers.forEach(layer => {
    if (!layer) return;
    layer.opacityU.value = 0.0;
  });
}

export function getActiveSummary() {
  const active = LAYER_CONFIG.filter(cfg => (layers[cfg.ch]?.opacityU.value ?? 0) > 0);
  return active.length ? active.map(c => c.label).join(' · ') : 'Play a note or chord';
}