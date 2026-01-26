  AFRAME.registerComponent('physics-ground', {
      init: function() {
        const checkPhysics = () => {
          if (physicsInitialized && window.RAPIER_READY) {
            this.createGroundBody();
          } else {
            setTimeout(checkPhysics, 100);
          }
        };
        checkPhysics();
      },

      createGroundBody: function() {
        const R = window.RAPIER_READY;
        
        // Create static rigid body at ground level
        const rigidBodyDesc = R.RigidBodyDesc.fixed()
          .setTranslation(0, 0, 0);
        
        const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
        
        // Create large flat collider (5000x5000 plane)
        const colliderDesc = R.ColliderDesc.cuboid(5000, 0.1, 5000)
          .setFriction(0.8)
          .setRestitution(0.1);
        
        physicsWorld.createCollider(colliderDesc, rigidBody);
        
        console.log('✅ Ground physics collider created');
      }
    });