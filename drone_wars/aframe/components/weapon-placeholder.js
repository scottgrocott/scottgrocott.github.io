
AFRAME.registerComponent('weapon-placeholder', {
  schema: {
    radius: { type: 'number', default: 0.08 },
    height: { type: 'number', default: 0.6 },
    color: { type: 'color', default: '#444444' },
    opacity: { type: 'number', default: 0.7 },
    
    // Local offsets relative to camera (x = right, y = up, z = forward/negative = in front)
    localX: { type: 'number', default: 0.35 },
    localY: { type: 'number', default: -0.25 },
    localZ: { type: 'number', default: -0.8 }  // negative = in front of camera
  },

  init: function () {
    const cylinder = document.createElement('a-cylinder');
    cylinder.setAttribute('radius', this.data.radius);
    cylinder.setAttribute('height', this.data.height);
    cylinder.setAttribute('color', this.data.color);
    cylinder.setAttribute('opacity', this.data.opacity);
    cylinder.setAttribute('material', 'side: double; metalness: 0.3; roughness: 0.4');

    // Position in LOCAL camera space (stays fixed on screen)
    cylinder.setAttribute('position', `${this.data.localX} ${this.data.localY} ${this.data.localZ}`);
    cylinder.setAttribute('rotation', '-52.283 -35.636 39.347');
    // Optional: Make it always face the camera (good for weapons)
    // cylinder.setAttribute('look-at', '[camera]');

    this.el.appendChild(cylinder);
    this.cylinder = cylinder;
  }
});
