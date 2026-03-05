// buildings.js — GLB loading with static Rapier colliders; placeholder if no GLB

import { scene, shadowGenerator } from './core.js';
import { physicsWorld, physicsReady, safeVec3 } from './physics.js';
import { CONFIG } from './config.js';

let _buildings = [];

export async function loadBuildings() {
  clearBuildings();
  const assets = CONFIG.assets || [];
  for (const asset of assets) {
    if (asset.type === 'building') {
      await _loadBuilding(asset);
    }
  }
}

async function _loadBuilding(def) {
  const px = +(def.position?.x || 0);
  const py = +(def.position?.y || 0);
  const pz = +(def.position?.z || 0);
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return;

  if (def.glb) {
    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', '', def.glb, scene);
      const meshes = result.meshes;
      meshes.forEach(m => {
        m.position.addInPlaceFromFloats(px, py, pz);
        m.receiveShadows = true;
        shadowGenerator.addShadowCaster(m);
      });
      _createStaticCollider(px, py + 2, pz, 4, 4, 4);
      _buildings.push({ meshes, def });
      return;
    } catch(e) {
      console.warn('[buildings] GLB load failed, using placeholder:', def.glb, e);
    }
  }

  // Placeholder box
  const mesh = BABYLON.MeshBuilder.CreateBox('building', {
    width:  def.width  || 6,
    height: def.height || 5,
    depth:  def.depth  || 6,
  }, scene);
  mesh.position.set(px, py + (def.height||5)/2, pz);
  mesh.receiveShadows = true;
  shadowGenerator.addShadowCaster(mesh);

  const mat = new BABYLON.StandardMaterial('bldgMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.35, 0.35, 0.3);
  mesh.material = mat;

  _createStaticCollider(px, py + (def.height||5)/2, pz, def.width||6, def.height||5, def.depth||6);
  _buildings.push({ meshes: [mesh], def });
}

function _createStaticCollider(px, py, pz, w, h, d) {
  if (!physicsReady) return;
  const safe = safeVec3(px, py, pz, 'building collider');
  if (!safe) return;
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(safe.x, safe.y, safe.z);
  const body = physicsWorld.createRigidBody(bodyDesc);
  physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(w/2, h/2, d/2), body);
}

export function clearBuildings() {
  for (const b of _buildings) {
    b.meshes.forEach(m => { try { m.dispose(); } catch(e){} });
  }
  _buildings = [];
}
