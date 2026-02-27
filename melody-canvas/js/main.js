import { renderer, scene, camera, initScene } from './scene.js';
import { initTone } from './synth.js';
import { buildLayers } from './layers.js';
import { buildPanel, initStylePanel } from './panel.js';
import { initPopup } from './popup.js';
import { initMIDI } from './midi.js';
import { initAudio, tickAudio } from './audio.js';

let lastTime = performance.now();

async function boot() {
  try {
    await initScene();
    buildLayers();
    buildPanel();
    initStylePanel();
    initPopup();

    // Render + audio tick loop
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt  = Math.min((now - lastTime) / 1000, 0.1); // seconds, capped
      lastTime  = now;

      tickAudio(dt);
      renderer.render(scene, camera);
    });

    await initMIDI();
  } catch(err) {
    console.error('Boot failed:', err);
  }
}

document.getElementById('tone-btn').addEventListener('click', async () => {
  const btn = document.getElementById('tone-btn');
  btn.textContent = '...';
  btn.disabled = true;
  await initTone();
  initAudio();         // attach analysers now that voices exist
  btn.textContent = '✓ Audio Ready';
});

boot();