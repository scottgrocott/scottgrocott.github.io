// audio.js — ToneJS init, enemy engine audio (real ogg files), spatial audio, SFX

export let toneReady = false;

// Default engine audio used for all enemy types when no variant URL is specified
const DEFAULT_ENGINE_URL = 'https://scottgrocott.github.io/mt-assets/enemies/engine.mp3';

function _guard() { return window.Tone && Tone.context.state === 'running'; }

export async function initAudio() {
  if (!window.Tone) return;
  try {
    await Tone.start();
    toneReady = true;
    console.log('[audio] ToneJS started');
  } catch(e) {
    console.warn('[audio] ToneJS start failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Listener — call this every frame with the player/camera world position
// so Panner3D has a reference point for distance rolloff and L/R panning
// ---------------------------------------------------------------------------
export function updateAudioListener(pos, forwardX = 0, forwardZ = -1) {
  window._audioListenerPos = pos;
}

// ---------------------------------------------------------------------------
// Per-enemy engine audio — looping Player with distance-based volume
// ---------------------------------------------------------------------------
export function createEnemySynth(type, engineUrl) {
  if (!_guard()) return null;
  try {
    const url = engineUrl || DEFAULT_ENGINE_URL;

    // Simple volume node — we calculate distance attenuation manually each frame
    const vol = new Tone.Volume(-6).toDestination();

    // Sentinel returned immediately — player populated once load completes
    const handle = { player: null, vol, type, _loading: true };

    const player = new Tone.Player({
      loop:      true,
      autostart: false,
    }).connect(vol);

    player.load(url).then(() => {
      handle.player = player;
      handle._loading = false;
      vol.volume.value = -6;  // audible default until first spatial update
      try { player.start(); } catch(e) {}
      console.log(`[audio] Engine playing for ${type}`);
    }).catch(err => {
      handle._loading = false;
      console.warn(`[audio] Engine load failed for ${type}:`, err);
      try { player.dispose(); } catch(e) {}
    });

    return handle;

  } catch(e) {
    console.warn('[audio] createEnemySynth failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-frame: update volume based on distance to player
// pos = enemy world position {x,y,z}
// listenerPos = player world position {x,y,z}  (passed in from tick)
// ---------------------------------------------------------------------------
export function updateEnemySpatial(synthObj, pos, listenerPos) {
  if (!synthObj?.vol) return;
  try {
    // DEBUG — remove after confirming audio works
    if (!synthObj._dbg) {
      synthObj._dbg = true;
      console.log('[audio] updateEnemySpatial FIRST CALL — vol:', synthObj.vol?.volume?.value, 'player state:', synthObj.player?.state, 'listenerPos:', window._audioListenerPos);
    }
    const lp = listenerPos || window._audioListenerPos;
    // If we have no listener position yet, play at medium volume rather than silence
    const dist = lp
      ? Math.sqrt((pos.x-lp.x)**2 + (pos.y-lp.y)**2 + (pos.z-lp.z)**2)
      : 20;
    // Full volume under 8 units, silent beyond 80
    const MIN_DIST = 8, MAX_DIST = 80;
    const clamped = Math.max(MIN_DIST, Math.min(MAX_DIST, dist));
    const t = (clamped - MIN_DIST) / (MAX_DIST - MIN_DIST);
    synthObj.vol.volume.value = -6 + (t * -40);
  } catch(e) {}
}

export function disposeEnemySynth(synthObj) {
  if (!synthObj) return;
  try {
    if (synthObj.player) { try { synthObj.player.stop(); } catch(e) {} synthObj.player.dispose(); }
    if (synthObj.vol)    synthObj.vol.dispose();
  } catch(e) {}
}

// ---------------------------------------------------------------------------
// SFX
// ---------------------------------------------------------------------------
export function playExplosion() {
  if (!_guard()) return;
  try {
    const noise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.1 }
    }).toDestination();
    noise.triggerAttackRelease('8n');
    setTimeout(() => { try { noise.dispose(); } catch(e){} }, 1000);
  } catch(e) {}
}

export function playTopple() {
  if (!_guard()) return;
  const partCount = 4 + Math.floor(Math.random() * 6);
  for (let i = 0; i < partCount; i++) {
    if (Math.random() > 0.4) continue;
    const delay = Math.random() * 600;
    setTimeout(() => {
      if (!_guard()) return;
      try {
        const m = new Tone.MembraneSynth().toDestination();
        m.triggerAttackRelease('C1', '8n');
        setTimeout(() => { try { m.dispose(); } catch(e){} }, 1000);
      } catch(e) {}
    }, delay);
  }
}