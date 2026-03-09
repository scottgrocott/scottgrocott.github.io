// shelters.js — physics shelter builder (BabylonJS Havok)
//
// Placement rules (enforced by scatter.js/_scatterShelters):
//   • No shelters in water — caller passes waterY, shelter skipped if groundY ≤ waterY + 1.5
//   • Flatness check: spawn position re-rolled until slope < MAX_SLOPE
//   • Poles sunk 0.25m so bases sit at terrain level, never floating
//
// Panel placement:
//   • Panels are nailed to ONE side (left OR right, random per shelter)
//   • Each panel row is placed at local X = sign*(poleRadius + PANEL_THICK/2)
//     so panels sit FLUSH against the outer face of the two poles on that side
//   • Panel width spans the FULL gap between the two poles (poleRadius*2 - poleWidth)
//
// Damage:
//   • onShelterHit(mesh) — call from basicGun raycast. 3–5 hits → collapse
//   • explosionKnockShelter(pos, radius) — placeholder for grenade/explosion system

import { scene, shadowGenerator }  from '../core.js';
import { physicsReady }             from '../physics.js';
import { spawnLadder }              from '../ladders.js';
import { getTerrainHeightAt }       from '../terrain/terrainMesh.js';
import { playBulletImpact, playStructureCollapse, playExplosion } from '../audio.js';
import { registerPanelMesh, unregisterPanelMesh, clearPanelMeshes, setShelterHitCallback } from '../shelterBridge.js';
import { capturePlayerPosition }    from './utils.js';

export let shelters               = [];
export let shelterProgressionDone = false;
let _designIndex = 0;

// Register hit callback with bridge so basicGun can call onShelterHit without importing us
setShelterHitCallback(_handleShelterHit);

// ── Designs ───────────────────────────────────────────────────────────────────
// poles[].offset.y is always 0 — the code handles sinking below terrain.
// extra[].offset.y is metres ABOVE terrain surface.
// panelSide:'x' → panels go on the +X or -X face (2 poles share same X coord).
// poleRadius: absolute distance from centre to each pole on the panel axis.

const DESIGNS = [
  {
    id: 'lean_to',
    poles: [{ offset: { x: 0, z: 0 }, h: 3.5 }],
    extra: [
      { type: 'beam', offset: { x: 0, y: 3.0, z: 0.7 }, size: { w: 1.8, h: 0.12, d: 0.12 } },
      { type: 'roof', offset: { x: 0, y: 3.3, z: 0.4 }, size: { w: 2.0, h: 0.08, d: 1.0  } },
    ],
    panelSide: null,   // single pole — no side panels
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
      { type: 'beam', offset: { x: 0, y: 3.62, z: -1 }, size: { w: 2.18, h: 0.13, d: 0.13 } },
      { type: 'beam', offset: { x: 0, y: 3.62, z:  1 }, size: { w: 2.18, h: 0.13, d: 0.13 } },
      { type: 'roof', offset: { x: 0, y: 3.82, z:  0 }, size: { w: 2.40, h: 0.10, d: 2.40 } },
    ],
    panelSide: 'x',
    poleRadius: 1.0,   // poles at x=±1
    poleWidth: 0.14,
    roofHalf: 1.20,    // half-extent of roof footprint (w=2.40)
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
      { type: 'floor', offset: { x: 0, y: 2.8, z: 0.0  }, size: { w: 1.4, h: 0.10, d: 1.4  } },
      { type: 'beam',  offset: { x: 0, y: 5.6, z: -0.6 }, size: { w: 1.3, h: 0.11, d: 0.11 } },
      { type: 'beam',  offset: { x: 0, y: 5.6, z:  0.6 }, size: { w: 1.3, h: 0.11, d: 0.11 } },
      { type: 'roof',  offset: { x: 0, y: 5.8, z: 0.0  }, size: { w: 1.5, h: 0.10, d: 1.5  } },
    ],
    panelSide: 'x',
    poleRadius: 0.6,
    poleWidth: 0.14,
    roofHalf: 0.75,    // half-extent of roof footprint (w=1.5)
  },
];

