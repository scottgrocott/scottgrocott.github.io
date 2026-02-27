/* ═══════════════════════════════════════════════════════════════════════════
   hand.js — Hand tracking cursor via MediaPipe Hands + webcam

   Pipeline:
     1. getUserMedia → hidden <video> element
     2. MediaPipe Hands detects index finger tip each frame (landmark 8)
     3. Canvas boundary defined by 4-corner click calibration on the preview.
        Calibration points are stored in localStorage and reloaded on init.
     4. applyHomography() applies a full perspective transform so the cursor
        is correct even when the camera is at an angle to the canvas.
     5. A cursor <div> overlay appears in #canvas-container only when the
        finger intersects the calibrated quad.
     6. Brush sound: Tone.js bandpass-filtered noise fades in while cursor
        moves, fades out when still. Frequency is per-layer.

   Public API:
     initHand()                — async, loads MediaPipe + camera + brush sound
     setHandLayer(index)       — 0-based channel index
     setPreviewCanvas(el)      — registers the panel <canvas> for video preview
     onCalibrationChange(fn)   — fn({ phase, pointsCollected }) called on changes
     startCalibration()        — begins 4-corner click collection on the preview
     clearCalibration()        — removes saved calibration, reverts to full-frame
     isCalibrated()            — returns true if a valid quad is active
     tickHand(dt)              — call every animation frame (dt = seconds)
     getHandCursorState()      — { x, y, active, layerIndex }
     setCursorContainer(el)    — re-parents cursor overlay (popup.js)
   ═══════════════════════════════════════════════════════════════════════════ */

import { LAYER_CONFIG } from './layers.js';

/* ─── LAYER COLOR LOOKUP ─────────────────────────────────────────────────── */
const LAYER_COLORS = new Array(16).fill('#ffffff');
LAYER_CONFIG.forEach(cfg => {
  LAYER_COLORS[cfg.ch] = (cfg.color === '#111111') ? '#888888' : cfg.color;
});

/* ─── STORAGE KEY ────────────────────────────────────────────────────────── */
const STORAGE_KEY = 'melodyCanvas_calibration_v1';

/* ─── MODULE STATE ───────────────────────────────────────────────────────── */
let video      = null;
let previewCvs = null;
let previewCtx = null;
let cursorEl   = null;

let activeLayer   = 0;
let lastLandmarks = null;

/* ─── CALIBRATION STATE ──────────────────────────────────────────────────
   calibPoints: accumulating clicks, each { x, y } in VIDEO normalised space
   Order the user clicks: TL → TR → BR → BL
   calibQuad: confirmed 4-point quad [{x,y}×4] in video space
   homographyMat: 3×3 matrix (Float64Array(9), row-major)
   ─────────────────────────────────────────────────────────────────────── */
let calibPoints   = [];
let calibQuad     = null;
let homographyMat = null;
let calibMode     = false;
let onCalibChange = null;

/* ─── ONE-EURO FILTER ────────────────────────────────────────────────────────
   Adaptive low-pass filter for pointer/cursor tracking.
   Reference: Casiez et al. "1€ Filter: A Simple Speed-based Low-pass Filter
              for Noisy Input in Interactive Systems" (CHI 2012)

   Key idea: cutoff frequency scales with speed.
     • Slow / still  → very low cutoff → heavy smoothing → stable cursor
     • Fast moving   → high cutoff     → minimal lag     → responsive cursor

   Parameters (tuned for ~15-20fps MediaPipe + normalised [0,1] coords):
     minCutoff  — baseline smoothing when still. Lower = smoother but more lag.
     beta       — speed coefficient. Higher = less lag when moving fast.
     dCutoff    — cutoff for the derivative (speed) estimate. Fixed at 1Hz.
   ─────────────────────────────────────────────────────────────────────────── */
