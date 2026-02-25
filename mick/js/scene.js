import * as THREE from 'three';

/* ─── SCENE ─────────────────────────────────────────────────── */
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x050505);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('canvas-container').appendChild(renderer.domElement);

/* ─── HELPERS ───────────────────────────────────────────────── */
function viewSize() {
  const h = 2 * Math.tan((45 * Math.PI / 180) / 2) * camera.position.z;
  return { w: h * camera.aspect, h };
}

/* ─── WHITE PLANE ───────────────────────────────────────────── */
let { w: pW, h: pH } = viewSize();
const planeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const plane    = new THREE.Mesh(new THREE.PlaneGeometry(pW, pH), planeMat);
scene.add(plane);

/* ─── VIGNETTE OVERLAY ──────────────────────────────────────── */
const vignetteMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite:  false,
  uniforms: { uOpacity: { value: 0.0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      vec2  d = vUv - 0.5;
      float v = smoothstep(0.25, 0.85, length(d) * 1.6);
      gl_FragColor = vec4(0.0, 0.0, 0.0, v * uOpacity);
    }
  `
});
const vignette = new THREE.Mesh(new THREE.PlaneGeometry(pW * 1.2, pH * 1.2), vignetteMat);
vignette.position.z = 0.01;
scene.add(vignette);

/* ─── RESIZE ────────────────────────────────────────────────── */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const { w, h } = viewSize();
  plane.geometry.dispose();
  plane.geometry    = new THREE.PlaneGeometry(w, h);
  vignette.geometry.dispose();
  vignette.geometry = new THREE.PlaneGeometry(w * 1.2, h * 1.2);
});

/* ─── ANIMATION LOOP ────────────────────────────────────────── */
let vigTarget = 0;

renderer.setAnimationLoop(() => {
  vignetteMat.uniforms.uOpacity.value +=
    (vigTarget - vignetteMat.uniforms.uOpacity.value) * 0.1;
  renderer.render(scene, camera);
});

/* ─── EXPORTS ───────────────────────────────────────────────── */
export function setVignetteTarget(v) { vigTarget = v; }
