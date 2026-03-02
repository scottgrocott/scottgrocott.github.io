// ============================================================
//  audio.js — Tone.js sound synthesis
// ============================================================

import { camera }            from './core.js';
import { initSoundtrack }    from './soundtrack.js';

export let toneReady = false;

const DRONE_PITCHES = [110, 130.81, 164.81, 196, 246.94, 293.66, 329.63, 392];

export async function initAudio() {
  try {
    await Tone.start();
    _startWind();
    initSoundtrack();
    toneReady = true;
  } catch (e) {
    console.warn('Audio init failed:', e);
  }
}

function _startWind() {
  const noise      = new Tone.Noise('pink').start();
  const autoFilter = new Tone.AutoFilter({ frequency: '0.1', baseFrequency: 200, octaves: 3 }).start();
  const windVol    = new Tone.Volume(-28);
  noise.connect(autoFilter);
  autoFilter.connect(windVol);
  windVol.toDestination();

  function windGust() {
    const t = Tone.now();
    windVol.volume.rampTo(-20, 2, t);
    windVol.volume.rampTo(-40, 3, t + 2 + Math.random() * 3);
    setTimeout(windGust, 6000 + Math.random() * 12000);
  }
  windGust();
}

export function createDroneSynth(droneIndex) {
  const freq = DRONE_PITCHES[droneIndex % DRONE_PITCHES.length];
  const osc1 = new Tone.Oscillator(freq, 'sawtooth');
  const osc2 = new Tone.Oscillator(freq * 1.01, 'square');
  const osc3 = new Tone.Oscillator(freq * 2, 'sawtooth');
  const distortion = new Tone.Distortion(0.4);
  const filter     = new Tone.Filter(800, 'lowpass');
  const panner     = new Tone.Panner(0);
  const vol        = new Tone.Volume(-18);

  osc1.connect(distortion); osc2.connect(distortion); osc3.connect(distortion);
  distortion.connect(filter); filter.connect(panner); panner.connect(vol);
  vol.toDestination();

  osc1.start(); osc2.start(); osc3.start();
  return { osc1, osc2, osc3, panner, vol, filter, baseFreq: freq };
}

export function updateDroneSpatial(synth, dronePos) {
  if (!synth) return;
  try {
    const pp   = camera.globalPosition;
    const dist = BABYLON.Vector3.Distance(dronePos, pp);
    if (!isFinite(dist) || dist < 0.01) return;

    const maxDist  = 120, minVol = -60, maxVol = -4;
    const normDist = Math.min(dist / maxDist, 1.0);
    const vol      = dist < maxDist ? maxVol + (minVol - maxVol) * (normDist ** 2) : minVol;
    if (isFinite(vol)) synth.vol.volume.setTargetAtTime(vol, Tone.now(), 0.8);

    const dx   = dronePos.x - pp.x;
    const dz   = dronePos.z - pp.z;
    const hLen = Math.sqrt(dx * dx + dz * dz);
    if (hLen > 0.01) {
      const right   = camera.getDirection(new BABYLON.Vector3(1, 0, 0));
      const toDrone = new BABYLON.Vector3(dx / hLen, 0, dz / hLen);
      const pan     = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(toDrone, right)));
      if (isFinite(pan)) synth.panner.pan.setTargetAtTime(pan, Tone.now(), 0.05);
    }

    const speed = Math.max(0.5, Math.min(2.0, 1 - dist / 80));
    synth.osc1.frequency.setTargetAtTime(synth.baseFreq * speed, Tone.now(), 0.2);
    synth.osc2.frequency.setTargetAtTime(synth.baseFreq * 1.01 * speed, Tone.now(), 0.2);
    synth.osc3.frequency.setTargetAtTime(synth.baseFreq * 2 * speed, Tone.now(), 0.2);
  } catch (_) {}
}

export function disposeDroneSynth(synth) {
  if (!synth) return;
  try {
    synth.osc1.stop(); synth.osc2.stop(); synth.osc3.stop();
    setTimeout(() => {
      try {
        synth.osc1.dispose(); synth.osc2.dispose(); synth.osc3.dispose();
        synth.panner.dispose(); synth.vol.dispose(); synth.filter.dispose();
      } catch (_) {}
    }, 200);
  } catch (_) {}
}

export function playExplosion() {
  if (!toneReady) return;
  try {
    const noise = new Tone.Noise('white');
    const env   = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.4, sustain: 0, release: 0.5 });
    const dist  = new Tone.Distortion(0.8);
    const filt  = new Tone.Filter(400, 'lowpass');
    const vol   = new Tone.Volume(-6);
    noise.connect(env); env.connect(dist); dist.connect(filt); filt.connect(vol); vol.toDestination();
    noise.start(); env.triggerAttackRelease('1');
    setTimeout(() => {
      try { noise.stop(); noise.dispose(); env.dispose(); dist.dispose(); filt.dispose(); vol.dispose(); } catch (_) {}
    }, 2000);
  } catch (_) {}
}

export function playGunshot() {
  if (!toneReady) return;
  try {
    const noise = new Tone.Noise('white');
    const env   = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 });
    const filt  = new Tone.Filter(2000, 'highpass');
    const vol   = new Tone.Volume(-10);
    noise.connect(env); env.connect(filt); filt.connect(vol); vol.toDestination();
    noise.start(); env.triggerAttackRelease('0.1');
    setTimeout(() => {
      try { noise.stop(); noise.dispose(); env.dispose(); filt.dispose(); vol.dispose(); } catch (_) {}
    }, 500);
  } catch (_) {}
}

export function playBulletHit() {
  if (!toneReady) return;
  try {
    const synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope:   { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
    }).toDestination();
    synth.triggerAttackRelease(440, '0.1');
    setTimeout(() => { try { synth.dispose(); } catch (_) {} }, 500);
  } catch (_) {}
}