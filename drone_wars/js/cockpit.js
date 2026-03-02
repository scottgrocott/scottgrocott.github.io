// ============================================================
//  cockpit.js — First-person drone cockpit props + sway
// ============================================================

import { scene, camera } from './core.js';

export const cockpitGroup = new BABYLON.TransformNode('cockpit', scene);
cockpitGroup.parent = camera;
cockpitGroup.rotationQuaternion = new BABYLON.Quaternion();
cockpitGroup.setEnabled(false);

const sway = { pitch: 0, roll: 0, bob: 0, bobT: 0 };

(function buildCockpit() {
  const bodyMat = new BABYLON.PBRMaterial('cbm', scene);
  bodyMat.albedoColor = BABYLON.Color3.FromHexString('#334433');
  bodyMat.metallic = 0.6; bodyMat.roughness = 0.4;

  const armMat = new BABYLON.PBRMaterial('cam', scene);
  armMat.albedoColor = BABYLON.Color3.FromHexString('#223322');
  armMat.metallic = 0.7; armMat.roughness = 0.3;

  const rotorMat = new BABYLON.PBRMaterial('crm', scene);
  rotorMat.albedoColor   = BABYLON.Color3.FromHexString('#ff2200');
  rotorMat.emissiveColor = BABYLON.Color3.FromHexString('#ff1100');

  const detMat = new BABYLON.PBRMaterial('cdm', scene);
  detMat.albedoColor   = BABYLON.Color3.FromHexString('#ff4400');
  detMat.emissiveColor = BABYLON.Color3.FromHexString('#ff0000');

  const body = BABYLON.MeshBuilder.CreateBox('cb', { width: 0.22, height: 0.04, depth: 0.18 }, scene);
  body.material = bodyMat; body.position.set(0, -0.14, -0.28); body.parent = cockpitGroup;

  const armL = BABYLON.MeshBuilder.CreateBox('cal', { width: 0.28, height: 0.025, depth: 0.035 }, scene);
  armL.material = armMat; armL.position.set(-0.16, -0.13, -0.30); armL.rotation.y = 0.22; armL.parent = cockpitGroup;

  const armR = BABYLON.MeshBuilder.CreateBox('car', { width: 0.28, height: 0.025, depth: 0.035 }, scene);
  armR.material = armMat; armR.position.set(0.16, -0.13, -0.30); armR.rotation.y = -0.22; armR.parent = cockpitGroup;

  const rotorL = BABYLON.MeshBuilder.CreateCylinder('crl', { diameter: 0.13, height: 0.008 }, scene);
  rotorL.material = rotorMat; rotorL.position.set(-0.265, -0.12, -0.36);
  rotorL.metadata = { isCockpitRotor: true, spinDir: 1 }; rotorL.parent = cockpitGroup;

  const rotorR = BABYLON.MeshBuilder.CreateCylinder('crr', { diameter: 0.13, height: 0.008 }, scene);
  rotorR.material = rotorMat; rotorR.position.set(0.265, -0.12, -0.36);
  rotorR.metadata = { isCockpitRotor: true, spinDir: -1 }; rotorR.parent = cockpitGroup;

  const det = BABYLON.MeshBuilder.CreateCylinder('cd', { diameter: 0.036, height: 0.07 }, scene);
  det.material = detMat; det.rotation.x = Math.PI / 2;
  det.position.set(0, -0.13, -0.36); det.parent = cockpitGroup;
})();

export function tickCockpit(dt, moveVec, isFreeCam) {
  if (!isFreeCam) return;

  const targetPitch = moveVec.y * 0.08;
  const targetRoll  = -moveVec.x * 0.06;
  const lerpT       = Math.min(1, dt * 5);

  sway.pitch += (targetPitch - sway.pitch) * lerpT;
  sway.roll  += (targetRoll  - sway.roll)  * lerpT;
  sway.bobT  += dt * 1.4;
  sway.bob    = Math.sin(sway.bobT) * 0.002;

  BABYLON.Quaternion.RotationYawPitchRollToRef(0, sway.pitch, sway.roll, cockpitGroup.rotationQuaternion);
  cockpitGroup.position.y = sway.bob;

  for (const c of cockpitGroup.getChildren()) {
    if (c.metadata?.isCockpitRotor) {
      c.rotation.y += dt * 28 * c.metadata.spinDir;
    }
  }
}

export function resetCockpitSway() {
  sway.pitch = 0; sway.roll = 0;
  cockpitGroup.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
}
