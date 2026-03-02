// ============================================================
//  buildings.js — GLB scene loading + Rapier static colliders
// ============================================================

import { scene, shadowGenerator } from './core.js';
import { GROUND_TEX }              from './config.js';
import { physicsWorld, raycastMeshes } from './physics.js';

export const buildingPositions = [];

export function loadBuildings(data, onTerrainReady) {
  const terrainMat = _makeTerrainMat();

  data.buildings.forEach(b => {
    const [px, py, pz] = b.position.split(' ').map(Number);
    const [sx, sy, sz] = (b.scale || '1 1 1').split(' ').map(
      n => Number(n) * (b.class === 'terrain' ? 1 : 1.15),
    );
    const isTerrain = b.class === 'terrain';
    const url       = b.model.startsWith('#')
      ? _getAssetSrc(data.assets, b.model.slice(1))
      : b.model;

    BABYLON.SceneLoader.ImportMeshAsync('', url, '', scene).then(result => {
      const root      = result.meshes[0];
      root.position.set(px, py, pz);
      root.scaling.set(sx, sy, sz);

      const subMeshes = result.meshes.slice(1);
      subMeshes.forEach(m => {
        if (!isTerrain) shadowGenerator.addShadowCaster(m);
        m.receiveShadows = true;
        if (isTerrain) m.material = terrainMat;
        raycastMeshes.push(m);
      });

      buildStaticCollider(root);

      if (isTerrain) {
        onTerrainReady?.(subMeshes);
      } else {
        const [bx, by, bz] = [px, py, pz];
        buildingPositions.push({ x: bx, y: by, z: bz, hx: sx * 0.55, hz: sz * 0.55 });
      }
    });
  });
}

export function buildStaticCollider(modelGroup) {
  const R        = window.RAPIER;
  const vertices = [];
  const indices  = [];
  let   idx      = 0;

  for (const node of modelGroup.getChildMeshes(false)) {
    node.computeWorldMatrix(true);
    const wm  = node.getWorldMatrix();
    const pos = node.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const ind = node.getIndices();
    if (!pos || !ind) continue;

    for (let i = 0; i < pos.length; i += 3) {
      const v = BABYLON.Vector3.TransformCoordinates(
        new BABYLON.Vector3(pos[i], pos[i + 1], pos[i + 2]),
        wm,
      );
      vertices.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < ind.length; i++) indices.push(idx + ind[i]);
    idx += pos.length / 3;
  }

  const body = physicsWorld.createRigidBody(R.RigidBodyDesc.fixed());
  physicsWorld.createCollider(
    R.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)),
    body,
  );
}

// ---- Private ----
function _makeTerrainMat() {
  const tex = new BABYLON.Texture(GROUND_TEX, scene);
  tex.uScale = 2250; tex.vScale = 2250;
  const mat = new BABYLON.PBRMaterial('tgm', scene);
  mat.albedoTexture = tex;
  mat.roughness = 0.95; mat.metallic = 0.05;
  mat.albedoColor = BABYLON.Color3.FromHexString('#8B7355');
  return mat;
}

function _getAssetSrc(assets, id) {
  return assets.find(a => a.id === id)?.src ?? null;
}
