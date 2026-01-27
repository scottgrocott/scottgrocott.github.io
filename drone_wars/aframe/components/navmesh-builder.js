// Global nav mesh manager
window.globalNavMesh = null;
window.navMeshReady = false;

AFRAME.registerComponent('navmesh-builder', {
  schema: {
    autoUpdate: { type: 'boolean', default: true }
  },

  init: function() {
    console.log('🗺️ Nav mesh builder initialized');
    
    // Wait for scene to load before loading navmesh
    this.el.sceneEl.addEventListener('loaded', () => {
      setTimeout(() => {
        this.loadNavMeshFromGLB();
      }, 2000); // Wait for all GLBs to load
    });
  },

  loadNavMeshFromGLB: function() {
    console.log('🔨 Loading nav mesh from GLB file...');
    
    // Create a loader for the navmesh GLB
    const loader = new THREE.GLTFLoader();
    const navmeshURL = 'https://scottgrocott.github.io/drone_wars/aframe/nav_mesh_create.glb';
    
    loader.load(
      navmeshURL,
      (gltf) => {
        console.log('✅ Nav mesh GLB loaded successfully');
        this.processNavMeshGeometry(gltf.scene);
      },
      (progress) => {
        console.log(`📥 Loading nav mesh: ${(progress.loaded / progress.total * 100).toFixed(0)}%`);
      },
      (error) => {
        console.error('❌ Failed to load nav mesh GLB:', error);
        console.log('⚠️ Falling back to simple nav mesh');
        this.createSimpleNavMesh();
      }
    );
  },

  processNavMeshGeometry: function(scene) {
    console.log('🔍 Processing nav mesh geometry...');
    
    // Collect all geometry from the navmesh GLB
    const allVertices = [];
    const allIndices = [];
    let vertexOffset = 0;
    let totalTriangles = 0;
    
    scene.traverse((node) => {
      if (node.isMesh && node.geometry) {
        const geometry = node.geometry;
        const positions = geometry.attributes.position.array;
        const indices = geometry.index ? geometry.index.array : null;
        
        // Get world transform
        node.updateMatrixWorld(true);
        const worldMatrix = node.matrixWorld;
        const tempVec = new THREE.Vector3();
        
        // Transform vertices to world space
        for (let i = 0; i < positions.length; i += 3) {
          tempVec.set(positions[i], positions[i + 1], positions[i + 2]);
          tempVec.applyMatrix4(worldMatrix);
          allVertices.push(tempVec.x, tempVec.y, tempVec.z);
        }
        
        // Add indices
        if (indices) {
          for (let i = 0; i < indices.length; i++) {
            allIndices.push(indices[i] + vertexOffset);
          }
          totalTriangles += indices.length / 3;
        } else {
          for (let i = 0; i < positions.length / 3; i++) {
            allIndices.push(i + vertexOffset);
          }
          totalTriangles += positions.length / 9;
        }
        
        vertexOffset += positions.length / 3;
      }
    });
    
    if (allVertices.length === 0) {
      console.error('❌ No geometry found in nav mesh GLB');
      this.createSimpleNavMesh();
      return;
    }
    
    console.log(`📊 Collected ${allVertices.length / 3} vertices, ${totalTriangles} triangles from nav mesh`);
    
    // Create Yuka nav mesh from the geometry
    this.createWalkableNavMesh(allVertices, allIndices);
  },
  
  createWalkableNavMesh: function(vertices, indices) {
    try {
      const navMesh = new YUKA.NavMesh();
      
      // Sample the geometry to create walkable regions
      // We'll create regions from horizontal surfaces (walkable areas)
      const regions = [];
      const regionCentroids = [];
      
      // Process triangles and filter for horizontal walkable surfaces
      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;
        
        const v0 = new YUKA.Vector3(vertices[i0], vertices[i0 + 1], vertices[i0 + 2]);
        const v1 = new YUKA.Vector3(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
        const v2 = new YUKA.Vector3(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
        
        // Calculate triangle normal
        const edge1 = new YUKA.Vector3().subVectors(v1, v0);
        const edge2 = new YUKA.Vector3().subVectors(v2, v0);
        const normal = new YUKA.Vector3().crossVectors(edge1, edge2).normalize();
        
        // Check if surface is walkable (roughly horizontal, facing up)
        const upDot = normal.dot(new YUKA.Vector3(0, 1, 0));
        
        if (upDot > 0.7) { // Surface is mostly horizontal and facing up
          // Calculate centroid
          const centroid = new YUKA.Vector3()
            .add(v0)
            .add(v1)
            .add(v2)
            .divideScalar(3);
          
          // Create region
          const region = {
            centroid: centroid,
            cost: 1.0,
            neighbors: []
          };
          
          regions.push(region);
          regionCentroids.push(centroid);
        }
      }
      
      // Connect nearby regions as neighbors
      const maxDistance = 50.0; // Max distance to connect regions (increased for larger scenes)
      
      for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
          const dist = regions[i].centroid.distanceTo(regions[j].centroid);
          
          if (dist < maxDistance) {
            regions[i].neighbors.push(j);
            regions[j].neighbors.push(i);
          }
        }
      }
      
      navMesh.regions = regions;
      
      console.log(`✅ Nav mesh created with ${regions.length} walkable regions`);
      
      // DEBUG: Check region connectivity
      let connectedCount = 0;
      let isolatedCount = 0;
      for (const region of regions) {
        if (region.neighbors && region.neighbors.length > 0) {
          connectedCount++;
        } else {
          isolatedCount++;
        }
      }
      console.log(`🔗 Connected regions: ${connectedCount}, Isolated: ${isolatedCount}`);
      
      // Find largest connected cluster
      let visited = new Set();
      let maxClusterSize = 0;
      for (let i = 0; i < regions.length; i++) {
        if (visited.has(i)) continue;
        
        let clusterSize = 0;
        let queue = [i];
        visited.add(i);
        
        while (queue.length > 0) {
          let current = queue.shift();
          clusterSize++;
          
          const region = regions[current];
          if (region.neighbors) {
            for (const neighborIdx of region.neighbors) {
              if (!visited.has(neighborIdx)) {
                visited.add(neighborIdx);
                queue.push(neighborIdx);
              }
            }
          }
        }
        
        if (clusterSize > maxClusterSize) {
          maxClusterSize = clusterSize;
        }
      }
      console.log(`📊 Largest connected cluster: ${maxClusterSize} out of ${regions.length} regions (${(maxClusterSize/regions.length*100).toFixed(1)}%)`);
      
      if (regions.length === 0) {
        console.warn('⚠️ No walkable surfaces found, creating fallback grid');
        this.createSimpleNavMesh();
        return;
      }
      
      // Store globally for AI to use
      window.globalNavMesh = navMesh;
      window.navMeshReady = true;
      
      console.log('🎯 Global nav mesh ready for AI pathfinding');
      
      // Emit event for AI entities
      this.el.sceneEl.emit('navmesh-ready', { navMesh: navMesh });
      
    } catch (error) {
      console.error('❌ Failed to create walkable nav mesh:', error);
      this.createSimpleNavMesh();
    }
  },
  
  createSimpleNavMesh: function() {
    // Create a simple grid-based nav mesh as fallback
    const navMesh = new YUKA.NavMesh();
    const size = 100;
    const divisions = 10;
    const cellSize = size / divisions;
    
    navMesh.regions = [];
    
    for (let x = 0; x < divisions; x++) {
      for (let z = 0; z < divisions; z++) {
        const cx = -size/2 + (x + 0.5) * cellSize;
        const cz = -size/2 + (z + 0.5) * cellSize;
        
        const region = {
          centroid: new YUKA.Vector3(cx, 0, cz),
          cost: 1.0,
          neighbors: []
        };
        
        navMesh.regions.push(region);
      }
    }
    
    // Connect grid neighbors
    for (let x = 0; x < divisions; x++) {
      for (let z = 0; z < divisions; z++) {
        const idx = x * divisions + z;
        const region = navMesh.regions[idx];
        
        // Right neighbor
        if (x < divisions - 1) {
          region.neighbors.push(idx + divisions);
        }
        // Down neighbor
        if (z < divisions - 1) {
          region.neighbors.push(idx + 1);
        }
        // Left neighbor
        if (x > 0) {
          region.neighbors.push(idx - divisions);
        }
        // Up neighbor
        if (z > 0) {
          region.neighbors.push(idx - 1);
        }
      }
    }
    
    console.log(`✅ Fallback grid nav mesh created with ${navMesh.regions.length} regions`);
    
    window.globalNavMesh = navMesh;
    window.navMeshReady = true;
    
    this.el.sceneEl.emit('navmesh-ready', { navMesh: navMesh });
  }
});

