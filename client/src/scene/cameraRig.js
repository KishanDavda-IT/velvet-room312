import * as THREE from 'three';
import { SEATS, EYE_HEIGHT } from '../constants.js';

const DEG2RAD = Math.PI / 180;
const MAX_YAW = 180 * DEG2RAD;
const MIN_PITCH = -25 * DEG2RAD;
const MAX_PITCH = 30 * DEG2RAD;
const MIN_FOV = 40;
const MAX_FOV = 75;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export function createCameraRig({ camera, canvas }) {
  camera.rotation.order = 'YXZ';

  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;

  let orbitMode = false;
  let firstPerson = false;
  let orbitAngle = 0;
  let seatTween = null;
  let followTarget = null;

  // Pointer drag + pinch state
  const activePointers = new Map();
  let lastDragPos = null;
  let lastPinchDist = null;

  function getSeatCameraPos(seatIndex) {
    const seat = SEATS[seatIndex] || SEATS[0];
    const [sx, sy, sz] = seat.pos;
    return new THREE.Vector3(sx, sy + EYE_HEIGHT, sz + 0.1);
  }

  function snapToSeat(seatIndex) {
    orbitMode = false;
    firstPerson = false;
    seatTween = null;
    followTarget = null;
    const pos = getSeatCameraPos(seatIndex);
    camera.position.copy(pos);
    yaw = 0;
    pitch = 0;
    targetYaw = 0;
    targetPitch = 0;
    camera.rotation.set(0, 0, 0, 'YXZ');
  }

  function moveToSeat(seatIndex) {
    orbitMode = false;
    const targetPos = getSeatCameraPos(seatIndex);
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    targetYaw = 0;
    targetPitch = 0;

    if (reducedMotion) {
      seatTween = null;
      camera.position.copy(targetPos);
      yaw = 0;
      pitch = 0;
      camera.rotation.set(0, 0, 0, 'YXZ');
      return;
    }

    seatTween = {
      from: camera.position.clone(),
      to: targetPos,
      start: performance.now(),
      duration: 800,
    };
  }

  function setOrbitMode(enabled) {
    orbitMode = Boolean(enabled);
    if (orbitMode) {
      firstPerson = false;
      seatTween = null;
      followTarget = null;
      camera.fov = 60;
      camera.updateProjectionMatrix();
    }
  }

  function setFollowTarget(getPosition) {
    followTarget = typeof getPosition === 'function' ? getPosition : null;
    if (followTarget) {
      orbitMode = false;
      seatTween = null;
    }
  }

  function setFirstPerson(enabled) {
    firstPerson = Boolean(enabled);
    seatTween = null;
    return firstPerson;
  }

  function onPointerDown(e) {
    if (orbitMode) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
      lastDragPos = { x: e.clientX, y: e.clientY };
      lastPinchDist = null;
    } else if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      lastDragPos = null;
    }
  }

  function onPointerMove(e) {
    if (orbitMode || !activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1 && lastDragPos) {
      const dx = e.clientX - lastDragPos.x;
      const dy = e.clientY - lastDragPos.y;
      lastDragPos = { x: e.clientX, y: e.clientY };

      targetYaw = clamp(targetYaw - dx * 0.004, -MAX_YAW, MAX_YAW);
      targetPitch = clamp(targetPitch - dy * 0.004, MIN_PITCH, MAX_PITCH);
    } else if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchDist !== null) {
        const delta = lastPinchDist - dist;
        camera.fov = clamp(camera.fov + delta * 0.08, MIN_FOV, MAX_FOV);
        camera.updateProjectionMatrix();
      }
      lastPinchDist = dist;
    }
  }

  function onPointerUpOrCancel(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      lastDragPos = { x: remaining.x, y: remaining.y };
      lastPinchDist = null;
    } else if (activePointers.size === 0) {
      lastDragPos = null;
      lastPinchDist = null;
    }
  }

  function onWheel(e) {
    if (orbitMode) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (dir === 0) return;
    camera.fov = clamp(camera.fov + dir * 2, MIN_FOV, MAX_FOV);
    camera.updateProjectionMatrix();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUpOrCancel);
  window.addEventListener('pointercancel', onPointerUpOrCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const orbitTarget = new THREE.Vector3(0, 3, -4);

  function update(dt, now) {
    if (orbitMode) {
      orbitAngle += 0.1 * dt;
      const radius = 14;
      const height = 4.5;
      camera.position.set(
        Math.sin(orbitAngle) * radius,
        height,
        Math.cos(orbitAngle) * radius
      );
      camera.lookAt(orbitTarget);
      return;
    }

    if (seatTween && !followTarget) {
      const elapsed = now - seatTween.start;
      const t = Math.min(Math.max(elapsed / seatTween.duration, 0), 1);
      const eased = easeInOutCubic(t);
      camera.position.lerpVectors(seatTween.from, seatTween.to, eased);
      if (t >= 1) {
        seatTween = null;
      }
    }

    yaw += (targetYaw - yaw) * 0.15;
    pitch += (targetPitch - pitch) * 0.15;

    if (followTarget) {
      const target = followTarget();
      if (target) {
        if (firstPerson) {
          camera.position.set(target.x, target.y + 1.76, target.z - 0.06);
          camera.rotation.set(pitch, yaw, 0, 'YXZ');
          return;
        }
        const xDirection = Math.sin(yaw);
        const zDirection = Math.cos(yaw);
        let distance = 3.8;
        if (xDirection > 0) distance = Math.min(distance, (7.65 - target.x) / xDirection);
        if (xDirection < 0) distance = Math.min(distance, (-7.65 - target.x) / xDirection);
        if (zDirection > 0) distance = Math.min(distance, (9.65 - target.z) / zDirection);
        if (zDirection < 0) distance = Math.min(distance, (-9.65 - target.z) / zDirection);
        distance = Math.max(0.35, distance);
        camera.position.set(
          target.x + xDirection * distance,
          target.y + 2.35,
          target.z + zDirection * distance
        );
        const lookDown = Math.atan2(0.95, distance);
        camera.rotation.set(clamp(lookDown + pitch, -0.35, 0.75), yaw, 0, 'YXZ');
        return;
      }
    }

    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  return {
    snapToSeat,
    moveToSeat,
    setOrbitMode,
    setFollowTarget,
    setFirstPerson,
    isFirstPerson() { return firstPerson; },
    getYaw() {
      return yaw;
    },
    update,
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUpOrCancel);
      window.removeEventListener('pointercancel', onPointerUpOrCancel);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
