AFRAME.registerComponent('hello-world', {
    init: function () {
      console.log('Hello, World!');
    }
  });

  AFRAME.registerComponent('log', {
    schema: {
      event: {type: 'string', default: ''},
      message: {type: 'string', default: 'Hello, World333!'}
    },
  
    update: function () {
      var data = this.data;  // Component property values.
      var el = this.el;  // Reference to the component's entity.
  
      if (data.event) {
        // This will log the `message` when the entity emits the `event`.
        el.addEventListener(data.event, function () {
          console.log(data.message);
        });
      } else {
        // `event` not specified, just log the message.
        console.log(data.message);
      }
    }
  });

  AFRAME.registerComponent('line-animation', {
    schema: {
      targetId: { type: 'string', default: '' }, // ID of the target entity to animate
      to: { type: 'string', default: '0 1 0' }, // End position (e.g., '0 1 0')
      dur: { type: 'number', default: 2000 } // Duration in milliseconds
    },
  
    init: function () {
      const { targetId, to, dur } = this.data;
  
      // Validate targetId
      if (!targetId) {
        console.error('line-animation component requires a targetId.');
        return;
      }
  
      const targetEntity = document.getElementById(targetId);
      if (!targetEntity) {
        console.error(`Entity with ID "${targetId}" not found.`);
        return;
      }
  
      // Get initial position
      const initialPosition = targetEntity.getAttribute('position') || { x: 0, y: 0, z: 0 };
      const from = `${initialPosition.x} ${initialPosition.y} ${initialPosition.z}`;
  
      // Create a single straight-line animation
      const animation = document.createElement('a-animation');
      animation.setAttribute('attribute', 'position');
      animation.setAttribute('from', from);
      animation.setAttribute('to', to);
      animation.setAttribute('dur', dur);
      animation.setAttribute('easing', 'linear');
  
      // Append the animation to the target entity
      targetEntity.appendChild(animation);
    }
  });