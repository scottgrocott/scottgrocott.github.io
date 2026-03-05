// ============================================================
//  shelters.js — Physics shelter builder + progression system
//
//  New in this version:
//  - All parts are dynamic rigid bodies (no isFixed poles)
//  - Foundation poles have top-cap + mid-collar for cross-beam support
//  - Each pole is independent physics body (falls separately on explosion)
//  - Shelter library ordered by part count (complexity progression)
//  - Shelter progression: last shelter destroyed → no more auto-spawn
//  - spawnNextShelter() / shelterProgressionDone flag
//  - ToneJS placeholder sounds for toppling
//  - One ladder spawned per shelter (configurable Y offset)
// ============================================================

import { scene }                           from './core.js';
import { physicsWorld, physicsReady }      from './physics.js';

export const shelters     = [];
export let   shelterProgressionDone = false;
const EXPLOSION_RADIUS    = 12;
const TOPPLE_SOUND_CHANCE = 0.4;   // probability a falling part plays a sound

// ============================================================
//  Materials (shared, lazy-init)
// ============================================================

const COL = {
  pole:   '#3a2a1e',
  cap:    '#2e2016',   // slightly darker for caps/collars
  pallet: '#8b6914',
  board:  '#c4a265',
  panel:  '#7a8a7a',
  ladder: '#5a4a3a',
};

let _mats = null;
function _getMats() {
  if (_mats) return _mats;
  const m = (name, hex, emHex) => {
    const mat        = new BABYLON.PBRMaterial(name, scene);
    mat.albedoColor  = BABYLON.Color3.FromHexString(hex);
    mat.emissiveColor = emHex
      ? BABYLON.Color3.FromHexString(emHex).scale(0.12)
      : BABYLON.Color3.Black();
    mat.metallic = 0.1; mat.roughness = 0.88;
    return mat;
  };
  _mats = {
    pole:   m('sm_pole',   COL.pole),
    cap:    m('sm_cap',    COL.cap),
    pallet: m('sm_pallet', COL.pallet),
    board:  m('sm_board',  COL.board),
    panel:  m('sm_panel',  COL.panel, '#8aaa8a'),
    ladder: m('sm_ladder', COL.ladder),
  };
  return _mats;
}

// ============================================================
//  ToneJS topple sound (placeholder)
// ============================================================

function _playTopple() {
  try {
    if (!window.Tone || Tone.context.state !== 'running') return;
    const synth = new Tone.MembraneSynth({
      pitchDecay: 0.08, octaves: 4,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    }).toDestination();
    synth.volume.value = -18;
    synth.triggerAttackRelease(
      30 + Math.random() * 40, '8n',
      Tone.now(),
    );
    setTimeout(() => synth.dispose(), 600);
  } catch (_) {}
}

// ============================================================
//  buildPart — low-level factory
// ============================================================

