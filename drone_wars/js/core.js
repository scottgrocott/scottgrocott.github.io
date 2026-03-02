// ============================================================
//  core.js — Babylon.js engine, scene, camera, lighting
// ============================================================

const canvas = document.getElementById('renderCanvas');

export const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
});

export const scene = new BABYLON.Scene(engine);
scene.useRightHandedSystem = true;
scene.clearColor     = new BABYLON.Color4(135/255, 206/255, 235/255, 1);
scene.fogMode        = BABYLON.Scene.FOGMODE_LINEAR;
scene.fogColor       = new BABYLON.Color3(135/255, 206/255, 235/255);
scene.fogStart       = 100;
scene.fogEnd         = 800;

// UniversalCamera — clear inputs so they don't fight our pointer-lock FPS logic
export const camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 0, 0), scene);
camera.minZ = 0.1;
camera.maxZ = 20_000;
camera.rotationQuaternion = new BABYLON.Quaternion();
camera.inputs.clear();

// ---- Lighting ----
const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
hemiLight.intensity   = 0.5;
hemiLight.groundColor = new BABYLON.Color3(139/255, 115/255, 85/255);

const sunLight = new BABYLON.DirectionalLight(
  'sunLight',
  new BABYLON.Vector3(-80, -200, -60).normalize(),
  scene,
);
sunLight.position = new BABYLON.Vector3(80, 200, 60);
sunLight.diffuse  = BABYLON.Color3.FromHexString('#fffde8');
sunLight.intensity = 2.2;

export const shadowGenerator = new BABYLON.ShadowGenerator(2048, sunLight);
shadowGenerator.useBlurExponentialShadowMap = true;
shadowGenerator.blurKernel = 32;
shadowGenerator.bias       = 0.0003;

window.addEventListener('resize', () => engine.resize());
