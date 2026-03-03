// ============================================================
//  terrainMaterial.js — ShaderMaterial, slope-blend + fog
//
//  Fog distance computed from world-space camera distance
//  rather than view-space Z, avoiding view matrix injection.
// ============================================================

import { scene }      from './core.js';
import { GROUND_TEX } from './config.js';

const ROCKY_TEX   = 'https://scottgrocott.github.io/metal_throne/assets/img/rocky_dirt00.png';
const BASE_SCALE  = 2250.0;
const ROCKY_SCALE = 120.0;
const BLEND_LOW   = 0.70;
const BLEND_HIGH  = 0.88;

const VERT = `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  attribute vec2 uv;
  uniform mat4 worldViewProjection;
  uniform mat4 world;
  varying vec2  vUV;
  varying vec3  vWorldNormal;
  varying vec3  vWorldPos;
  void main(void) {
    vec4 wp      = world * vec4(position, 1.0);
    vWorldPos    = wp.xyz;
    vWorldNormal = normalize(mat3(world) * normal);
    vUV          = uv;
    gl_Position  = worldViewProjection * vec4(position, 1.0);
  }
`;

// fogMode: 0=none  1=exp  2=exp2  3=linear
const FRAG = `
  precision highp float;
  uniform sampler2D baseSampler;
  uniform sampler2D rockySampler;
  uniform float baseScale;
  uniform float rockyScale;
  uniform float blendLow;
  uniform float blendHigh;
  uniform vec3  cameraPosition;
  uniform int   fogMode;
  uniform float fogStart;
  uniform float fogEnd;
  uniform float fogDensity;
  uniform vec3  fogColor;
  varying vec2  vUV;
  varying vec3  vWorldNormal;
  varying vec3  vWorldPos;
  void main(void) {
    vec3  n       = normalize(vWorldNormal);
    float normalY = dot(n, vec3(0.0, 1.0, 0.0));
    float mask    = smoothstep(blendLow, blendHigh, normalY);
    vec4 baseCol  = texture2D(baseSampler,  vUV * baseScale);
    vec4 rockyCol = texture2D(rockySampler, vUV * rockyScale);
    vec4 albedo   = mix(baseCol, rockyCol, mask);
    float light   = clamp(dot(n, normalize(vec3(0.4, 1.0, 0.6))), 0.15, 1.0);
    vec3  color   = albedo.rgb * light;
    float dist      = length(vWorldPos - cameraPosition);
    float fogFactor = 1.0;
    if (fogMode == 3) {
      fogFactor = clamp((fogEnd - dist) / (fogEnd - fogStart), 0.0, 1.0);
    } else if (fogMode == 1) {
      fogFactor = clamp(exp(-fogDensity * dist), 0.0, 1.0);
    } else if (fogMode == 2) {
      float fd  = fogDensity * dist;
      fogFactor = clamp(exp(-(fd * fd)), 0.0, 1.0);
    }
    color        = mix(fogColor, color, fogFactor);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export async function buildTerrainNodeMaterial() {
  BABYLON.Effect.ShadersStore['terrainBlendVertexShader']   = VERT;
  BABYLON.Effect.ShadersStore['terrainBlendFragmentShader'] = FRAG;

  const mat = new BABYLON.ShaderMaterial(
    'terrainBlendMat', scene,
    { vertex: 'terrainBlend', fragment: 'terrainBlend' },
    {
      attributes: ['position', 'normal', 'uv'],
      uniforms:   ['worldViewProjection', 'world',
                   'cameraPosition',
                   'baseScale', 'rockyScale', 'blendLow', 'blendHigh',
                   'fogMode', 'fogStart', 'fogEnd', 'fogDensity', 'fogColor'],
      samplers:   ['baseSampler', 'rockySampler'],
      needAlphaBlending: false,
    },
  );

  mat.setTexture('baseSampler',  new BABYLON.Texture(GROUND_TEX, scene));
  mat.setTexture('rockySampler', new BABYLON.Texture(ROCKY_TEX,  scene));
  mat.setFloat('baseScale',  BASE_SCALE);
  mat.setFloat('rockyScale', ROCKY_SCALE);
  mat.setFloat('blendLow',   BLEND_LOW);
  mat.setFloat('blendHigh',  BLEND_HIGH);

  mat.onBindObservable.add(() => {
    const cam = scene.activeCamera;
    if (cam) {
      mat.setVector3('cameraPosition',
        new BABYLON.Vector3(cam.globalPosition.x, cam.globalPosition.y, cam.globalPosition.z)
      );
    }
    mat.setInt   ('fogMode',    scene.fogMode    ?? 0);
    mat.setFloat ('fogStart',   scene.fogStart   ?? 0);
    mat.setFloat ('fogEnd',     scene.fogEnd     ?? 1000);
    mat.setFloat ('fogDensity', scene.fogDensity ?? 0.01);
    mat.setVector3('fogColor',
      new BABYLON.Vector3(scene.fogColor.r, scene.fogColor.g, scene.fogColor.b)
    );
  });

  mat.backFaceCulling = false;
  console.info('[terrainMaterial] Built — slope-blend + fog active');
  return mat;
}

export function applyTerrainNodeMaterial(nodeMat, terrainMeshes) {
  for (const m of terrainMeshes) {
    m.material     = nodeMat;
    m.receiveShadows = true;
  }
}