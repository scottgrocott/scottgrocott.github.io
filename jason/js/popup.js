/* ═══════════════════════════════════════════════════════════════
   popup.js — Canvas popup window manager

   Opens a new browser window and physically moves the Three.js
   canvas element into it. The renderer keeps drawing to the same
   canvas — no GPU context is recreated. All app logic (MIDI,
   audio, shaders) stays in the parent window.

   The popup listens for resize events and forwards them back to
   the parent so the renderer and layer geometry stay correct.
   ═══════════════════════════════════════════════════════════════ */

import { renderer, camera } from './scene.js';
import { setCursorContainer } from './hand.js';

let popupWin   = null;
let isDetached = false;
let popBtn     = null;

/* ─── INIT — called from main.js after DOM is ready ─────────── */
export function initPopup() {
  popBtn = document.getElementById('popup-btn');
  popBtn.addEventListener('click', () => {
    if (isDetached) {
      reclaimCanvas();
    } else {
      detachCanvas();
    }
  });
}

/* ─── DETACH — move canvas into popup ───────────────────────── */
function detachCanvas() {
  const canvas = renderer.domElement;

  const sw = screen.availWidth;
  const sh = screen.availHeight;

  popupWin = window.open(
    '', 'MIDICanvas',
    `width=${sw},height=${sh},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`
  );

  if (!popupWin) {
    alert('Popup blocked — please allow popups for localhost.');
    return;
  }

  /* Minimal popup document */
  popupWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>MIDI Canvas</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; overflow:hidden; background:#fff; }
    canvas { display:block; width:100% !important; height:100% !important; }
  </style>
</head>
<body></body>
</html>`);
  popupWin.document.close();

  /* Adopt the canvas into the popup document and append */
  const adopted = popupWin.document.adoptNode(canvas);
  popupWin.document.body.appendChild(adopted);

  /* Move hand cursor into the popup so it overlays the canvas there */
  setCursorContainer(popupWin.document.body);

  /* Resize renderer to popup dimensions */
  resizeToWindow(popupWin);

  /* Forward popup resize events to renderer */
  popupWin.addEventListener('resize', () => resizeToWindow(popupWin));

  /* If popup is closed by the user, reclaim the canvas */
  popupWin.addEventListener('beforeunload', () => {
    if (isDetached) reclaimCanvas(true);
  });

  isDetached = true;
  popBtn.textContent = '⊡ Reclaim Canvas';
  document.getElementById('canvas-container').style.background = '#111';
}

/* ─── RECLAIM — move canvas back to parent ──────────────────── */
function reclaimCanvas(popupAlreadyClosed = false) {
  if (!popupWin) return;

  const canvas    = renderer.domElement;
  const container = document.getElementById('canvas-container');

  /* Move canvas back */
  const adopted = document.adoptNode(canvas);
  container.appendChild(adopted);
  container.style.background = '';

  /* Return hand cursor to the parent canvas container */
  setCursorContainer(container);

  /* Resize renderer to parent dimensions */
  resizeToWindow(window);

  if (!popupAlreadyClosed) {
    try { popupWin.close(); } catch(e) {}
  }

  popupWin   = null;
  isDetached = false;
  popBtn.textContent = '⧉ Pop Out Canvas';
}

/* ─── RESIZE RENDERER + CAMERA + LAYER PLANES ──────────────── */
function resizeToWindow(win) {
  const w = win.innerWidth;
  const h = win.innerHeight;

  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  /* Fire a synthetic resize so layers.js rebuilds plane geometry */
  window.dispatchEvent(new Event('resize'));
}