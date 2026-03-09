// ── Metal Throne — Browser Console Utilities ─────────────────────────────────
// Paste this entire block into the DevTools console after the game has loaded.
//
// Four independent audio buses:
//   music   — battle / adventure soundtrack tracks
//   env     — environmental soundscape (wind, water, insects)
//   enemy   — enemy engine / spatial synths
//   sfx     — bullet impacts, collapses, explosions
//
// Usage:
//   mtMute('music')           mute music bus
//   mtUnmute('env')           unmute env bus
//   mtSolo('enemy')           solo enemy — silences all others
//   mtUnsolo()                restore all
//   mtVolume('sfx', -10)      set bus volume in dB
//   mtStatus()                print current state of all buses
//   mtMuteAll() / mtUnmuteAll()

(function() {
  'use strict';

  // ── Resolve bus Gain nodes from the engine's exported channel API ───────────
  // The engine exports muteChannel / soloChannel / unsoloAll / setChannelVolume
  // via the audio module. We proxy those here so this script doesn't need imports.
  //
  // Strategy: the engine attaches a _mtAudio handle to window when audio starts.
  // If that isn't present, we fall back to direct Tone.js gain manipulation.

  function _api() {
    // Prefer the exported engine handle
    if (window._mtAudio) return window._mtAudio;
    // Fallback: try dynamically importing the engine's audio module
    // (works in browsers that support dynamic import from console)
    return null;
  }

  // Thin wrapper that calls the engine's channel API if available,
  // or prints a warning if the audio module hasn't been attached yet.
  function _call(fn, ...args) {
    const api = _api();
    if (api && typeof api[fn] === 'function') {
      return api[fn](...args);
    }
    // If engine exposes functions directly on window (some setups do):
    const wfn = window['mt_' + fn] ?? window[fn];
    if (typeof wfn === 'function') return wfn(...args);
    console.warn(`[mt-utils] Engine audio API not ready. Call after the game loads. (looking for: ${fn})`);
  }

  // ── State mirror (for mtStatus printout) ─────────────────────────────────
  const _state = {
    music: { muted: false, soloed: false, volume: -6  },
    env:   { muted: false, soloed: false, volume: -8  },
    enemy: { muted: false, soloed: false, volume: -12 },
    sfx:   { muted: false, soloed: false, volume: -4  },
  };
  const BUSES = Object.keys(_state);

  function _assertBus(name) {
    if (!_state[name]) {
      console.error(`[mt-utils] Unknown bus "${name}". Valid: ${BUSES.join(', ')}`);
      return false;
    }
    return true;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Mute one bus. bus = 'music' | 'env' | 'enemy' | 'sfx' */
  window.mtMute = function(bus) {
    if (!_assertBus(bus)) return;
    _state[bus].muted = true;
    _call('muteChannel', bus, true);
    console.log(`[mt] 🔇 ${bus} muted`);
  };

  /** Unmute one bus */
  window.mtUnmute = function(bus) {
    if (!_assertBus(bus)) return;
    _state[bus].muted = false;
    _call('muteChannel', bus, false);
    console.log(`[mt] 🔊 ${bus} unmuted`);
  };

  /** Toggle mute on a bus */
  window.mtToggle = function(bus) {
    if (!_assertBus(bus)) return;
    if (_state[bus].muted) window.mtUnmute(bus);
    else                   window.mtMute(bus);
  };

  /** Solo one bus — all others silenced */
  window.mtSolo = function(bus) {
    if (!_assertBus(bus)) return;
    for (const b of BUSES) _state[b].soloed = false;
    _state[bus].soloed = true;
    _call('soloChannel', bus);
    console.log(`[mt] 🎯 solo: ${bus}`);
  };

  /** Unsolo all — restore normal mix */
  window.mtUnsolo = function() {
    for (const b of BUSES) _state[b].soloed = false;
    _call('unsoloAll');
    console.log('[mt] unsolo all');
  };

  /** Set bus volume in dB. E.g. mtVolume('music', -20) */
  window.mtVolume = function(bus, db) {
    if (!_assertBus(bus)) return;
    _state[bus].volume = db;
    _call('setChannelVolume', bus, db);
    console.log(`[mt] 🎚  ${bus} volume → ${db} dB`);
  };

  /** Mute all buses */
  window.mtMuteAll = function() {
    for (const b of BUSES) window.mtMute(b);
  };

  /** Unmute all buses */
  window.mtUnmuteAll = function() {
    for (const b of BUSES) window.mtUnmute(b);
  };

  /** Print current state of all buses */
  window.mtStatus = function() {
    const engineState = _call('getChannelStates') ?? {};
    console.group('[mt] Audio bus status');
    for (const b of BUSES) {
      const eng = engineState[b] ?? _state[b];
      const icon = eng.muted ? '🔇' : eng.soloed ? '🎯' : '🔊';
      console.log(`  ${icon}  ${b.padEnd(6)}  vol:${String(eng.volume).padStart(4)} dB  muted:${eng.muted}  soloed:${eng.soloed}`);
    }
    console.groupEnd();
  };

  // ── Convenience: quick shortcuts ─────────────────────────────────────────
  // mtM()  = mute music    mtE() = mute env    mtX() = mute enemy   mtS() = mute sfx
  window.mtM = () => window.mtToggle('music');
  window.mtE = () => window.mtToggle('env');
  window.mtX = () => window.mtToggle('enemy');
  window.mtS = () => window.mtToggle('sfx');

  // Print help on load
  console.log(
    '%c[mt-utils] Audio controls loaded\n' +
    'mtMute/mtUnmute/mtToggle(bus)  •  mtSolo(bus)  •  mtUnsolo()\n' +
    'mtVolume(bus, dB)  •  mtMuteAll()  •  mtUnmuteAll()  •  mtStatus()\n' +
    'Shortcuts: mtM() mtE() mtX() mtS()   buses: music | env | enemy | sfx',
    'color:#8aee8a;font-family:monospace'
  );

})();
