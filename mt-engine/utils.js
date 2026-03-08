// ── Metal Throne — Browser Console Utilities ─────────────────────────────────
// Paste this entire block into DevTools console after audio has started.
// Works on any Metal Throne level page.

// ── Music / Audio master toggle ──────────────────────────────────────────────
window.toggleMusic = (() => {
  let _muted = false;
  return function toggleMusic() {
    if (!window.Tone) { console.warn('[mt] Tone.js not loaded yet'); return; }
    _muted = !_muted;
    Tone.getDestination().mute = _muted;
    console.log('[mt] Audio', _muted ? '🔇 MUTED' : '🔊 UNMUTED');
    return _muted ? 'music off' : 'music on';
  };
})();

// Separate controls for music vs enemy/sfx if needed:
window.setMusicVol  = (db) => { if (window.Tone) Tone.getDestination().volume.value = db; };
window.muteMusic    = ()   => toggleMusic();

console.log('%c[mt] Console utils loaded. Call toggleMusic() to toggle audio on/off.', 'color:#4aee4a');