// shelters/shelters.js — physics shelter builder (Havok)
// Changes from Rapier version:
//   - RAPIER.RigidBodyDesc.fixed()  → PhysicsAggregate(mass:0)
//   - RAPIER.RigidBodyDesc.dynamic() → PhysicsAggregate(mass:1)
//   - physicsWorld.removeRigidBody() → aggregate.dispose()
//   - Rotation sync uses physicsBody.transformNode quaternion

import { scene, shadowGenerator } from '../core.js';
import { physicsReady, safeVec3 } from '../physics.js';
import { spawnLadder } from '../ladders.js';
import { playTopple } from '../audio.js';
import { capturePlayerPosition } from './utils.js';

export let shelters = [];
export let shelterProgressionDone = false;

let _designIndex = 0;

const DESIGNS = [
{id: "lean_to", parts: [{type: "pole", offset: {x: 0, y: 0, z: 0}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "beam", offset: {x: 0, y: 3.5, z: 0.8}, size: {w: 2, h: 0.15, d: 0.15}}, {type: "roof", offset: {x: 0, y: 3.8, z: 0.5}, size: {w: 2.2, h: 0.1, d: 1.2}}]},
{id: "basic_shelter", parts: [{type: "pole", offset: {x: -1, y: 0, z: -1}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "pole", offset: {x: 1, y: 0, z: -1}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "pole", offset: {x: -1, y: 0, z: 1}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "pole", offset: {x: 1, y: 0, z: 1}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "beam", offset: {x: 0, y: 3.8, z: -1}, size: {w: 2.2, h: 0.15, d: 0.15}}, {type: "beam", offset: {x: 0, y: 3.8, z: 1}, size: {w: 2.2, h: 0.15, d: 0.15}}, {type: "roof", offset: {x: 0, y: 4.0, z: 0}, size: {w: 2.4, h: 0.12, d: 2.4}}]},
{id: "tower", parts: [{type: "pole", offset: {x: -0.6, y: 0, z: -0.6}, size: {w: 0.15, h: 6, d: 0.15}}, {type: "pole", offset: {x: 0.6, y: 0, z: -0.6}, size: {w: 0.15, h: 6, d: 0.15}}, {type: "pole", offset: {x: -0.6, y: 0, z: 0.6}, size: {w: 0.15, h: 6, d: 0.15}}, {type: "pole", offset: {x: 0.6, y: 0, z: 0.6}, size: {w: 0.15, h: 6, d: 0.15}}, {type: "floor", offset: {x: 0, y: 3, z: 0}, size: {w: 1.5, h: 0.1, d: 1.5}}, {type: "beam", offset: {x: 0, y: 5.8, z: -0.6}, size: {w: 1.4, h: 0.12, d: 0.12}}, {type: "beam", offset: {x: 0, y: 5.8, z: 0.6}, size: {w: 1.4, h: 0.12, d: 0.12}}, {type: "roof", offset: {x: 0, y: 6.0, z: 0}, size: {w: 1.6, h: 0.12, d: 1.6}}]},
{id: "square_tower_1_levels_size_1_0", parts: [{type: "pole", offset: {x: -0.5, y: 0, z: -0.5}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "pole", offset: {x: 0.5, y: 0, z: -0.5}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "pole", offset: {x: -0.5, y: 0, z: 0.5}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "pole", offset: {x: 0.5, y: 0, z: 0.5}, size: {w: 0.15, h: 4, d: 0.15}}, {type: "floor", offset: {x: 0, y: 0.1, z: 0}, size: {w: 1.2, h: 0.1, d: 1.2}}, {type: "beam", offset: {x: 0, y: 3.8, z: -0.5}, size: {w: 1.2, h: 0.15, d: 0.15}}, {type: "beam", offset: {x: 0, y: 3.8, z: 0.5}, size: {w: 1.2, h: 0.15, d: 0.15}}, {type: "beam", offset: {x: -0.5, y: 3.8, z: 0}, size: {w: 0.15, h: 0.15, d: 1.2}}, {type: "beam", offset: {x: 0.5, y: 3.8, z: 0}, size: {w: 0.15, h: 0.15, d: 1.2}}, {type: "roof", offset: {x: 0, y: 4.0, z: 0}, size: {w: 1.4, h: 0.12, d: 1.4}}]},
];

