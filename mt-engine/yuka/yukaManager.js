// yuka/yukaManager.js — YUKA EntityManager singleton
// Owns the EntityManager and Time, drives the update loop.
// Called from main.js via tickYUKA() (re-exported through enemyBase.js).

let _entityManager = null;
let _time          = null;

export function initYUKA() {
  if (!window.YUKA) {
    console.warn('[yukaManager] YUKA global not found — skipping init');
    return;
  }
  _entityManager = new YUKA.EntityManager();
  _time          = new YUKA.Time();
  console.log('[yukaManager] EntityManager ready');
}

export function getYukaManager() {
  return _entityManager;
}

// Step the YUKA simulation — call every frame from main loop
export function tickYUKA() {
  if (!_entityManager || !_time) return;
  const dt = _time.update().getDelta();
  _entityManager.update(dt);
}

// Assign a path (array of {x,y,z}) to a YUKA vehicle
export function assignPath(vehicle, waypoints) {
  if (!vehicle || !waypoints || waypoints.length === 0) return;
  if (!window.YUKA) return;

  const path = new YUKA.Path();
  path.loop = true;
  for (const wp of waypoints) {
    path.add(new YUKA.Vector3(+wp.x, +wp.y, +wp.z));
  }

  const followPath  = new YUKA.FollowPathBehavior(path, 2);
  const onPath      = new YUKA.OnPathBehavior(path);
  onPath.radius     = 1.5;

  vehicle.steering.clear();
  vehicle.steering.add(onPath);
  vehicle.steering.add(followPath);
}

export function resetYUKA() {
  if (_entityManager) {
    // Remove all entities
    const entities = [..._entityManager.entities];
    for (const e of entities) {
      try { _entityManager.remove(e); } catch(_) {}
    }
  }
  _entityManager = null;
  _time          = null;
}