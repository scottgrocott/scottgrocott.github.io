import { renderer, scene, camera, initScene } from './scene.js';
import { initTone }                           from './synth.js';
import { buildLayers, updatePaintTexture }    from './layers.js';
import { buildPanel, initStylePanel }         from './panel.js';
import { initPopup }                          from './popup.js';
import { initMIDI }                           from './midi.js';
import { initAudio, tickAudio }               from './audio.js';
import { tickHand, getHandCursorState }       from './hand.js';
import { tickBrushEngine, getDwellProgress }  from './brush.js';
import { initToolPanel, tickToolPanel }       from './toolpanel.js';

let lastTime = performance.now();

async function boot() {
  try {
    await initScene();
    buildLayers();
    buildPanel();
    initStylePanel();
    initPopup();
    initToolPanel();

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt  = Math.min((now - lastTime) / 1000, 0.1);
      lastTime  = now;

      const cursorState = getHandCursorState();

      tickAudio(dt);
      tickHand(dt);
      tickBrushEngine(dt, cursorState);
      tickToolPanel(dt, cursorState, getDwellProgress(cursorState.layerIndex));

      // Upload paint textures to layer shader uniforms
      for (let ch = 0; ch < 10; ch++) updatePaintTexture(ch);

      renderer.render(scene, camera);
    });

    await initMIDI();
  } catch(err) {
    console.error('[Boot] Failed:', err);
  }
}

document.getElementById('tone-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.textContent = '...';
  btn.disabled    = true;
  try {
    await Tone.start();
    await initTone();
    initAudio();
    btn.textContent = '✓ Audio Ready';
    console.log('[Boot] AudioContext state:', Tone.context.state);
  } catch(err) {
    console.error('[Boot] Audio init failed:', err);
    btn.textContent = '✕ Failed — click to retry';
    btn.disabled    = false;
  }
});

boot();