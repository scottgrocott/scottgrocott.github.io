/* ═══════════════════════════════════════════════════════════════
   popup.js — Canvas popup window manager

   Opens a new browser window and physically moves the Three.js
   canvas element into it. The renderer keeps drawing to the same
   canvas — no GPU context is recreated. All app logic (MIDI,
   audio, shaders) stays in the parent window.

   Key fix: the popup document links back to the parent stylesheet
   so that adopted elements (tool panel, cursor, trigger bar) keep
   all their CSS. body gets position:relative so absolute children
   anchor correctly.
   ═══════════════════════════════════════════════════════════════ */

import { renderer, camera } from './scene.js';
import { setCursorContainer } from './hand.js';
import { setToolPanelContainer } from './toolpanel.js';

let popupWin   = null;
let isDetached = false;
let popBtn     = null;

/* ─── INIT ───────────────────────────────────────────────────── */
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
    'width=' + sw + ',height=' + sh + ',left=0,top=0,menubar=no,toolbar=no,location=no,status=no'
  );

  if (!popupWin) {
    alert('Popup blocked — please allow popups for localhost.');
    return;
  }

  // Resolve parent stylesheet URL
  const styleLink = document.querySelector('link[rel="stylesheet"]');
  const styleHref = styleLink
    ? styleLink.href
    : (window.location.origin + '/jason/css/style.css');

  // Grab Google Fonts link if present
  const fontLink = document.querySelector('link[href*="fonts.googleapis"]');
  const fontTag  = fontLink
    ? '<link rel="stylesheet" href="' + fontLink.href + '">'
    : '';

  popupWin.document.write(
    '<!DOCTYPE html>' +
    '<html>' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<title>MIDI Canvas</title>' +
    fontTag +
    '<link rel="stylesheet" href="' + styleHref + '">' +
    '<style>' +
    '* { margin:0; padding:0; box-sizing:border-box; }' +
    'html, body { width:100%; height:100%; overflow:hidden; background:#fff; position:relative; }' +
    'canvas { display:block; width:100% !important; height:100% !important; }' +
    '</style>' +
    '</head>' +
    '<body></body>' +
    '</html>'
  );
  popupWin.document.close();

  /* Adopt canvas into popup */
  const adopted = popupWin.document.adoptNode(canvas);
  popupWin.document.body.appendChild(adopted);

  /* Move cursor and tool panel into popup */
  setCursorContainer(popupWin.document.body);
  setToolPanelContainer(popupWin.document.body);

  resizeToWindow(popupWin);
  popupWin.addEventListener('resize', () => resizeToWindow(popupWin));
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

  const adopted = document.adoptNode(canvas);
  container.appendChild(adopted);
  container.style.background = '';

  setCursorContainer(container);
  setToolPanelContainer(container);
  resizeToWindow(window);

  if (!popupAlreadyClosed) {
    try { popupWin.close(); } catch(e) {}
  }

  popupWin   = null;
  isDetached = false;
  popBtn.textContent = '⧉ Pop Out Canvas';
}

/* ─── RESIZE ─────────────────────────────────────────────────── */
function resizeToWindow(win) {
  const w = win.innerWidth;
  const h = win.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  window.dispatchEvent(new Event('resize'));
}