export function buildPart(def, worldPos, worldRot, origin) {
  const R    = window.RAPIER;
  const mats = _getMats();
  const quat = worldRot || { x:0, y:0, z:0, w:1 };
  const mat  = mats[def.matKey || def.type] || mats.board;

  // Coerce and validate — Rapier crashes hard on NaN
  const px = +worldPos.x, py = +worldPos.y, pz = +worldPos.z;
  if (isNaN(px) || isNaN(py) || isNaN(pz)) {
    console.error('[shelters] buildPart: NaN position', def.type, worldPos);
    return null;
  }

  let mesh;
  if (def.type === 'pole') {
    mesh = BABYLON.MeshBuilder.CreateCylinder('pole', {
      diameter: def.dims.r * 2, height: def.dims.h, tessellation: 8,
    }, scene);
  } else {
    mesh = BABYLON.MeshBuilder.CreateBox(def.type, {
      width: def.dims.w, height: def.dims.h, depth: def.dims.d,
    }, scene);
  }

  mesh.material           = mat;
  mesh.position.set(px, py, pz);
  mesh.rotationQuaternion = new BABYLON.Quaternion(quat.x, quat.y, quat.z, quat.w);
  mesh.receiveShadows     = true;

  const bodyDesc = def.isFixed
    ? R.RigidBodyDesc.fixed().setTranslation(px, py, pz)
    : R.RigidBodyDesc.dynamic()
        .setTranslation(px, py, pz)
        .setLinearDamping(0.4)
        .setAngularDamping(0.6);
  bodyDesc.setRotation(quat);

  let colliderDesc;
  if (def.type === 'pole') {
    colliderDesc = R.ColliderDesc
      .cylinder(def.dims.h / 2, def.dims.r)
      .setMass(def.isFixed ? 0 : (def.mass || 8))
      .setFriction(def.friction ?? 0.7)
      .setRestitution(def.restitution ?? 0.1);
  } else {
    colliderDesc = R.ColliderDesc
      .cuboid(def.dims.w / 2, def.dims.h / 2, def.dims.d / 2)
      .setMass(def.isFixed ? 0 : (def.mass || 5))
      .setFriction(def.friction ?? 0.7)
      .setRestitution(def.restitution ?? 0.1);
  }

  const body     = physicsWorld.createRigidBody(bodyDesc);
  const collider = physicsWorld.createCollider(colliderDesc, body);

  const relPos = origin
    ? { x: px - origin.x, y: py - origin.y, z: pz - origin.z }
    : { x: 0, y: 0, z: 0 };

  return {
    mesh, body, collider,
    type: def.type, matKey: def.matKey || def.type, dims: { ...def.dims },
    relPos, relRot: { ...quat },
    isFixed: !!def.isFixed,
    mass: def.isFixed ? 0 : (def.mass || 5),
    friction: def.friction ?? 0.7,
    restitution: def.restitution ?? 0.1,
  };
}

// ============================================================
//  Foundation pole factory
//  Returns an array of parts: shaft + top-cap + mid-collar
//  Each is a separate rigid body so they fall independently.
// ============================================================

function _buildFoundationPole(cx, cy, cz, pH, pR, origin) {
  const capW  = pR * 2 + 0.12;   // wide enough for a 4x4 beam on all 4 sides
  const capH  = 0.04;
  const capD  = capW;

  const parts = [];

  // Shaft
  parts.push(buildPart(
    { type: 'pole', dims: { r: pR, h: pH }, isFixed: true, mass: 0, friction: 0.8 },
    { x: cx, y: cy + pH / 2, z: cz }, null, origin,
  ));

  // Top cap
  parts.push(buildPart(
    { type: 'panel', matKey: 'cap', dims: { w: capW, h: capH, d: capD }, isFixed: true, mass: 0 },
    { x: cx, y: cy + pH, z: cz }, null, origin,
  ));

  // Mid collar (halfway up pole — supports cross-bars during stacking)
  parts.push(buildPart(
    { type: 'panel', matKey: 'cap', dims: { w: capW * 0.9, h: capH, d: capD * 0.9 }, isFixed: true, mass: 0 },
    { x: cx, y: cy + pH / 2, z: cz }, null, origin,
  ));

  return parts;
}

// ============================================================
//  Ladder factory — one per shelter
// ============================================================

function _buildLadder(cx, cy, cz, height, origin) {
  const mats  = _getMats();
  const rungW = 0.5, rungH = 0.04, rungD = 0.06;
  const railR = 0.03;
  const rungs = Math.floor(height / 0.4);
  const parts = [];

  // Left rail
  parts.push(buildPart(
    { type: 'pole', matKey: 'ladder', dims: { r: railR, h: height }, isFixed: true, mass: 0 },
    { x: cx - rungW / 2, y: cy + height / 2, z: cz }, null, origin,
  ));
  // Right rail
  parts.push(buildPart(
    { type: 'pole', matKey: 'ladder', dims: { r: railR, h: height }, isFixed: true, mass: 0 },
    { x: cx + rungW / 2, y: cy + height / 2, z: cz }, null, origin,
  ));
  // Rungs
  for (let i = 0; i <= rungs; i++) {
    const ry = cy + i * (height / rungs);
    parts.push(buildPart(
      { type: 'board', matKey: 'ladder', dims: { w: rungW, h: rungH, d: rungD }, isFixed: true, mass: 0 },
      { x: cx, y: ry, z: cz }, null, origin,
    ));
  }
  return parts;
}

// ============================================================
//  Shelter designs — ordered by complexity (part count)
// ============================================================

