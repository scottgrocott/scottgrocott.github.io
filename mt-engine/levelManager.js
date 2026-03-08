// levelManager.js — level completion detection, splash screen, next-level progression

import { getEnemies } from './enemies/enemyRegistry.js';
import { CONFIG }     from './config.js';

let _active        = false;
let _completed     = false;
let _checkDelay    = 3.0;   // seconds after load before checking (let enemies spawn)
let _checkTimer    = 0;
let _splashEl      = null;
let _onLoadLevel   = null;  // callback: fn(url) — provided by main.js

// ── Public API ────────────────────────────────────────────────────────────────

export function initLevelManager(onLoadLevelFn) {
  _onLoadLevel           = onLoadLevelFn;
  _active                = false;
  _completed             = false;
  _checkTimer            = 0;
  window._levelComplete  = false;   // allow respawns on fresh level
  _hideSplash();
  console.log('[levelManager] Ready');
}

export function startLevelCheck() {
  _active    = true;
  _completed = false;
  _checkTimer = 0;
}

export function stopLevelCheck() {
  _active = false;
}

export function tickLevelManager(dt) {
  if (!_active || _completed) return;

  // Wait for initial spawn delay
  _checkTimer += dt;
  if (_checkTimer < _checkDelay) return;

  const enemies = getEnemies();
  if (enemies.length === 0) return;  // nothing spawned yet

  // An enemy counts as "down" if dead AND either destroyed (no respawn)
  // or all others are also dead (whole wave wiped simultaneously).
  // Simplest reliable rule: all enemies currently have dead===true.
  // To prevent respawns blocking this, levelManager sets window._levelComplete=true
  // which stops all pending respawn timeouts from reviving enemies.
  const allDown = enemies.every(e => e.dead);
  if (allDown) {
    _completed             = true;
    _active                = false;
    window._levelComplete  = true;   // blocks respawn timeouts in takeDamage

    // GA: all_enemies_dead (before splash shown)
    const urlParam2   = new URLSearchParams(window.location.search).get('level');
    const currentId2  = urlParam2 ? `level-${urlParam2}` : ((CONFIG.meta?.levels||[])[0]?.id || 'level-1');
    window._gaEvent?.('all_enemies_dead', {
      level_id: currentId2,
      game_title: CONFIG.meta?.title || 'Metal Throne',
    });
    _showSplash();
  }
}

// ── Splash screen ─────────────────────────────────────────────────────────────

function _showSplash() {
  _hideSplash();
  // Release pointer lock so the player can interact with the splash UI
  try { document.exitPointerLock(); } catch(e) {}

  const meta        = CONFIG.meta || {};
  const levels      = meta.levels || [];
  const totalLevels = meta.total_levels || 1;
  const splashHtml  = meta.splash_screen || '';

  // Determine current level id from URL param (?level=N) or meta.levels[0].id
  const urlParam    = new URLSearchParams(window.location.search).get('level');
  const currentId   = urlParam ? `level-${urlParam}` : (levels[0]?.id || 'level-1');
  const currentNum  = _parseLevelNum(currentId);
  const isLast      = currentNum >= totalLevels;

  const nextNum     = isLast ? 1 : currentNum + 1;
  const nextLabel   = isLast ? '↺ Restart Game' : `▶ Play Level ${nextNum}`;
  const nextUrl     = `?level=${nextNum}`;

  // Find title/subtitle for current level
  const levelMeta   = levels.find(l => l.id === currentId) || levels[0] || {};
  const title       = levelMeta.title    || CONFIG.meta?.title || 'LEVEL COMPLETE';
  const subtitle    = levelMeta.subtitle || '';

  const el = document.createElement('div');
  el.id = 'level-splash';
  el.innerHTML = `
    <div class="splash-inner">
      <div class="splash-badge">✓ COMPLETE</div>
      <div class="splash-title">${title}</div>
      ${subtitle ? `<div class="splash-sub">${subtitle}</div>` : ''}
      ${splashHtml ? `<div class="splash-social">${splashHtml}</div>` : ''}
      <button class="splash-btn" id="splash-next-btn">${nextLabel}</button>
    </div>
  `;

  // Inline styles — self-contained, no external CSS needed
  el.style.cssText = `
    position:fixed;inset:0;z-index:99990;
    background:rgba(0,8,0,0.88);
    display:flex;align-items:center;justify-content:center;
    font-family:'Courier New',monospace;color:#8aee8a;
    animation:splashFadeIn 0.6s ease;
  `;

  // Inject keyframe if not already present
  if (!document.getElementById('splash-keyframes')) {
    const style = document.createElement('style');
    style.id = 'splash-keyframes';
    style.textContent = `
      @keyframes splashFadeIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
      #level-splash .splash-inner {
        text-align:center;max-width:520px;padding:48px 40px;
        border:1px solid #2a6a2a;background:rgba(0,16,0,0.7);border-radius:4px;
      }
      #level-splash .splash-badge {
        font-size:11px;letter-spacing:0.3em;color:#4aee4a;margin-bottom:18px;
      }
      #level-splash .splash-title {
        font-size:28px;letter-spacing:0.2em;margin-bottom:8px;
      }
      #level-splash .splash-sub {
        font-size:12px;color:#4a7a4a;letter-spacing:0.15em;margin-bottom:24px;
      }
      #level-splash .splash-social {
        margin:20px 0;font-size:12px;line-height:1.8;
      }
      #level-splash .splash-social a {
        color:#4aee8a;text-decoration:none;margin:0 8px;
      }
      #level-splash .splash-social a:hover { color:#8aee8a; }
      #level-splash .splash-btn {
        margin-top:28px;padding:10px 32px;
        background:#0e2a0e;border:1px solid #4aee4a;
        color:#8aee8a;font-family:'Courier New',monospace;
        font-size:13px;letter-spacing:0.15em;cursor:pointer;border-radius:2px;
        transition:background 0.2s;
      }
      #level-splash .splash-btn:hover { background:#1a4a1a; }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(el);
  _splashEl = el;

  document.getElementById('splash-next-btn').addEventListener('click', () => {
    // GA: level_complete event with level info
    window._gaEvent?.('level_complete', {
      level_id:    currentId,
      level_num:   currentNum,
      level_title: title,
      is_last:     isLast,
      next_level:  isLast ? 1 : nextNum,
    });
    _hideSplash();
    _loadNextLevel(nextUrl);
  });

  console.log(`[levelManager] Level complete — ${isLast ? 'last level, restart' : `next: level-${nextNum}`}`);
}

function _hideSplash() {
  if (_splashEl) {
    _splashEl.remove();
    _splashEl = null;
  }
  const existing = document.getElementById('level-splash');
  if (existing) existing.remove();
}

function _loadNextLevel(urlQuery) {
  // Navigate to next level — simplest reliable approach
  const base = window.location.href.split('?')[0];
  window.location.href = base + urlQuery;
}

function _parseLevelNum(id) {
  // 'level-5' → 5, 'level-12' → 12
  const m = String(id).match(/(\d+)$/);
  return m ? parseInt(m[1]) : 1;
}