const PART_COLORS = {
  pole:  new BABYLON.Color3(0.45, 0.30, 0.18),
  beam:  new BABYLON.Color3(0.38, 0.26, 0.15),
  roof:  new BABYLON.Color3(0.35, 0.24, 0.14),
  floor: new BABYLON.Color3(0.42, 0.30, 0.18),
  panel: new BABYLON.Color3(0.60, 0.52, 0.40),
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

  // ── Ground Y ─────────────────────────────────────────────────────────────
  // Sample centre + all pole offsets, use MIN so poles anchor on the low edge.
  // This prevents any pole from floating above a slope.
  let groundY = getTerrainHeightAt(bx, bz);
  for (const p of (design.poles || [])) {
    const h = getTerrainHeightAt(bx + p.offset.x, bz + p.offset.z);
    if (h < groundY) groundY = h;
  }

  const POLE_SINK = 0.25;   // sink poles so base sits at terrain level
  const POLE_W    = 0.14;

  const parts = [];
  const rotY  = worldPos.rotY ?? (Math.random() * Math.PI * 2);
  const cosR  = Math.cos(rotY);
  const sinR  = Math.sin(rotY);

  // Rotate a local XZ offset into world XZ
  const rot = (lx, lz) => ({
    x: bx + lx * cosR - lz * sinR,
    z: bz + lx * sinR + lz * cosR,
  });

  let maxPoleH = 0;

  // ── Poles ─────────────────────────────────────────────────────────────────
  for (const pd of (design.poles || [])) {
    const poleH   = pd.h + POLE_SINK;
    const { x: wx, z: wz } = rot(pd.offset.x, pd.offset.z);
    // Bottom of pole at groundY - POLE_SINK, so the visible face is at groundY
    const centerY = groundY - POLE_SINK + poleH / 2;

    const mesh = _box(`pole_${parts.length}`, POLE_W, poleH, POLE_W, wx, centerY, wz, 'pole');
    parts.push({ mesh, agg: _staticAgg(mesh), isFixed: true, type: 'pole' });
    if (pd.h > maxPoleH) maxPoleH = pd.h;
  }

  // ── Extra parts ───────────────────────────────────────────────────────────
  for (const e of (design.extra || [])) {
    const { x: wx, z: wz } = rot(e.offset.x, e.offset.z);
    // offset.y is above groundY, not above by
    const centerY = groundY + e.offset.y + e.size.h / 2;

    const mesh = _box(`${e.type}_${parts.length}`, e.size.w, e.size.h, e.size.d, wx, centerY, wz, e.type);
    if (rotY !== 0) mesh.rotation.y = rotY;
    parts.push({ mesh, agg: _staticAgg(mesh), isFixed: true, type: e.type });
  }

  // ── Panels on ONE side (flush against outer face of the two poles) ─────────
  // Panel geometry:
  //   - sits at local X = sign*(poleRadius + PANEL_THICK/2)
  //     so the INNER face of the panel touches the outer face of the poles
  //   - width spans the FULL Z span between the two poles on this side
  //     minus a small gap so it doesn't overlap the pole cylinders
  //   - height rows stack from ~ground level up to ~85% of pole height
  if (design.panelSide === 'x' && design.poles.length >= 4) {
    const sign   = Math.random() < 0.5 ? -1 : 1;
    const radius = design.poleRadius ?? 1.0;
    const pw     = design.poleWidth  ?? POLE_W;
    _spawnPanels(parts, bx, groundY, bz, rotY, cosR, sinR, sign, radius, pw, maxPoleH);

    // Ladder placed dead-centre off the non-panel face of the roof, not at a diagonal.
    // This keeps it on a single axis (X) so there is no diagonal overlap with the roof corner.
    // ladderLX = roofHalf + CLEAR_GAP on the non-panel X side, ladderLZ = 0 (face midpoint).
    // CLEAR_GAP is wide enough that the ladder rails clear the roof overhang completely.
    const ladderSign  = -sign;
    const roofHalf    = design.roofHalf ?? (radius + pw / 2 + 0.20);
    const CLEAR_GAP   = 0.55;   // clear of roof edge — inner rail well outside the slab
    const ladderLX    = ladderSign * (roofHalf + CLEAR_GAP);
    const ladderLZ    = 0;       // centre of face, not at a corner
    const { x: lx, z: lz } = rot(ladderLX, ladderLZ);
    // Face directly away from the shelter on the X axis
    const ladderRotY  = rotY + (ladderSign > 0 ? 0 : Math.PI);
    spawnLadder({ position: { x: lx, y: groundY, z: lz }, height: maxPoleH, rotY: ladderRotY });
  } else if (design.id !== 'lean_to') {
    // lean_to just gets a side ladder
    spawnLadder({ position: { x: bx + 0.8 * cosR, y: groundY, z: bz + 0.8 * sinR }, height: maxPoleH, rotY });
  }

  const hitThreshold = 3 + Math.floor(Math.random() * 3);
  const shelter = {
    design,
    worldPos: { x: bx, y: groundY, z: bz },
    parts,
    hitCount:    0,
    hitThreshold,
    collapsed:   false,
  };
  shelters.push(shelter);
  return shelter;
}

