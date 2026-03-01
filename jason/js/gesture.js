/* ═══════════════════════════════════════════════════════════════════════════
   gesture.js — Hand gesture recognition using finger geometry

   Instead of comparing against reference poses (which fail when your hand
   differs from the reference), we measure finger curl directly:
     - Each finger: compare tip-to-palm distance vs MCP-to-palm distance
     - Extended finger: tip is far from palm
     - Curled finger: tip is close to palm

   Gestures:
     'pointing'  — index extended, middle+ring+pinky curled
     'draw'      — index + middle extended (peace/V sign), others curled
     'erase'     — all 4 fingers extended (open hand)
     null        — no confident match
   ═══════════════════════════════════════════════════════════════════════════ */

let currentGesture   = null;
let candidateGesture = null;
let candidateCount   = 0;
const CONFIRM_FRAMES = 4;   // frames needed to enter a gesture (faster response)
const RELEASE_FRAMES = 18;  // frames of non-match needed to leave (strong hysteresis)

let _logTimer    = 0;
let releaseCount = 0;  // counts frames since current gesture stopped matching

export async function initGestures() {
  console.log('[Gesture] Geometry-based recogniser ready');
}

export function clearGesture() {
  currentGesture   = null;
  candidateGesture = null;
  candidateCount   = 0;
  releaseCount     = 0;
}

export function getCurrentGesture() {
  return currentGesture;
}

/* ─── FINGER INDICES ──────────────────────────────────────────────────────
   Landmarks per finger: [MCP, PIP, DIP, TIP]
   ─────────────────────────────────────────────────────────────────────── */
const FINGERS = {
  index:  { mcp: 5,  pip: 6,  dip: 7,  tip: 8  },
  middle: { mcp: 9,  pip: 10, dip: 11, tip: 12 },
  ring:   { mcp: 13, pip: 14, dip: 15, tip: 16 },
  pinky:  { mcp: 17, pip: 18, dip: 19, tip: 20 },
};

function dist3(a, b) {
  const dx = a.x-b.x, dy = a.y-b.y, dz = (a.z??0)-(b.z??0);
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

/**
 * Returns 0.0 (fully curled) to 1.0 (fully extended) for one finger.
 * Compares tip→wrist distance to MCP→wrist distance — if tip is farther
 * than MCP, finger is extended.
 */
function fingerExtension(lm, finger) {
  const wrist = lm[0];
  const mcp   = lm[finger.mcp];
  const tip   = lm[finger.tip];
  const mcpDist = dist3(mcp, wrist);
  const tipDist = dist3(tip, wrist);
  // Normalise: 1.0 = tip as far as MCP (curled), >1 = extended
  return mcpDist > 0.001 ? tipDist / mcpDist : 0;
}

export function updateGesture(landmarks) {
  if (!landmarks) { _setGesture(null); return; }

  const ext = {
    index:  fingerExtension(landmarks, FINGERS.index),
    middle: fingerExtension(landmarks, FINGERS.middle),
    ring:   fingerExtension(landmarks, FINGERS.ring),
    pinky:  fingerExtension(landmarks, FINGERS.pinky),
  };

  // Thresholds tuned to this hand's observed values:
  //   draw:    r/p hover ~1.10-1.16 (curled)
  //   erase:   r/p reach ~1.22-1.33 (extended)
  //   pointing: m/r/p all <1.15
  const EXTENDED = 1.18;   // finger extension threshold
  const CURLED   = 1.22;   // finger curl threshold (wider dead zone = fewer null gaps)

  const iExt = ext.index  > EXTENDED;
  const mExt = ext.middle > EXTENDED;
  const rExt = ext.ring   > EXTENDED;
  const pExt = ext.pinky  > EXTENDED;
  const iCrl = ext.index  < CURLED;
  const mCrl = ext.middle < CURLED;
  const rCrl = ext.ring   < CURLED;
  const pCrl = ext.pinky  < CURLED;

  let matched = null;

  if (iExt && mExt && rExt && pExt) {
    matched = 'erase';    // open hand — all extended
  } else if (iExt && mExt && rCrl && pCrl) {
    matched = 'draw';     // V sign — index + middle extended
  } else if (iExt && mCrl && rCrl && pCrl) {
    matched = 'pointing'; // index only extended
  }

  // Throttled log
  _logTimer++;
  if (_logTimer % 15 === 0) {
    console.log('[Gesture]',
      `i:${ext.index.toFixed(2)} m:${ext.middle.toFixed(2)} r:${ext.ring.toFixed(2)} p:${ext.pinky.toFixed(2)}`,
      '→', matched ?? 'none'
    );
  }

  // Confirm over N frames to avoid flicker
  // Hysteresis: if we already have a confirmed gesture, require RELEASE_FRAMES
  // of non-match before switching — prevents flicker at boundaries
  if (currentGesture !== null) {
    if (matched === currentGesture) {
      // Still matching — keep confirmed, reset release counter
      releaseCount     = 0;
      candidateGesture = matched;
      candidateCount   = CONFIRM_FRAMES;
    } else {
      // Not matching current gesture — accumulate release frames
      releaseCount++;
      // Track candidate for the new gesture while in release window
      if (matched === candidateGesture) {
        candidateCount++;
      } else {
        candidateGesture = matched;
        candidateCount   = 1;
      }
      // Only switch after holding RELEASE_FRAMES of non-match
      if (releaseCount >= RELEASE_FRAMES) {
        if (candidateGesture !== null && candidateCount >= CONFIRM_FRAMES) {
          // Switch to new confirmed gesture
          _setGesture(candidateGesture);
          releaseCount = 0;
        } else if (candidateGesture === null) {
          // Drop to null only after release window fully expires
          _setGesture(null);
          releaseCount = 0;
          candidateCount = 0;
        }
      }
      // While in release window, keep current gesture active
    }
  } else {
    // No current gesture — confirm new one over CONFIRM_FRAMES
    if (matched === candidateGesture) {
      candidateCount++;
      if (candidateCount >= CONFIRM_FRAMES) {
        _setGesture(matched);
        releaseCount = 0;
      }
    } else {
      candidateGesture = matched;
      candidateCount   = 1;
    }
  }
}

function _setGesture(name) {
  if (name !== currentGesture) {
    console.log('[Gesture]', currentGesture, '→', name);
    currentGesture = name;
  }
}