function makeOneEuroFilter({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
  let xPrev    = null;   // previous filtered value
  let dxPrev   = 0;      // previous filtered derivative
  let tPrev    = null;   // previous timestamp (seconds)

  function alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  return {
    reset() { xPrev = null; dxPrev = 0; tPrev = null; },

    filter(x, t) {
      if (xPrev === null) { xPrev = x; tPrev = t; return x; }

      const dt = Math.max(t - tPrev, 1e-6);
      tPrev    = t;

      // Derivative estimate (filtered)
      const dx_raw  = (x - xPrev) / dt;
      const aD      = alpha(dCutoff, dt);
      const dx      = aD * dx_raw + (1 - aD) * dxPrev;
      dxPrev        = dx;

      // Adaptive cutoff: higher speed → higher cutoff → less smoothing
      const cutoff  = minCutoff + beta * Math.abs(dx);
      const aX      = alpha(cutoff, dt);
      const xFilt   = aX * x + (1 - aX) * xPrev;
      xPrev         = xFilt;

      return xFilt;
    },
  };
}

// Two independent filters, one per axis
// minCutoff: lower = smoother still cursor (try 0.5–2.0)
// beta:      higher = less lag when moving fast (try 0.004–0.02)
const filterX = makeOneEuroFilter({ minCutoff: 6.0, beta: 0.2 });
const filterY = makeOneEuroFilter({ minCutoff: 6.0, beta: 0.2 });

/* ─── VELOCITY PREDICTION ────────────────────────────────────────────────────
   Each MediaPipe result gives us a filtered position. We track velocity
   (units/sec in normalised space) and extrapolate forward every animation
   frame to compensate for the ~50-80ms MediaPipe pipeline delay.

   PREDICT_MS: how far ahead to extrapolate. Should roughly match the
   detection pipeline latency. 60-80ms is typical for MediaPipe lite.
   ─────────────────────────────────────────────────────────────────────────── */
const PREDICT_MS   = 65;   // ms to extrapolate ahead — tune if over/undershooting
const VEL_ALPHA    = 0.5;  // EMA smoothing on velocity estimate (0=no update, 1=instant)
const MAX_VEL      = 8.0;  // clamp velocity to prevent wild extrapolation (units/sec)

let predVelX    = 0;   // smoothed velocity, normalised units per second
let predVelY    = 0;
let predBaseX   = 0.5; // last filtered position from MediaPipe
let predBaseY   = 0.5;
let predBaseT   = 0;   // performance.now() when base was set
let predActive  = false;

/** Called from onHandResults with the freshly filtered position */
function updatePrediction(fx, fy, t) {
  if (predBaseT > 0) {
    const dt = (t - predBaseT) / 1000;
    if (dt > 0.005) {  // ignore sub-5ms spurious calls
      const rawVx = (fx - predBaseX) / dt;
      const rawVy = (fy - predBaseY) / dt;
      // Clamp then smooth velocity
      const cvx = Math.max(-MAX_VEL, Math.min(MAX_VEL, rawVx));
      const cvy = Math.max(-MAX_VEL, Math.min(MAX_VEL, rawVy));
      predVelX = predVelX * (1 - VEL_ALPHA) + cvx * VEL_ALPHA;
      predVelY = predVelY * (1 - VEL_ALPHA) + cvy * VEL_ALPHA;
    }
  }
  predBaseX = fx;
  predBaseY = fy;
  predBaseT = t;
  predActive = true;
}

/** Called every animation frame — returns extrapolated position */
function getPredictedPosition() {
  if (!predActive) return { x: predBaseX, y: predBaseY };
  const dt  = Math.min((performance.now() - predBaseT) / 1000, 0.15); // cap at 150ms
  const ahead = PREDICT_MS / 1000;
  const px = clamp01(predBaseX + predVelX * (dt + ahead));
  const py = clamp01(predBaseY + predVelY * (dt + ahead));
  return { x: px, y: py };
}

function resetPrediction() {
  predVelX   = 0;
  predVelY   = 0;
  predActive = false;
  predBaseT  = 0;
}

/* ─── CURSOR STATE ───────────────────────────────────────────────────────── */
let cursorNorm   = { x: 0.5, y: 0.5 };
let cursorActive = false;
let prevRaw      = { x: 0.5, y: 0.5 };  // raw (unfiltered) for movement EMA
let movementEMA  = 0;
const EMA_ALPHA  = 0.15;
const STILL_THR  = 0.0015;

/* ─── BRUSH SOUND ────────────────────────────────────────────────────────── */
let brushNoise  = null;
let brushFilter = null;
let brushGain   = null;
let brushReady  = false;

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════════════ */

export function setPreviewCanvas(canvas) {
  previewCvs = canvas;
  previewCtx = canvas ? canvas.getContext('2d') : null;
  if (previewCvs) _attachCalibrationClickHandler();
}

export function setHandLayer(index) {
  activeLayer = Math.max(0, Math.min(15, index));
  applyCursorColor();
  updateBrushFreq();
}

export function getHandCursorState() {
  return { x: cursorNorm.x, y: cursorNorm.y, active: cursorActive, layerIndex: activeLayer };
}

export function tickHand(dt) {
  // Apply velocity prediction every frame — decouples cursor display rate
  // from MediaPipe detection rate (~15fps → smooth 60fps cursor)
  if (cursorActive && predActive) {
    const { x, y } = getPredictedPosition();
    const cont = cursorEl?.parentElement;
    if (cont && cursorEl) {
      cursorEl.style.left = `${x * cont.clientWidth}px`;
      cursorEl.style.top  = `${y * cont.clientHeight}px`;
      cursorNorm = { x, y };
    }
  }
  tickBrush(dt);
  if (previewCtx) renderPreview();
}

/** Register a callback notified whenever calibration state changes.
 *  Receives: { phase: 'idle'|'collecting'|'done', pointsCollected: 0-4 }
 */
export function onCalibrationChange(fn) {
  onCalibChange = fn;
}

/** Begin 4-corner calibration — user clicks TL → TR → BR → BL on preview */
export function startCalibration() {
  calibPoints = [];
  calibMode   = true;
  _notifyCalib();
}

/** Clear saved calibration — reverts to full-frame fallback mapping */
export function clearCalibration() {
  calibQuad     = null;
  homographyMat = null;
  calibMode     = false;
  calibPoints   = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  _notifyCalib();
}

export function isCalibrated() {
  return calibQuad !== null;
}

/** Re-parent cursor overlay (called by popup.js when canvas moves) */
export function setCursorContainer(newParent) {
  if (!cursorEl || !newParent) return;
  newParent.appendChild(cursorEl);
}

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════════════ */

export async function initHand() {
  await loadMediaPipeScripts();
  await setupCamera();
  setupMediaPipeHands();
  setupCursorOverlay();
  setupBrushSound();
  _loadCalibration();
  console.log('[Hand] Initialised');
}

/* ─── SCRIPT LOADER ──────────────────────────────────────────────────────── */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.onload  = resolve;
    el.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(el);
  });
}

