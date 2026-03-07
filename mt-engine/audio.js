// audio.js — ToneJS init, enemy engine audio (real ogg files), spatial audio, SFX

export let toneReady = false;

// Permanent CDN locations for enemy engine sounds
const ENGINE_URLS = {
  drone:    'https://scottgrocott.github.io/mt-assets/enemies/audio/drone_engine.ogg',
  car:      'https://scottgrocott.github.io/mt-assets/enemies/audio/car_engine.ogg',
  forklift: 'https://scottgrocott.github.io/mt-assets/enemies/audio/forklift_engine.ogg',
};

// Safely guard every audio call
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

// Per-enemy engine audio factory — loads real ogg, falls back to synth if file missing
export function createEnemySynth(type, engineUrl) {
  if (!_guard()) return null;
  try {
    const panner = new Tone.Panner3D({ panningModel: 'HRTF', rolloffFactor: 1.5 }).toDestination();
    const url = engineUrl || ENGINE_URLS[type];

    if (url) {
      // Real audio file — loop it as the engine sound
      const player = new Tone.Player({
        url,
        loop: true,
        autostart: false,
        volume: -6,
      }).connect(panner);

      // Start once loaded; if the file 404s, onload never fires — synth fallback kicks in
      const loadTimeout = setTimeout(() => {
        console.warn(`[audio] Engine file timed out for ${type}, using synth fallback`);
        player.dispose();
        _startSynthFallback(type, panner);
      }, 5000);

      player.load(url).then(() => {
        clearTimeout(loadTimeout);
        try { player.start(); } catch(e) {}
        console.log(`[audio] Engine player started for ${type}`);
      }).catch(() => {
        clearTimeout(loadTimeout);
        console.warn(`[audio] Engine file failed for ${type}, using synth fallback`);
        player.dispose();
        _startSynthFallback(type, panner);
      });

      return { player, panner, type };
    }

    // No URL at all — go straight to synth
    return _startSynthFallback(type, panner);

  } catch(e) {
    console.warn('[audio] createEnemySynth failed:', e);
    return null;
  }
}

// Tone.js synth fallback — identical to the original behaviour
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
    return { synth, panner, type };
  } catch(e) {
    console.warn('[audio] synth fallback failed:', e);
    return null;
  }
}

export function updateEnemySpatial(synthObj, pos) {
  if (!_guard() || !synthObj || !synthObj.panner) return;
  try {
    const px = +pos.x, py = +pos.y, pz = +pos.z;
    if (!isNaN(px)) {
      synthObj.panner.positionX.value = px;
      synthObj.panner.positionY.value = py;
      synthObj.panner.positionZ.value = pz;
    }
  } catch(e) {}
}

export function disposeEnemySynth(synthObj) {
  if (!synthObj) return;
  try {
    // Real audio player path
    if (synthObj.player) { try { synthObj.player.stop(); } catch(e) {} synthObj.player.dispose(); }
    // Synth fallback path
    if (synthObj.synth)  { synthObj.synth.triggerRelease(); synthObj.synth.dispose(); }
    if (synthObj.panner) synthObj.panner.dispose();
  } catch(e) {}
}

export function playExplosion(pos) {
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