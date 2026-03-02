// ============================================================
//  ladders.js — Climbable ladder geometry + player interaction
// ============================================================

import { scene }           from './core.js';
import { LADDERS, LADDER_TEX } from './config.js';
import { physCache }       from './physics.js';
import { player }          from './player.js';
import { keys }            from './input.js';

const ladderInstances = [];

export function initLadders() {
  const tex = new BABYLON.Texture(LADDER_TEX, scene);
  const mat = new BABYLON.StandardMaterial('ladderMat', scene);
  mat.diffuseTexture  = tex;
  mat.backFaceCulling = false;

  for (const def of LADDERS) {
    const [lx, ly, lz] = def.position;
    const mesh = BABYLON.MeshBuilder.CreateBox('lad', {
      width:  def.width,
      height: def.height,
      depth:  0.05,
    }, scene);
    mesh.material = mat;
    mesh.position.set(lx, ly + def.height / 2, lz);

    ladderInstances.push({
      position:   new BABYLON.Vector3(lx, ly, lz),
      height:     def.height,
      width:      def.width,
      climbSpeed: def.climbSpeed,
    });
  }
}

export function tickLadders() {
  if (!player.rigidBody) return;

  const pv = physCache.playerPos;
  player.onLadder = false;

  for (const l of ladderInstances) {
    const inX = Math.abs(pv.x - l.position.x) < (l.width / 2 + 0.5);
    const inY = Math.abs(pv.y - (l.position.y + l.height / 2)) < (l.height / 2 + 0.5);
    const inZ = Math.abs(pv.z - l.position.z) < 1.0;

    if (inX && inY && inZ) {
      player.onLadder = true;
      const goUp   = keys.w || keys.space;
      const goDown = keys.s;
      if (goUp || goDown) {
        const dir = goUp ? 1 : -1;
        const vel = physCache.playerVel;
        player.rigidBody.setLinvel(
          { x: vel.x * 0.5, y: dir * l.climbSpeed, z: vel.z * 0.5 },
          true,
        );
      }
    }
  }
}
