// touchControls.js — mobile / tablet touch overlay
//
// Writes directly into the engine's existing `keys` and `euler` objects so
// zero changes are needed in player.js, look.js, or input.js.
//
// Layout:
//   LEFT  half → virtual joystick  (move)
//   RIGHT half → drag-to-look      (camera pan)
//   FIRE button → bottom-right     (calls shoot callback, auto-repeats while held)
//   JUMP button → above fire
//
// Call initTouchControls(keys, euler, shootFn) once after engine boot.
// Call disposeTouchControls() on level reload if needed.

// ── Detection ─────────────────────────────────────────────────────────────────
export function isTouchDevice() {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Mobi|Android|iPhone|iPad|Tablet/i.test(navigator.userAgent)
  );
}

// ── State ─────────────────────────────────────────────────────────────────────
let _keys    = null;
let _euler   = null;
let _shootFn = null;
let _overlay = null;
let _raf     = null;
let _active  = false;

const _joy  = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0, radius: 52 };
const _look = { active: false, id: -1, lx: 0, ly: 0, sensitivity: 0.006 };
const _fire = { active: false, interval: null };

// ── Init ──────────────────────────────────────────────────────────────────────
export function initTouchControls(keys, euler, shootFn) {
  if (!isTouchDevice()) return;
  if (_active) return;
  _keys    = keys;
  _euler   = euler;
  _shootFn = shootFn;
  _active  = true;
  _buildOverlay();
  _attachEvents();
  _raf = requestAnimationFrame(_tick);
  console.log('[touch] Touch controls active');
}

export function disposeTouchControls() {
  _active = false;
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_overlay) { _overlay.remove(); _overlay = null; }
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _buildOverlay() {
  const style = document.createElement('style');
  style.textContent = `
    #tc-overlay{position:fixed;inset:0;z-index:8500;pointer-events:none;
      user-select:none;-webkit-user-select:none;}
    #tc-left{position:absolute;left:0;top:0;bottom:0;width:50%;pointer-events:auto;}
    #tc-right{position:absolute;right:0;top:0;bottom:0;width:50%;pointer-events:auto;}

    /* joystick */
    #tc-base{position:absolute;width:114px;height:114px;border-radius:50%;
      border:2px solid rgba(138,238,138,0.22);
      background:rgba(0,18,0,0.22);
      box-shadow:0 0 22px rgba(74,238,74,0.07),inset 0 0 16px rgba(0,0,0,0.45);
      transform:translate(-50%,-50%);pointer-events:none;display:none;}
    #tc-base::before{content:'';position:absolute;inset:10px;border-radius:50%;
      border:1px solid rgba(138,238,138,0.08);}
    #tc-base.on{display:block;}
    #tc-thumb{position:absolute;width:46px;height:46px;border-radius:50%;
      background:radial-gradient(circle at 38% 35%,rgba(138,238,138,0.5),rgba(18,72,18,0.8));
      border:2px solid rgba(138,238,138,0.65);
      box-shadow:0 0 14px rgba(74,238,74,0.4);
      transform:translate(-50%,-50%);pointer-events:none;display:none;}
    #tc-thumb.on{display:block;}

    /* move label */
    #tc-move-label{position:absolute;bottom:72px;left:50%;transform:translateX(-50%);
      color:rgba(138,238,138,0.18);font-family:'Courier New',monospace;font-size:9px;
      letter-spacing:0.25em;pointer-events:none;text-align:center;}

    /* look zone */
    #tc-look-label{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      color:rgba(138,238,138,0.13);font-family:'Courier New',monospace;font-size:9px;
      letter-spacing:0.2em;pointer-events:none;text-align:center;line-height:2;
      transition:opacity 0.3s;}
    #tc-look-label.hidden{opacity:0;}

    /* corner brackets on look zone */
    #tc-look-bracket{position:absolute;top:50%;left:50%;
      width:52px;height:52px;transform:translate(-50%,-50%);
      pointer-events:none;opacity:0.13;}
    #tc-look-bracket::before,#tc-look-bracket::after{
      content:'';position:absolute;width:14px;height:14px;
      border-color:#8aee8a;border-style:solid;}
    #tc-look-bracket::before{top:0;left:0;border-width:2px 0 0 2px;}
    #tc-look-bracket::after{bottom:0;right:0;border-width:0 2px 2px 0;}

    /* buttons */
    #tc-btns{position:fixed;right:24px;bottom:36px;z-index:8600;
      display:flex;flex-direction:column;align-items:center;gap:16px;
      pointer-events:auto;}
    .tc-btn{width:72px;height:72px;border-radius:50%;
      border:2px solid rgba(138,238,138,0.48);
      display:flex;align-items:center;justify-content:center;
      font-family:'Courier New',monospace;font-size:10px;font-weight:bold;
      letter-spacing:0.1em;color:rgba(138,238,138,0.85);
      -webkit-tap-highlight-color:transparent;cursor:pointer;
      transition:background 0.07s,box-shadow 0.07s;}
    #tc-btn-fire{width:82px;height:82px;
      background:radial-gradient(circle at 40% 38%,rgba(80,200,80,0.15),rgba(0,28,0,0.6));
      box-shadow:0 0 20px rgba(74,238,74,0.18),inset 0 0 12px rgba(0,0,0,0.55);}
    #tc-btn-fire.on{
      background:radial-gradient(circle at 40% 38%,rgba(138,238,138,0.42),rgba(20,80,20,0.7));
      box-shadow:0 0 32px rgba(138,238,138,0.6);}
    #tc-btn-jump{
      background:rgba(0,18,0,0.42);
      box-shadow:0 0 10px rgba(74,238,74,0.08),inset 0 0 8px rgba(0,0,0,0.4);}
    #tc-btn-jump.on{background:rgba(28,78,28,0.65);box-shadow:0 0 20px rgba(138,238,138,0.3);}

    /* scanlines for atmosphere */
    #tc-overlay::after{content:'';position:absolute;inset:0;pointer-events:none;
      background:repeating-linear-gradient(to bottom,transparent 0,transparent 3px,
      rgba(0,0,0,0.025) 3px,rgba(0,0,0,0.025) 4px);}
  `;
  document.head.appendChild(style);

  _overlay = document.createElement('div');
  _overlay.id = 'tc-overlay';
  _overlay.innerHTML = `
    <div id="tc-left">
      <div id="tc-move-label">MOVE</div>
      <div id="tc-base"></div>
      <div id="tc-thumb"></div>
    </div>
    <div id="tc-right">
      <div id="tc-look-label">DRAG<br>TO<br>LOOK</div>
      <div id="tc-look-bracket"></div>
    </div>
    <div id="tc-btns">
      <div class="tc-btn" id="tc-btn-jump">JUMP</div>
      <div class="tc-btn" id="tc-btn-fire">FIRE</div>
    </div>
  `;
  document.body.appendChild(_overlay);
}

