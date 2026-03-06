// soundtrack.js — environment soundscape player
// Reads sounds.json audioConfig.soundscape, handles all three trigger types:
//   continuous    — synth held on permanently
//   random_burst  — rapid repeated triggers for N seconds, then silence
//   random_interval — single trigger on a random timer

import { getEnvironment } from './environment.js';

let _nodes   = [];   // active { synth, effects, chain, behavior, _timer, _burstTimer, _burstActive }
let _reverb  = null;
let _running = false;

function _guard() { return window.Tone && Tone.context.state === 'running'; }

// ── Public API ───────────────────────────────────────────────────────────────

export function initSoundtrack() {
  disposeSoundtrack();
  if (!_guard()) return;

  const env = getEnvironment();
  if (!env || !env.sounds) return;

  const cfg = env.sounds.audioConfig;
  if (!cfg) return;

  // Global reverb send
  try {
    const rv = cfg.globalReverb || {};
    _reverb = new Tone.Reverb({
      decay:    rv.decay    ?? 3.0,
      preDelay: rv.preDelay ?? 0.03,
    }).toDestination();
    _reverb.wet.value = rv.wet ?? 0.4;
    _reverb.generate();
  } catch(e) {
    console.warn('[soundtrack] Reverb failed:', e);
    _reverb = null;
  }

  const soundscape = cfg.soundscape || [];
  for (const def of soundscape) {
    const node = _buildNode(def);
    if (node) _nodes.push(node);
  }

  _running = true;
  console.log('[soundtrack] Started |', _nodes.length, 'soundscape nodes | env:', env.name);
}

export function tickSoundtrack(dt) {
  if (!_running || !_guard()) return;
  for (const node of _nodes) {
    _tickNode(node, dt || 0.016);
  }
}

export function disposeSoundtrack() {
  _running = false;
  for (const node of _nodes) {
    _disposeNode(node);
  }
  _nodes = [];
  if (_reverb) {
    try { _reverb.dispose(); } catch(e) {}
    _reverb = null;
  }
}

// ── Node builder ─────────────────────────────────────────────────────────────

function _buildNode(def) {
  if (!_guard()) return null;
  try {
    const synth    = _makeSynth(def.toneClass, def.synthConfig || {});
    if (!synth) return null;

    const fxChain  = _makeEffects(def.effects || {});
    const behavior = def.behavior || {};
    const vol      = behavior.volume ?? -12;

    // Build signal chain: synth → effects → (reverb send) → destination
    const volNode = new Tone.Volume(vol).toDestination();
    if (_reverb) {
      const reverbSend = new Tone.Volume(vol - 6);  // slightly quieter to reverb
      reverbSend.connect(_reverb);
      if (fxChain.length > 0) {
        _chainConnect([synth, ...fxChain, volNode]);
        fxChain[fxChain.length - 1].connect(reverbSend);
      } else {
        synth.connect(volNode);
        synth.connect(reverbSend);
      }
    } else {
      if (fxChain.length > 0) {
        _chainConnect([synth, ...fxChain, volNode]);
      } else {
        synth.connect(volNode);
      }
    }

    const node = {
      name:        def.name,
      synth,
      fxChain,
      volNode,
      behavior,
      toneClass:   def.toneClass,
      _timer:      Math.random() * (behavior.minIntervalSeconds ?? 10),  // stagger start
      _burstActive: false,
      _burstTimer:  0,
    };

    // Start continuous sounds immediately
    if (behavior.triggerType === 'continuous') {
      _trigger(node);
    }

    return node;
  } catch(e) {
    console.warn('[soundtrack] Failed to build node:', def.name, e);
    return null;
  }
}

// ── Per-frame tick ────────────────────────────────────────────────────────────

