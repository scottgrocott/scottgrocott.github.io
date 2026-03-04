// ============================================================
//  inputGuard.js — Shared flag: suspend game mouse input
//                  when the editor UI has focus
//
//  input.js  reads:  isMouseSuspended()
//  editor.js writes: suspendMouse() / resumeMouse()
//
//  Also patches the pointer-lock release so the snap-to-centre
//  mousemove that fires when Escape exits lock doesn't spin
//  the camera.
// ============================================================

let _suspended    = false;
let _blankFrames  = 0;   // frames to ignore after pointer lock releases

export function suspendMouse()    { _suspended = true;  }
export function resumeMouse()     { _suspended = false; }
export function isMouseSuspended(){ return _suspended || _blankFrames > 0; }

// ---- Pointer-lock release blank ----
// When the browser exits pointer lock (Escape or programmatic) it
// fires a large mousemove as the cursor jumps to its last real position.
// We blank input for 3 frames after any lock-change to drop that delta.

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) {
    // Just released — ignore next 3 frames of mouse input
    _blankFrames = 3;
  }
});

// Decrement blank counter — call this once per render frame from main.js
export function tickInputGuard() {
  if (_blankFrames > 0) _blankFrames--;
}