// ── Events ────────────────────────────────────────────────────────────────────
function _attachEvents() {
  const leftEl = document.getElementById('tc-left');
  const rightEl = document.getElementById('tc-right');
  const fireEl  = document.getElementById('tc-btn-fire');
  const jumpEl  = document.getElementById('tc-btn-jump');

  leftEl.addEventListener('touchstart',  _joyStart,  { passive: false });
  leftEl.addEventListener('touchmove',   _joyMove,   { passive: false });
  leftEl.addEventListener('touchend',    _joyEnd,    { passive: false });
  leftEl.addEventListener('touchcancel', _joyEnd,    { passive: false });

  rightEl.addEventListener('touchstart',  _lookStart,  { passive: false });
  rightEl.addEventListener('touchmove',   _lookMove,   { passive: false });
  rightEl.addEventListener('touchend',    _lookEnd,    { passive: false });
  rightEl.addEventListener('touchcancel', _lookEnd,    { passive: false });

  fireEl.addEventListener('touchstart', e => {
    e.preventDefault();
    _fire.active = true;
    fireEl.classList.add('on');
    if (_shootFn) _shootFn();
    _fire.interval = setInterval(() => { if (_fire.active && _shootFn) _shootFn(); }, 110);
  }, { passive: false });
  fireEl.addEventListener('touchend', e => {
    e.preventDefault();
    _fire.active = false;
    fireEl.classList.remove('on');
    clearInterval(_fire.interval);
  }, { passive: false });
  fireEl.addEventListener('touchcancel', e => {
    e.preventDefault();
    _fire.active = false;
    fireEl.classList.remove('on');
    clearInterval(_fire.interval);
  }, { passive: false });

  jumpEl.addEventListener('touchstart', e => {
    e.preventDefault();
    if (_keys) _keys.jump = true;
    jumpEl.classList.add('on');
  }, { passive: false });
  jumpEl.addEventListener('touchend', e => {
    e.preventDefault();
    if (_keys) _keys.jump = false;
    jumpEl.classList.remove('on');
  }, { passive: false });
  jumpEl.addEventListener('touchcancel', e => {
    e.preventDefault();
    if (_keys) _keys.jump = false;
    jumpEl.classList.remove('on');
  }, { passive: false });

  // Kill scroll/zoom on canvas
  document.addEventListener('touchmove', e => {
    if (e.target === document.getElementById('renderCanvas')) e.preventDefault();
  }, { passive: false });
}