function _designBasic(cx, cy, cz) {
  const W=4.0, D=3.0, H=2.8, pR=0.08, pH=H, BT=0.09, PT=0.04, PH=0.14;
  const parts = [];

  // 4 foundation poles (each = shaft + top-cap + mid-collar = 3 parts)
  for (const [px, pz] of [[-W/2,-D/2],[W/2,-D/2],[-W/2,D/2],[W/2,D/2]]) {
    parts.push(..._buildFoundationPole(cx+px, cy, cz+pz, pH, pR, {x:cx,y:cy,z:cz}));
  }

  // Floor pallets
  parts.push({ type:'pallet', dims:{w:W-0.1,h:PH,d:0.8}, mass:18, friction:0.9, pos:[cx,cy+PH/2,    cz+D/2-0.4] });
  parts.push({ type:'pallet', dims:{w:W-0.1,h:PH,d:0.8}, mass:18, friction:0.9, pos:[cx,cy+PH+PH/2, cz+D/2-0.4] });

  // Ridge beams
  parts.push({ type:'board', dims:{w:BT,h:BT,d:D}, mass:6, friction:0.8, pos:[cx-W/2+0.1,cy+H-BT/2,cz] });
  parts.push({ type:'board', dims:{w:BT,h:BT,d:D}, mass:6, friction:0.8, pos:[cx+W/2-0.1,cy+H-BT/2,cz] });
  parts.push({ type:'board', dims:{w:W,h:BT,d:BT}, mass:6, friction:0.8, pos:[cx,cy+H,cz] });

  // Roof + walls
  parts.push({ type:'panel', dims:{w:W,h:PT,d:D},  mass:10, friction:0.6, pos:[cx,cy+H+PT/2,cz] });
  parts.push({ type:'panel', dims:{w:W,h:H,d:PT},  mass:8,  friction:0.6, pos:[cx,cy+H/2,cz+D/2+PT/2] });
  parts.push({ type:'panel', dims:{w:PT,h:H,d:D},  mass:8,  friction:0.6, pos:[cx-(W/2+PT/2),cy+H/2,cz] });
  parts.push({ type:'panel', dims:{w:PT,h:H,d:D},  mass:8,  friction:0.6, pos:[cx+(W/2+PT/2),cy+H/2,cz] });

  return parts;
}

function _designFortified(cx, cy, cz) {
  // Larger, double-walled with internal shelf
  const W=6.0, D=4.0, H=3.2, pR=0.1, pH=H, BT=0.1, PT=0.05;
  const parts = _designBasic(cx, cy, cz);   // base + extra

  // Extra corner poles
  for (const [px, pz] of [[-W/2,-D/2],[W/2,-D/2],[-W/2,D/2],[W/2,D/2]]) {
    parts.push(..._buildFoundationPole(cx+px, cy, cz+pz, pH, pR, {x:cx,y:cy,z:cz}));
  }

  // Internal shelf
  parts.push({ type:'board', dims:{w:W-0.3,h:BT,d:D-0.3}, mass:8, friction:0.8, pos:[cx,cy+H*0.5,cz] });

  // Second roof layer
  parts.push({ type:'panel', dims:{w:W+0.2,h:PT,d:D+0.2}, mass:12, friction:0.6, pos:[cx,cy+H+PT,cz] });

  return parts;
}

// Shelter library — will be sorted by complexity at runtime
const SHELTER_DESIGNS = [
  { id: 'basic',     label: 'Basic Lean-To',     build: _designBasic },
  { id: 'fortified', label: 'Fortified Outpost',  build: _designFortified },
];

// Sort ascending by part count (complexity)
function _getSortedDesigns(cx, cy, cz) {
  return SHELTER_DESIGNS
    .map(d => ({ ...d, parts: d.build(cx, cy, cz) }))
    .sort((a, b) => a.parts.length - b.parts.length);
}

export function getShelterDesignIds() {
  return SHELTER_DESIGNS.map(d => ({ id: d.id, label: d.label }));
}

// ============================================================
//  createShelter
// ============================================================