// ── Panel spawn helper ────────────────────────────────────────────────────────
// sign = +1 (right side) or -1 (left side)
// radius = poleRadius (distance from shelter centre to poles on the chosen axis)
// pw = pole width (to compute tight-fit panel width)
function _spawnPanels(parts, bx, groundY, bz, rotY, cosR, sinR, sign, radius, pw, maxPoleH) {
  const PANEL_H     = 0.50;
  const PANEL_THICK = 0.030;
  const ROW_GAP     = 0.03;
  const START_Y     = 0.10;   // first panel row starts this far above groundY

  // Panel width: full Z span between the two poles on this side, minus half a pole width each side
  const panelW = radius * 2 - pw - 0.02;

  // Face X in local coords: outer face of poles is at sign*(radius + pw/2)
  // Panel inner face touches that, so panel CENTRE is at sign*(radius + pw/2 + PANEL_THICK/2)
  const faceLocalX = sign * (radius + pw / 2 + PANEL_THICK / 2 + 0.002);

  const rows = Math.max(1, Math.floor((maxPoleH * 0.86 - START_Y) / (PANEL_H + ROW_GAP)));

  for (let row = 0; row < rows; row++) {
    if (Math.random() < 0.10) continue;   // occasional missing panel for worn look

    const localY = groundY + START_Y + row * (PANEL_H + ROW_GAP) + PANEL_H / 2;

    // Panel centre in local space: X = faceLocalX, Z = 0 (centred between the two poles)
    const lx = faceLocalX, lz = 0;
    const wx = bx + lx * cosR - lz * sinR;
    const wz = bz + lx * sinR + lz * cosR;

    // Panel box: thin on X (= PANEL_THICK), wide on Z (= panelW), PANEL_H tall
    // When rotY≠0 the rotation is baked into mesh.rotation.y
    const mesh = _box(`panel_${parts.length}`, PANEL_THICK, PANEL_H, panelW, wx, localY, wz, 'panel');
    if (rotY !== 0) mesh.rotation.y = rotY;
    parts.push({ mesh, agg: _staticAgg(mesh), isFixed: true, type: 'panel' });
    registerPanelMesh(mesh);
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
  try {
    return new BABYLON.PhysicsAggregate(
      mesh, BABYLON.PhysicsShapeType.BOX,
      { mass: 0, restitution: 0.05, friction: 0.7 }, scene,
    );
  } catch(e) { return null; }
}

// ── Hit registration ──────────────────────────────────────────────────────────
// hitMesh  — the picked mesh (must be named panel_*)
// hitPos   — BABYLON.Vector3 world position of bullet at impact
// hitDir   — BABYLON.Vector3 normalised bullet travel direction

function _handleShelterHit(hitMesh, hitPos, hitDir) {
  for (const shelter of shelters) {
    if (shelter.collapsed) continue;
    const part = shelter.parts.find(p => p.mesh === hitMesh);
    if (!part) continue;

    shelter.hitCount++;
    playBulletImpact();

    // ── Panel: fly off on first hit ───────────────────────────────────────────
    if (part.type === 'panel' && part.isFixed) {
      _launchPanel(part, hitPos, hitDir);
    }

    // ── Full collapse after hitThreshold hits ─────────────────────────────────
    if (shelter.hitCount >= shelter.hitThreshold) {
      _collapseShelter(shelter);
    }
    return true;
  }
  return false;
}

// Make a single panel fly off with physics, preserving bullet direction bias
function _launchPanel(part, hitPos, hitDir) {
  if (!part.isFixed || !part.agg) return;
  part.isFixed = false;
  unregisterPanelMesh(part.mesh);   // no longer a valid hit target once flying

  try {
    const pos = part.mesh.position.clone();

    // Swap static aggregate for dynamic
    part.agg.dispose();
    part.agg = new BABYLON.PhysicsAggregate(
      part.mesh, BABYLON.PhysicsShapeType.BOX,
      { mass: 0.6, restitution: 0.25, friction: 0.45 }, scene,
    );

    const body = part.agg.body;
    if (!body) return;

    // Impulse = bullet direction * force + upward kick + random tumble
    const fwd = hitDir ?? new BABYLON.Vector3(0, 1, 0);
    body.applyImpulse(new BABYLON.Vector3(
      fwd.x * 18 + (Math.random() - 0.5) * 8,
      12 + Math.random() * 10,
      fwd.z * 18 + (Math.random() - 0.5) * 8,
    ), pos);

    // Angular impulse — panel tumbles visually
    body.applyAngularImpulse(new BABYLON.Vector3(
      (Math.random() - 0.5) * 22,
      (Math.random() - 0.5) * 22,
      (Math.random() - 0.5) * 22,
    ));
  } catch(e) {}
}

// ── Collapse ──────────────────────────────────────────────────────────────────

function _collapseShelter(shelter) {
  if (shelter.collapsed) return;
  shelter.collapsed = true;
  playStructureCollapse();

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
          body.applyImpulse(new BABYLON.Vector3(
            (Math.random() - 0.5) * 28,
            18 + Math.random() * 22,
            (Math.random() - 0.5) * 28,
          ), pos);
        }
        part.isFixed = false;
      } catch(e) {}
    }, delay);
  }
}

