AFRAME.registerComponent('ladder', {
  schema: {
    height: { type: 'number', default: 5 },
    width: { type: 'number', default: 0.5 },
    depth: { type: 'number', default: 0.1 },
    climbSpeed: { type: 'number', default: 3 },
    texture: { type: 'string', default: '' },
    color: { type: 'color', default: '#8B4513' }
  },

  init: function() {
    this.player = null;
    this.isPlayerOnLadder = false;
    this.climbingActive = false;
    
    this.createLadderMesh();
    this.setupPhysicsTrigger();
    this.setupClimbControls();
  },

  createLadderMesh: function() {
    // Create visual ladder
    const ladder = document.createElement('a-box');
    ladder.setAttribute('width', this.data.width);
    ladder.setAttribute('height', this.data.height);
    ladder.setAttribute('depth', this.data.depth);
    
    if (this.data.texture) {
      ladder.setAttribute('material', `src: ${this.data.texture}; side: double`);
    } else {
      ladder.setAttribute('material', `color: ${this.data.color}; side: double`);
    }
    
    // Position at center of ladder height
    ladder.setAttribute('position', `0 ${this.data.height / 2} 0`);
    
    this.el.appendChild(ladder);
    this.ladderMesh = ladder;
  },

  setupPhysicsTrigger: function() {
    // Wait for physics to initialize
    const checkPhysics = () => {
      if (physicsInitialized && window.RAPIER_READY) {
        this.createTriggerSensor();
      } else {
        setTimeout(checkPhysics, 100);
      }
    };
    checkPhysics();
  },

  createTriggerSensor: function() {
    const R = window.RAPIER_READY;
    const pos = this.el.object3D.position;
    const rot = this.el.object3D.quaternion;
    
    // Create sensor (non-solid trigger zone)
    const rigidBodyDesc = R.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y + (this.data.height / 2), pos.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    
    this.rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
    
    // Create trigger collider (slightly wider than visual for easier access)
    const colliderDesc = R.ColliderDesc.cuboid(
      this.data.width / 2 + 0.2,
      this.data.height / 2,
      this.data.depth / 2 + 0.5
    ).setSensor(true); // IMPORTANT: Makes it a trigger, not solid
    
    this.collider = physicsWorld.createCollider(colliderDesc, this.rigidBody);
    
    console.log('✅ Ladder trigger created:', this.data.height, 'units tall');
  },

  setupClimbControls: function() {
    // Find player
    setTimeout(() => {
      const rig = document.querySelector('#rig');
      if (rig && rig.components['physics-player']) {
        this.player = rig.components['physics-player'];
        console.log('🪜 Ladder found player');
      }
    }, 1000);

    // Climb keys (W/S or Up/Down while on ladder)
    this.onKeyDown = (e) => {
      if (!this.isPlayerOnLadder) return;
      
      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        this.climbingActive = true;
        this.climbDirection = 1; // Up
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        this.climbingActive = true;
        this.climbDirection = -1; // Down
      }
    };

    this.onKeyUp = (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp' || 
          e.code === 'KeyS' || e.code === 'ArrowDown') {
        this.climbingActive = false;
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  },

  tick: function() {
    if (!this.player || !this.player.rigidBody) return;

    // Check if player is touching the ladder
    this.checkPlayerProximity();

    // Apply climbing movement
    if (this.isPlayerOnLadder && this.climbingActive) {
      this.applyClimb();
    }
  },

  checkPlayerProximity: function() {
    const playerPos = this.player.rigidBody.translation();
    const ladderPos = this.el.object3D.position;
    
    // Calculate distance from player to ladder
    const dx = playerPos.x - ladderPos.x;
    const dy = playerPos.y - (ladderPos.y + this.data.height / 2);
    const dz = playerPos.z - ladderPos.z;
    
    // Check if within ladder bounds (wider trigger zone)
    const inXRange = Math.abs(dx) < (this.data.width / 2 + 0.5);
    const inYRange = Math.abs(dy) < (this.data.height / 2 + 0.5);
    const inZRange = Math.abs(dz) < (this.data.depth / 2 + 1.0);
    
    const wasOnLadder = this.isPlayerOnLadder;
    this.isPlayerOnLadder = inXRange && inYRange && inZRange;
    
    // Log when entering/leaving ladder
    if (!wasOnLadder && this.isPlayerOnLadder) {
      console.log('🪜 Player on ladder');
    } else if (wasOnLadder && !this.isPlayerOnLadder) {
      console.log('🪜 Player left ladder');
      this.climbingActive = false;
    }
  },

  applyClimb: function() {
    // Cancel gravity and apply vertical movement
    const currentVel = this.player.rigidBody.linvel();
    
    // Set velocity: keep horizontal movement, override vertical
    this.player.rigidBody.setLinvel({
      x: currentVel.x * 0.5, // Reduce horizontal movement while climbing
      y: this.climbDirection * this.data.climbSpeed,
      z: currentVel.z * 0.5
    }, true);
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