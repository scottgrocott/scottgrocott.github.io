// soundtrack.js — environment soundscape + zone-based dynamic music
//
// Two systems running in parallel:
//   1. SOUNDSCAPE  — continuous ambient sounds from sounds.json (wind, animals etc.)
//   2. MUSIC       — looping Tone.Transport sequences from music.json
//                    zone switches: outerZone=wind(off), midZone=adventure, innerZone=battle
//
// On load: one battle theme and one adventure theme are randomly selected from the pool.
// The active theme crossfades in/out as the player moves between zones.

import { getEnvironment } from './environment.js';
import { CONFIG }         from './config.js';
import { playerRig }      from './player.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _soundscapeNodes = [];
let _reverb          = null;

// Music
let _transport       = null;
let _activeParts     = [];      // currently playing Tone.Part instances
let _activeTheme     = null;    // 'none' | 'adventure' | 'battle'
let _adventureTheme  = null;    // randomly selected theme object
let _battleTheme     = null;    // randomly selected theme object
let _instruments     = {};      // id → Tone synth instance
let _masterVol       = null;    // master volume node for music
let _musicReady      = false;

// Zone config from level CONFIG.audio
let _outerR  = 280;
let _midR    = 150;
let _innerR  = 60;

// ── Public API ────────────────────────────────────────────────────────────────

export function initSoundtrack() {
  disposeSoundtrack();
  if (!_guard()) return;

  const env = getEnvironment();
  if (!env) return;

  // Read zone radii from level config
  const audioCfg = CONFIG.audio || {};
  _outerR = audioCfg.outerZone?.radius ?? 280;
  _midR   = audioCfg.midZone?.radius   ?? 150;
  _innerR = audioCfg.innerZone?.radius  ?? 60;

  // 1. Start soundscape
  _initSoundscape(env.sounds);

  // 2. Prepare music (randomly pick one battle + one adventure theme)
  _initMusic(env.music);
}

export function tickSoundtrack(dt) {
  if (!_guard()) return;
  _tickSoundscape(dt || 0.016);
  _tickMusicZone();
}

export function disposeSoundtrack() {
  // Stop transport and dispose parts
  _stopAllParts();
  _disposeInstruments();
  if (_masterVol)  { try { _masterVol.dispose();  } catch(e) {} _masterVol  = null; }

  // Dispose soundscape
  for (const node of _soundscapeNodes) _disposeNode(node);
  _soundscapeNodes = [];
  if (_reverb) { try { _reverb.dispose(); } catch(e) {} _reverb = null; }

  _activeTheme  = null;
  _musicReady   = false;
  _adventureTheme = null;
  _battleTheme    = null;
}

// ── Zone detection ────────────────────────────────────────────────────────────

function _tickMusicZone() {
  if (!_musicReady || !playerRig) return;

  const p    = playerRig.position;
  const dist = Math.sqrt(p.x * p.x + p.z * p.z);  // distance from map centre

  let wantedZone;
  if      (dist <= _innerR) wantedZone = 'battle';
  else if (dist <= _midR)   wantedZone = 'adventure';
  else                      wantedZone = 'none';

  if (wantedZone === _activeTheme) return;

  _activeTheme = wantedZone;
  _stopAllParts();

  if (wantedZone === 'battle'    && _battleTheme)    _playTheme(_battleTheme);
  if (wantedZone === 'adventure' && _adventureTheme) _playTheme(_adventureTheme);

  console.log('[soundtrack] Zone →', wantedZone);
}

// ── Music init ────────────────────────────────────────────────────────────────

function _initMusic(musicData) {
  if (!musicData) return;
  try {
    const battlePool    = musicData.battle    || [];
    const adventurePool = musicData.adventure || [];

    if (battlePool.length === 0 && adventurePool.length === 0) return;

    _battleTheme    = battlePool.length    ? _pick(battlePool)    : null;
    _adventureTheme = adventurePool.length ? _pick(adventurePool) : null;

    // Shared master volume for music (separate from soundscape)
    _masterVol = new Tone.Volume(-6).toDestination();

    _musicReady = true;
    console.log('[soundtrack] Music ready |',
      'battle:', _battleTheme?.name || 'none',
      '| adventure:', _adventureTheme?.name || 'none');
  } catch(e) {
    console.warn('[soundtrack] Music init failed:', e);
  }
}

