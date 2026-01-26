const yukaEntityManager = new YUKA.EntityManager();
let physicsWorld;
let physicsInitialized = false;

async function initPhysics() {
  try {
    if (typeof window.RAPIER === 'undefined') {
      console.log('Waiting for RAPIER module to load...');
      setTimeout(initPhysics, 100);
      return;
    }
    
    console.log('Initializing RAPIER physics...');
    await window.RAPIER.init();
    
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    physicsWorld = new window.RAPIER.World(gravity);
    
    physicsInitialized = true;
    console.log('Rapier physics initialized successfully!');
    window.RAPIER_READY = window.RAPIER;
    
    setInterval(() => {
      if (physicsWorld) physicsWorld.step();
    }, 16);
  } catch (error) {
    console.error('Failed to initialize Rapier:', error);
  }
}

window.addEventListener('load', initPhysics);

async function loadScene() {
  try {
    const response = await fetch(JSON_URL);
    const data = await response.json();
    
    const assetContainer = document.querySelector('#asset-container');
    const sceneContainer = document.querySelector('#scene-container');
    const navmeshContainer = document.querySelector('#navmesh-container');
    
    data.assets.forEach(asset => {
      const assetItem = document.createElement('a-asset-item');
      assetItem.setAttribute('id', asset.id);
      assetItem.setAttribute('src', asset.src);
      assetContainer.appendChild(assetItem);
    });
    
    assetContainer.addEventListener('loaded', () => {
      document.querySelector('#loading').style.display = 'none';
    });
    
    data.buildings.forEach(building => {
      const entity = document.createElement('a-entity');
      entity.setAttribute('id', building.id);
      entity.setAttribute('gltf-model', building.model);
      entity.setAttribute('position', building.position);
      
      if (building.scale && building.scale !== "0 0 0") {
        entity.setAttribute('scale', building.scale);
      } else {
        entity.setAttribute('scale', '1 1 1');
      }
      
      if (building.rotation) {
        entity.setAttribute('rotation', building.rotation);
      } else {
        entity.setAttribute('rotation', '0 0 0');
      }
      
      entity.setAttribute('class', building.class);
      
      // CRITICAL: Add physics-static to all buildings
      entity.setAttribute('physics-static', 'friction: 0.8; restitution: 0.1');
      console.log('Added physics-static to', building.id);
      
      const navMeshEntity = document.createElement('a-entity');
      navMeshEntity.setAttribute('gltf-model', building.model);
      navMeshEntity.setAttribute('position', building.position);
      navMeshEntity.setAttribute('nav-mesh', '');
      navMeshEntity.setAttribute('visible', 'false');
      
      if (building.scale && building.scale !== "0 0 0") {
        navMeshEntity.setAttribute('scale', building.scale);
      } else {
        navMeshEntity.setAttribute('scale', '1 1 1');
      }
      
      if (building.rotation) {
        navMeshEntity.setAttribute('rotation', building.rotation);
      }
      
      navmeshContainer.appendChild(navMeshEntity);
      
      sceneContainer.appendChild(entity);
    });
    
    console.log('Scene loaded successfully!');
    
  } catch (error) {
    console.error('Error loading scene:', error);
    document.querySelector('#loading').textContent = 'Error loading scene. Check console for details.';
  }
}

window.addEventListener('load', loadScene);