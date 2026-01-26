AFRAME.registerComponent('physics-player', {
  schema: {
    height: { type: 'number', default: 1.6 },
    radius: { type: 'number', default: 0.4 },
    mass: { type: 'number', default: 80 },
    jumpForce: { type: 'number', default: 300 },
    moveSpeed: { type: 'number', default: 500 },
    maxVelocity: { type: 'number', default: 5 }
  },

  init: function() {
    this.rigidBody = null;
    this.collider = null;
    this.isGrounded = false;
    this.moveDirection = new THREE.Vector3();
    this.justJumped = false;
    
    // Movement state
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false
    };
    
    // IMPORTANT: Disable A-Frame's default WASD controls
    this.el.removeAttribute('wasd-controls');
    
    this.setupPhysicsBody();
    this.setupControls();
  },

  setupPhysicsBody: function() {
    const checkPhysics = () => {
      if (physicsInitialized && window.RAPIER_READY) {
        this.createPlayerBody();
      } else {
        setTimeout(checkPhysics, 100);
      }
    };
    checkPhysics();
  },

  createPlayerBody: function() {
    const R = window.RAPIER_READY;
    const pos = this.el.object3D.position;
    
    // Create dynamic character controller
    const rigidBodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .lockRotations() // Prevent player from tipping over
      .setLinearDamping(5.0) // Higher damping for more control
      .enabledRotations(false, false, false); // Lock all rotations
    
    this.rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
    
    // Create capsule collider for smooth movement
    const colliderDesc = R.ColliderDesc.capsule(
      (this.data.height / 2) - this.data.radius, 
      this.data.radius
    )
      .setMass(this.data.mass)
      .setFriction(0.0) // Zero friction for smoother movement
      .setRestitution(0.0); // No bounce
    
    this.collider = physicsWorld.createCollider(colliderDesc, this.rigidBody);
    
    console.log('✅ Player physics body created');
    console.log('   Height:', this.data.height, 'Radius:', this.data.radius);
    console.log('   Position:', pos);
  },

  setupControls: function() {
    // Keyboard controls
    this.onKeyDown = (e) => {
      switch(e.code) {
        case 'KeyW':
        case 'ArrowUp':
          e.preventDefault();
          this.keys.forward = true; 
          break;
        case 'KeyS':
        case 'ArrowDown':
          e.preventDefault();
          this.keys.backward = true; 
          break;
        case 'KeyA':
        case 'ArrowLeft':
          e.preventDefault();
          this.keys.left = true; 
          break;
        case 'KeyD':
        case 'ArrowRight':
          e.preventDefault();
          this.keys.right = true; 
          break;
        case 'Space': 
          e.preventDefault();
          if (!this.keys.jump) { // Only set on first press
            this.keys.jump = true;
            console.log('Space pressed');
          }
          break;
      }
    };

    this.onKeyUp = (e) => {
      switch(e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.forward = false; 
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.backward = false; 
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = false; 
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = false; 
          break;
        case 'Space': 
          this.keys.jump = false;
          this.justJumped = false;
          break;
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Get camera for rotation
    setTimeout(() => {
      this.camera = this.el.querySelector('[camera]');
      if (!this.camera) {
        this.camera = document.querySelector('[camera]');
      }
      console.log('Camera found:', !!this.camera);
    }, 100);
  },

  tick: function(time, deltaTime) {
    if (!this.rigidBody || !this.camera) return;

    const delta = Math.min(deltaTime / 1000, 0.1); // Cap delta time
    
    // Check if grounded
    this.checkGrounded();
    
    // Get camera rotation (Y-axis only for horizontal movement)
    const cameraEl = this.camera;
    const cameraRotY = cameraEl.object3D.rotation.y;
    
    // Calculate movement direction based on camera facing
    this.moveDirection.set(0, 0, 0);
    
    if (this.keys.forward) {
      this.moveDirection.x -= Math.sin(cameraRotY);
      this.moveDirection.z -= Math.cos(cameraRotY);
    }
    if (this.keys.backward) {
      this.moveDirection.x += Math.sin(cameraRotY);
      this.moveDirection.z += Math.cos(cameraRotY);
    }
    if (this.keys.left) {
      this.moveDirection.x -= Math.cos(cameraRotY);
      this.moveDirection.z += Math.sin(cameraRotY);
    }
    if (this.keys.right) {
      this.moveDirection.x += Math.cos(cameraRotY);
      this.moveDirection.z -= Math.sin(cameraRotY);
    }
    
    // Normalize to prevent faster diagonal movement
    if (this.moveDirection.length() > 0) {
      this.moveDirection.normalize();
    }
    
    // Apply movement impulse
    const currentVel = this.rigidBody.linvel();
    const horizontalSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.z * currentVel.z);
    
    // Only apply force if below max velocity
    if (horizontalSpeed < this.data.maxVelocity) {
      const impulse = {
        x: this.moveDirection.x * this.data.moveSpeed * delta,
        y: 0,
        z: this.moveDirection.z * this.data.moveSpeed * delta
      };
      
      this.rigidBody.applyImpulse(impulse, true);
    }
    
    // Jump
    if (this.keys.jump && this.isGrounded && !this.justJumped) {
      const jumpImpulse = { x: 0, y: this.data.jumpForce, z: 0 };
      this.rigidBody.applyImpulse(jumpImpulse, true);
      this.justJumped = true;
      console.log('🚀 Jumped! Grounded:', this.isGrounded);
    }
    
    // Sync position from physics to A-Frame
    const position = this.rigidBody.translation();
    this.el.object3D.position.set(position.x, position.y, position.z);
  },

  checkGrounded: function() {
    const R = window.RAPIER_READY;
    const pos = this.rigidBody.translation();
    
    // Cast ray downward from center of capsule
    const rayOrigin = { x: pos.x, y: pos.y, z: pos.z };
    const rayDir = { x: 0, y: -1, z: 0 };
    const maxDist = (this.data.height / 2) + 0.1; // Just beyond bottom of capsule
    
    const ray = new R.Ray(rayOrigin, rayDir);
    const hit = physicsWorld.castRay(ray, maxDist, true);
    
    const wasGrounded = this.isGrounded;
    this.isGrounded = hit !== null;
    
    // Debug logging
    if (wasGrounded !== this.isGrounded) {
      console.log('Grounded state changed:', this.isGrounded);
    }
  },

  remove: function() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    
    if (this.collider && physicsWorld) {
      physicsWorld.removeCollider(this.collider);
    }
    if (this.rigidBody && physicsWorld) {
      physicsWorld.removeRigidBody(this.rigidBody);
    }
  }
});