export function createShelter(position, designId, customDefs) {
  if (!physicsReady) { console.warn('[shelters] Physics not ready'); return null; }
  const cx = +position.x, cy = +position.y, cz = +position.z;
  if (isNaN(cx) || isNaN(cy) || isNaN(cz)) {
    console.error('[shelters] createShelter: invalid position', position);
    return null;
  }
  const origin = { x: cx, y: cy, z: cz };

  let rawDefs;
  if (customDefs) {
    rawDefs = customDefs;
  } else {
    const design = SHELTER_DESIGNS.find(d => d.id === designId) || SHELTER_DESIGNS[0];
    rawDefs = design.build(cx, cy, cz);
  }

  const parts = [];
  for (const def of rawDefs) {
    if (def.mesh) {
      // Already a built part (from _buildFoundationPole / _buildLadder)
      parts.push(def);
      continue;
    }
    const wp = def.pos
      ? { x: def.pos[0], y: def.pos[1], z: def.pos[2] }
      : { x: cx + (def.relPos?.x || 0), y: cy + (def.relPos?.y || 0), z: cz + (def.relPos?.z || 0) };
    const wr = def.rot || { x:0, y:0, z:0, w:1 };
    const part = buildPart(def, wp, wr, origin);
    if (part) parts.push(part);
  }

  // Auto-spawn ladder on the front face, offset 0.6m forward
  const ladderH   = 2.8;
  const ladderYOff = 0;   // configurable: height offset from shelter base
  const ladderParts = _buildLadder(cx, cy + ladderYOff, cz + 2.5, ladderH, origin);
  parts.push(...ladderParts);

  const shelter = {
    id:       shelters.length,
    origin:   { ...origin },
    parts,
    dead:     false,
    label:    '',
    designId: designId || 'basic',
    ladderYOffset: ladderYOff,
  };
  shelters.push(shelter);
  console.info(`[shelters] Built shelter #${shelter.id} (${shelter.designId}) — ${parts.length} parts`);
  return shelter;
}

// ============================================================
//  Shelter progression
// ============================================================

let _progressionIndex = 0;   // which design in sorted order we're on

export function spawnNextShelter(position) {
  if (shelterProgressionDone) {
    console.info('[shelters] All shelter designs exhausted — progression done');
    return null;
  }
  const sorted = getShelterDesignIds();
  if (_progressionIndex >= sorted.length) {
    shelterProgressionDone = true;
    return null;
  }
  const designId = sorted[_progressionIndex].id;
  _progressionIndex++;
  return createShelter(position, designId);
}

export function resetProgression() {
  _progressionIndex       = 0;
  shelterProgressionDone  = false;
}

// ============================================================
//  moveShelter
// ============================================================

export function moveShelter(shelter, newOrigin) {
  if (!shelter || shelter.dead) return;
  const dx = newOrigin.x - shelter.origin.x;
  const dy = (newOrigin.y !== undefined) ? newOrigin.y - shelter.origin.y : 0;
  const dz = newOrigin.z - shelter.origin.z;

  for (const part of shelter.parts) {
    const t  = part.body.translation();
    const nx = t.x + dx, ny = t.y + dy, nz = t.z + dz;
    part.body.setTranslation({ x: nx, y: ny, z: nz }, true);
    part.mesh.position.set(nx, ny, nz);
    part.relPos.x += dx; part.relPos.y += dy; part.relPos.z += dz;
  }
  shelter.origin.x += dx; shelter.origin.y += dy; shelter.origin.z += dz;
}

// ============================================================
//  addPartToShelter
// ============================================================

export function addPartToShelter(shelter, typeName, worldPos, dims, options) {
  if (!physicsReady || shelter.dead) return null;
  const TYPE_DEFAULTS = {
    pole:   { dims: { r: 0.08, h: 2.8 }, isFixed: true, mass: 0, friction: 0.8 },
    pallet: { dims: { w: 1.0, h: 0.14, d: 0.8 },        mass: 18, friction: 0.9 },
    board:  { dims: { w: 0.09, h: 0.09, d: 3.0 },       mass: 6,  friction: 0.8 },
    panel:  { dims: { w: 4.0, h: 0.04, d: 3.0 },        mass: 10, friction: 0.6 },
    ladder: { dims: { r: 0.03, h: 2.8 }, isFixed: true, mass: 0, friction: 0.8 },
  };
  const defaults = TYPE_DEFAULTS[typeName] || TYPE_DEFAULTS.board;
  const def = {
    type:        typeName,
    dims:        dims || defaults.dims,
    isFixed:     options?.isFixed ?? defaults.isFixed ?? false,
    mass:        options?.mass        || defaults.mass,
    friction:    options?.friction    || defaults.friction,
    restitution: options?.restitution || 0.1,
  };
  const part = buildPart(def, worldPos, options?.rot || { x:0,y:0,z:0,w:1 }, shelter.origin);
  shelter.parts.push(part);
  return part;
}

