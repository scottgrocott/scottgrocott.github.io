// ============================================================
//  shelters.js — Procedural physics-enabled shelter builder
//
//  Parts carry full metadata so designs can be serialized
//  position-independent and re-spawned anywhere.
//
//  part = {
//    mesh, body, collider,
//    type,     'pole' | 'pallet' | 'board' | 'panel'
//    dims,     { w,h,d } or { r,h } for cylinders
//    relPos,   { x,y,z } offset from shelter origin
//    relRot,   { x,y,z,w } quaternion
//    isFixed,  bool
//  }
// ============================================================

import { scene }                      from './core.js';
import { physicsWorld, physicsReady } from './physics.js';

export const shelters = [];
const EXPLOSION_RADIUS = 12;

const COL = {
  pole:'#4a3728', pallet:'#8b6914', board:'#c4a265',
  panel:'#7a8a7a', panelE:'#556655',
};

let _mats = null;
function _getMats() {
  if (_mats) return _mats;
  const m = (name, hex, em) => {
    const mat = new BABYLON.PBRMaterial(name, scene);
    mat.albedoColor   = BABYLON.Color3.FromHexString(hex);
    mat.emissiveColor = em ? BABYLON.Color3.FromHexString(em).scale(0.18) : BABYLON.Color3.Black();
    mat.metallic = 0.15; mat.roughness = 0.85;
    return mat;
  };
  _mats = {
    pole:   m('sm_pole',   COL.pole),
    pallet: m('sm_pallet', COL.pallet),
    board:  m('sm_board',  COL.board),
    panel:  m('sm_panel',  COL.panel, COL.panelE),
  };
  return _mats;
}

// ============================================================
//  buildPart — low-level factory used by all creation paths
// ============================================================
export function buildPart(def, worldPos, worldRot, origin) {
  const R    = window.RAPIER;
  const mats = _getMats();
  const quat = worldRot || { x:0, y:0, z:0, w:1 };

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

  mesh.material           = mats[def.type] || mats.board;
  mesh.position.set(worldPos.x, worldPos.y, worldPos.z);
  mesh.rotationQuaternion = new BABYLON.Quaternion(quat.x, quat.y, quat.z, quat.w);

  const bodyDesc = def.isFixed
    ? R.RigidBodyDesc.fixed().setTranslation(worldPos.x, worldPos.y, worldPos.z)
    : R.RigidBodyDesc.dynamic().setTranslation(worldPos.x, worldPos.y, worldPos.z);
  bodyDesc.setRotation(quat);

  const colliderDesc = def.type === 'pole'
    ? R.ColliderDesc.cylinder(def.dims.h/2, def.dims.r).setMass(def.isFixed ? 0 : (def.mass||5))
    : R.ColliderDesc.cuboid(def.dims.w/2, def.dims.h/2, def.dims.d/2)
        .setMass(def.mass||5).setFriction(def.friction||0.7).setRestitution(def.restitution||0.1);

  const body     = physicsWorld.createRigidBody(bodyDesc);
  const collider = physicsWorld.createCollider(colliderDesc, body);

  const relPos = origin
    ? { x: worldPos.x - origin.x, y: worldPos.y - origin.y, z: worldPos.z - origin.z }
    : { x:0, y:0, z:0 };

  return {
    mesh, body, collider,
    type: def.type, dims: { ...def.dims },
    relPos, relRot: { ...quat },
    isFixed: !!def.isFixed,
    mass: def.mass||5, friction: def.friction||0.7, restitution: def.restitution||0.1,
  };
}

// ============================================================
//  Default layout
// ============================================================
function _defaultParts(cx, cy, cz) {
  const W=4.0, D=3.0, H=2.8, PR=0.08, PT=0.04, BT=0.09, PH=0.14;
  return [
    { type:'pole',   dims:{r:PR,h:H},            isFixed:true,  mass:0,  pos:[cx-W/2,cy+H/2,cz-D/2] },
    { type:'pole',   dims:{r:PR,h:H},            isFixed:true,  mass:0,  pos:[cx+W/2,cy+H/2,cz-D/2] },
    { type:'pole',   dims:{r:PR,h:H},            isFixed:true,  mass:0,  pos:[cx-W/2,cy+H/2,cz+D/2] },
    { type:'pole',   dims:{r:PR,h:H},            isFixed:true,  mass:0,  pos:[cx+W/2,cy+H/2,cz+D/2] },
    { type:'pallet', dims:{w:W-0.1,h:PH,d:0.8}, mass:18, friction:0.9,  pos:[cx,cy+PH/2,     cz+D/2-0.4] },
    { type:'pallet', dims:{w:W-0.1,h:PH,d:0.8}, mass:18, friction:0.9,  pos:[cx,cy+PH+PH/2,  cz+D/2-0.4] },
    { type:'board',  dims:{w:BT,h:BT,d:D},       mass:6,  friction:0.8,  pos:[cx-W/2+0.1,cy+H-BT/2,cz] },
    { type:'board',  dims:{w:BT,h:BT,d:D},       mass:6,  friction:0.8,  pos:[cx+W/2-0.1,cy+H-BT/2,cz] },
    { type:'board',  dims:{w:W,h:BT,d:BT},       mass:6,  friction:0.8,  pos:[cx,cy+H,cz] },
    { type:'panel',  dims:{w:W,h:PT,d:D},         mass:10, friction:0.6,  pos:[cx,cy+H+PT/2,cz] },
    { type:'panel',  dims:{w:W,h:H,d:PT},         mass:8,  friction:0.6,  pos:[cx,cy+H/2,cz+D/2+PT/2] },
    { type:'panel',  dims:{w:PT,h:H,d:D},         mass:8,  friction:0.6,  pos:[cx-(W/2+PT/2),cy+H/2,cz] },
    { type:'panel',  dims:{w:PT,h:H,d:D},         mass:8,  friction:0.6,  pos:[cx+(W/2+PT/2),cy+H/2,cz] },
  ];
}

