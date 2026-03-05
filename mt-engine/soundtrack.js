// soundtrack.js — zone-based ambient crossfade soundtrack

import { playerRig } from './player.js';
import { CONFIG } from './config.js';

let _initialized = false;
let _outerVol, _midVol, _innerVol;
let _outerNoise, _midPoly, _innerDrum;

function _guard() { return window.Tone && Tone.context.state === 'running'; }

export function initSoundtrack() {
  if (!_guard() || _initialized) return;
  _initialized = true;

  try {
    // Outer zone: filtered wind noise
    _outerVol = new Tone.Volume(-20).toDestination();
    _outerNoise = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 2, decay: 0, sustain: 1, release: 2 }
    }).connect(_outerVol);
    _outerNoise.triggerAttack();

    // Mid zone: adventure poly
    _midVol = new Tone.Volume(-60).toDestination();
    _midPoly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.5, decay: 0.3, sustain: 0.6, release: 1.5 }
    }).connect(new Tone.Reverb(2).connect(_midVol));
    const midPattern = new Tone.Pattern((time, note) => {
      _midPoly.triggerAttackRelease(note, '4n', time);
    }, ['C3','E3','G3','B3','A3','F3'], 'upDown');
    midPattern.interval = '4n';
    midPattern.start(0);

    // Inner zone: battle drums
    _innerVol = new Tone.Volume(-60).toDestination();
    const drumEnv = new Tone.AmplitudeEnvelope({ attack:0.01, decay:0.15, sustain:0, release:0.1 })
      .connect(_innerVol);
    _innerDrum = new Tone.MembraneSynth().connect(drumEnv);
    new Tone.Sequence((time) => {
      _innerDrum.triggerAttackRelease('C1', '8n', time);
    }, [0, null, 1, null, 0, null, 1, 1], '8n').start(0);

    Tone.Transport.bpm.value = 100;
    Tone.Transport.start();
  } catch(e) {
    console.warn('[soundtrack] init failed:', e);
  }
}

export function tickSoundtrack() {
  if (!_guard() || !_initialized || !playerRig) return;

  const cfg   = CONFIG.audio;
  const outerR = cfg.outerZone?.radius || 280;
  const midR   = cfg.midZone?.radius   || 150;
  const innerR = cfg.innerZone?.radius || 60;

  const p = playerRig.position;
  const dist = Math.sqrt(p.x*p.x + p.z*p.z);

  try {
    // Outer: active when far
    const outerGain = dist > midR   ? -15 : -60;
    // Mid: active in mid zone
    const midGain   = dist <= outerR && dist > innerR ? -20 : -60;
    // Inner: active near center
    const innerGain = dist <= innerR ? -10 : -60;

    const ramp = 1.5;
    if (_outerVol) _outerVol.volume.rampTo(outerGain, ramp);
    if (_midVol)   _midVol.volume.rampTo(midGain, ramp);
    if (_innerVol) _innerVol.volume.rampTo(innerGain, ramp);
  } catch(e) {}
}

export function disposeSoundtrack() {
  _initialized = false;
  try { Tone.Transport.stop(); } catch(e) {}
  try { if (_outerNoise) _outerNoise.dispose(); } catch(e) {}
  try { if (_midPoly)    _midPoly.dispose();    } catch(e) {}
  try { if (_innerDrum)  _innerDrum.dispose();  } catch(e) {}
}