// ============================================================
//  serializeDesign / spawnFromDesign
// ============================================================

export function serializeDesign(shelter, name) {
  return {
    name:  name || shelter.label || ('design_' + shelter.id),
    designId: shelter.designId,
    parts: shelter.parts.map(p => ({
      type: p.type, matKey: p.matKey, dims: { ...p.dims },
      relPos: { ...p.relPos }, relRot: { ...p.relRot },
      isFixed: p.isFixed, mass: p.mass,
      friction: p.friction, restitution: p.restitution,
    })),
  };
}

export function spawnFromDesign(design, origin) {
  const defs = design.parts.map(p => ({
    ...p,
    pos: [origin.x + p.relPos.x, origin.y + p.relPos.y, origin.z + p.relPos.z],
    rot: p.relRot,
  }));
  return createShelter(origin, design.designId, defs);
}

// ============================================================
//  tickShelters
// ============================================================

export function tickShelters() {
  for (const shelter of shelters) {
    if (shelter.dead) continue;
    for (const part of shelter.parts) {
      if (!part.body || !part.mesh) continue;
      try {
        const t = part.body.translation();
        const r = part.body.rotation();
        part.mesh.position.set(t.x, t.y, t.z);
        if (!part.mesh.rotationQuaternion)
          part.mesh.rotationQuaternion = new BABYLON.Quaternion();
        part.mesh.rotationQuaternion.set(r.x, r.y, r.z, r.w);
      } catch (_) {}
    }
  }
}

// ============================================================
//  destroyShelterAt — each part falls independently
// ============================================================

export function destroyShelterAt(explosionPos, onAllDestroyed) {
  let destroyed = false;
  for (const shelter of shelters) {
    if (shelter.dead) continue;
    const dx = shelter.origin.x - explosionPos.x;
    const dz = shelter.origin.z - explosionPos.z;
    if (Math.sqrt(dx * dx + dz * dz) < EXPLOSION_RADIUS) {
      _destroyShelter(shelter, onAllDestroyed);
      destroyed = true;
    }
  }
  return destroyed;
}

function _destroyShelter(shelter, onAllDestroyed) {
  shelter.dead = true;

  for (const part of shelter.parts) {
    try {
      // Unfix all parts so they fall individually
      if (part.isFixed) {
        part.body.setBodyType(window.RAPIER.RigidBodyType.Dynamic);
      }
      const mass = part.mass || 5;
      part.body.applyImpulse({
        x: (Math.random() - 0.5) * 80 * (1 / mass),
        y: Math.random() * 50 + 10,
        z: (Math.random() - 0.5) * 80 * (1 / mass),
      }, true);
      part.body.applyTorqueImpulse({
        x: (Math.random() - 0.5) * 20,
        y: (Math.random() - 0.5) * 20,
        z: (Math.random() - 0.5) * 20,
      }, true);

      // Topple sound on some pieces
      if (Math.random() < TOPPLE_SOUND_CHANCE) {
        setTimeout(_playTopple, Math.random() * 600);
      }
    } catch (_) {}
  }

  // Clean up after settling
  setTimeout(() => {
    for (const part of shelter.parts) {
      try { part.mesh?.dispose(); } catch (_) {}
      try { physicsWorld.removeCollider(part.collider, true); } catch (_) {}
      try { physicsWorld.removeRigidBody(part.body); } catch (_) {}
    }
    const idx = shelters.indexOf(shelter);
    if (idx >= 0) shelters.splice(idx, 1);
    console.info('[shelters] Shelter #' + shelter.id + ' destroyed');

    // Check if all shelters are gone
    const alive = shelters.filter(s => !s.dead);
    if (alive.length === 0) {
      shelterProgressionDone = true;
      onAllDestroyed?.();
      console.info('[shelters] All shelters destroyed — progression complete');
    }
  }, 4000);
}