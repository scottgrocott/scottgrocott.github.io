AFRAME.registerComponent('drone_func', {
    schema: {
      bar: {type: 'number'},
      baz: {type: 'string'}
    },
  
    init: function () {
      // Do something when component first attached.
      //console.log(this.el.querySelectorAll('.propeller'));
      const props = this.el.querySelectorAll('.propeller');
        for (let i = 0; i < props.length; i++) {
           // 
            //props.item(i).setAttribute('position', {x: 1, y: 2, z: -3})
            props.item(i).setAttribute('animation', 'pauseEvents: stopdrone;resumeEvents: resumedrone;dur: 120; easing: linear; enabled:true;loop: true; property: rotation; to: 0 360 0');
           // console.log(props.item(i));
        }
      //this.el.querySelectorAll('.propeller').setAttribute('position', {x: 1, y: 2, z: -3});
    },
  
    update: function () {
      // Do something when component's data is updated.
    },
  
    remove: function () {
      // Do something when the component or its entity is detached.
    },
  
    tick: function (time, timeDelta) {
      // Do something on every scene tick or frame.
    }
  });


  function stopAnimation(){
    var sceneEl = document.querySelector('a-scene');
    const entity = sceneEl.querySelectorAll('a-camera');
    entity.emit(`stopdrone`, null, false);
    console.log('made it');
    /* */
    //const props = sceneEl.querySelectorAll('.propeller');
    //for (let i = 0; i < props.length; i++) {
        //console.log(props.item(i));
        //props.item(i).setAttribute('animation', 'enabled:false;')
        
    //}
  }
   
  function startAnimation(){
    var sceneEl = document.querySelector('a-scene');
    //const entity = sceneEl.querySelectorAll('.propeller');

    //console.log(entity);
    const props = sceneEl.querySelectorAll('.propeller');
    for (let i = 0; i < props.length; i++) {
        //console.log(props.item(i));
        props.item(i).setAttribute('animation', 'enabled:true;')
        
    }
  }

  function startPatrol(){
    var sceneEl = document.querySelector('a-scene');
    //const entity = sceneEl.querySelectorAll('.propeller');

    //console.log(entity);
    const props = sceneEl.querySelector('#drone_wrapper');
    //const props = sceneEl.querySelector('#gocart');
    
        //console.log(props.item(i));
        props.setAttribute('animation', 'property: position; to: 1 8 -10; dur: 10000; easing: easeInOutQuad; loop: true;dir:alternate;');
        
    
  }
  AFRAME.registerComponent('button-listener', {
    init: function () {
      const button = document.getElementById('thetest');
      var sceneEl = document.querySelector('a-scene');
      const entity = sceneEl.querySelector('.propeller');
  


      button.addEventListener('click', function () {
        console.log('hit button');
        const props = sceneEl.querySelectorAll('.propeller');
        for (let i = 0; i < entity.length; i++) {
            //console.log(props.item(i));
            props.item(i).removeAttribute('animation', '')
        }
      });
    }
  });