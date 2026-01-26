  AFRAME.registerComponent('physics-body', {
      schema: {
        type: { type: 'string', default: 'dynamic' },
        mass: { type: 'number', default: 1.0 },
        restitution: { type: 'number', default: 0.3 },
        friction: { type: 'number', default: 0.5 }
      },

      init: function() {
        this.rigidBody = null;
        this.collider = null;
        this.isDead = false;
        
        const checkPhysics = () => {
          if (physicsInitialized) {
            console.log('Physics body ready (will activate on kill event)');
          } else {
            setTimeout(checkPhysics, 100);
          }
        };
        checkPhysics();
        
        this.el.addEventListener('kill', () => {
          this.activatePhysics();
          this.el.removeAttribute('animation-mixer');
          this.el.removeAttribute('spatial-sound');
        });
      },

      activatePhysics: function() {
        if (this.isDead || !window.RAPIER_READY) return;
        
        const R = window.RAPIER_READY;
        
        console.log('💥 Activating physics - drone killed!');
        this.isDead = true;
        
        const pos = this.el.object3D.position;
        const rot = this.el.object3D.quaternion;
        
        const rigidBodyDesc = R.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ w: rot.w, x: rot.x, y: rot.y, z: rot.z });
        
        this.rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
        
        const colliderDesc = R.ColliderDesc.cuboid(0.5, 0.5, 0.5)
          .setMass(this.data.mass)
          .setRestitution(this.data.restitution)
          .setFriction(this.data.friction);
        
        this.collider = physicsWorld.createCollider(colliderDesc, this.rigidBody);
        
        this.rigidBody.setAngvel({ 
          x: (Math.random() - 0.5) * 10, 
          y: (Math.random() - 0.5) * 10, 
          z: (Math.random() - 0.5) * 10 
        }, true);
        
        if (this.el.components['yuka-nav']) {
          this.el.components['yuka-nav'].disableNavigation();
        }
        
        console.log('🪦 Drone is falling...');
      },

      tick: function() {
        if (!this.rigidBody || !this.isDead) return;
        
        const position = this.rigidBody.translation();
        const rotation = this.rigidBody.rotation();
        
        this.el.object3D.position.set(position.x, position.y, position.z);
        this.el.object3D.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
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