// shelters.js — physics shelter builder (BabylonJS Havok)
//
// Key design:
//   • Posts are sunk 0.3m into terrain (ground Y from getTerrainHeightAt)
//     so poles never float above ground.
//   • Panels are nailed to ONE side (left or right, chosen randomly per shelter)
//     — flush against the outer face of the two poles on that side, not centred.
//   • Each shelter has a random hit threshold 3–5. On the Nth basicgun bullet hit
//     all parts go dynamic with impulses and a collapse sound plays.
//   • explosionKnockShelter(worldPos, radius) is the placeholder for explosion-driven
//     toppling — uses the full sound object (boom + debris).

import { scene, shadowGenerator }     from '../core.js';
import { physicsReady, safeVec3 }     from '../physics.js';
import { spawnLadder }                from '../ladders.js';
import { getTerrainHeightAt }         from '../terrain/terrainMesh.js';
import {
  playBulletImpact,
  playStructureCollapse,
  playExplosion,
}                                     from '../audio.js';
import { capturePlayerPosition }      from './utils.js';

export let shelters               = [];
export let shelterProgressionDone = false;
let _designIndex = 0;

// ── Shelter designs ───────────────────────────────────────────────────────────
// poles[] offset is local XZ from shelter centre.
// extra[] offset.y is metres above terrain surface (NOT above by).
// panelSide 'x' means panels go on the x=-poleRadius or x=+poleRadius face.

const DESIGNS = [
  {
    id: 'lean_to',
    poles: [{ offset: { x: 0, z: 0 }, h: 3.5 }],
    extra: [
      { type: 'beam', offset: { x: 0, y: 3.0, z: 0.7 }, size: { w: 1.8, h: 0.12, d: 0.12 } },
      { type: 'roof', offset: { x: 0, y: 3.3, z: 0.4 }, size: { w: 2.0, h: 0.08, d: 1.0  } },
    ],
    panelSide: null,
  },
  {
    id: 'basic_shelter',
    poles: [
      { offset: { x: -1, z: -1 }, h: 3.8 },
      { offset: { x:  1, z: -1 }, h: 3.8 },
      { offset: { x: -1, z:  1 }, h: 3.8 },
      { offset: { x:  1, z:  1 }, h: 3.8 },
    ],
    extra: [
      { type: 'beam', offset: { x: 0, y: 3.6, z: -1 }, size: { w: 2.2, h: 0.13, d: 0.13 } },
      { type: 'beam', offset: { x: 0, y: 3.6, z:  1 }, size: { w: 2.2, h: 0.13, d: 0.13 } },
      { type: 'roof', offset: { x: 0, y: 3.8, z:  0 }, size: { w: 2.4, h: 0.10, d: 2.4  } },
    ],
    panelSide: 'x',
    poleRadius: 1,
  },
  {
    id: 'tower',
    poles: [
      { offset: { x: -0.6, z: -0.6 }, h: 5.8 },
      { offset: { x:  0.6, z: -0.6 }, h: 5.8 },
      { offset: { x: -0.6, z:  0.6 }, h: 5.8 },
      { offset: { x:  0.6, z:  0.6 }, h: 5.8 },
    ],
    extra: [
      { type: 'floor', offset: { x: 0, y: 2.8, z: 0   }, size: { w: 1.4, h: 0.10, d: 1.4  } },
      { type: 'beam',  offset: { x: 0, y: 5.6, z: -0.6 }, size: { w: 1.3, h: 0.11, d: 0.11 } },
      { type: 'beam',  offset: { x: 0, y: 5.6, z:  0.6 }, size: { w: 1.3, h: 0.11, d: 0.11 } },
      { type: 'roof',  offset: { x: 0, y: 5.8, z: 0   }, size: { w: 1.5, h: 0.10, d: 1.5  } },
    ],
    panelSide: 'x',
    poleRadius: 0.6,
  },
];

const PART_COLORS = {
  pole:  new BABYLON.Color3(0.45, 0.30, 0.18),
  beam:  new BABYLON.Color3(0.38, 0.26, 0.15),
  roof:  new BABYLON.Color3(0.35, 0.24, 0.14),
  floor: new BABYLON.Color3(0.42, 0.30, 0.18),
  panel: new BABYLON.Color3(0.58, 0.52, 0.44),
};

