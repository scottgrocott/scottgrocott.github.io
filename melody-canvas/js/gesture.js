/* ═══════════════════════════════════════════════════════════════════════════
   gesture.js — Two-stage gesture recognition

   Stage 1 (primary): cosine-similarity template matching vs gestures.json
     • Normalise landmarks: translate to wrist origin, scale by wrist→MCP9
     • Best-match score across every sample in each class
     • Must exceed MATCH_THRESHOLD to fire

   Stage 2 (fallback): geometry — finger extension ratios
     • Kicks in when templates not loaded or no class clears threshold

   gestures.json mixed format handled:
     pointing samples  →  { type, handedness, landmarks: [{x,y,z}×21] }
     draw/erase samples → raw [{x,y,z}×21]
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── HYSTERESIS CONFIG ──────────────────────────────────────────────────── */
const CONFIRM_FRAMES  = 4;    // frames to enter a gesture
const RELEASE_FRAMES  = 18;   // frames of non-match before leaving
const MATCH_THRESHOLD = 0.88; // cosine sim needed for template match

/* ─── STATE ──────────────────────────────────────────────────────────────── */
let currentGesture   = null;
let candidateGesture = null;
let candidateCount   = 0;
let releaseCount     = 0;
let _logTimer        = 0;

/* ─── TEMPLATE STORE ─────────────────────────────────────────────────────── */
const templates     = {};   // { gestureName: Float32Array[] }
let templatesLoaded = false;

/* ═══════════════════════════════════════════════════════════════════════════
   INIT — fetch + normalise all reference poses
   ═══════════════════════════════════════════════════════════════════════════ */
export async function initGestures() {
  const paths = ['./gestures.json', '/melody-canvas/js/gestures.json', 'gestures.json'];
  let data = null;

  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (r.ok) { data = await r.json(); console.log('[Gesture] Loaded from', p); break; }
    } catch (_) {}
  }

  if (!data) {
    console.warn('[Gesture] gestures.json not found — geometry fallback only');
    return;
  }

  let total = 0;
  for (const [name, samples] of Object.entries(data)) {
    templates[name] = [];
    for (const sample of samples) {
      // pointing: { type, handedness, landmarks:[{x,y,z}×21] }
      // draw/erase: raw [{x,y,z}×21]
      const lm = Array.isArray(sample) ? sample : sample.landmarks;
      if (!lm || lm.length < 21) continue;
      const vec = _normalise(lm);
      if (vec) { templates[name].push(vec); total++; }
    }
    console.log('[Gesture]', name, '—', templates[name].length, 'templates');
  }

  templatesLoaded = total > 0;
  console.log('[Gesture] Ready —', total, 'samples across', Object.keys(templates).length, 'classes');
}

export function clearGesture() {
  currentGesture = null; candidateGesture = null;
  candidateCount = 0;    releaseCount     = 0;
}

export function getCurrentGesture() { return currentGesture; }

/* ═══════════════════════════════════════════════════════════════════════════
   NORMALISE — wrist origin, scale by wrist→middle-MCP (lm[9])
   Returns Float32Array([x0,y0,z0, x1,y1,z1, …]) or null if degenerate
   ═══════════════════════════════════════════════════════════════════════════ */
function _normalise(lm) {
  const wx = lm[0].x, wy = lm[0].y, wz = lm[0].z ?? 0;
  const mx = lm[9].x, my = lm[9].y, mz = lm[9].z ?? 0;
  const scale = Math.sqrt((mx-wx)**2 + (my-wy)**2 + (mz-wz)**2);
  if (scale < 1e-6) return null;

  const out = new Float32Array(lm.length * 3);
  for (let i = 0; i < lm.length; i++) {
    out[i*3  ] = (lm[i].x          - wx) / scale;
    out[i*3+1] = (lm[i].y          - wy) / scale;
    out[i*3+2] = ((lm[i].z ?? 0)   - wz) / scale;
  }
  return out;
}

