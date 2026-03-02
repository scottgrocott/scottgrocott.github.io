// ============================================================
//  hud.js — Thin wrappers around HUD DOM elements
// ============================================================

const el = id => document.getElementById(id);

export const hud = {
  setDrones(count)   { el('hud-drones').textContent   = `DRONES: ${count}`; },
  setGrounded(state) { el('hud-grounded').textContent = `GROUNDED: ${state}`; },
  setPos(x, y, z)    { el('hud-pos').textContent      = `POS: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`; },
  setDuck(state)     { el('hud-duck').textContent     = `DUCK: ${state}`; },
  setAmmo(n)         { el('hud-ammo').textContent     = `SHOTS FIRED: ${n}`; },
  hideLoading()      { el('loading').classList.add('hidden'); },
};