async function loadMediaPipeScripts() {
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe';
  await loadScript(`${CDN}/camera_utils/camera_utils.js`);
  await loadScript(`${CDN}/hands/hands.js`);
  await new Promise((res, rej) => {
    let n = 0;
    const id = setInterval(() => {
      if (typeof Hands !== 'undefined' && typeof Camera !== 'undefined') { clearInterval(id); res(); }
      if (++n > 40) { clearInterval(id); rej(new Error('MediaPipe globals not found after load')); }
    }, 100);
  });
}

/* ─── CAMERA ─────────────────────────────────────────────────────────────── */
async function setupCamera() {
  video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.style.display = 'none';
  document.body.appendChild(video);

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise(res => { video.onloadedmetadata = res; });
  await video.play();
}

/* ─── MEDIAPIPE HANDS ────────────────────────────────────────────────────── */
function setupMediaPipeHands() {
  /* global Hands, Camera */
  const mp = new Hands({ /* eslint-disable-line no-undef */
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  mp.setOptions({
    maxNumHands:            1,
    modelComplexity:        0,
    minDetectionConfidence: 0.70,
    minTrackingConfidence:  0.60,
  });
  mp.onResults(onHandResults);

  const cam = new Camera(video, { /* eslint-disable-line no-undef */
    onFrame: async () => { await mp.send({ image: video }); },
    width: 640, height: 480,
  });
  cam.start();
}

/* ─── HAND RESULTS CALLBACK ──────────────────────────────────────────────── */
function onHandResults(results) {
  if (!results.multiHandLandmarks?.length) {
    lastLandmarks = null;
    filterX.reset();
    filterY.reset();
    resetPrediction();
    updateCursor(false, 0, 0);
    return;
  }

  const lm = results.multiHandLandmarks[0];
  lastLandmarks = lm;

  // Landmark 8 = index finger tip, normalised video coords [0,1]
  const tx = lm[8].x;
  const ty = lm[8].y;
  const t  = performance.now() / 1000;

  let rawX, rawY, inside;

  if (!calibQuad || !homographyMat) {
    rawX   = 1 - tx;
    rawY   = ty;
    inside = true;
  } else {
    const mapped = applyHomography(tx, ty);
    rawX   = mapped.nx;
    rawY   = mapped.ny;
    inside = mapped.inside;
  }

  // One-euro filter: smooth jitter when still, low-lag when moving fast
  const sx = filterX.filter(rawX, t);
  const sy = filterY.filter(rawY, t);

  // Update velocity predictor with new filtered position
  updatePrediction(sx, sy, performance.now());

  updateCursor(inside, sx, sy, rawX, rawY);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CALIBRATION — 4-CORNER CLICK ON PREVIEW CANVAS
   ═══════════════════════════════════════════════════════════════════════════ */

const CORNER_LABELS = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];

// Where each clicked video-space corner maps to in canvas normalised space
const CORNER_TARGETS = [
  [0, 0],  // TL → canvas (0,0)
  [1, 0],  // TR → canvas (1,0)
  [1, 1],  // BR → canvas (1,1)
  [0, 1],  // BL → canvas (0,1)
];

function _attachCalibrationClickHandler() {
  if (!previewCvs) return;
  previewCvs.addEventListener('click', _onPreviewClick);
}

function _onPreviewClick(e) {
  if (!calibMode) return;

  const rect = previewCvs.getBoundingClientRect();
  const px   = (e.clientX - rect.left)  / rect.width;
  const py   = (e.clientY - rect.top)   / rect.height;

  // Preview is rendered mirrored — un-mirror X to get true video space
  const vx = 1 - px;
  const vy = py;

  calibPoints.push({ x: vx, y: vy });
  _notifyCalib();

  if (calibPoints.length === 4) {
    _confirmCalibration();
  }
}

function _confirmCalibration() {
  calibQuad     = [...calibPoints];
  calibMode     = false;
  calibPoints   = [];
  homographyMat = _computeHomography(calibQuad);
  _saveCalibration();
  _notifyCalib();
  console.log('[Hand] Calibration confirmed:', calibQuad);
}

function _notifyCalib() {
  if (!onCalibChange) return;
  let phase = 'idle';
  if (calibMode)      phase = 'collecting';
  else if (calibQuad) phase = 'done';
  onCalibChange({
    phase,
    pointsCollected: calibMode ? calibPoints.length : (calibQuad ? 4 : 0),
  });
}

/* ─── PERSIST ──────────────────────────────────────────────────────────── */
function _saveCalibration() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calibQuad));
  } catch(e) {
    console.warn('[Hand] Could not save calibration:', e);
  }
}