function _playTheme(theme) {
  if (!theme || !_masterVol) return;
  try {
    // Build instrument map for this theme
    _disposeInstruments();
    _instruments = {};
    for (const inst of (theme.instruments || [])) {
      const synth = _makeSynth(inst.type, inst.options || {});
      if (synth) {
        synth.connect(_masterVol);
        _instruments[inst.id] = synth;
      }
    }

    // Build one Tone.Part per sequence and start transport
    const bpm = theme.bpm || 120;
    Tone.getTransport().bpm.value = bpm;
    Tone.getTransport().loop      = true;
    Tone.getTransport().loopStart = 0;
    Tone.getTransport().loopEnd   = theme.loopEnd || '1m';

    for (const seq of (theme.sequences || [])) {
      const synth = _instruments[seq.instrumentId];
      if (!synth) continue;

      const events = (seq.events || []).map(ev => [ev.time, ev]);
      const part = new Tone.Part((time, ev) => {
        try {
          const note = ev.note;
          const dur  = ev.duration || '8n';
          // PolySynth and chords: note can be array
          if (Array.isArray(note)) {
            synth.triggerAttackRelease(note, dur, time);
          } else {
            synth.triggerAttackRelease(note, dur, time);
          }
        } catch(e) {}
      }, events);

      part.loop     = true;
      part.loopEnd  = theme.loopEnd || '1m';
      part.start(0);
      _activeParts.push(part);
    }

    if (Tone.getTransport().state !== 'started') {
      Tone.getTransport().start();
    }

    console.log('[soundtrack] Playing:', theme.name);
  } catch(e) {
    console.warn('[soundtrack] _playTheme failed:', e);
  }
}

function _stopAllParts() {
  try {
    for (const part of _activeParts) {
      try { part.stop(); part.dispose(); } catch(e) {}
    }
    _activeParts = [];
    // Don't stop transport — let it idle so restart is seamless
  } catch(e) {}
}

function _disposeInstruments() {
  for (const synth of Object.values(_instruments)) {
    try { synth.dispose(); } catch(e) {}
  }
  _instruments = {};
}

// ── Soundscape init ───────────────────────────────────────────────────────────

function _initSoundscape(soundsData) {
  if (!soundsData) return;
  const cfg = soundsData.audioConfig;
  if (!cfg) return;

  try {
    const rv = cfg.globalReverb || {};
    _reverb = new Tone.Reverb({
      decay:    rv.decay    ?? 3.0,
      preDelay: rv.preDelay ?? 0.03,
    }).toDestination();
    _reverb.wet.value = rv.wet ?? 0.4;
    _reverb.generate();
  } catch(e) {
    _reverb = null;
  }

  for (const def of (cfg.soundscape || [])) {
    const node = _buildSoundscapeNode(def);
    if (node) _soundscapeNodes.push(node);
  }

  console.log('[soundtrack] Soundscape |', _soundscapeNodes.length, 'nodes');
}

function _tickSoundscape(dt) {
  for (const node of _soundscapeNodes) _tickNode(node, dt);
}

// ── Soundscape node builder ───────────────────────────────────────────────────

function _buildSoundscapeNode(def) {
  if (!_guard()) return null;
  try {
    const synth   = _makeSynth(def.toneClass, def.synthConfig || {});
    if (!synth) return null;

    const fxChain = _makeEffects(def.effects || {});
    const behavior = def.behavior || {};
    const volNode  = new Tone.Volume(behavior.volume ?? -12).toDestination();

    // chain: synth → fx → vol → dest
    if (fxChain.length > 0) {
      _chainConnect([synth, ...fxChain, volNode]);
    } else {
      synth.connect(volNode);
    }
    // Reverb send
    if (_reverb) {
      const src = fxChain.length > 0 ? fxChain[fxChain.length - 1] : synth;
      try { src.connect(_reverb); } catch(e) {}
    }

    const node = {
      synth, fxChain, volNode,
      behavior,
      toneClass:    def.toneClass,
      _timer:       Math.random() * (behavior.minIntervalSeconds ?? 10),
      _burstActive: false,
      _burstTimer:  0,
      _burstElapsed: 0,
    };

    if (behavior.triggerType === 'continuous') _triggerSoundscape(node);
    return node;
  } catch(e) {
    console.warn('[soundtrack] Soundscape node failed:', def.name, e);
    return null;
  }
}

function _tickNode(node, dt) {
  const b = node.behavior;
  if (!b || b.triggerType === 'continuous') return;

  if (b.triggerType === 'random_interval') {
    node._timer -= dt;
    if (node._timer <= 0) {
      _triggerSoundscape(node);
      node._timer = (b.minIntervalSeconds ?? 15) +
                    Math.random() * ((b.maxIntervalSeconds ?? 60) - (b.minIntervalSeconds ?? 15));
    }
    return;
  }

  if (b.triggerType === 'random_burst') {
    if (node._burstActive) {
      node._burstTimer   += dt;
      node._burstElapsed += dt;
      const period = 1 / (b.repeatRateHz ?? 20);
      if (node._burstTimer >= period) {
        node._burstTimer = 0;
        _triggerSoundscape(node);
      }
      if (node._burstElapsed >= (b.burstDurationSeconds ?? 1.5)) {
        node._burstActive  = false;
        node._burstElapsed = 0;
        node._timer = (b.minIntervalSeconds ?? 20) +
                      Math.random() * ((b.maxIntervalSeconds ?? 60) - (b.minIntervalSeconds ?? 20));
      }
    } else {
      node._timer -= dt;
      if (node._timer <= 0) {
        node._burstActive  = true;
        node._burstElapsed = 0;
        node._burstTimer   = 0;
      }
    }
  }
}

