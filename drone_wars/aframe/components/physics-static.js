AFRAME.registerComponent('physics-static', {
  schema: {
    friction: { type: 'number', default: 0.8 },
    restitution: { type: 'number', default: 0.1 }
  },

  init: function() {
    this.rigidBody = null;
    this.colliders = [];
    
    // Wait for model to load before creating physics body
    this.el.addEventListener('model-loaded', () => {
      this.createStaticBody();
    });
  },

  createStaticBody: function() {
    const checkPhysics = () => {
      if (physicsInitialized && window.RAPIER_READY) {
        this.buildColliders();
      } else {
        setTimeout(checkPhysics, 100);
      }
    };
    checkPhysics();
  },

  buildColliders: function() {
    const R = window.RAPIER_READY;
    const mesh = this.el.getObject3D('mesh');
    
    if (!mesh) {
      console.warn('No mesh found for physics-static on', this.el.id);
      return;
    }
    
    const pos = this.el.object3D.position;
    const rot = this.el.object3D.quaternion;
    const scale = this.el.object3D.scale;
    
    console.log(`Building collider for ${this.el.id}, Scale: (${scale.x}, ${scale.y}, ${scale.z})`);
    
    // Create static rigid body at entity position
    const rigidBodyDesc = R.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y, pos.z);
    
    this.rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
    
    // Collect all vertices and indices from all meshes
    const allVertices = [];
    const allIndices = [];
    let vertexOffset = 0;
    let totalTriangles = 0;
    
    // Force update of all matrices
    this.el.object3D.updateMatrixWorld(true);
    
    mesh.traverse((node) => {
      if (node.isMesh && node.geometry) {
        const geometry = node.geometry;
        
        // Get positions
        const positions = geometry.attributes.position.array;
        const indices = geometry.index ? geometry.index.array : null;
        
        // Get the local transform of this mesh node relative to the parent
        const tempVec = new THREE.Vector3();
        const tempQuat = new THREE.Quaternion();
        const tempScale = new THREE.Vector3();
        
        for (let i = 0; i < positions.length; i += 3) {
          tempVec.set(positions[i], positions[i + 1], positions[i + 2]);
          
          // Apply the entity's scale directly
          tempVec.x *= scale.x;
          tempVec.y *= scale.y;
          tempVec.z *= scale.z;
          
          // Apply node's local transform (rotation from the GLB)
          tempVec.applyQuaternion(node.quaternion);
          
          // Add node's local position
          tempVec.add(node.position);
          
          // Apply entity rotation
          tempVec.applyQuaternion(rot);
          
          // Now tempVec is in world space relative to the entity position
          allVertices.push(tempVec.x, tempVec.y, tempVec.z);
        }
        
        // Add indices with offset
        if (indices) {
          for (let i = 0; i < indices.length; i++) {
            allIndices.push(indices[i] + vertexOffset);
          }
          totalTriangles += indices.length / 3;
        } else {
          // Generate indices for non-indexed geometry
          for (let i = 0; i < positions.length / 3; i++) {
            allIndices.push(i + vertexOffset);
          }
          totalTriangles += positions.length / 9;
        }
        
        vertexOffset += positions.length / 3;
      }
    });
    
    if (allVertices.length === 0) {
      console.warn('No vertices found for physics-static on', this.el.id);
      return;
    }
    
    // Debug: Print vertex bounds to verify scale is applied
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < allVertices.length; i += 3) {
      minX = Math.min(minX, allVertices[i]);
      maxX = Math.max(maxX, allVertices[i]);
      minY = Math.min(minY, allVertices[i + 1]);
      maxY = Math.max(maxY, allVertices[i + 1]);
      minZ = Math.min(minZ, allVertices[i + 2]);
      maxZ = Math.max(maxZ, allVertices[i + 2]);
    }
    
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    
    console.log(`   Bounds: X(${minX.toFixed(2)} to ${maxX.toFixed(2)}) Y(${minY.toFixed(2)} to ${maxY.toFixed(2)}) Z(${minZ.toFixed(2)} to ${maxZ.toFixed(2)})`);
    console.log(`   Size: ${sizeX.toFixed(2)} x ${sizeY.toFixed(2)} x ${sizeZ.toFixed(2)}`);
    
    // Create single trimesh collider from all collected geometry
    const colliderDesc = R.ColliderDesc.trimesh(
      new Float32Array(allVertices),
      new Uint32Array(allIndices)
    )
      .setFriction(this.data.friction)
      .setRestitution(this.data.restitution);
    
    const collider = physicsWorld.createCollider(colliderDesc, this.rigidBody);
    this.colliders.push(collider);
    
    console.log(`✅ Static physics body created for ${this.el.id} with ${totalTriangles} triangles`);
    console.log(`   Position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
  },

  remove: function() {
    this.colliders.forEach(collider => {
      if (physicsWorld) {
        physicsWorld.removeCollider(collider);
      }
    });
    
    if (this.rigidBody && physicsWorld) {
      physicsWorld.removeRigidBody(this.rigidBody);
    }
  }
});