// ============================================================
//  createShelter
// ============================================================
export function createShelter(position, designDefs) {
  if (!physicsReady) { console.warn('[shelters] Physics not ready'); return null; }
  const cx=position.x, cy=position.y, cz=position.z;
  const origin = { x:cx, y:cy, z:cz };
  const defs   = designDefs || _defaultParts(cx, cy, cz);
  const parts  = [];

  for (const def of defs) {
    const wp = def.pos
      ? { x:def.pos[0], y:def.pos[1], z:def.pos[2] }
      : { x:cx+(def.relPos?.x||0), y:cy+(def.relPos?.y||0), z:cz+(def.relPos?.z||0) };
    const wr = def.rot || { x:0, y:0, z:0, w:1 };
    parts.push(buildPart(def, wp, wr, origin));
  }

  const shelter = { id:shelters.length, origin:{ ...origin }, parts, dead:false, label:'' };
  shelters.push(shelter);
  console.info(`[shelters] Built shelter #${shelter.id} — ${parts.length} parts`);
  return shelter;
}

// ============================================================
//  moveShelter — translate all parts as a unit
// ============================================================
export function moveShelter(shelter, newOrigin) {
  if (!shelter || shelter.dead) return;
  const dx = newOrigin.x - shelter.origin.x;
  const dy = (newOrigin.y !== undefined) ? newOrigin.y - shelter.origin.y : 0;
  const dz = newOrigin.z - shelter.origin.z;

  for (const part of shelter.parts) {
    const t  = part.body.translation();
    const nx = t.x+dx, ny = t.y+dy, nz = t.z+dz;
    part.body.setTranslation({ x:nx, y:ny, z:nz }, true);
    part.mesh.position.set(nx, ny, nz);
    part.relPos.x += dx; part.relPos.y += dy; part.relPos.z += dz;
  }
  shelter.origin.x += dx; shelter.origin.y += dy; shelter.origin.z += dz;
}

// ============================================================
//  addPartToShelter — add a new part to an existing shelter
// ============================================================
export function addPartToShelter(shelter, typeName, worldPos, dims, options) {
  if (!physicsReady || shelter.dead) return null;
  const TYPE_DEFAULTS = {
    pole:   { dims:{ r:0.08, h:2.8 }, isFixed:true,  mass:0,  friction:0.8 },
    pallet: { dims:{ w:1.0, h:0.14, d:0.8 },          mass:18, friction:0.9 },
    board:  { dims:{ w:0.09, h:0.09, d:3.0 },         mass:6,  friction:0.8 },
    panel:  { dims:{ w:4.0, h:0.04, d:3.0 },          mass:10, friction:0.6 },
  };
  const defaults = TYPE_DEFAULTS[typeName] || TYPE_DEFAULTS.board;
  const def = {
    type:        typeName,
    dims:        dims          || defaults.dims,
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
//  serializeDesign — position-independent export
// ============================================================
export function serializeDesign(shelter, name) {
  return {
    name:  name || shelter.label || ('design_' + shelter.id),
    parts: shelter.parts.map(p => ({
      type: p.type, dims: { ...p.dims },
      relPos: { ...p.relPos }, relRot: { ...p.relRot },
      isFixed: p.isFixed, mass: p.mass,
      friction: p.friction, restitution: p.restitution,
    })),
  };
}

// ============================================================
//  spawnFromDesign — instantiate a saved design at a position
// ============================================================
export function spawnFromDesign(design, origin) {
  const defs = design.parts.map(p => ({
    ...p,
    pos: [origin.x+p.relPos.x, origin.y+p.relPos.y, origin.z+p.relPos.z],
    rot: p.relRot,
  }));
  return createShelter(origin, defs);
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
//  destroyShelterAt
// ============================================================
export function destroyShelterAt(explosionPos) {
  for (const shelter of shelters) {
    if (shelter.dead) continue;
    const dx = shelter.origin.x - explosionPos.x;
    const dz = shelter.origin.z - explosionPos.z;
    if (Math.sqrt(dx*dx+dz*dz) < EXPLOSION_RADIUS) _destroyShelter(shelter);
  }
}

function _destroyShelter(shelter) {
  shelter.dead = true;
  for (const part of shelter.parts) {
    try {
      if (!part.isFixed)
        part.body.applyImpulse({
          x:(Math.random()-0.5)*120, y:Math.random()*80+20, z:(Math.random()-0.5)*120
        }, true);
    } catch (_) {}
  }
  setTimeout(() => {
    for (const part of shelter.parts) {
      try { part.mesh?.dispose(); } catch (_) {}
      try { physicsWorld.removeCollider(part.collider, true); } catch (_) {}
      try { physicsWorld.removeRigidBody(part.body); } catch (_) {}
    }
    const idx = shelters.indexOf(shelter);
    if (idx >= 0) shelters.splice(idx, 1);
    console.info('[shelters] Shelter #' + shelter.id + ' destroyed');
  }, 3500);
}