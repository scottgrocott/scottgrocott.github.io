AFRAME.registerComponent('physics-drone', {
  schema: {
    radius: { type: 'number', default: 0.5 },
    mass: { type: 'number', default: 2 },
    friction: { type: 'number', default: 0.0 },
    restitution: { type: 'number', default: 0.3 }
  },

  init: function() {
    this.rigidBody = null;
    this.collider = null;
    this.yukaNav = null;
    
    // Wait for model to load
    this.el.addEventListener('model-loaded', () => {
      this.createPhysicsBody();
      
      // Get reference to yuka-nav component
      setTimeout(() => {
        this.yukaNav = this.el.components['yuka-nav-pathfinding'] || this.el.components['yuka-nav'];
      }, 100);
    });
  },

  createPhysicsBody: function() {
    const checkPhysics = () => {
      if (physicsInitialized && window.RAPIER_READY) {
        this.buildCollider();
      } else {
        setTimeout(checkPhysics, 100);
      }
    };
    checkPhysics();
  },

  buildCollider: function() {
    const R = window.RAPIER_READY;
    const pos = this.el.object3D.position;
    const rot = this.el.object3D.quaternion;
    
    // Create kinematic body (moves with Yuka, but has collision)
    const rigidBodyDesc = R.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    
    this.rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
    
    // Create sphere collider for the drone
    const colliderDesc = R.ColliderDesc.ball(this.data.radius)
      .setMass(this.data.mass)
      .setFriction(this.data.friction)
      .setRestitution(this.data.restitution);
    
    this.collider = physicsWorld.createCollider(colliderDesc, this.rigidBody);
    
    console.log('✅ Drone physics collider created (radius:', this.data.radius, ')');
  },

  tick: function() {
    if (!this.rigidBody || !this.yukaNav || !this.yukaNav.vehicle) return;
    
    // Get desired position from Yuka
    const yukaPos = this.yukaNav.vehicle.position;
    
    // Update physics body to match Yuka position
    this.rigidBody.setNextKinematicTranslation({ 
      x: yukaPos.x, 
      y: yukaPos.y, 
      z: yukaPos.z 
    });
    
    // Check if we hit something
    const actualPos = this.rigidBody.translation();
    const dx = actualPos.x - yukaPos.x;
    const dy = actualPos.y - yukaPos.y;
    const dz = actualPos.z - yukaPos.z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    // If physics pushes us away from desired position, update Yuka to match
    if (distance > 0.1) {
      // We hit something, update Yuka vehicle to actual physics position
      this.yukaNav.vehicle.position.set(actualPos.x, actualPos.y, actualPos.z);
    }
  },

  remove: function() {
    if (this.collider && physicsWorld) {
      physicsWorld.removeCollider(this.collider);
    }
    if (this.rigidBody && physicsWorld) {
      physicsWorld.removeRigidBody(this.rigidBody);
    }
  }
});