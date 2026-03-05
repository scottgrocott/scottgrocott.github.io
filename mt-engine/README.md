# Warzone Engine

A browser-based game editor and engine shell built with **BabylonJS v8**, **Rapier3D**, **YUKA 0.7**, and **ToneJS v14**. No bundler. No build step. Pure ES modules.

---

## Quick Start

Serve the project root with any static file server:

```bash
# Python
python3 -m http.server 8080

# Node (npx)
npx serve .

# Node http-server
npx http-server . -p 8080
```

Then open `http://localhost:8080` in a modern browser (Chrome/Edge recommended for best WebGL + WASM support).

---

## Controls

| Key / Input | Action |
|---|---|
| W A S D / Arrows | Move |
| Mouse | Look |
| Left Click | Shoot |
| Space | Jump |
| Shift | Sprint |
| C | Duck |
| F | Toggle freecam / editor |
| N / 0 | Spawn enemy manually |
| Escape | Release pointer lock |

**Gamepad:** Left stick = move, right stick = look, RT = shoot, RB = freecam, LB = spawn enemy.

---

## Game Modes

Select from the top-bar dropdown:

| Config | Description |
|---|---|
| **Test / Sandbox** | No enemies, all editor features, experiment freely |
| **Drone Wars** | 3 aerial drones — patrol, hunt, red box placeholders |
| **Car Wars** | 2 ground cars — patrol waypoints, chase, ram attack |
| **Forklift Wars** | 2 heavy forklifts — slow, high-impulse ram with lifting forks |
| **Metal Throne** | 2 drones + 1 car + 1 forklift simultaneously |

---

## Editor (localhost only)

Press **F** to enter freecam and open the editor panel. The editor is present on `localhost` only — it's a no-op on production deployments.

Editor sections: Scene (save/copy JSON), Terrain (heightmap upload, shader layers), Scatter (density per layer), Shelters (drop physics shelters with 3-second countdown), Enemies (live count), Player Position (copy coords), Log.

---

## File Structure

```
/
├── index.html          ← entry point
├── main.js             ← boot sequence + render loop
├── core.js             ← BabylonJS engine, scene, camera, shadows
├── config.js           ← runtime config store
├── look.js             ← euler look state, applyLookDelta
├── input.js            ← keyboard, mouse, pointer lock, callbacks
├── inputGuard.js       ← mouse suspension, blank-frame counter
├── physics.js          ← Rapier world, step, sync, NaN guard
├── player.js           ← capsule body, walk + freecam tick
├── cockpit.js          ← first-person weapon sway
├── hud.js              ← DOM HUD overlay
├── scatter.js          ← billboard vegetation + props
├── flatnav.js          ← terrain scan → waypoints
├── spawn.js            ← player drop-on-start
├── buildings.js        ← GLB buildings + static colliders
├── structures.js       ← editor-placed rigid structures
├── ladders.js          ← ladder zones + climb tick
├── explosions.js       ← particle bursts
├── audio.js            ← ToneJS synths, spatial audio, SFX
├── soundtrack.js       ← zone-based ambient crossfade
├── minimap.js          ← 220px canvas minimap
├── gamepad.js          ← gamepad polling
│
├── terrain/
│   ├── heightmap.js    ← PNG → Float32Array + Rapier heightfield
│   ├── terrainMesh.js  ← BabylonJS ground mesh
│   ├── terrainMaterial.js ← elevation-band material
│   └── terrainBounds.js   ← bounding box helper
│
├── enemies/
│   ├── enemyBase.js    ← shared factory, YUKA manager, kill/respawn
│   ├── drones.js       ← aerial, rising→patrol→hunting states
│   ├── cars.js         ← ground, patrol→chase→ram
│   └── forklifts.js    ← ground, heavier, fork-lift animation
│
├── weapons/
│   ├── weaponBase.js
│   └── basicGun.js     ← hitscan bullets, Rapier sphere pool
│
├── shelters/
│   ├── shelters.js     ← physics shelter builder, progression
│   ├── shelterEditor.js ← nudge/select parts
│   └── utils.js        ← position snapshot
│
├── editor/
│   ├── editor.js       ← master editor panel
│   ├── terrainEditor.js
│   ├── scatterEditor.js
│   └── structureEditor.js
│
└── assets/
    └── configs/
        ├── test.json
        ├── drone_wars.json
        ├── car_wars.json
        ├── forklift_wars.json
        └── metal_throne.json
```

---

## Key Architecture Notes

- **NaN kills Rapier permanently.** Every `setTranslation` call is preceded by an explicit NaN guard via `safeVec3()` in `physics.js`.
- **BabylonJS Vector3 cannot be spread.** `x/y/z` are prototype getters — always extract: `const x = +v.x, y = +v.y, z = +v.z`.
- **`inputState` and `keys` are the same object.** `Object.defineProperties` bridges both naming conventions on a single backing object.
- **Shoot works in freecam.** `setFreeCamActive(bool)` tells input.js to allow shots when pointer lock is released.
- **Config teardown order:** dispose meshes → remove Rapier bodies → clear module arrays → re-init.
- **Audio guard:** every ToneJS call is wrapped in `if (!window.Tone || Tone.context.state !== 'running') return`.
