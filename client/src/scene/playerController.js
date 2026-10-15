const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright']);

function floorHeight(x, z) {
  return z >= 1.25 && z <= 4.75 && Math.abs(x) <= 6 ? 0.5 : 0;
}

function smoothAngle(from, to, maxStep) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-maxStep, Math.min(maxStep, delta));
}

const MOVE_SPEED = 2.8;
const SEND_INTERVAL_MS = 60;

export function createPlayerController({ getPosition, getViewYaw, onMove }) {
  const keys = new Set();
  let lastSendAt = 0;
  let wasMoving = false;
  let facing = 0;

  function isTyping() {
    const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || active?.isContentEditable;
  }

  function onKeyDown(event) {
    const key = event.key.toLowerCase();
    if (!MOVE_KEYS.has(key) || isTyping()) return;
    event.preventDefault();
    keys.add(key);
  }

  function stopMovement() {
    keys.clear();
    if (!wasMoving) return;
    const current = getPosition();
    if (current) onMove({ ...current, moving: false }, true);
    wasMoving = false;
    lastSendAt = performance.now();
  }

  function onKeyUp(event) {
    keys.delete(event.key.toLowerCase());
    if (keys.size === 0) stopMovement();
  }

  function clearKeys() {
    stopMovement();
  }

  function onVisibilityChange() {
    if (document.hidden) clearKeys();
  }

  function onFocusIn() {
    if (isTyping()) clearKeys();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', clearKeys);
  window.addEventListener('pointercancel', clearKeys);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('focusin', onFocusIn);

  function update(dt, now) {
    if (isTyping()) clearKeys();
    const current = getPosition();
    if (!current) return;

    const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
    const strafe = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    const length = Math.hypot(forward, strafe);
    const moving = length > 0;
    let next = { ...current, moving };

    if (moving) {
      const yaw = getViewYaw();
      const amount = MOVE_SPEED * Math.min(dt, 0.05) / length;
      const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * amount;
      const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * amount;
      next.x = Math.min(7.2, Math.max(-7.2, current.x + dx));
      next.z = Math.min(9.2, Math.max(-9.2, current.z + dz));
      next.y = floorHeight(next.x, next.z);
      const desiredFacing = Math.atan2(dx, -dz);
      facing = smoothAngle(facing, desiredFacing, 7.5 * Math.min(dt, 0.05));
      next.yaw = facing;
    }

    if (moving || wasMoving) {
      const shouldBroadcast = moving
        ? !wasMoving || now - lastSendAt >= SEND_INTERVAL_MS
        : wasMoving;
      onMove(next, shouldBroadcast);
      if (shouldBroadcast) {
        lastSendAt = now;
        wasMoving = moving;
      }
    }
  }

  return {
    update,
    stop: stopMovement,
    resetFacing(yaw = 0) {
      facing = Number.isFinite(yaw) ? yaw : 0;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', clearKeys);
      window.removeEventListener('pointercancel', clearKeys);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('focusin', onFocusIn);
      clearKeys();
    },
  };
}
