AFRAME.registerComponent('drone-manager', {
  init: function () {
    const el = this.el;
    
    // Listen for messages from your WebSocket instance
    // Assuming your global socket variable is named 'ws'
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'chunk') return; // Ignore streaming chunks

      // Regex to match: cmd_pos_x_y_z_frames_easing_anim
      const cmdRegex = /^cmd_pos_(-?\d+\.?\d*)_(-?\d+\.?\d*)_(-?\d+\.?\d*)_(\d+)_([a-zA-Z]+)_([a-zA-Z0-9\-_]+)$/;
      const match = data.content.trim().match(cmdRegex);

      if (match) {
        const [_, x, y, z, frames, easing, anim] = match;
        this.executeMove(x, y, z, frames, easing, anim);
      }
    };
  },

  executeMove: function (x, y, z, frames, easing, anim) {
    const el = this.el;
    const duration = (frames / 60) * 1000; // Convert frames (assuming 60fps) to ms

    // 1. Update Rotation/Animation intensity
    const model = el.querySelector('#drone-model');
    if (anim === 'aggressive_flight') {
        model.setAttribute('animation__hover', 'dur', 500);
    } else {
        model.setAttribute('animation__hover', 'dur', 5000);
    }

    // 2. Perform Movement
    el.setAttribute('animation__move', {
      property: 'position',
      to: `${x} ${y} ${z}`,
      dur: duration,
      easing: easing,
      autoplay: true
    });

    // 3. Callback when finished
    el.addEventListener('animationcomplete__move', () => {
        console.log("Move complete, notifying AI...");
        ws.send(JSON.stringify({
            sessionId: localStorage.getItem('chat_session_id'),
            text: `CALLBACK: Position change to ${x} ${y} ${z} complete. Awaiting next command.`
        }));
    }, { once: true });
  }
});