/* ─── Cosine similarity ─────────────────────────────────────────────────── */
function _cosine(a, b) {
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma  += a[i] * a[i];
    mb  += b[i] * b[i];
  }
  const d = Math.sqrt(ma) * Math.sqrt(mb);
  return d < 1e-9 ? 0 : dot / d;
}

/* ─── Best match score for one class ───────────────────────────────────── */
function _bestScore(vec, name) {
  let best = 0;
  for (const t of (templates[name] ?? [])) {
    const s = _cosine(vec, t);
    if (s > best) best = s;
  }
  return best;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GEOMETRY FALLBACK — finger extension ratios vs wrist distance
   ═══════════════════════════════════════════════════════════════════════════ */
const _F = {
  index:  { mcp:  5, tip:  8 },
  middle: { mcp:  9, tip: 12 },
  ring:   { mcp: 13, tip: 16 },
  pinky:  { mcp: 17, tip: 20 },
};

function _ext(lm, f) {
  const d3 = (a, b) => {
    const dx = a.x-b.x, dy = a.y-b.y, dz = (a.z??0)-(b.z??0);
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  };
  const mcpDist = d3(lm[f.mcp], lm[0]);
  return mcpDist > 1e-4 ? d3(lm[f.tip], lm[0]) / mcpDist : 0;
}

function _geometry(lm) {
  const EXT = 1.18, CRL = 1.22;
  const iE = _ext(lm,_F.index)  > EXT, mE = _ext(lm,_F.middle) > EXT;
  const rE = _ext(lm,_F.ring)   > EXT, pE = _ext(lm,_F.pinky)  > EXT;
  const mC = _ext(lm,_F.middle) < CRL;
  const rC = _ext(lm,_F.ring)   < CRL;
  const pC = _ext(lm,_F.pinky)  < CRL;

  if (iE && mE && rE && pE)  return 'erase';
  if (iE && mE && rC && pC)  return 'draw';
  if (iE && mC && rC && pC)  return 'pointing';
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE — called every MediaPipe frame
   ═══════════════════════════════════════════════════════════════════════════ */
export function updateGesture(lm) {
  if (!lm) { _setGesture(null); return; }

  let matched = null;

  if (templatesLoaded) {
    const vec = _normalise(lm);
    if (vec) {
      const scores = {};
      for (const name of Object.keys(templates)) scores[name] = _bestScore(vec, name);

      let bestName = null, bestScore = MATCH_THRESHOLD;
      for (const [name, score] of Object.entries(scores)) {
        if (score > bestScore) { bestScore = score; bestName = name; }
      }
      matched = bestName;

      if (++_logTimer % 20 === 0) {
        const s = Object.entries(scores).map(([n,v]) => n+':'+v.toFixed(3)).join('  ');
        console.log('[Gesture] template  ' + s + '  →', matched ?? 'none→fallback');
      }
    }

    // Geometry fallback when nothing clears threshold
    if (matched === null) matched = _geometry(lm);

  } else {
    matched = _geometry(lm);
  }

  /* ── Hysteresis ───────────────────────────────────────────────────────── */
  if (currentGesture !== null) {
    if (matched === currentGesture) {
      releaseCount = 0; candidateGesture = matched; candidateCount = CONFIRM_FRAMES;
    } else {
      releaseCount++;
      if (matched === candidateGesture) candidateCount++;
      else { candidateGesture = matched; candidateCount = 1; }

      if (releaseCount >= RELEASE_FRAMES) {
        if (candidateGesture !== null && candidateCount >= CONFIRM_FRAMES) {
          _setGesture(candidateGesture); releaseCount = 0;
        } else if (candidateGesture === null) {
          _setGesture(null); releaseCount = 0; candidateCount = 0;
        }
      }
    }
  } else {
    if (matched === candidateGesture) {
      candidateCount++;
      if (candidateCount >= CONFIRM_FRAMES) { _setGesture(matched); releaseCount = 0; }
    } else {
      candidateGesture = matched; candidateCount = 1;
    }
  }
}

function _setGesture(name) {
  if (name !== currentGesture) {
    console.log('[Gesture]', currentGesture, '→', name);
    currentGesture = name;
  }
}