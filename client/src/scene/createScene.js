import * as THREE from 'three';

export function createScene(container = document.getElementById('app')) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(0x0a0610);

  const canvas = renderer.domElement;
  canvas.classList.add('scene-canvas');
  container.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0610, 18, 32);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    60
  );

  // Lights
  const ambientLight = new THREE.AmbientLight(0x81708f, 0.68);
  scene.add(ambientLight);

  const ceilingFill = new THREE.DirectionalLight(0xffe5c2, 1.25);
  ceilingFill.position.set(-2, 9, 3);
  scene.add(ceilingFill);

  const screenLight = new THREE.PointLight(0x9fb4ff, 6, 22, 2);
  screenLight.position.set(0, 3.6, -9.0);
  scene.add(screenLight);

  const sconcePositions = [
    [-7.5, 3, -4],
    [7.5, 3, -4],
    [-7.5, 3, 4],
    [7.5, 3, 4],
  ];
  const sconceLights = sconcePositions.map(([x, y, z]) => {
    const light = new THREE.PointLight(0xffb36b, 5.5, 13, 1.7);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  });

  const ceilingLights = [
    [-4.5, 6.2, -2],
    [4.5, 6.2, -2],
    [-4.5, 6.2, 5.5],
    [4.5, 6.2, 5.5],
  ].map(([x, y, z]) => {
    const light = new THREE.PointLight(0xffd2a0, 3.2, 11, 1.8);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  });

  const roomLights = [ambientLight, ceilingFill, ...sconceLights, ...ceilingLights];
  let roomLightsEnabled = true;

  function setRoomLightsEnabled(enabled) {
    roomLightsEnabled = Boolean(enabled);
    // Keep a low cinematic fill in the room so the chairs and players remain visible.
    ambientLight.intensity = roomLightsEnabled ? 0.68 : 0.34;
    ceilingFill.intensity = roomLightsEnabled ? 1.25 : 0.08;
    sconceLights.forEach((light) => { light.intensity = roomLightsEnabled ? 5.5 : 0.55; });
    ceilingLights.forEach((light) => { light.intensity = roomLightsEnabled ? 3.2 : 0.18; });
    roomLights.forEach((light) => { light.visible = true; });
    return roomLightsEnabled;
  }

  function toggleRoomLights() {
    return setRoomLightsEnabled(!roomLightsEnabled);
  }

  const tickHandlers = new Set();
  let lastTime = performance.now();

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener('resize', onResize);

  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    for (const fn of tickHandlers) {
      fn(dt, now);
    }
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(tick);

  return {
    renderer,
    canvas,
    scene,
    camera,
    screenLight,
    sconceLights,
    ceilingLights,
    setRoomLightsEnabled,
    toggleRoomLights,
    areRoomLightsEnabled() {
      return roomLightsEnabled;
    },
    onTick(fn) {
      tickHandlers.add(fn);
      return () => tickHandlers.delete(fn);
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      renderer.setAnimationLoop(null);
      tickHandlers.clear();
      renderer.dispose();
      canvas.remove();
    },
  };
}
