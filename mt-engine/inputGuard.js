// inputGuard.js — suspend/resume mouse, blank-frame guard for pointer-lock transitions

let _suspended = false;
let _blankFrames = 0;
const BLANK_FRAME_COUNT = 3;

export function suspendMouse() {
  _suspended = true;
  _blankFrames = 0;
}

export function resumeMouse() {
  // Don't resume immediately — set blank frame countdown
  _blankFrames = BLANK_FRAME_COUNT;
}

export function isMouseSuspended() {
  return _suspended || _blankFrames > 0;
}

export function tickInputGuard() {
  if (_blankFrames > 0) {
    _blankFrames--;
    if (_blankFrames === 0) {
      _suspended = false;
    }
  }
}

// Listen for pointer lock changes to absorb the cursor-jump delta
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) {
    // Pointer lock released — absorb incoming cursor jump
    _blankFrames = BLANK_FRAME_COUNT;
  }
});
