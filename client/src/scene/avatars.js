import * as THREE from 'three';
import { SEATS } from '../constants.js';

function truncateName(name, maxLen = 12) {
  if (!name) return '';
  return name.length > maxLen ? `${name.slice(0, maxLen)}…` : name;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createNameTagTexture(name, isHost) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(10, 6, 16, 0.8)';
    drawRoundedRect(ctx, 4, 6, 248, 52, 16);
    ctx.fill();

    const shortName = truncateName(name, 12);
    ctx.font = '600 28px "Inter", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    if (isHost) {
      const prefix = '★ ';
      const prefixW = ctx.measureText(prefix).width;
      const nameW = ctx.measureText(shortName).width;
      const startX = (256 - prefixW - nameW) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#d4a24c';
      ctx.fillText(prefix, startX, 32);
      ctx.fillStyle = '#f4ecdc';
      ctx.fillText(shortName, startX + prefixW, 32);
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f4ecdc';
      ctx.fillText(shortName, 128, 32);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function seatPosition(seatIndex) {
  const seat = SEATS[seatIndex] || SEATS[0];
  return { x: seat.pos[0], y: seat.pos[1], z: seat.pos[2], yaw: 0, moving: false };
}

function normalizePosition(position, fallback) {
  return {
    x: Number.isFinite(position?.x) ? position.x : fallback.x,
    y: Number.isFinite(position?.y) ? position.y : fallback.y,
    z: Number.isFinite(position?.z) ? position.z : fallback.z,
    yaw: Number.isFinite(position?.yaw) ? position.yaw : fallback.yaw,
    moving: Boolean(position?.moving),
  };
}

export function buildAvatars(scene) {
  const root = new THREE.Group();
  root.name = 'AvatarsRoot';
  scene.add(root);

  const avatars = new Map();

  function upsertAvatar(peer, selfId) {
    if (!peer) return;
    const isSelf = peer.id === selfId;
    const fallback = seatPosition(peer.seat);
    const position = normalizePosition(peer.position, fallback);

    if (avatars.has(peer.id)) {
      const existing = avatars.get(peer.id);
      existing.isSelf = isSelf;
      if (existing.seat !== peer.seat && !peer.position) {
        moveAvatarToSeat(peer.id, peer.seat);
      }
      if (peer.position) setAvatarPosition(peer.id, peer.position, { immediate: true });
      if (existing.isHost !== peer.isHost || existing.name !== peer.name) {
        existing.isHost = peer.isHost;
        existing.name = peer.name;
        const oldTexture = existing.spriteMat.map;
        existing.spriteMat.map = createNameTagTexture(peer.name, peer.isHost);
        existing.spriteMat.needsUpdate = true;
        oldTexture?.dispose();
      }
      return;
    }

    const group = new THREE.Group();
    group.name = `Player-${peer.id}`;
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = position.yaw;

    const shirtMat = new THREE.MeshStandardMaterial({
      color: peer.color || '#e8a33d',
      roughness: 0.84,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xf1c27d,
      roughness: 0.88,
    });
    const pantsColor = new THREE.Color(peer.color || '#e8a33d').multiplyScalar(0.48);
    const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x29202a, roughness: 0.8 });
    const materials = [shirtMat, skinMat, pantsMat, faceMat];
    const geometries = [];

    function mesh(geometry, material, parent, x, y, z) {
      geometries.push(geometry);
      const part = new THREE.Mesh(geometry, material);
      part.position.set(x, y, z);
      part.castShadow = true;
      part.receiveShadow = true;
      parent.add(part);
      return part;
    }

    const pose = new THREE.Group();
    group.add(pose);

    // Classic blocky R6 proportions: squared head, torso and jointed limbs.
    mesh(new THREE.BoxGeometry(0.82, 0.84, 0.42), shirtMat, pose, 0, 1.2, 0);
    mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), skinMat, pose, 0, 1.94, 0);
    mesh(new THREE.BoxGeometry(0.075, 0.085, 0.026), faceMat, pose, -0.135, 1.99, -0.315);
    mesh(new THREE.BoxGeometry(0.075, 0.085, 0.026), faceMat, pose, 0.135, 1.99, -0.315);
    mesh(new THREE.BoxGeometry(0.19, 0.025, 0.026), faceMat, pose, 0, 1.81, -0.315);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.49, 1.56, 0);
    pose.add(leftArm);
    mesh(new THREE.BoxGeometry(0.32, 0.76, 0.35), skinMat, leftArm, 0, -0.38, 0);
    mesh(new THREE.BoxGeometry(0.32, 0.24, 0.35), skinMat, leftArm, 0, -0.85, 0);

    const rightArm = new THREE.Group();
    rightArm.position.set(0.49, 1.56, 0);
    pose.add(rightArm);
    mesh(new THREE.BoxGeometry(0.32, 0.76, 0.35), skinMat, rightArm, 0, -0.38, 0);
    mesh(new THREE.BoxGeometry(0.32, 0.24, 0.35), skinMat, rightArm, 0, -0.85, 0);

    const cupGroup = new THREE.Group();
    cupGroup.position.set(0, -0.86, -0.04);
    cupGroup.visible = false;
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xb8dfe4, roughness: 0.22, transparent: true, opacity: 0.55 });
    const drinkMat = new THREE.MeshStandardMaterial({ color: 0xd87935, roughness: 0.38 });
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xf4ecdc, roughness: 0.5 });
    const cupShell = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.075, 0.24, 14, 1, true), cupMat);
    cupShell.position.y = 0.12;
    const drink = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.1, 12), drinkMat);
    drink.position.y = 0.07;
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8), strawMat);
    straw.position.set(0.03, 0.27, 0);
    straw.rotation.z = -0.12;
    cupGroup.add(cupShell, drink, straw);
    rightArm.add(cupGroup);
    materials.push(cupMat, drinkMat, strawMat);
    geometries.push(cupShell.geometry, drink.geometry, straw.geometry);

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.22, 0.8, 0);
    pose.add(leftLeg);
    mesh(new THREE.BoxGeometry(0.36, 0.7, 0.4), pantsMat, leftLeg, 0, -0.35, 0);
    mesh(new THREE.BoxGeometry(0.38, 0.18, 0.52), pantsMat, leftLeg, 0, -0.71, -0.055);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.22, 0.8, 0);
    pose.add(rightLeg);
    mesh(new THREE.BoxGeometry(0.36, 0.7, 0.4), pantsMat, rightLeg, 0, -0.35, 0);
    mesh(new THREE.BoxGeometry(0.38, 0.18, 0.52), pantsMat, rightLeg, 0, -0.71, -0.055);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.38, 24),
      new THREE.MeshBasicMaterial({ color: 0x050308, transparent: true, opacity: 0.36, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    group.add(shadow);
    materials.push(shadow.material);
    geometries.push(shadow.geometry);

    const tagTex = createNameTagTexture(peer.name, peer.isHost);
    const spriteMat = new THREE.SpriteMaterial({ map: tagTex, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.25, 0.31, 1);
    sprite.position.set(0, 2.64, 0);
    sprite.renderOrder = 10;
    group.add(sprite);

    root.add(group);
    avatars.set(peer.id, {
      id: peer.id,
      name: peer.name,
      isHost: peer.isHost,
      isSelf,
      seat: peer.seat,
      group,
      pose,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      cupGroup,
      materials,
      geometries,
      spriteMat,
      target: { ...position },
      moving: position.moving,
      phase: Math.random() * Math.PI * 2,
      drinkStartedAt: 0,
      drinkUntil: 0,
    });
  }

  function setAvatarPosition(peerId, rawPosition, { immediate = false } = {}) {
    const entry = avatars.get(peerId);
    if (!entry) return;
    const position = normalizePosition(rawPosition, entry.target);
    entry.seat = Number.isInteger(rawPosition?.seat) ? rawPosition.seat : entry.seat;
    entry.target = position;
    entry.moving = position.moving;
    if (immediate || entry.isSelf) {
      entry.group.position.set(position.x, position.y, position.z);
      entry.group.rotation.y = position.yaw;
    }
  }

  function getAvatarPosition(peerId) {
    const entry = avatars.get(peerId);
    if (!entry) return null;
    return {
      x: entry.group.position.x,
      y: entry.group.position.y,
      z: entry.group.position.z,
      yaw: entry.group.rotation.y,
      moving: entry.moving,
    };
  }

  function setAvatarVisible(peerId, visible) {
    const entry = avatars.get(peerId);
    if (!entry) return;
    entry.group.visible = Boolean(visible);
  }

  function drinkAvatar(peerId) {
    const entry = avatars.get(peerId);
    if (!entry) return false;
    const now = performance.now();
    entry.drinkStartedAt = now;
    entry.drinkUntil = now + 1800;
    entry.cupGroup.visible = true;
    return true;
  }

  function moveAvatarToSeat(peerId, seatIndex) {
    const entry = avatars.get(peerId);
    if (!entry) return;
    const position = { ...seatPosition(seatIndex), seat: seatIndex };
    entry.seat = seatIndex;
    setAvatarPosition(peerId, position);
  }

  function removeAvatar(peerId) {
    const entry = avatars.get(peerId);
    if (!entry) return;
    root.remove(entry.group);
    entry.geometries.forEach((geometry) => geometry.dispose());
    entry.materials.forEach((material) => material.dispose());
    entry.spriteMat.map?.dispose();
    entry.spriteMat.dispose();
    avatars.delete(peerId);
  }

  function getPeerHeadPosition(peerId) {
    const entry = avatars.get(peerId);
    if (!entry) return null;
    return new THREE.Vector3(
      entry.group.position.x,
      entry.group.position.y + 1.94,
      entry.group.position.z
    );
  }

  function update(dt, now = performance.now()) {
    for (const entry of avatars.values()) {
      if (!entry.isSelf) {
        const blend = 1 - Math.exp(-10 * dt);
        entry.group.position.x += (entry.target.x - entry.group.position.x) * blend;
        entry.group.position.y += (entry.target.y - entry.group.position.y) * blend;
        entry.group.position.z += (entry.target.z - entry.group.position.z) * blend;
        const angleDelta = Math.atan2(
          Math.sin(entry.target.yaw - entry.group.rotation.y),
          Math.cos(entry.target.yaw - entry.group.rotation.y)
        );
        entry.group.rotation.y += angleDelta * blend;
      }

      entry.phase += dt * (entry.moving ? 8 : 2.2);
      const stride = entry.moving ? Math.sin(entry.phase) * 0.4 : Math.sin(entry.phase) * 0.025;
      entry.leftLeg.rotation.x = stride;
      entry.rightLeg.rotation.x = -stride;
      entry.leftArm.rotation.x = -stride * 0.62;
      let drinkPose = 0;
      if (entry.drinkUntil > now) {
        const progress = (now - entry.drinkStartedAt) / (entry.drinkUntil - entry.drinkStartedAt);
        drinkPose = Math.min(1, progress / 0.18, (1 - progress) / 0.18);
        drinkPose = Math.max(0, drinkPose);
      } else if (entry.cupGroup.visible) {
        entry.cupGroup.visible = false;
      }
      entry.rightArm.rotation.x = stride * 0.62 + drinkPose * 2.1;
      entry.rightArm.rotation.z = -drinkPose * 0.08;
      entry.cupGroup.rotation.x = -drinkPose * 2.1;
      entry.pose.position.y = entry.moving ? Math.abs(Math.sin(entry.phase * 2)) * 0.045 : 0;
    }
  }

  function clear() {
    for (const id of Array.from(avatars.keys())) removeAvatar(id);
  }

  return {
    root,
    upsertAvatar,
    setAvatarPosition,
    getAvatarPosition,
    setAvatarVisible,
    drinkAvatar,
    moveAvatarToSeat,
    removeAvatar,
    getPeerHeadPosition,
    update,
    clear,
  };
}
