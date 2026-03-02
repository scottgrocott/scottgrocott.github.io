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
        _buildTerrainBoundaryWalls(subMeshes);
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

/**
 * Erect 4 invisible Rapier cuboid walls around the terrain's world bounding box.
 * Wall height spans from well below the lowest point to well above the highest,
 * so there is no gap regardless of terrain elevation range.
 * Wall thickness is 2 m — thick enough that fast-moving players can't tunnel through.
 */
function _buildTerrainBoundaryWalls(terrainMeshes) {
  const R   = window.RAPIER;
  const THICKNESS = 2;
  const OVERREACH = 50; // extra metres above/below terrain extents

  // Compute world bounding box from all terrain sub-meshes
  const min = new BABYLON.Vector3( Infinity,  Infinity,  Infinity);
  const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of terrainMeshes) {
    m.computeWorldMatrix(true);
    const { minimumWorld, maximumWorld } = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(minimumWorld);
    max.maximizeInPlace(maximumWorld);
  }

  const cx = (min.x + max.x) / 2;   // terrain centre X
  const cz = (min.z + max.z) / 2;   // terrain centre Z
  const cy = (min.y + max.y) / 2;   // vertical midpoint

  const halfW = (max.x - min.x) / 2 + THICKNESS; // half-extent X (includes wall thickness)
  const halfD = (max.z - min.z) / 2 + THICKNESS; // half-extent Z
  const halfH = (max.y - min.y) / 2 + OVERREACH; // tall enough to cover full elevation range

  // Each wall: [centreX, centreY, centreZ, halfExtentX, halfExtentY, halfExtentZ]
  const walls = [
    // -X (west)
    [min.x - THICKNESS / 2, cy, cz,   THICKNESS / 2, halfH, halfD],
    // +X (east)
    [max.x + THICKNESS / 2, cy, cz,   THICKNESS / 2, halfH, halfD],
    // -Z (south)
    [cx, cy, min.z - THICKNESS / 2,   halfW, halfH, THICKNESS / 2],
    // +Z (north)
    [cx, cy, max.z + THICKNESS / 2,   halfW, halfH, THICKNESS / 2],
  ];

  for (const [wx, wy, wz, hx, hy, hz] of walls) {
    const body = physicsWorld.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(wx, wy, wz),
    );
    physicsWorld.createCollider(R.ColliderDesc.cuboid(hx, hy, hz), body);
  }

  console.info(
    `[buildings] Boundary walls built — terrain extents`,
    `X[${min.x.toFixed(1)} → ${max.x.toFixed(1)}]`,
    `Z[${min.z.toFixed(1)} → ${max.z.toFixed(1)}]`,
  );
}

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