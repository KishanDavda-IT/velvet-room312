import * as THREE from 'three';
import { SCREEN, STATUS_TEXT } from '../constants.js';

export function buildScreen({ scene, screenLight }) {
  // 1280x720 idle canvas
  const idleCanvas = document.createElement('canvas');
  idleCanvas.width = 1280;
  idleCanvas.height = 720;
  const idleCtx = idleCanvas.getContext('2d');

  const idleTexture = new THREE.CanvasTexture(idleCanvas);
  idleTexture.colorSpace = THREE.SRGBColorSpace;
  idleTexture.minFilter = THREE.LinearFilter;
  idleTexture.magFilter = THREE.LinearFilter;

  const geometry = new THREE.PlaneGeometry(SCREEN.W, SCREEN.H);
  const material = new THREE.MeshBasicMaterial({
    map: idleTexture,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...SCREEN.CENTER);
  scene.add(mesh);

  let currentStatus = STATUS_TEXT.WAITING;
  let activeVideo = null;
  let liveTexture = null;

  function drawIdleCanvas() {
    if (!idleCtx) return;
    const w = idleCanvas.width;
    const h = idleCanvas.height;

    idleCtx.fillStyle = '#0a0610';
    idleCtx.fillRect(0, 0, w, h);

    // Radial vignette (center transparent -> edges rgba(0,0,0,.6))
    const grad = idleCtx.createRadialGradient(w / 2, h / 2, h * 0.15, w / 2, h / 2, w * 0.65);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    idleCtx.fillStyle = grad;
    idleCtx.fillRect(0, 0, w, h);

    // Centered title "Velvet Room" in italic 700 96px "Playfair Display" color #d4a24c at y=300
    idleCtx.textAlign = 'center';
    idleCtx.textBaseline = 'middle';
    idleCtx.fillStyle = '#d4a24c';
    idleCtx.font = 'italic 700 96px "Playfair Display", Georgia, serif';
    idleCtx.fillText('Velvet Room', w / 2, 300);

    // Current status string in 500 32px Inter color #8b8296 at y=380
    idleCtx.fillStyle = '#8b8296';
    idleCtx.font = '500 32px "Inter", system-ui, sans-serif';
    idleCtx.fillText(currentStatus || '', w / 2, 380);

    idleTexture.needsUpdate = true;
  }

  // Wait for Playfair Display before first draw, with immediate fallback
  drawIdleCanvas();
  if (typeof document !== 'undefined' && document.fonts?.load) {
    document.fonts
      .load('italic 700 96px "Playfair Display"')
      .then(() => {
        drawIdleCanvas();
      })
      .catch(() => {
        drawIdleCanvas();
      });
  }

  function updateAspectFit() {
    if (!activeVideo || !activeVideo.videoWidth || !activeVideo.videoHeight) {
      mesh.scale.set(1, 1, 1);
      return;
    }
    const a = activeVideo.videoWidth / activeVideo.videoHeight;
    const target = 16 / 9;
    mesh.scale.set(1, 1, 1);
    if (a >= target) {
      liveTexture.repeat.set(target / a, 1);
      liveTexture.offset.set((1 - target / a) / 2, 0);
    } else {
      liveTexture.repeat.set(1, a / target);
      liveTexture.offset.set(0, (1 - a / target) / 2);
    }
    liveTexture.needsUpdate = true;
  }

  function resetGlowToIdle() {
    if (screenLight) {
      screenLight.color.setHex(0x9fb4ff);
      screenLight.intensity = 6;
    }
  }

  function setSource(videoEl) {
    if (activeVideo === videoEl) return;

    if (activeVideo) {
      activeVideo.removeEventListener('loadedmetadata', updateAspectFit);
      activeVideo.removeEventListener('resize', updateAspectFit);
    }

    const previousTexture = liveTexture;
    liveTexture = null;

    activeVideo = videoEl || null;

    if (activeVideo) {
      liveTexture = new THREE.VideoTexture(activeVideo);
      liveTexture.colorSpace = THREE.SRGBColorSpace;
      liveTexture.minFilter = THREE.LinearFilter;
      liveTexture.magFilter = THREE.LinearFilter;
      liveTexture.generateMipmaps = false;

      activeVideo.addEventListener('loadedmetadata', updateAspectFit);
      activeVideo.addEventListener('resize', updateAspectFit);
      updateAspectFit();

      material.map = liveTexture;
      material.needsUpdate = true;
    } else {
      mesh.scale.set(1, 1, 1);
      material.map = idleTexture;
      material.needsUpdate = true;
      drawIdleCanvas();
      resetGlowToIdle();
    }

    previousTexture?.dispose();
  }

  function setStatus(statusText) {
    if (currentStatus === statusText) return;
    currentStatus = statusText;
    drawIdleCanvas();
  }

  // Keep the screen spill light steady. Sampling changing movie frames was making
  // the surrounding room pulse, which looked like the screen itself was blinking.
  function update() {}

  return {
    mesh,
    setSource,
    setStatus,
    update,
    dispose() {
      setSource(null);
      idleTexture.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
