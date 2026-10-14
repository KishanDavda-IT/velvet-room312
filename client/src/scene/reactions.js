import * as THREE from 'three';

const MAX_LIVE_SPRITES = 40;
const REACTION_MS = 2000;
const REACTION_REDUCED_MS = 800;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function createEmojiTexture(emoji) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 68);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buildReactions({ scene, camera, avatars, getSelfId }) {
  const group = new THREE.Group();
  group.name = 'ReactionsRoot';
  scene.add(group);

  /** @type {Array<any>} */
  const activeSprites = [];

  function disposeEntry(entry) {
    group.remove(entry.sprite);
    entry.material.map?.dispose();
    entry.material.dispose();
  }

  function spawnReaction(peerId, emoji) {
    while (activeSprites.length >= MAX_LIVE_SPRITES) {
      const oldest = activeSprites.shift();
      if (oldest) disposeEntry(oldest);
    }

    let spawnPos;
    const selfId = getSelfId();

    if (peerId === selfId) {
      // 0.8 m in front of the camera, slightly below center
      const forward = new THREE.Vector3(0, -0.15, -0.8);
      forward.applyQuaternion(camera.quaternion);
      spawnPos = camera.position.clone().add(forward);
    } else {
      const headPos = avatars.getPeerHeadPosition(peerId);
      if (!headPos) return;
      spawnPos = headPos.clone().add(new THREE.Vector3(0, 0.6, 0));
    }

    const texture = createEmojiTexture(emoji);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.5, 0.5, 0.5);
    sprite.position.copy(spawnPos);
    sprite.renderOrder = 15;
    group.add(sprite);

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    activeSprites.push({
      sprite,
      material,
      startX: spawnPos.x,
      startY: spawnPos.y,
      startZ: spawnPos.z,
      startTime: performance.now(),
      duration: reducedMotion ? REACTION_REDUCED_MS : REACTION_MS,
    });
  }

  function update(_dt, now) {
    for (let i = activeSprites.length - 1; i >= 0; i--) {
      const item = activeSprites[i];
      const elapsed = now - item.startTime;
      const t = Math.min(Math.max(elapsed / item.duration, 0), 1);

      item.sprite.position.y = item.startY + 1.6 * easeOutCubic(t);
      item.sprite.position.x = item.startX + 0.15 * Math.sin(t * 6);
      item.material.opacity = Math.max(0, 1 - t * t);

      if (t >= 1) {
        disposeEntry(item);
        activeSprites.splice(i, 1);
      }
    }
  }

  function clear() {
    while (activeSprites.length > 0) {
      const item = activeSprites.pop();
      if (item) disposeEntry(item);
    }
  }

  return {
    spawnReaction,
    update,
    clear,
  };
}