// ── Joystick ──────────────────────────────────────────────────────────────────
function _joyStart(e) {
  e.preventDefault();
  if (_joy.active) return;
  const t  = e.changedTouches[0];
  const el = document.getElementById('tc-left');
  const r  = el.getBoundingClientRect();
  _joy.active = true;
  _joy.id     = t.identifier;
  _joy.cx     = t.clientX - r.left;
  _joy.cy     = t.clientY - r.top;
  _joy.dx     = 0;
  _joy.dy     = 0;
  const base  = document.getElementById('tc-base');
  const thumb = document.getElementById('tc-thumb');
  base.style.left  = thumb.style.left = _joy.cx + 'px';
  base.style.top   = thumb.style.top  = _joy.cy + 'px';
  base.classList.add('on');
  thumb.classList.add('on');
}

function _joyMove(e) {
  e.preventDefault();
  if (!_joy.active) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== _joy.id) continue;
    const el = document.getElementById('tc-left');
    const r  = el.getBoundingClientRect();
    let dx = (t.clientX - r.left) - _joy.cx;
    let dy = (t.clientY - r.top)  - _joy.cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > _joy.radius) { dx *= _joy.radius/dist; dy *= _joy.radius/dist; }
    _joy.dx = dx / _joy.radius;
    _joy.dy = dy / _joy.radius;
    const thumb = document.getElementById('tc-thumb');
    thumb.style.left = (_joy.cx + dx) + 'px';
    thumb.style.top  = (_joy.cy + dy) + 'px';
  }
}

function _joyEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== _joy.id) continue;
    _joy.active = false; _joy.dx = 0; _joy.dy = 0;
    document.getElementById('tc-base').classList.remove('on');
    document.getElementById('tc-thumb').classList.remove('on');
    _clearMoveKeys();
  }
}

// ── Look ──────────────────────────────────────────────────────────────────────
function _lookStart(e) {
  e.preventDefault();
  if (_look.active) return;
  const t = e.changedTouches[0];
  _look.active = true;
  _look.id     = t.identifier;
  _look.lx     = t.clientX;
  _look.ly     = t.clientY;
  document.getElementById('tc-look-label')?.classList.add('hidden');
}

function _lookMove(e) {
  e.preventDefault();
  if (!_look.active) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== _look.id) continue;
    const ddx = t.clientX - _look.lx;
    const ddy = t.clientY - _look.ly;
    _look.lx = t.clientX;
    _look.ly = t.clientY;
    if (_euler) {
      _euler.y += ddx * _look.sensitivity;
      _euler.x  = Math.max(-1.4, Math.min(1.4, _euler.x + ddy * _look.sensitivity));
    }
  }
}

function _lookEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== _look.id) continue;
    _look.active = false;
    document.getElementById('tc-look-label')?.classList.remove('hidden');
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────
const DEAD = 0.14;

function _tick() {
  if (!_active) return;
  _raf = requestAnimationFrame(_tick);
  if (!_keys) return;
  if (_joy.active) {
    _keys.moveForward = _joy.dy < -DEAD;
    _keys.moveBack    = _joy.dy >  DEAD;
    _keys.moveLeft    = _joy.dx < -DEAD;
    _keys.moveRight   = _joy.dx >  DEAD;
    _keys.sprint      = Math.hypot(_joy.dx, _joy.dy) > 0.78;
  }
}

function _clearMoveKeys() {
  if (!_keys) return;
  _keys.moveForward = _keys.moveBack = _keys.moveLeft = _keys.moveRight = _keys.sprint = false;
}