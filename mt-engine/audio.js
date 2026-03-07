// audio.js — ToneJS init, enemy engine audio (real ogg files), spatial audio, SFX

export let toneReady = false;

// Permanent CDN locations for enemy engine sounds
const ENGINE_URLS = {
  drone:    'https://scottgrocott.github.io/mt-assets/enemies/audio/drone_engine.ogg',
  car:      'https://scottgrocott.github.io/mt-assets/enemies/audio/car_engine.ogg',
  forklift: 'https://scottgrocott.github.io/mt-assets/enemies/audio/forklift_engine.ogg',
};

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
  if (!_guard()) return;
  try {
    const ctx = Tone.context.rawContext;
    const L   = ctx.listener;
    if (!L) return;

    // Position
    if (L.positionX) {
      L.positionX.value = pos.x;
      L.positionY.value = pos.y;
      L.positionZ.value = pos.z;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
    }

    // Forward vector (which way the player is facing)
    if (L.forwardX) {
      L.forwardX.value = forwardX;
      L.forwardY.value = 0;
      L.forwardZ.value = forwardZ;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setOrientation(forwardX, 0, forwardZ, 0, 1, 0);
    }
  } catch(e) {}
}

// ---------------------------------------------------------------------------
// Per-enemy engine audio — real ogg with synth fallback
// ---------------------------------------------------------------------------
export function createEnemySynth(type, engineUrl) {
  if (!_guard()) return null;
  try {
    const panner = new Tone.Panner3D({
      panningModel:         'HRTF',
      distanceModel:        'inverse',
      refDistance:          1,
      maxDistance:          80,
      rolloffFactor:        2.0,
      coneInnerAngle:       360,
      coneOuterAngle:       360,
      coneOuterGain:        0,
    }).toDestination();

    const url = engineUrl || ENGINE_URLS[type];
    if (!url) return _startSynthFallback(type, panner);

    // Construct player without passing url — load separately to avoid double-fetch
    const player = new Tone.Player({
      loop:      true,
      autostart: false,
      volume:    -4,
    }).connect(panner);

    const loadTimeout = setTimeout(() => {
      console.warn(`[audio] Engine load timed out for ${type} — synth fallback`);
      try { player.dispose(); } catch(e) {}
      _startSynthFallback(type, panner);
    }, 6000);

    player.load(url).then(() => {
      clearTimeout(loadTimeout);
      try { player.start(); } catch(e) {}
      console.log(`[audio] Engine playing for ${type}`);
    }).catch(err => {
      clearTimeout(loadTimeout);
      console.warn(`[audio] Engine load failed for ${type}:`, err);
      try { player.dispose(); } catch(e) {}
      _startSynthFallback(type, panner);
    });

    return { player, panner, type };

  } catch(e) {
    console.warn('[audio] createEnemySynth failed:', e);
    return null;
  }
}

function _startSynthFallback(type, panner) {
  try {
    let synth;
    if (type === 'drone') {
      synth = new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 2,
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.8 }
      }).connect(panner);
      synth.triggerAttack('C1');
    } else if (type === 'car') {
      synth = new Tone.FMSynth({
        harmonicity: 3, modulationIndex: 10,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.5 },
      }).connect(panner);
      synth.triggerAttack('A0');
    } else if (type === 'forklift') {
      synth = new Tone.AMSynth({
        harmonicity: 2.5,
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 1.0 },
      }).connect(panner);
      synth.triggerAttack('E0');
    }
    return synth ? { synth, panner, type } : null;
  } catch(e) {
    console.warn('[audio] synth fallback failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-frame: move enemy sound source to current world position
// ---------------------------------------------------------------------------
export function updateEnemySpatial(synthObj, pos) {
  if (!synthObj?.panner) return;
  try {
    const px = +pos.x, py = +pos.y, pz = +pos.z;
    if (isNaN(px)) return;
    synthObj.panner.positionX.value = px;
    synthObj.panner.positionY.value = py;
    synthObj.panner.positionZ.value = pz;
  } catch(e) {}
}

export function disposeEnemySynth(synthObj) {
  if (!synthObj) return;
  try {
    if (synthObj.player) { try { synthObj.player.stop(); } catch(e) {} synthObj.player.dispose(); }
    if (synthObj.synth)  { synthObj.synth.triggerRelease(); synthObj.synth.dispose(); }
    if (synthObj.panner) synthObj.panner.dispose();
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
