// ============================================================
//  terrainMaterial.js — ShaderMaterial that blends rocky-dirt
//  onto flat terrain areas using world-space normal Y.
//
//  Avoids NodeMaterial block connector issues entirely by using
//  inline GLSL via BABYLON.ShaderMaterial.
//
//  Blend logic (in fragment shader):
//   normalY = dot( worldNormal, vec3(0,1,0) )
//   mask    = smoothstep( BLEND_LOW, BLEND_HIGH, normalY )
//   albedo  = mix( baseTex, rockyTex, mask )
//   → flat ground shows rocky dirt, cliffs stay sandy
// ============================================================

import { scene }      from './core.js';
import { GROUND_TEX } from './config.js';

const ROCKY_TEX   = 'https://scottgrocott.github.io/metal_throne/assets/img/rocky_dirt00.png';
const BASE_SCALE  = 2250.0;
const ROCKY_SCALE = 120.0;
const BLEND_LOW   = 0.70;
const BLEND_HIGH  = 0.88;

// ── Vertex shader ─────────────────────────────────────────────
const VERT = /* glsl */`
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
    vec4 worldPos    = world * vec4(position, 1.0);
    vWorldPos        = worldPos.xyz;
    vWorldNormal     = normalize(mat3(world) * normal);
    vUV              = uv;
    gl_Position      = worldViewProjection * vec4(position, 1.0);
  }
`;

// ── Fragment shader ───────────────────────────────────────────
const FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D baseSampler;
  uniform sampler2D rockySampler;
  uniform float     baseScale;
  uniform float     rockyScale;
  uniform float     blendLow;
  uniform float     blendHigh;

  varying vec2  vUV;
  varying vec3  vWorldNormal;
  varying vec3  vWorldPos;

  void main(void) {
    vec3  n        = normalize(vWorldNormal);
    float normalY  = dot(n, vec3(0.0, 1.0, 0.0));
    float mask     = smoothstep(blendLow, blendHigh, normalY);

    vec4  baseCol  = texture2D(baseSampler,  vUV * baseScale);
    vec4  rockyCol = texture2D(rockySampler, vUV * rockyScale);

    vec4  albedo   = mix(baseCol, rockyCol, mask);

    // Simple diffuse-only shading so it matches the existing terrain look
    float light    = clamp(dot(n, normalize(vec3(0.4, 1.0, 0.6))), 0.15, 1.0);
    gl_FragColor   = vec4(albedo.rgb * light, 1.0);
  }
`;

export async function buildTerrainNodeMaterial() {
  // Register the shader source with Babylon's store
  BABYLON.Effect.ShadersStore['terrainBlendVertexShader']   = VERT;
  BABYLON.Effect.ShadersStore['terrainBlendFragmentShader'] = FRAG;

  const mat = new BABYLON.ShaderMaterial(
    'terrainBlendMat',
    scene,
    { vertex: 'terrainBlend', fragment: 'terrainBlend' },
    {
      attributes:   ['position', 'normal', 'uv'],
      uniforms:     ['worldViewProjection', 'world',
                     'baseScale', 'rockyScale', 'blendLow', 'blendHigh'],
      samplers:     ['baseSampler', 'rockySampler'],
      needAlphaBlending: false,
    },
  );

  const baseTex  = new BABYLON.Texture(GROUND_TEX, scene);
  const rockyTex = new BABYLON.Texture(ROCKY_TEX,  scene);

  mat.setTexture('baseSampler',  baseTex);
  mat.setTexture('rockySampler', rockyTex);
  mat.setFloat('baseScale',  BASE_SCALE);
  mat.setFloat('rockyScale', ROCKY_SCALE);
  mat.setFloat('blendLow',   BLEND_LOW);
  mat.setFloat('blendHigh',  BLEND_HIGH);

  mat.backFaceCulling = false;

  console.info('[terrainMaterial] ShaderMaterial built — flat areas will show rocky-dirt');
  return mat;
}

export function applyTerrainNodeMaterial(nodeMat, terrainMeshes) {
  for (const m of terrainMeshes) {
    m.material     = nodeMat;
    m.receiveShadows = true;
  }
}