// Updated yuka-nav component to use global nav mesh
AFRAME.registerComponent('yuka-nav-pathfinding', {
  schema: {
    speed: { type: 'number', default: 2 },
    patrolRadius: { type: 'number', default: 10 },
    wanderInterval: { type: 'number', default: 5000 },
    minHeight: { type: 'number', default: 2 }, // Minimum flying height
    heightOffset: { type: 'number', default: 3 } // Extra height above nav mesh
  },

  init: function() {
    this.vehicle = null;
    this.navigationActive = true;
    this.pathPlanner = null;
    this.followPathBehavior = null;
    this.wanderBehavior = null;
    this.navigationTimer = null;
    
    this.setupYukaVehicle();
  },

  setupYukaVehicle: function() {
    console.log('🚁 Setting up Yuka vehicle with pathfinding...');
    
    this.el.addEventListener('model-loaded', () => {
      console.log('📦 Model loaded, creating Yuka vehicle');
      
      const pos = this.el.object3D.position;
      
      this.vehicle = new YUKA.Vehicle();
      this.vehicle.position.set(pos.x, pos.y, pos.z);
      this.vehicle.maxSpeed = this.data.speed;
      this.vehicle.updateOrientation = true;
      
      this.vehicle.syncToRenderComponent = (entity) => {
        // Apply position but enforce minimum height
        const newY = Math.max(entity.position.y, this.data.minHeight);
        this.el.object3D.position.set(entity.position.x, newY, entity.position.z);
        this.el.object3D.quaternion.copy(entity.rotation);
      };
      
      yukaEntityManager.add(this.vehicle);
      
      console.log('✅ Yuka vehicle created at:', this.vehicle.position);
      
      // Check if nav mesh is ready
      if (window.navMeshReady) {
        this.setupPathfinding();
      } else {
        // Wait for nav mesh
        this.el.sceneEl.addEventListener('navmesh-ready', () => {
          this.setupPathfinding();
        });
      }
    });
  },
  
  setupPathfinding: function() {
    console.log('🗺️ Setting up pathfinding navigation');
    
    if (!window.globalNavMesh) {
      console.warn('⚠️ No global nav mesh available, falling back to wander');
      this.setupWanderBehavior();
      return;
    }
    
    try {
      // Yuka uses AStar algorithm for pathfinding, not PathPlanner
      // We'll use OnPathBehavior with manually calculated paths
      
      // Create follow path behavior
      this.followPathBehavior = new YUKA.FollowPathBehavior();
      this.followPathBehavior.active = false;
      this.vehicle.steering.add(this.followPathBehavior);
      
      // Add obstacle avoidance
      const obstacleAvoidance = new YUKA.ObstacleAvoidanceBehavior();
      this.vehicle.steering.add(obstacleAvoidance);
      
      console.log('✅ Pathfinding setup complete');
      
      // Start finding paths
      this.startPatrolling();
      
    } catch (error) {
      console.error('❌ Pathfinding setup failed:', error);
      this.setupWanderBehavior();
    }
  },
  
  setupWanderBehavior: function() {
    console.log('🔧 Falling back to wander behavior');
    
    this.wanderBehavior = new YUKA.WanderBehavior();
    this.vehicle.steering.add(this.wanderBehavior);
    
    const obstacleAvoidance = new YUKA.ObstacleAvoidanceBehavior();
    this.vehicle.steering.add(obstacleAvoidance);
    
    console.log('✅ Wander behavior active');
  },
  
  startPatrolling: function() {
    // Find first path
    this.findNewPath();
    
    // Set up interval to find new paths
    this.navigationTimer = setInterval(() => {
      if (this.navigationActive) {
        this.findNewPath();
      }
    }, this.data.wanderInterval);
  },
  
  findNewPath: function() {
    if (!window.globalNavMesh || !window.globalNavMesh.regions || window.globalNavMesh.regions.length === 0) {
      console.warn('⚠️ No nav mesh regions available');
      return;
    }
    
    const regions = window.globalNavMesh.regions;
    const vehiclePos = this.vehicle.position;
    
    // Find closest region to current position
    let closestFromRegion = regions[0];
    let closestFromDist = Infinity;
    
    for (const region of regions) {
      const dist = vehiclePos.distanceTo(region.centroid);
      if (dist < closestFromDist) {
        closestFromDist = dist;
        closestFromRegion = region;
      }
    }
    
    // Pick random destination region
    const toRegion = regions[Math.floor(Math.random() * regions.length)];
    
    console.log(`🎯 Finding path from region to random destination`);
    
    try {
      // Simple pathfinding: just go to random region centroids
      // For more complex pathfinding, we'd need to implement A* on the region graph
      const path = new YUKA.Path();
      
      // Add current position with height offset
      const startPos = vehiclePos.clone();
      startPos.y = Math.max(startPos.y, this.data.minHeight);
      path.add(startPos);
      
      // Add intermediate waypoints if regions are connected
      const waypoints = this.findWaypoints(closestFromRegion, toRegion, regions);
      
      for (const waypoint of waypoints) {
        // Add height offset to each waypoint
        waypoint.y += this.data.heightOffset;
        waypoint.y = Math.max(waypoint.y, this.data.minHeight);
        path.add(waypoint);
      }
      
      // Add final destination with height offset
      const endPos = toRegion.centroid.clone();
      endPos.y += this.data.heightOffset;
      endPos.y = Math.max(endPos.y, this.data.minHeight);
      path.add(endPos);
      
      console.log(`✅ Path created with ${waypoints.length + 2} waypoints (min height: ${this.data.minHeight})`);
      
      this.followPathBehavior.path = path;
      this.followPathBehavior.active = true;
      
    } catch (error) {
      console.error('❌ Pathfinding error:', error);
    }
  },
  
  findWaypoints: function(fromRegion, toRegion, allRegions) {
    // Simple greedy pathfinding: move towards goal through connected regions
    const waypoints = [];
    const visited = new Set();
    let currentRegion = fromRegion;
    const maxSteps = 20;
    let steps = 0;
    
    visited.add(allRegions.indexOf(currentRegion));
    
    while (currentRegion !== toRegion && steps < maxSteps) {
      steps++;
      
      // Find neighbor closest to goal
      let bestNeighbor = null;
      let bestDist = Infinity;
      
      if (currentRegion.neighbors && currentRegion.neighbors.length > 0) {
        for (const neighborIdx of currentRegion.neighbors) {
          if (visited.has(neighborIdx)) continue;
          
          const neighbor = allRegions[neighborIdx];
          const distToGoal = neighbor.centroid.distanceTo(toRegion.centroid);
          
          if (distToGoal < bestDist) {
            bestDist = distToGoal;
            bestNeighbor = neighbor;
          }
        }
      }
      
      if (bestNeighbor) {
        waypoints.push(bestNeighbor.centroid.clone());
        currentRegion = bestNeighbor;
        visited.add(allRegions.indexOf(currentRegion));
      } else {
        // No more neighbors, done
        break;
      }
      
      // If we're close enough to goal, stop
      if (currentRegion === toRegion || currentRegion.centroid.distanceTo(toRegion.centroid) < 5) {
        break;
      }
    }
    
    return waypoints;
  },

  tick: function(time, deltaTime) {
    if (this.vehicle && this.navigationActive) {
      const delta = deltaTime / 1000;
      yukaEntityManager.update(delta);
      
      if (this.vehicle.syncToRenderComponent) {
        this.vehicle.syncToRenderComponent(this.vehicle);
      }
    }
  },

  disableNavigation: function() {
    console.log('🛑 Yuka navigation disabled');
    this.navigationActive = false;
    
    if (this.navigationTimer) {
      clearInterval(this.navigationTimer);
    }
    
    if (this.vehicle) {
      this.vehicle.steering.clear();
    }
  },

  remove: function() {
    if (this.navigationTimer) {
      clearInterval(this.navigationTimer);
    }
    if (this.vehicle) {
      yukaEntityManager.remove(this.vehicle);
    }
  }
});