// ── Explosion placeholder ─────────────────────────────────────────────────────
// Wire into grenade/explosion system. worldPos should be the explosion origin.

export function explosionKnockShelter(worldPos, radius = 9) {
  const px = +worldPos.x, pz = +worldPos.z;
  for (const shelter of shelters) {
    if (shelter.collapsed) continue;
    const dx = shelter.worldPos.x - px;
    const dz = shelter.worldPos.z - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > radius) continue;

    shelter.collapsed = true;
    playExplosion({ x: px, y: worldPos.y ?? shelter.worldPos.y, z: pz });

    const falloff = Math.max(0, 1 - dist / radius);
    for (const part of shelter.parts) {
      if (!part.agg) continue;
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
            body.applyImpulse(new BABYLON.Vector3(
              ((pos.x - px) * 0.6 + (Math.random() - 0.5) * 18) * falloff,
              45 + falloff * 55 + Math.random() * 20,
              ((pos.z - pz) * 0.6 + (Math.random() - 0.5) * 18) * falloff,
            ), pos);
          }
        } catch(e) {}
      }, Math.random() * 200);
    }
  }
}

export function destroyShelterAt(worldPos, radius = 5) {
  const px = +worldPos.x, pz = +worldPos.z;
  for (const shelter of shelters) {
    const dx = shelter.worldPos.x - px;
    const dz = shelter.worldPos.z - pz;
    if (Math.sqrt(dx * dx + dz * dz) < radius) _collapseShelter(shelter);
  }
}

export function tickShelters() {}

export function clearShelters() {
  for (const shelter of shelters) {
    for (const part of shelter.parts) {
      try { part.agg?.dispose(); }  catch(e) {}
      try { part.mesh?.dispose(); } catch(e) {}
    }
  }
  shelters               = [];
  clearPanelMeshes();
  shelterProgressionDone = false;
  _designIndex           = 0;
}