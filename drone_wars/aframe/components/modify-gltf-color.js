  AFRAME.registerComponent('modify-gltf-color', {
    schema: {
      color: {type: 'color', default: '#00FF00'}, // Default Green
      opacity: {type: 'number', default: 1.0}     // Default Opaque
    },

    init: function () {
      // Wait for the model to finish loading
      this.el.addEventListener('model-loaded', () => {
        
        // Get the underlying Three.js object
        const obj = this.el.getObject3D('mesh');
        
        // Go through every part of the model (in case it has children)
        obj.traverse((node) => {
          if (node.isMesh) {
            
            // OPTIONAL: Clone material so modifying one cube doesn't change ALL cubes
            // node.material = node.material.clone(); 

            // 1. Change RGB (Color)
            node.material.color.set(this.data.color);

            // 2. Change A (Alpha/Opacity)
            if (this.data.opacity < 1.0) {
              node.material.transparent = true; // Required for transparency to work
              node.material.opacity = this.data.opacity;
            }
          }
        });
      });
    }
  });


      /**
 * Returns an object with random red, green, and blue values (0-255).
 * @returns {{r: number, g: number, b: number}}
 */
function getRandomRGB() {
  return {
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256)
  };
}