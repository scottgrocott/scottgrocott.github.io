    // Simulate loading progress (A-Frame doesn't provide a direct progress API)
    document.addEventListener('DOMContentLoaded', () => {
        const loadingBar = document.getElementById('loading-bar');
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            loadingBar.style.width = `${progress}%`;
            if (progress >= 100) {
                clearInterval(interval);
            }
        }, 200); // Simulate progress every 200ms
    });

    // Hide loading screen when the scene is loaded
    document.querySelector('a-scene').addEventListener('loaded', () => {
        const loadingScreen = document.getElementById('aframeLoadingScreen');
        loadingScreen.classList.add('loaded');
    });



    function assignAnimation(model,anim){
        var sceneEl = document.querySelector('a-scene');
        //const entity = sceneEl.querySelectorAll('.propeller');
    //alert(model);
    //alert(anim);
        //console.log(entity);
       const mod = sceneEl.querySelector('#' + model);
        
            //console.log(mod);
            mod.setAttribute('animation', anim);
            
        
      }

      AFRAME.registerComponent('rotation-reader', {
  tick: function () {
    // `this.el` is the element.
    // `object3D` is the three.js object.

    // `rotation` is a three.js Euler using radians. `quaternion` also available.
    console.log(this.el.object3D.rotation);

    // `position` is a three.js Vector3.
    console.log(this.el.object3D.position);
  }
});

// scripts/main.js

function getCameraPosition() {
    // Get the A-Frame scene
    const scene = document.querySelector('a-scene');
    if (!scene) {
        console.error('A-Frame scene not found!');
        return null;
    }

    // Get the camera entity (the rig)
    const cameraEntity = scene.querySelector('a-camera');
    if (!cameraEntity) {
        console.error('No camera entity found in the scene!');
        return null;
    }

    // Ensure the scene is loaded and the camera is initialized
    if (!cameraEntity.object3D) {
        console.error('Camera object3D not initialized yet!');
        return null;
    }

    // Get the world position of the camera rig
    const worldPosition = new THREE.Vector3();
    cameraEntity.object3D.getWorldPosition(worldPosition);
//console.log(worldPosition);
    return worldPosition; // Returns a THREE.Vector3 with the camera's world position
}
function buildAnimation(){
        //var sceneEl = document.querySelector('a-scene');
        //const entity = sceneEl.querySelectorAll('.propeller');
        model = document.getElementById('selectedModel').value;
        var anim = {};
       anim.property = document.getElementById('property').value;

       anim.delay = document.getElementById('delay').value;
       anim.autoplay = document.getElementById('autoplay').value;
       anim.startEvents = document.getElementById('startEvents').value;
       anim.pauseEvents = document.getElementById('pauseEvents').value;
       anim.resumeEvents = document.getElementById('resumeEvents').value;

       anim.loop = document.getElementById('loop').value;
       anim.enabled = document.getElementById('enabled').value;
       anim.dir = document.getElementById('dir').value;
       anim.from = document.getElementById('from').value;
       anim.to = document.getElementById('to').value;
        anim.dur = document.getElementById('dur').value;
        anim.easing = document.getElementById('easing').value;

    //alert(document.getElementById('selectedModel').value);
    jsonanim = JSON.stringify(anim);
    const newStr = jsonanim.replace(/,/g, ";");
    const newStr2 = newStr.replace(/"/g, "");
    const newStr3 = newStr2.replace(/{/g, "");
    const newStr4= newStr3.replace(/}/g, "");
    document.getElementById('selectedAnim').value = newStr4;
        //console.log(entity);
       //const mod = sceneEl.querySelector('#' + model);
        
            //console.log(props.item(i));
           // mod.setAttribute('animation', anim);
            
        
      }


      function setFrom(){
        var pos = getCameraPosition();
        document.getElementById('from').value = pos.x + ' ' + pos.y + ' ' + pos.z;
        //console.log(pos);
      }


      function setTo(){
        var pos = getCameraPosition();
        document.getElementById('to').value = pos.x + ' ' + pos.y + ' ' + pos.z;
        //console.log(pos);
      }

      // Function to emit an A-Frame event on a specified entity
function emitAFrameEvent(entityOrSelector, eventName, eventData = {}) {
    let entity;
    if (typeof entityOrSelector === 'string') {
        entity = document.querySelector(entityOrSelector);
    } else {
        entity = entityOrSelector;
    }

    if (!entity) {
        console.error(`Entity not found for selector: ${entityOrSelector}`);
        return false;
    }

    const event = new CustomEvent(eventName, {
        detail: eventData,
        bubbles: true
    });

    entity.dispatchEvent(event);
    console.log(`Emitted event '${eventName}' on entity with data:`, eventData);
    return true;
}

function testEmitEvent() {
    var sceneEl = document.querySelector('a-scene');
    const props = sceneEl.querySelectorAll('.propeller');
    for (let i = 0; i < props.length; i++) {
       // 
        //props.item(i).setAttribute('position', {x: 1, y: 2, z: -3})
         emitAFrameEvent(props.item(i), 'stopdrone', null);
        
    }
 
       

    
}
function emitEvent(id,event) {
    var sceneEl = document.querySelector('a-scene');
    const props = sceneEl.querySelectorAll(id);
    for (let i = 0; i < props.length; i++) {
       // 
        //props.item(i).setAttribute('position', {x: 1, y: 2, z: -3})
         emitAFrameEvent(props.item(i), event, null);
        
    }
 
       

    
}
AFRAME.registerComponent('collider-check', {
    dependencies: ['raycaster'],
  
    init: function () {
  
      this.el.addEventListener('raycaster-intersection', function (evt) {
        console.log('Player hit something!');
        ;
 console.log(evt.detail.els[0].id);
      });


    }
  });