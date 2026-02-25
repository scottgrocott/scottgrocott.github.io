import { renderer, scene, camera, initScene } from './scene.js';
import { initTone } from './synth.js';
import { buildLayers } from './layers.js';
import { buildPanel } from './panel.js';
import { initPopup } from './popup.js';
import { initMIDI } from './midi.js';

async function boot() {
  try {
    // 1. WebGPU — async, appends canvas to #canvas-container
    await initScene();

    // 2. TSL shader mesh layers
    buildLayers();

    // 3. Sidebar panel DOM
    buildPanel();

    // 4. Popup button wiring
    initPopup();

    // 5. Render loop
    renderer.setAnimationLoop(() => renderer.render(scene, camera));

    // 6. MIDI — last, so DOM is fully ready
    await initMIDI();

  } catch(err) {
    console.error('Boot failed:', err);
  }
}

document.getElementById('tone-btn').addEventListener('click', () => {
  initTone();
  const btn = document.getElementById('tone-btn');
  btn.textContent = '✓ Audio Ready';
  btn.disabled = true;
});

boot();