const PART_COLORS = {
  pole:  new BABYLON.Color3(0.55, 0.38, 0.20),
  beam:  new BABYLON.Color3(0.50, 0.34, 0.18),
  roof:  new BABYLON.Color3(0.40, 0.28, 0.15),
  floor: new BABYLON.Color3(0.48, 0.33, 0.18),
};

export function getShelterDesignIds() { return DESIGNS.map(d => d.id); }

export function spawnNextShelter() {
  if (shelterProgressionDone) return;
  if (_designIndex >= DESIGNS.length) { shelterProgressionDone = true; return; }
  const design = DESIGNS[_designIndex++];
  spawnShelter(design, capturePlayerPosition());
}

export function spawnShelterByDesign(designId, pos) {
  const design = DESIGNS.find(d => d.id === designId);
  if (design) spawnShelter(design, pos || capturePlayerPosition());
}

export function spawnShelter(design, worldPos) {
  if (!physicsReady) return;
  const bx = +worldPos.x, by = +worldPos.y, bz = +worldPos.z;
  if (isNaN(bx) || isNaN(by) || isNaN(bz)) return;

  const parts = [];

  for (const partDef of design.parts) {
    const ox = +partDef.offset.x, oy = +partDef.offset.y, oz = +partDef.offset.z;
    const s = safeVec3(bx + ox, by + oy, bz + oz, `shelter part ${partDef.type}`);
    if (!s) continue;

    const { w, h, d } = partDef.size;

    const mesh = BABYLON.MeshBuilder.CreateBox(`shelterPart_${parts.length}`,
      { width: w, height: h, depth: d }, scene);
    mesh.position.set(s.x, s.y + h / 2, s.z);

    const mat = new BABYLON.StandardMaterial('shelterMat', scene);
    mat.diffuseColor = PART_COLORS[partDef.type] || PART_COLORS.pole;
    mesh.material = mat;
    mesh.receiveShadows = true;
    shadowGenerator?.addShadowCaster(mesh);

    // Static Havok box
    const aggregate = new BABYLON.PhysicsAggregate(
      mesh,
      BABYLON.PhysicsShapeType.BOX,
      { mass: 0, restitution: 0.0, friction: 0.6 },
      scene,
    );

    parts.push({ mesh, aggregate, size: partDef.size, isFixed: true });
  }

  if (design.id !== 'lean_to') {
    spawnLadder({ position: { x: bx + 0.8, y: by, z: bz }, height: 4 });
  }

  const shelter = { design, worldPos: { x: bx, y: by, z: bz }, parts };
  shelters.push(shelter);
  return shelter;
}

export function destroyShelterAt(worldPos, radius = 4) {
  const px = +worldPos.x, pz = +worldPos.z;
  for (const shelter of shelters) {
    const dx = shelter.worldPos.x - px;
    const dz = shelter.worldPos.z - pz;
    if (Math.sqrt(dx * dx + dz * dz) < radius) _explodeShelter(shelter);
  }
}

function _explodeShelter(shelter) {
  playTopple();
  for (const part of shelter.parts) {
    if (!part.isFixed) continue;
    setTimeout(() => {
      if (!part.aggregate) return;
      try {
        const pos = part.mesh.position.clone();
        // Dispose static aggregate, replace with dynamic
        part.aggregate.dispose();
        part.aggregate = new BABYLON.PhysicsAggregate(
          part.mesh,
          BABYLON.PhysicsShapeType.BOX,
          { mass: 1, restitution: 0.2, friction: 0.5 },
          scene,
        );
        // Explosion impulse
        const body = part.aggregate.body;
        if (body) {
          body.applyImpulse(
            new BABYLON.Vector3(
              (Math.random() - 0.5) * 80,
              60 + Math.random() * 60,
              (Math.random() - 0.5) * 80,
            ),
            pos,
          );
        }
        part.isFixed = false;
      } catch(e) {}
    }, Math.random() * 400);
  }
}

export function tickShelters(dt) {
  // Havok syncs dynamic mesh positions automatically via physicsBody.
  // Nothing to do here — the transform node is driven by the physics engine.
}

export function clearShelters() {
  for (const shelter of shelters) {
    for (const part of shelter.parts) {
      try { part.aggregate?.dispose(); } catch(e) {}
      try { part.mesh?.dispose(); } catch(e) {}
    }
  }
  shelters = [];
  shelterProgressionDone = false;
  _designIndex = 0;
}
