// audio.js — ToneJS init, enemy synths, spatial audio, SFX
// Mute/solo channels: music | env | enemy
// Use muteChannel('music', true/false), soloChannel('music'), unsoloAll()

export let toneReady = false;

function _guard() { return window.Tone && Tone.context.state === 'running'; }

// ── Channel volume nodes ───────────────────────────────────────────────────────
// Each channel routes through its own Gain node so we can mute/solo independently
let _musicGain  = null;
let _envGain    = null;
let _enemyGain  = null;
let _sfxGain    = null;

// Channel state: saved volumes before mute/solo
const _channels = {
  music: { muted: false, soloed: false, volume: -6  },
  env:   { muted: false, soloed: false, volume: -8  },
  enemy: { muted: false, soloed: false, volume: -12 },
  sfx:   { muted: false, soloed: false, volume: -4  },
};

function _getGain(channel) {
  if (channel === 'music') return _musicGain;
  if (channel === 'env')   return _envGain;
  if (channel === 'enemy') return _enemyGain;
  if (channel === 'sfx')   return _sfxGain;
  return null;
}

function _applyChannelState() {
  if (!_guard()) return;
  const anySolo = Object.values(_channels).some(c => c.soloed);
  for (const [name, state] of Object.entries(_channels)) {
    const gain = _getGain(name);
    if (!gain) continue;
    const silenced = state.muted || (anySolo && !state.soloed);
    try {
      gain.gain.rampTo(silenced ? 0 : Tone.dbToGain(state.volume), 0.15);
    } catch(e) {}
  }
}

/** Mute or unmute a channel. channel: 'music' | 'env' | 'enemy' | 'sfx' */
export function muteChannel(channel, muted) {
  if (!_channels[channel]) return;
  _channels[channel].muted = muted;
  _applyChannelState();
  console.log(`[audio] ${channel} ${muted ? 'muted' : 'unmuted'}`);
}

/** Solo a channel — all others go silent. Call unsoloAll() to restore. */
export function soloChannel(channel) {
  if (!_channels[channel]) return;
  for (const c of Object.values(_channels)) c.soloed = false;
  _channels[channel].soloed = true;
  _applyChannelState();
  console.log(`[audio] solo: ${channel}`);
}

export function unsoloAll() {
  for (const c of Object.values(_channels)) c.soloed = false;
  _applyChannelState();
  console.log('[audio] unsolo all');
}

/** Set volume (dB) for a channel */
export function setChannelVolume(channel, db) {
  if (!_channels[channel]) return;
  _channels[channel].volume = db;
  _applyChannelState();
}

/** Returns {muted, soloed, volume} for each channel */
export function getChannelStates() {
  return JSON.parse(JSON.stringify(_channels));
}

/** Returns the Tone.Gain node for a channel — for external routing */
export function getGainNode(channel) {
  return _getGain(channel);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initAudio() {
  if (!window.Tone) return;
  try {
    await Tone.start();

    // Create channel gain nodes
    _musicGain  = new Tone.Gain(Tone.dbToGain(_channels.music.volume)).toDestination();
    _envGain    = new Tone.Gain(Tone.dbToGain(_channels.env.volume)).toDestination();
    _enemyGain  = new Tone.Gain(Tone.dbToGain(_channels.enemy.volume)).toDestination();
    _sfxGain    = new Tone.Gain(Tone.dbToGain(_channels.sfx.volume)).toDestination();

    toneReady = true;
    console.log('[audio] ToneJS started — channels: music, env, enemy, sfx');
  } catch(e) {
    console.warn('[audio] ToneJS start failed:', e);
  }
}

// ── Enemy synths (route through enemyGain) ────────────────────────────────────

export function createEnemySynth(type) {
  if (!_guard()) return null;
  try {
    let synth;
    const panner = new Tone.Panner3D({ panningModel: 'HRTF', rolloffFactor: 1.5 });
    panner.connect(_enemyGain ?? Tone.Destination);

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
    } else if (type === 'boat') {
      synth = new Tone.FMSynth({
        harmonicity: 1.2, modulationIndex: 4,
        envelope: { attack: 0.3, decay: 0.4, sustain: 0.7, release: 2.0 },
      }).connect(panner);
      synth.triggerAttack('D0');
    } else if (type === 'submarine') {
      synth = new Tone.AMSynth({
        harmonicity: 0.5,
        envelope: { attack: 0.8, decay: 1.0, sustain: 0.8, release: 3.0 },
      }).connect(panner);
      synth.triggerAttack('A#0');
    }

    return { synth, panner };
  } catch(e) {
    console.warn('[audio] createEnemySynth failed:', e);
    return null;
  }
}

export function updateEnemySpatial(synthObj, pos) {
  if (!_guard() || !synthObj?.panner) return;
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
    if (synthObj.synth) { synthObj.synth.triggerRelease(); synthObj.synth.dispose(); }
    if (synthObj.panner) synthObj.panner.dispose();
  } catch(e) {}
}

// ── SFX (route through sfxGain) ───────────────────────────────────────────────

export function playExplosion(pos) {
  if (!_guard()) return;
  try {
    const noise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.1 }
    }).connect(_sfxGain ?? Tone.Destination);
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
        const m = new Tone.MembraneSynth().connect(_sfxGain ?? Tone.Destination);
        m.triggerAttackRelease('C1', '8n');
        setTimeout(() => { try { m.dispose(); } catch(e){} }, 1000);
      } catch(e) {}
    }, delay);
  }
}

/** Bullet impact sound — short wooden thump */
export function playBulletImpact() {
  if (!_guard()) return;
  try {
    const m = new Tone.MembraneSynth({
      pitchDecay: 0.02, octaves: 4,
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }
    }).connect(_sfxGain ?? Tone.Destination);
    m.triggerAttackRelease('G2', '32n');
    setTimeout(() => { try { m.dispose(); } catch(e){} }, 500);
  } catch(e) {}
}

/** Structure hits ground / collapse impact */
export function playStructureCollapse() {
  if (!_guard()) return;
  try {
    const noise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.01, decay: 0.6, sustain: 0.1, release: 0.4 }
    }).connect(_sfxGain ?? Tone.Destination);
    const mem = new Tone.MembraneSynth({
      pitchDecay: 0.08, octaves: 6,
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 }
    }).connect(_sfxGain ?? Tone.Destination);
    noise.triggerAttackRelease('8n');
    mem.triggerAttackRelease('D1', '8n');
    setTimeout(() => {
      try { noise.dispose(); mem.dispose(); } catch(e){}
    }, 2000);
  } catch(e) {}
}

export function updateAudioListener(pos) {
  if (!_guard()) return;
  try {
    Tone.Listener.positionX.value = +pos.x || 0;
    Tone.Listener.positionY.value = +pos.y || 0;
    Tone.Listener.positionZ.value = +pos.z || 0;
  } catch(e) {}
}