// ── Public API ────────────────────────────────────────────────────────────────

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
  const bx = +worldPos.x, bz = +worldPos.z;
  if (isNaN(bx) || isNaN(bz)) return;

  // Ground Y: sample terrain at centre + all pole offsets, use MIN.
  // MIN means we anchor on the lowest nearby point — poles never float on a hill.
  let groundY = getTerrainHeightAt(bx, bz);
  for (const p of (design.poles || [])) {
    const h = getTerrainHeightAt(bx + p.offset.x, bz + p.offset.z);
    if (h < groundY) groundY = h;
  }

  // Sink poles 0.25m so their visible base is at terrain level
  const POLE_SINK = 0.25;
  const POLE_W    = 0.14;

  const parts = [];
  const rotY  = worldPos.rotY ?? (Math.random() * Math.PI * 2);
  const cosR  = Math.cos(rotY);
  const sinR  = Math.sin(rotY);

  function rotXZ(lx, lz) {
    return { x: bx + lx * cosR - lz * sinR, z: bz + lx * sinR + lz * cosR };
  }

  let maxPoleH = 0;

  // ── Poles ─────────────────────────────────────────────────────────────────
  for (const poleDef of (design.poles || [])) {
    const poleH   = poleDef.h + POLE_SINK;
    const { x: wx, z: wz } = rotXZ(poleDef.offset.x, poleDef.offset.z);
    const centerY = groundY - POLE_SINK + poleH / 2;  // bottom at groundY-POLE_SINK

    const mesh = _box(`pole_${parts.length}`, POLE_W, poleH, POLE_W, wx, centerY, wz, 'pole');
    parts.push({ mesh, agg: _staticAgg(mesh), isFixed: true, type: 'pole' });
    if (poleDef.h > maxPoleH) maxPoleH = poleDef.h;
  }

  // ── Extra parts (beams, roof, floor) ─────────────────────────────────────
  for (const e of (design.extra || [])) {
    const { x: wx, z: wz } = rotXZ(e.offset.x, e.offset.z);
    const centerY = groundY + e.offset.y + e.size.h / 2;

    const mesh = _box(`${e.type}_${parts.length}`, e.size.w, e.size.h, e.size.d, wx, centerY, wz, e.type);
    if (rotY !== 0) mesh.rotation.y = rotY;
    parts.push({ mesh, agg: _staticAgg(mesh), isFixed: true, type: e.type });
  }

  // ── Panels on ONE side ────────────────────────────────────────────────────
  if (design.panelSide && design.poles.length >= 4) {
    const sign   = Math.random() < 0.5 ? -1 : 1;
    const radius = design.poleRadius ?? 1.0;
    _spawnPanels(parts, bx, groundY, bz, rotY, cosR, sinR, sign, radius, maxPoleH);
  }

  // ── Ladder on far side ────────────────────────────────────────────────────
  if (design.id !== 'lean_to') {
    spawnLadder({
      position: { x: bx + 1.4 * cosR, y: groundY, z: bz + 1.4 * sinR },
      height: maxPoleH,
    });
  }

  const hitThreshold = 3 + Math.floor(Math.random() * 3);  // 3, 4, or 5
  const shelter = {
    design,
    worldPos: { x: bx, y: groundY, z: bz },
    parts,
    hitCount: 0,
    hitThreshold,
    collapsed: false,
  };
  shelters.push(shelter);
  return shelter;
}

// ── Panels: nailed flush to outer face of the two poles on 'sign' side ───────
function _spawnPanels(parts, bx, groundY, bz, rotY, cosR, sinR, sign, radius, maxPoleH) {
  const PANEL_H     = 0.52;
  const PANEL_THICK = 0.032;
  const GAP         = 0.035;
  const START_Y     = 0.12;  // first row bottom above groundY

  // Panel width = full span between poles on Z axis (which = radius*2 minus pole width)
  const pw = radius * 2 - 0.10;

  // Face is at local x = sign * radius, outer surface at sign * (radius + PANEL_THICK/2)
  const faceLocalX = sign * (radius + PANEL_THICK / 2 + 0.005);

  const rows = Math.max(1, Math.floor((maxPoleH * 0.88 - START_Y) / (PANEL_H + GAP)));

  for (let row = 0; row < rows; row++) {
    if (Math.random() < 0.12) continue;  // occasional gap

    const centerY = groundY + START_Y + row * (PANEL_H + GAP) + PANEL_H / 2;

    // Local z=0 = centre between the two poles on this side
    const lx = faceLocalX, lz = 0;
    const wx = bx + lx * cosR - lz * Math.sin(rotY);
    const wz = bz + lx * Math.sin(rotY) + lz * cosR;

    // Panel geometry: wide on Z, thin on X (flush against face)
    const mesh = _box(`panel_r${row}`, PANEL_THICK, PANEL_H, pw, wx, centerY, wz, 'panel');
    if (rotY !== 0) mesh.rotation.y = rotY;
    parts.push({ mesh, agg: _staticAgg(mesh), isFixed: true, type: 'panel' });
  }
}

// ── Geometry / physics helpers ────────────────────────────────────────────────