function _tickNode(node, dt) {
  const b = node.behavior;
  if (!b) return;

  if (b.triggerType === 'continuous') return;  // fired once, self-sustaining

  if (b.triggerType === 'random_interval') {
    node._timer -= dt;
    if (node._timer <= 0) {
      _trigger(node);
      const lo = b.minIntervalSeconds ?? 15;
      const hi = b.maxIntervalSeconds ?? 60;
      node._timer = lo + Math.random() * (hi - lo);
    }
  }

  if (b.triggerType === 'random_burst') {
    if (node._burstActive) {
      // Firing burst — trigger rapidly at repeatRateHz
      node._burstTimer += dt;
      const period = 1 / (b.repeatRateHz ?? 20);
      if (node._burstTimer >= period) {
        node._burstTimer = 0;
        _trigger(node);
      }
      // Check if burst duration elapsed
      node._burstElapsed = (node._burstElapsed || 0) + dt;
      if (node._burstElapsed >= (b.burstDurationSeconds ?? 1.5)) {
        node._burstActive  = false;
        node._burstElapsed = 0;
        const lo = b.minIntervalSeconds ?? 20;
        const hi = b.maxIntervalSeconds ?? 60;
        node._timer = lo + Math.random() * (hi - lo);
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

// ── Trigger a synth hit ───────────────────────────────────────────────────────

function _trigger(node) {
  if (!_guard()) return;
  try {
    const b = node.behavior;
    const synth = node.synth;

    if (node.toneClass === 'NoiseSynth') {
      if (b.triggerType === 'continuous') {
        synth.triggerAttack(Tone.now());
      } else {
        synth.triggerAttackRelease('8n', Tone.now());
      }
    } else if (node.toneClass === 'MembraneSynth') {
      const pitch = b.basePitch || 'C2';
      synth.triggerAttackRelease(pitch, '8n', Tone.now());
    } else {
      // Synth, FMSynth, AMSynth, MetalSynth etc.
      const pitch = b.basePitch || 'A3';
      if (b.triggerType === 'continuous') {
        synth.triggerAttack(pitch, Tone.now());
        // Pitch drop for hawk-screech style
        if (b.pitchDropOctaves) {
          const freq = Tone.Frequency(pitch).toFrequency();
          const targetFreq = freq * Math.pow(2, b.pitchDropOctaves);
          synth.frequency?.rampTo(targetFreq, b.behavior?.decay ?? 0.8);
        }
      } else {
        const dur = b.noteDuration || '4n';
        synth.triggerAttackRelease(pitch, dur, Tone.now());
      }
    }
  } catch(e) {
    // Ignore transient audio errors
  }
}

// ── Synth factory ─────────────────────────────────────────────────────────────

function _makeSynth(toneClass, config) {
  switch (toneClass) {
    case 'NoiseSynth':    return new Tone.NoiseSynth(config);
    case 'FMSynth':       return new Tone.FMSynth(config);
    case 'AMSynth':       return new Tone.AMSynth(config);
    case 'MembraneSynth': return new Tone.MembraneSynth(config);
    case 'MetalSynth':    return new Tone.MetalSynth(config);
    case 'Synth':         return new Tone.Synth(config);
    default:
      console.warn('[soundtrack] Unknown toneClass:', toneClass);
      return null;
  }
}

// ── Effects factory ───────────────────────────────────────────────────────────

function _makeEffects(effectsMap) {
  const chain = [];
  for (const [name, params] of Object.entries(effectsMap)) {
    try {
      let fx = null;
      switch (name) {
        case 'AutoFilter':     fx = new Tone.AutoFilter(params).start(); break;
        case 'AutoPanner':     fx = new Tone.AutoPanner(params).start(); break;
        case 'Filter':         fx = new Tone.Filter(params); break;
        case 'Distortion':     fx = new Tone.Distortion(params); break;
        case 'PingPongDelay':  fx = new Tone.PingPongDelay(params); break;
        case 'Reverb':         fx = new Tone.Reverb(params); break;
        case 'Chorus':         fx = new Tone.Chorus(params).start(); break;
        case 'Phaser':         fx = new Tone.Phaser(params).start(); break;
        default:
          console.warn('[soundtrack] Unknown effect:', name);
      }
      if (fx) chain.push(fx);
    } catch(e) {
      console.warn('[soundtrack] Effect build failed:', name, e);
    }
  }
  return chain;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _chainConnect(nodes) {
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].connect(nodes[i + 1]);
  }
}

function _disposeNode(node) {
  try {
    if (node.synth) {
      try { node.synth.triggerRelease(); } catch(e) {}
      node.synth.dispose();
    }
    for (const fx of (node.fxChain || [])) {
      try { fx.dispose(); } catch(e) {}
    }
    if (node.volNode) node.volNode.dispose();
  } catch(e) {}
}