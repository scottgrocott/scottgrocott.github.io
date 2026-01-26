  AFRAME.registerComponent('yuka-nav', {
      schema: {
        speed: { type: 'number', default: 2 },
        patrolRadius: { type: 'number', default: 10 }
      },

      init: function() {
        this.vehicle = null;
        this.navigationActive = true;
        this.setupYukaVehicle();
      },

      setupYukaVehicle: function() {
        console.log('🚁 Setting up Yuka vehicle...');
        
        this.el.addEventListener('model-loaded', () => {
          console.log('📦 Model loaded, creating Yuka vehicle');
          
          const pos = this.el.object3D.position;
          
          this.vehicle = new YUKA.Vehicle();
          this.vehicle.position.set(pos.x, pos.y, pos.z);
          this.vehicle.maxSpeed = this.data.speed;
          this.vehicle.updateOrientation = true;
          
          this.vehicle.syncToRenderComponent = (entity) => {
            this.el.object3D.position.copy(entity.position);
            this.el.object3D.quaternion.copy(entity.rotation);
          };
          
          yukaEntityManager.add(this.vehicle);
          
          console.log('✅ Yuka vehicle created at:', this.vehicle.position);
          
          this.setupWanderBehavior();
        });
      },
      
      setupWanderBehavior: function() {
        console.log('🔧 Setting up wander behavior');
        
        const wanderBehavior = new YUKA.WanderBehavior();
        this.vehicle.steering.add(wanderBehavior);
        
        const obstacleBehavior = new YUKA.ObstacleAvoidanceBehavior();
        this.vehicle.steering.add(obstacleBehavior);
        
        console.log('✅ Wander behavior active, behaviors:', this.vehicle.steering.behaviors.length);
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
        
        if (this.vehicle) {
          this.vehicle.steering.clear();
        }
      },

      remove: function() {
        if (this.vehicle) {
          yukaEntityManager.remove(this.vehicle);
        }
      }
    });