function _loadCalibration() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const pts = JSON.parse(raw);
    if (Array.isArray(pts) && pts.length === 4) {
      calibQuad     = pts;
      homographyMat = _computeHomography(calibQuad);
      console.log('[Hand] Calibration restored from localStorage');
      _notifyCalib();
    }
  } catch(e) {
    console.warn('[Hand] Could not load calibration:', e);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOMOGRAPHY — 4-POINT PERSPECTIVE TRANSFORM (Direct Linear Transform)

   Maps the 4 calibrated video-space points to the unit square [0,1]×[0,1].
   Source: video-space quad corners (where the user clicked)
   Destination: TL=(0,0), TR=(1,0), BR=(1,1), BL=(0,1)

   Returns a Float64Array(9) representing the 3×3 matrix in row-major order.
   ═══════════════════════════════════════════════════════════════════════════ */
function _computeHomography(quad) {
  const src = quad.map(p => [p.x, p.y]);
  const dst = CORNER_TARGETS;

  // Build 8×9 matrix A for DLT — each correspondence gives 2 rows
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([-sx, -sy, -1,   0,   0,  0, dx * sx, dx * sy, dx]);
    A.push([  0,   0,  0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
  }

  // h[8] = 1 (normalised), solve 8×8 system A[:,0..7]·x = -A[:,8]
  const M = A.map(row => row.slice(0, 8));
  const b = A.map(row => -row[8]);

  const h8 = _gaussElim(M, b);
  if (!h8) {
    console.warn('[Hand] Homography degenerate — check calibration points');
    return null;
  }

  return new Float64Array([...h8, 1.0]);
}

/* ─── GAUSSIAN ELIMINATION with partial pivoting (8×8) ─────────────────── */
function _gaussElim(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;

    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }

  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

/* ─── APPLY HOMOGRAPHY ─────────────────────────────────────────────────── */
function applyHomography(vx, vy) {
  if (!homographyMat) return { inside: false, nx: 0, ny: 0 };

  const h = homographyMat;
  const w      = h[6] * vx + h[7] * vy + h[8];
  const nx_raw = (h[0] * vx + h[1] * vy + h[2]) / w;
  const ny_raw = (h[3] * vx + h[4] * vy + h[5]) / w;

  // A small margin so the cursor doesn't snap off right at the boundary
  const inside = nx_raw >= -0.04 && nx_raw <= 1.04 &&
                 ny_raw >= -0.04 && ny_raw <= 1.04;

  // Front-facing camera mirrors X — flip so canvas left = physical left
  return {
    inside,
    nx: Math.max(0, Math.min(1, 1 - nx_raw)),
    ny: Math.max(0, Math.min(1, ny_raw)),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CURSOR OVERLAY
   ═══════════════════════════════════════════════════════════════════════════ */
function setupCursorOverlay() {
  cursorEl = document.createElement('div');
  cursorEl.id = 'hand-cursor';
  Object.assign(cursorEl.style, {
    position:      'absolute',
    width:         '20px',
    height:        '20px',
    borderRadius:  '50%',
    border:        '2px solid #fff',
    pointerEvents: 'none',
    transform:     'translate(-50%, -50%)',
    display:       'none',
    zIndex:        '50',
    boxSizing:     'border-box',
    transition:    'border-color 0.1s, box-shadow 0.1s',
  });

  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position:     'absolute',
    inset:        '4px',
    borderRadius: '50%',
    background:   '#fff',
    transition:   'background 0.1s',
  });
  cursorEl.appendChild(dot);

  document.getElementById('canvas-container')?.appendChild(cursorEl);
  applyCursorColor();
}

function updateCursor(visible, nx, ny, rawX, rawY) {
  if (!cursorEl) return;
  cursorActive = visible;

  if (visible) {
    // Movement EMA uses raw (unfiltered) delta — reacts instantly to motion
    const rx  = rawX ?? nx;
    const ry  = rawY ?? ny;
    const dx  = rx - prevRaw.x;
    const dy  = ry - prevRaw.y;
    movementEMA = movementEMA * (1 - EMA_ALPHA) + Math.sqrt(dx * dx + dy * dy) * EMA_ALPHA;
    prevRaw = { x: rx, y: ry };

    cursorNorm = { x: nx, y: ny };
    cursorEl.style.display = 'block';
  } else {
    movementEMA = movementEMA * (1 - EMA_ALPHA);
    cursorEl.style.display = 'none';
  }
}

function applyCursorColor() {
  if (!cursorEl) return;
  const color = LAYER_COLORS[activeLayer];
  cursorEl.style.borderColor = color;
  cursorEl.style.boxShadow   = `0 0 10px ${color}99, 0 0 3px ${color}`;
  const dot = cursorEl.querySelector('div');
  if (dot) dot.style.background = color;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PREVIEW CANVAS RENDERING
   Draws: mirrored video → confirmed quad outline → calib overlay → skeleton
   ═══════════════════════════════════════════════════════════════════════════ */
function renderPreview() {
  if (!video || !video.videoWidth) return;

  const pw = previewCvs.width;
  const ph = previewCvs.height;

  // Mirrored video frame
  previewCtx.save();
  previewCtx.scale(-1, 1);
  previewCtx.drawImage(video, -pw, 0, pw, ph);
  previewCtx.restore();

  // Confirmed calibration quad — green outline
  if (calibQuad && !calibMode) {
    const pts = calibQuad.map(p => ({ x: (1 - p.x) * pw, y: p.y * ph }));
    previewCtx.strokeStyle = '#00ff88';
    previewCtx.lineWidth   = 1.5;
    previewCtx.beginPath();
    pts.forEach((p, i) => i === 0 ? previewCtx.moveTo(p.x, p.y) : previewCtx.lineTo(p.x, p.y));
    previewCtx.closePath();
    previewCtx.stroke();

    // Corner dots with labels
    const labelOffsets = [[-2, -8], [2, -8], [2, 10], [-2, 10]];
    const labelAligns  = ['right', 'left', 'left', 'right'];
    pts.forEach((p, i) => {
      previewCtx.fillStyle = '#00ff88';
      previewCtx.beginPath();
      previewCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      previewCtx.fill();
      previewCtx.font      = '7px monospace';
      previewCtx.fillStyle = '#00ff8899';
      previewCtx.textAlign = labelAligns[i];
      previewCtx.fillText(CORNER_LABELS[i], p.x + labelOffsets[i][0], p.y + labelOffsets[i][1]);
    });
  }

  // Calibration mode overlay
  if (calibMode) {
    _drawCalibOverlay(pw, ph);
  }

  // Hand skeleton
  if (lastLandmarks) {
    const CONN = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],[17,0],
    ];
    const pts = lastLandmarks.map(lm => ({
      x: (1 - lm.x) * pw,
      y: lm.y * ph,
    }));

    previewCtx.strokeStyle = 'rgba(255,255,255,0.22)';
    previewCtx.lineWidth   = 1;
    for (const [a, b] of CONN) {
      previewCtx.beginPath();
      previewCtx.moveTo(pts[a].x, pts[a].y);
      previewCtx.lineTo(pts[b].x, pts[b].y);
      previewCtx.stroke();
    }

    const tip   = pts[8];
    const color = LAYER_COLORS[activeLayer];
    previewCtx.fillStyle = color;
    previewCtx.beginPath();
    previewCtx.arc(tip.x, tip.y, 5, 0, Math.PI * 2);
    previewCtx.fill();
  }
}

/* ─── CALIBRATION OVERLAY ─────────────────────────────────────────────────
   Draws instructional overlay during 4-corner collection.
   ─────────────────────────────────────────────────────────────────────── */
function _drawCalibOverlay(pw, ph) {
  const step = calibPoints.length;

  // Dim background
  previewCtx.fillStyle = 'rgba(0,0,0,0.40)';
  previewCtx.fillRect(0, 0, pw, ph);

  // Already-confirmed points
  for (let i = 0; i < step; i++) {
    const p  = calibPoints[i];
    const cx = (1 - p.x) * pw;
    const cy = p.y * ph;
    previewCtx.strokeStyle = '#00ff88';
    previewCtx.lineWidth   = 1.5;
    _drawCrosshair(cx, cy, 9);
    previewCtx.fillStyle = '#00ff8866';
    previewCtx.beginPath();
    previewCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    previewCtx.fill();
    previewCtx.fillStyle  = '#00ff88';
    previewCtx.font       = '7px monospace';
    previewCtx.textAlign  = 'center';
    previewCtx.fillText(`✓ ${CORNER_LABELS[i]}`, cx, cy - 12);
  }

  if (step >= 4) return;

  // Target hint — corner bracket near the relevant preview corner
  const MARGIN = 16;
  const hints = [
    { x: MARGIN,      y: MARGIN },
    { x: pw - MARGIN, y: MARGIN },
    { x: pw - MARGIN, y: ph - MARGIN },
    { x: MARGIN,      y: ph - MARGIN },
  ];
  const hint = hints[step];

  previewCtx.strokeStyle = '#ff6600';
  previewCtx.lineWidth   = 2;
  _drawCrosshair(hint.x, hint.y, 10);

  // Corner label
  const hAlign = (step === 1 || step === 2) ? 'right' : 'left';
  const vOff   = step < 2 ? 20 : -14;
  previewCtx.fillStyle  = '#ff9944';
  previewCtx.font       = 'bold 8px monospace';
  previewCtx.textAlign  = hAlign;
  previewCtx.fillText(CORNER_LABELS[step], hint.x + (hAlign === 'left' ? 14 : -14), hint.y + vOff);

  // Centre instruction
  previewCtx.fillStyle  = 'rgba(255,255,255,0.92)';
  previewCtx.font       = 'bold 9px monospace';
  previewCtx.textAlign  = 'center';
  previewCtx.fillText(`CLICK ${CORNER_LABELS[step].toUpperCase()} CORNER`, pw / 2, ph / 2 - 7);
  previewCtx.fillStyle  = 'rgba(255,255,255,0.5)';
  previewCtx.font       = '8px monospace';
  previewCtx.fillText(`Step ${step + 1} of 4`, pw / 2, ph / 2 + 8);

  // Click-cursor hint on preview
  previewCtx.fillStyle  = 'rgba(255,255,255,0.25)';
  previewCtx.font       = '7px monospace';
  previewCtx.fillText('click the preview above', pw / 2, ph / 2 + 20);
}

function _drawCrosshair(cx, cy, size) {
  previewCtx.beginPath();
  previewCtx.moveTo(cx - size, cy);
  previewCtx.lineTo(cx + size, cy);
  previewCtx.moveTo(cx, cy - size);
  previewCtx.lineTo(cx, cy + size);
  previewCtx.stroke();
  const b = size * 0.45;
  previewCtx.strokeRect(cx - b, cy - b, b * 2, b * 2);
}

/* ═══════════════════════════════════════════════════════════════════════════
   BRUSH SOUND
   ═══════════════════════════════════════════════════════════════════════════ */
function setupBrushSound() {
  if (typeof Tone === 'undefined') return;
  try {
    brushNoise  = new Tone.Noise('white');
    brushFilter = new Tone.Filter({ type: 'bandpass', Q: 4 });
    brushGain   = new Tone.Gain(0);
    brushNoise.chain(brushFilter, brushGain, Tone.Destination);
    brushNoise.start();
    brushReady = true;
    updateBrushFreq();
    console.log('[Hand] Brush sound ready');
  } catch(e) {
    console.warn('[Hand] Brush sound setup failed:', e);
  }
}

function layerToFreq(idx) {
  return 350 * Math.pow(7000 / 350, idx / 15);
}

function updateBrushFreq() {
  if (!brushFilter) return;
  brushFilter.frequency.rampTo(layerToFreq(activeLayer), 0.25);
}

function tickBrush(dt) {
  if (!brushReady || !brushGain) return;
  const isMoving = cursorActive && movementEMA > STILL_THR;
  const target   = isMoving ? 0.07 : 0;
  const current  = brushGain.gain.value;
  const lerpRate = target > current ? dt * 14 : dt * 5;
  brushGain.gain.value = clamp01(current + (target - current) * Math.min(1, lerpRate));
}

/* ─── UTIL ───────────────────────────────────────────────────────────────── */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }