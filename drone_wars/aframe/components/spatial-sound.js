  AFRAME.registerComponent('spatial-sound', {
      schema: {
        src: { type: 'string', default: '' },
        volume: { type: 'number', default: 0.5 },
        loop: { type: 'boolean', default: true },
        refDistance: { type: 'number', default: 5 },
        maxDistance: { type: 'number', default: 50 },
        rolloffFactor: { type: 'number', default: 1 }
      },

      init: function() {
        this.sound = null;
        this.camera = null;
        
        if (!this.data.src) {
          console.warn('No sound source specified for spatial-sound');
          return;
        }
        
        // Create Howler sound with spatial audio
        this.sound = new Howl({
          src: [this.data.src],
          loop: this.data.loop,
          volume: this.data.volume,
          autoplay: true,
          spatial: true,
          refDistance: this.data.refDistance,
          maxDistance: this.data.maxDistance,
          rolloffFactor: this.data.rolloffFactor,
          onload: () => {
            console.log('🔊 Spatial sound loaded:', this.data.src);
          },
          onloaderror: (id, error) => {
            console.error('Failed to load sound:', error);
          }
        });
        
        // Get camera reference
        this.el.sceneEl.addEventListener('camera-set-active', (evt) => {
          this.camera = evt.detail.cameraEl;
        });
        
        // If camera already exists, use it
        setTimeout(() => {
          if (!this.camera) {
            this.camera = document.querySelector('[camera]');
          }
        }, 100);
      },

      tick: function() {
        if (!this.sound || !this.camera) return;
        
        // Update listener position (camera)
        const camPos = this.camera.object3D.position;
        const camRot = this.camera.object3D.rotation;
        
        Howler.pos(camPos.x, camPos.y, camPos.z);
        Howler.orientation(
          Math.sin(camRot.y), 0, -Math.cos(camRot.y),  // Forward vector
          0, 1, 0  // Up vector
        );
        
        // Update sound source position
        const pos = this.el.object3D.position;
        this.sound.pos(pos.x, pos.y, pos.z);
      },

      remove: function() {
        if (this.sound) {
          this.sound.stop();
          this.sound.unload();
        }
      }
    });