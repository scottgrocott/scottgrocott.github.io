
   
    function buildDrone() {
      const sceneContainer = document.querySelector('#scene-container');
      const drone = document.createElement('a-entity');
      drone.setAttribute('id', 'drone');
      drone.setAttribute('gltf-model', '#droneglb');
      const color = getRandomRGB();
      const rgbString = `rgb(${color.r}, ${color.g}, ${color.b})`;
      drone.setAttribute('modify-gltf-color', `color: ${rgbString}; opacity: 1.0`);
      drone.setAttribute('position', '0 2 0');
      drone.setAttribute('scale', '.5 .5 .5');
      //drone.setAttribute('animation-mixer', 'clip: attack; loop: repeat; timeScale: 1');
      drone.setAttribute('yuka-nav', 'speed: 3; patrolRadius: 15');
      drone.setAttribute('physics-body', 'type: kinematic; mass: 2; restitution: 0.2; friction: 0.8');
      drone.setAttribute('spatial-sound', 'src: https://scottgrocott.github.io/metal_throne/assets/audio/buzz.mp3; volume: 0.7; refDistance: 5; maxDistance: 50');
        setTimeout(() => {
              console.log('⏰ Killing drone in 5 seconds...');
              setTimeout(() => {
                drone.emit('kill');
                    setTimeout(() => {
                    drone.remove();
                    
                }, 5000);
              }, 5000);
            }, 5000);
      
      sceneContainer.appendChild(drone);
    }