function _triggerSoundscape(node) {
  if (!_guard()) return;
  try {
    const b    = node.behavior;
    const type = node.toneClass;
    const synth = node.synth;
    const now   = Tone.now();

    if (type === 'NoiseSynth') {
      if (b.triggerType === 'continuous') {
        synth.triggerAttack(now);
      } else {
        synth.triggerAttackRelease('8n', now);
      }
      return;
    }

    const pitch = b.basePitch || 'A3';
    if (b.triggerType === 'continuous') {
      synth.triggerAttack(pitch, now);
      // Pitch drop (hawk screech style)
      if (b.pitchDropOctaves && synth.frequency) {
        const startFreq  = Tone.Frequency(pitch).toFrequency();
        const targetFreq = startFreq * Math.pow(2, b.pitchDropOctaves);
        synth.frequency.setValueAtTime(startFreq, now);
        synth.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.8);
      }
    } else {
      const dur = b.noteDuration || '4n';
      synth.triggerAttackRelease(pitch, dur, now);
      if (b.pitchDropOctaves && synth.frequency) {
        const startFreq  = Tone.Frequency(pitch).toFrequency();
        const targetFreq = startFreq * Math.pow(2, b.pitchDropOctaves);
        synth.frequency.setValueAtTime(startFreq, now);
        synth.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.8);
      }
    }
  } catch(e) {}
}

// ── Synth factory ─────────────────────────────────────────────────────────────

function _makeSynth(type, options) {
  try {
    switch (type) {
      case 'Synth':         return new Tone.Synth(options);
      case 'FMSynth':       return new Tone.FMSynth(options);
      case 'AMSynth':       return new Tone.AMSynth(options);
      case 'NoiseSynth':    return new Tone.NoiseSynth(options);
      case 'MembraneSynth': return new Tone.MembraneSynth(options);
      case 'MetalSynth':    return new Tone.MetalSynth(options);
      case 'PluckSynth':    return new Tone.PluckSynth(options);
      case 'DuoSynth':      return new Tone.DuoSynth(options);
      case 'PolySynth':     return new Tone.PolySynth(Tone.Synth, options);
      default:
        console.warn('[soundtrack] Unknown synth type:', type);
        return null;
    }
  } catch(e) {
    console.warn('[soundtrack] Synth build failed:', type, e);
    return null;
  }
}

// ── Effects factory ───────────────────────────────────────────────────────────

function _makeEffects(map) {
  const chain = [];
  for (const [name, params] of Object.entries(map)) {
    try {
      let fx = null;
      switch (name) {
        case 'AutoFilter':    fx = new Tone.AutoFilter(params).start();  break;
        case 'AutoPanner':    fx = new Tone.AutoPanner(params).start();  break;
        case 'Filter':        fx = new Tone.Filter(params);              break;
        case 'Distortion':    fx = new Tone.Distortion(params);          break;
        case 'PingPongDelay': fx = new Tone.PingPongDelay(params);       break;
        case 'Reverb':        fx = new Tone.Reverb(params);              break;
        case 'Chorus':        fx = new Tone.Chorus(params).start();      break;
        case 'Phaser':        fx = new Tone.Phaser(params).start();      break;
        default: console.warn('[soundtrack] Unknown effect:', name);
      }
      if (fx) chain.push(fx);
    } catch(e) {
      console.warn('[soundtrack] Effect failed:', name, e);
    }
  }
  return chain;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _guard()  { return window.Tone && Tone.context.state === 'running'; }
function _pick(a)  { return a[Math.floor(Math.random() * a.length)]; }

function _chainConnect(nodes) {
  for (let i = 0; i < nodes.length - 1; i++) {
    try { nodes[i].connect(nodes[i + 1]); } catch(e) {}
  }
}

function _disposeNode(node) {
  try { node.synth?.triggerRelease?.(); node.synth?.dispose?.(); } catch(e) {}
  for (const fx of (node.fxChain || [])) { try { fx.dispose(); } catch(e) {} }
  try { node.volNode?.dispose?.(); } catch(e) {}
}