function _box(name, w, h, d, wx, wy, wz, type) {
  const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  mesh.position.set(wx, wy, wz);
  mesh.isPickable = true;
  const mat = new BABYLON.StandardMaterial(name + '_mat', scene);
  mat.diffuseColor = (PART_COLORS[type] || PART_COLORS.pole).clone().scale(0.82 + Math.random() * 0.28);
  mesh.material = mat;
  mesh.receiveShadows = true;
  shadowGenerator?.addShadowCaster(mesh);
  return mesh;
}

function _staticAgg(mesh) {
  if (!physicsReady) return null;
  return new BABYLON.PhysicsAggregate(
    mesh, BABYLON.PhysicsShapeType.BOX,
    { mass: 0, restitution: 0.05, friction: 0.7 }, scene,
  );
}

// ── Hit registration ──────────────────────────────────────────────────────────
// Call from weapon/bullet system when a ray hits any mesh.
// Returns true if the hit belonged to a shelter (caller can skip further handling).

export function onShelterHit(hitMesh) {
  for (const shelter of shelters) {
    if (shelter.collapsed) continue;
    const owns = shelter.parts.some(p => p.mesh === hitMesh);
    if (!owns) continue;

    shelter.hitCount++;
    playBulletImpact();  // wooden/metal panel impact thud

    if (shelter.hitCount >= shelter.hitThreshold) {
      _collapseShelter(shelter);
    }
    return true;
  }
  return false;
}

// ── Collapse ──────────────────────────────────────────────────────────────────

function _collapseShelter(shelter) {
  if (shelter.collapsed) return;
  shelter.collapsed = true;

  playStructureCollapse();  // brown noise + membrane boom

  for (const part of shelter.parts) {
    if (!part.isFixed || !part.agg) continue;
    const delay = Math.random() * 380;
    setTimeout(() => {
      try {
        const pos = part.mesh.position.clone();
        part.agg.dispose();
        part.agg = new BABYLON.PhysicsAggregate(
          part.mesh, BABYLON.PhysicsShapeType.BOX,
          { mass: 1.2, restitution: 0.15, friction: 0.55 }, scene,
        );
        const body = part.agg.body;
        if (body) {
          body.applyImpulse(
            new BABYLON.Vector3(
              (Math.random() - 0.5) * 28,
              18 + Math.random() * 22,
              (Math.random() - 0.5) * 28,
            ),
            pos,
          );
        }
        part.isFixed = false;
      } catch(e) {}
    }, delay);
  }
}

// ── Explosion placeholder ─────────────────────────────────────────────────────
// Hook into your grenade/explosion system. Pass the full explosion worldPos object.

export function explosionKnockShelter(worldPos, radius = 9) {
  const px = +worldPos.x, pz = +worldPos.z;

  for (const shelter of shelters) {
    const dx = shelter.worldPos.x - px;
    const dz = shelter.worldPos.z - pz;
    if (Math.sqrt(dx * dx + dz * dz) > radius) continue;
    if (shelter.collapsed) continue;

    shelter.collapsed = true;
    // Full explosion sound — spatial pos passed through
    playExplosion({ x: px, y: worldPos.y ?? shelter.worldPos.y, z: pz });

    const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz) / radius);

    for (const part of shelter.parts) {
      if (!part.agg) continue;
      const delay = Math.random() * 200;
      setTimeout(() => {
        try {
          const pos = part.mesh.position.clone();
          if (part.isFixed) {
            part.agg.dispose();
            part.agg = new BABYLON.PhysicsAggregate(
              part.mesh, BABYLON.PhysicsShapeType.BOX,
              { mass: 1.2, restitution: 0.2, friction: 0.5 }, scene,
            );
            part.isFixed = false;
          }
          const body = part.agg.body;
          if (body) {
            const ix = (pos.x - px) * 0.6 + (Math.random() - 0.5) * 18;
            const iy = 45 + falloff * 55 + Math.random() * 20;
            const iz = (pos.z - pz) * 0.6 + (Math.random() - 0.5) * 18;
            body.applyImpulse(new BABYLON.Vector3(ix * falloff, iy, iz * falloff), pos);
          }
        } catch(e) {}
      }, delay);
    }
  }
}

// ── Proximity destroy (editor / scripting) ────────────────────────────────────

export function destroyShelterAt(worldPos, radius = 5) {
  const px = +worldPos.x, pz = +worldPos.z;
  for (const shelter of shelters) {
    const dx = shelter.worldPos.x - px;
    const dz = shelter.worldPos.z - pz;
    if (Math.sqrt(dx * dx + dz * dz) < radius) _collapseShelter(shelter);
  }
}

export function tickShelters() {}  // Havok drives dynamic bodies automatically

export function clearShelters() {
  for (const shelter of shelters) {
    for (const part of shelter.parts) {
      try { part.agg?.dispose(); }  catch(e) {}
      try { part.mesh?.dispose(); } catch(e) {}
    }
  }
  shelters               = [];
  shelterProgressionDone = false;
  _designIndex           = 0;
}