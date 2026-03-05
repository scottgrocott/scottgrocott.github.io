// structures.js — editor-placed rigid body GLB structures

import { scene, shadowGenerator } from './core.js';
import { physicsWorld, physicsReady, safeVec3 } from './physics.js';
import { CONFIG } from './config.js';

export let structures = [];

export async function loadStructure(glbUrl, worldPos, options = {}) {
  const px = +worldPos.x, py = +worldPos.y, pz = +worldPos.z;
  if (isNaN(px)||isNaN(py)||isNaN(pz)) return null;

  let meshes = [];
  if (glbUrl) {
    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', '', glbUrl, scene);
      meshes = result.meshes;
      meshes.forEach(m => {
        m.position.addInPlaceFromFloats(px, py, pz);
        shadowGenerator.addShadowCaster(m);
      });
    } catch(e) {
      console.warn('[structures] GLB load failed, using placeholder:', glbUrl);
      meshes = [_makePlaceholder(px, py, pz, options)];
    }
  } else {
    meshes = [_makePlaceholder(px, py, pz, options)];
  }

  // Physics body
  let body = null;
  if (physicsReady) {
    const safe = safeVec3(px, py, pz, 'structure');
    if (safe) {
      const isDynamic = options.dynamic || false;
      const bodyDesc = isDynamic
        ? RAPIER.RigidBodyDesc.dynamic().setTranslation(safe.x, safe.y, safe.z)
        : RAPIER.RigidBodyDesc.fixed().setTranslation(safe.x, safe.y, safe.z);
      body = physicsWorld.createRigidBody(bodyDesc);
      const w = options.width||2, h = options.height||2, d = options.depth||2;
      physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(w/2, h/2, d/2), body);
    }
  }

  const struct = { meshes, body, glbUrl, worldPos: {x:px,y:py,z:pz}, options, dead: false };
  structures.push(struct);
  return struct;
}

function _makePlaceholder(px, py, pz, options) {
  const mesh = BABYLON.MeshBuilder.CreateBox('struct', {
    width: options.width||2, height: options.height||2, depth: options.depth||2
  }, scene);
  mesh.position.set(px, py + (options.height||2)/2, pz);
  const mat = new BABYLON.StandardMaterial('structMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.6, 0.5, 0.3);
  mesh.material = mat;
  mesh.receiveShadows = true;
  shadowGenerator.addShadowCaster(mesh);
  return mesh;
}

export function placeStructure(glbUrl, worldPos, options) {
  return loadStructure(glbUrl, worldPos, options);
}

export function removeStructure(struct) {
  const idx = structures.indexOf(struct);
  if (idx === -1) return;
  struct.meshes.forEach(m => { try { m.dispose(); } catch(e){} });
  if (struct.body) { try { physicsWorld.removeRigidBody(struct.body); } catch(e){} }
  structures.splice(idx, 1);
}

export function tickStructures(dt) {
  for (const s of structures) {
    if (!s.body || !s.options.dynamic) continue;
    const t = s.body.translation();
    const px = +t.x, py = +t.y, pz = +t.z;
    if (isNaN(px)) continue;
    s.meshes.forEach(m => m.position.set(px, py, pz));
  }
}

export function clearStructures() {
  for (const s of structures) {
    s.meshes.forEach(m => { try { m.dispose(); } catch(e){} });
    if (s.body) { try { physicsWorld.removeRigidBody(s.body); } catch(e){} }
  }
  structures = [];
}
