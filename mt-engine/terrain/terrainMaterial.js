// terrain/terrainMaterial.js — PBR terrain material with elevation bands

import { scene } from '../core.js';

let _material = null;
let _shaderLayers = [];

export function buildTerrainMaterial(terrainCfg) {
  if (_material) { _material.dispose(); _material = null; }

  const mat = new BABYLON.StandardMaterial('terrainMat', scene);

  // Base color from first shader layer or default
  const baseLayer = (terrainCfg.shaderLayers && terrainCfg.shaderLayers[0]);
  const baseColor = baseLayer ? _hexToColor3(baseLayer.color) : new BABYLON.Color3(0.22, 0.30, 0.15);
  mat.diffuseColor  = baseColor;
  mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  mat.specularPower = 64;
  mat.backFaceCulling = false;

  if (terrainCfg.groundTexture) {
    const tex = new BABYLON.Texture(terrainCfg.groundTexture, scene);
    tex.uScale = 40; tex.vScale = 40;
    mat.diffuseTexture = tex;
  }

  _material = mat;
  _shaderLayers = terrainCfg.shaderLayers || [];
  return mat;
}

export function applyTerrainMaterial(meshes) {
  if (!_material) return;
  meshes.forEach(m => { m.material = _material; });
}

export function setShaderLayers(layers) {
  _shaderLayers = layers;
  if (_material && layers && layers.length > 0) {
    const baseColor = _hexToColor3(layers[0].color);
    _material.diffuseColor = baseColor;
  }
}

export function getTerrainMaterial() { return _material; }

function _hexToColor3(hex) {
  if (!hex || hex.length < 7) return new BABYLON.Color3(0.22, 0.30, 0.15);
  const r = parseInt(hex.slice(1,3), 16) / 255;
  const g = parseInt(hex.slice(3,5), 16) / 255;
  const b = parseInt(hex.slice(5,7), 16) / 255;
  return new BABYLON.Color3(r, g, b);
}
