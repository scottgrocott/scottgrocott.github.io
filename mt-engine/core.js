// core.js — BabylonJS engine, scene, camera, shadow generator

const canvas = document.getElementById('renderCanvas');

export const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  antialias: true,
});

export const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.04, 0.06, 0.08, 1.0);
scene.fogMode    = BABYLON.Scene.FOGMODE_EXP2;
scene.fogDensity = 0.004;
scene.fogColor   = new BABYLON.Color3(0.06, 0.08, 0.10);

// Lighting
const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
ambient.intensity    = 0.45;
ambient.groundColor  = new BABYLON.Color3(0.08, 0.10, 0.06);
ambient.diffuse      = new BABYLON.Color3(0.55, 0.60, 0.50);

export const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, -0.5), scene);
sun.position  = new BABYLON.Vector3(200, 400, 200);
sun.intensity = 1.1;
sun.diffuse   = new BABYLON.Color3(1.0, 0.95, 0.80);

export const shadowGenerator = new BABYLON.ShadowGenerator(1024, sun);
shadowGenerator.useBlurExponentialShadowMap = true;
shadowGenerator.blurKernel = 16;

// Camera (will be parented to playerRig by player.js)
export const camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 2, 0), scene);
camera.minZ = 0.1;
camera.maxZ = 1200;
camera.fov  = 1.05;

// Prevent default Babylon camera controls — we drive it manually
camera.inputs.clear();

// Resize handler
window.addEventListener('resize', () => engine.resize());
