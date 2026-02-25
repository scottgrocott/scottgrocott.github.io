import * as THREE from 'three';

export const scene  = new THREE.Scene();
scene.background    = new THREE.Color(0xffffff);

export const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 5);

// Renderer created but NOT appended to DOM yet — initScene() does that
export const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

export async function initScene() {
  await renderer.init();

  // Now safe to touch DOM
  const container = document.getElementById('canvas-container');
  renderer.setSize(container.clientWidth, container.clientHeight);
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  container.appendChild(renderer.domElement);

  // Resize observer — reacts to container size changes (panel resize, popup)
  new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    window.dispatchEvent(new Event('resize'));
  }).observe(container);
}

export function viewSize(zPos = 0) {
  const dist = camera.position.z - zPos;
  const h    = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist;
  return { w: h * camera.aspect, h };
}