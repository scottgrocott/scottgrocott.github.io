// cockpit.js — first-person weapon sway mesh

import { scene, camera } from './core.js';
import { keys } from './input.js';

let _weaponMesh = null;
let _swayX = 0, _swayY = 0;
let _bobT  = 0;

export function initCockpit() {
  if (_weaponMesh) { _weaponMesh.dispose(); }

  // Simple gun placeholder: box + barrel cylinder
  const root = new BABYLON.TransformNode('cockpitRoot', scene);
  root.parent = camera;
  root.position.set(0.22, -0.18, 0.5);

  const body = BABYLON.MeshBuilder.CreateBox('wpnBody', { width: 0.06, height: 0.08, depth: 0.24 }, scene);
  body.parent = root;
  body.position.set(0, 0, 0);

  const barrel = BABYLON.MeshBuilder.CreateCylinder('wpnBarrel', { diameter: 0.025, height: 0.22 }, scene);
  barrel.parent = root;
  barrel.position.set(0, 0.01, 0.18);
  barrel.rotation.x = Math.PI / 2;

  const mat = new BABYLON.StandardMaterial('wpnMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.15);
  body.material = mat;
  barrel.material = mat;

  _weaponMesh = root;
}

export function tickCockpit(dt) {
  if (!_weaponMesh) return;

  const moving = keys.moveForward || keys.moveBack || keys.moveLeft || keys.moveRight;
  const speed  = keys.sprint ? 2.5 : 1.5;

  if (moving) {
    _bobT += dt * speed * 8;
    const bobX = Math.sin(_bobT) * 0.008;
    const bobY = Math.abs(Math.sin(_bobT)) * -0.006;
    _weaponMesh.position.x = 0.22 + bobX;
    _weaponMesh.position.y = -0.18 + bobY;
  } else {
    _bobT *= 0.9;
    _weaponMesh.position.x += (0.22 - _weaponMesh.position.x) * 0.1;
    _weaponMesh.position.y += (-0.18 - _weaponMesh.position.y) * 0.1;
  }

  // Sway
  _weaponMesh.rotation.z += (-_swayX * 0.3 - _weaponMesh.rotation.z) * 0.1;
  _weaponMesh.rotation.x += (-_swayY * 0.3 - _weaponMesh.rotation.x) * 0.1;
  _swayX *= 0.85;
  _swayY *= 0.85;
}

export function addSway(dx, dy) {
  _swayX += dx * 0.4;
  _swayY += dy * 0.4;
}

export function disposeCockpit() {
  if (_weaponMesh) { _weaponMesh.dispose(); _weaponMesh = null; }
}
