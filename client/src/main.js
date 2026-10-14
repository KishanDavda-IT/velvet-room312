import './styles/main.css';
import { EMOJIS, STATUS_TEXT } from './constants.js';
import { store } from './store.js';
import { initRouter, navigate } from './router.js';
import { getRoomInfo } from './api.js';
import { net } from './net.js';
import { createScene } from './scene/createScene.js';
import { buildRoom } from './scene/room.js';
import { buildSeats } from './scene/seats.js';
import { buildScreen } from './scene/screen.js';
import { buildAvatars } from './scene/avatars.js';
import { buildCompanion } from './scene/companion.js';
import { createPlayerController } from './scene/playerController.js';
import { buildReactions } from './scene/reactions.js';
import { createCameraRig } from './scene/cameraRig.js';
import { HostStreamer } from './rtc/hostStreamer.js';
import { ViewerReceiver } from './rtc/viewerReceiver.js';
import { renderLanding } from './ui/landing.js';
import { renderJoinGate, renderStatusScreen, unlockAudioGesture } from './ui/joinGate.js';
import { renderHud } from './ui/hud.js';
import { renderChat } from './ui/chat.js';
import { renderHostControls } from './ui/hostControls.js';
import { showToast } from './ui/toast.js';

const appEl = document.getElementById('app');

let sceneCtx = null;
let roomBuilder = null;
let seatsBuilder = null;
let screenBuilder = null;
let avatarsBuilder = null;
let companionBuilder = null;
let reactionsBuilder = null;
let cameraRig = null;
let playerController = null;
let requestSeatAction = null;
let requestDrinkAction = null;

let activeOverlay = null;
let activeRoomCleanup = null;

function ensure3DScene() {
  if (sceneCtx) {
    return;
  }

  sceneCtx = createScene(appEl);
  roomBuilder = buildRoom(sceneCtx.scene, {
    camera: sceneCtx.camera,
    canvas: sceneCtx.canvas,
    onDrink() {
      requestDrinkAction?.();
    },
  });
  screenBuilder = buildScreen({
    scene: sceneCtx.scene,
    screenLight: sceneCtx.screenLight,
  });
  avatarsBuilder = buildAvatars(sceneCtx.scene);
  companionBuilder = buildCompanion({
    scene: sceneCtx.scene,
    getPlayerPosition: () => avatarsBuilder.getAvatarPosition(store.selfId),
  });
  cameraRig = createCameraRig({
    camera: sceneCtx.camera,
    canvas: sceneCtx.canvas,
  });
  reactionsBuilder = buildReactions({
    scene: sceneCtx.scene,
    camera: sceneCtx.camera,
    avatars: avatarsBuilder,
    getSelfId: () => store.selfId,
  });
  seatsBuilder = buildSeats({
    scene: sceneCtx.scene,
    camera: sceneCtx.camera,
    canvas: sceneCtx.canvas,
    isSeatOccupied(seatIndex) {
      for (const peer of store.peers.values()) {
        if (peer.id !== store.selfId && peer.seat === seatIndex) return true;
      }
      return false;
    },
    async onSelectSeat(seatIndex) {
      if (requestSeatAction) return requestSeatAction(seatIndex);
      showToast('Join the room before choosing a seat.');
    },
  });

  sceneCtx.onTick((dt, now) => {
    playerController?.update(dt, now);
    cameraRig.update(dt, now);
    avatarsBuilder.update(dt, now);
    companionBuilder.update(dt);
    reactionsBuilder.update(dt, now);
    roomBuilder.update(dt, now);
    screenBuilder.update(dt, now);
  });
}

function clearCurrentView() {
  if (activeOverlay) {
    activeOverlay.destroy();
    activeOverlay = null;
  }
  if (activeRoomCleanup) {
    activeRoomCleanup();
    activeRoomCleanup = null;
  }
}

function getSavedVolume() {
  try {
    const raw = localStorage.getItem('velvet:volume');
    if (raw !== null) {
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        return Math.min(Math.max(n, 0), 1);
      }
    }
  } catch {
    // Ignore
  }
  return 0.8;
}

async function enterRoom({ roomId, name, hostKey }) {
  clearCurrentView();
  ensure3DScene();

  sceneCtx.canvas.classList.remove('blurred');
  seatsBuilder.setInteractive(true);

  const socket = net.connect();
  const joinRes = await net.emit('room:join', { roomId, name, hostKey });

  if (!joinRes || !joinRes.ok) {
    const code = joinRes?.code || 'INTERNAL';
    if (code === 'ROOM_NOT_FOUND') {
      sceneCtx.canvas.classList.add('blurred');
      cameraRig.setOrbitMode(true);
      activeOverlay = renderStatusScreen({
        container: appEl,
        title: 'Room not found',
        message: 'This cinema room has closed or never existed.',
        onGoHome: () => navigate('/'),
      });
      return joinRes;
    }
    if (code === 'ROOM_FULL') {
      sceneCtx.canvas.classList.add('blurred');
      cameraRig.setOrbitMode(true);
      activeOverlay = renderStatusScreen({
        container: appEl,
        title: 'This room is full.',
        message: 'All 8 seats in this screening are currently occupied.',
        onGoHome: () => navigate('/'),
      });
      return joinRes;
    }
    return joinRes;
  }

  // Load initial state into store
  store.loadRoomState(joinRes.state);

  // Sync 3D scene with state
  avatarsBuilder.clear();
  reactionsBuilder.clear();
  for (const peer of store.peers.values()) {
    avatarsBuilder.upsertAvatar(peer, store.selfId);
  }

  const selfPeer = store.peers.get(store.selfId);
  cameraRig.snapToSeat(selfPeer ? selfPeer.seat : 0);
  cameraRig.setFollowTarget(() => avatarsBuilder.getAvatarPosition(store.selfId));
  playerController?.dispose();
  playerController = createPlayerController({
    getPosition: () => avatarsBuilder.getAvatarPosition(store.selfId),
    getViewYaw: () => cameraRig.getYaw(),
    onMove(position, broadcast) {
      avatarsBuilder.setAvatarPosition(store.selfId, position, { immediate: true });
      if (broadcast) {
        net.send('player:move', {
          x: position.x,
          z: position.z,
          yaw: position.yaw,
          moving: position.moving,
        });
      }
    },
  });
  playerController.resetFacing(selfPeer?.position?.yaw || 0);

  let membershipReady = true;
  let membershipRecovery = null;
  let lastMembershipJoinAt = Date.now();
  let membershipFailure = '';
  async function restoreRoomMembership() {
    if (membershipReady && socket.connected) return true;
    if (membershipRecovery) return membershipRecovery;
    membershipRecovery = (async () => {
      const reAck = await net.emit('room:join', { roomId, name, hostKey });
      if (!reAck?.ok) {
        membershipFailure = reAck?.error || 'Your room connection was lost. Please rejoin.';
        return false;
      }
      membershipFailure = '';
      membershipReady = true;
      lastMembershipJoinAt = Date.now();
      store.loadRoomState(reAck.state);
      avatarsBuilder.clear();
      for (const peer of store.peers.values()) {
        avatarsBuilder.upsertAvatar(peer, store.selfId);
      }
      if (cameraRig.isFirstPerson()) avatarsBuilder.setAvatarVisible(store.selfId, false);
      cameraRig.setFollowTarget(() => avatarsBuilder.getAvatarPosition(store.selfId));
      playerController?.resetFacing(store.peers.get(store.selfId)?.position?.yaw || 0);
      return true;
    })();
    try {
      return await membershipRecovery;
    } finally {
      membershipRecovery = null;
    }
  }

  async function sendRoomAction(eventName, payload = {}) {
    let result = await net.emit(eventName, payload);
    if (result?.code === 'NOT_IN_ROOM') {
      if (membershipRecovery) {
        await membershipRecovery;
      } else if (!membershipReady || Date.now() - lastMembershipJoinAt > 1500) {
        membershipReady = false;
        await restoreRoomMembership();
      }
      if (membershipReady) result = await net.emit(eventName, payload);
      else if (membershipFailure) result = { ok: false, code: 'NOT_IN_ROOM', error: membershipFailure };
    }
    return result;
  }

  requestSeatAction = async (seatIndex) => {
    const result = await sendRoomAction('seat:take', { seatIndex });
    if (!result?.ok && result?.error) showToast(result.error);
    return result;
  };

  requestDrinkAction = async () => {
    if (!store.selfId || !store.peers.has(store.selfId)) {
      showToast('Join the room before ordering a drink.');
      return false;
    }
    return avatarsBuilder.drinkAvatar(store.selfId);
  };

  function toggleFirstPerson() {
    const enabled = cameraRig.setFirstPerson(!cameraRig.isFirstPerson());
    avatarsBuilder.setAvatarVisible(store.selfId, !enabled);
    return enabled;
  }
  roomBuilder.setCurtainsOpen(store.streaming.active);
  screenBuilder.setStatus(store.status);

  let currentVolume = getSavedVolume();
  let hostStreamer = null;
  let viewerReceiver = null;

  if (store.isHost) {
    hostStreamer = new HostStreamer({
      onLocalVideoChange(videoEl) {
        screenBuilder.setSource(videoEl);
      },
      getVolume: () => currentVolume,
    });
  } else {
    viewerReceiver = new ViewerReceiver({
      onRemoteVideoChange(videoEl) {
        screenBuilder.setSource(videoEl);
      },
      getVolume: () => currentVolume,
    });
  }

  // Render HUD, Chat, and Host Controls
  const hud = renderHud({
    container: appEl,
    initialVolume: currentVolume,
    initialLightsEnabled: sceneCtx.areRoomLightsEnabled(),
    initialFirstPerson: cameraRig.isFirstPerson(),
    onToggleLights() {
      return sceneCtx.toggleRoomLights();
    },
    onToggleCompanion() {
      return companionBuilder.toggle();
    },
    onToggleFirstPerson: toggleFirstPerson,
    onDrink: requestDrinkAction,
    onToggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    },
    onSendReaction(emoji) {
      net.emit('reaction:send', { emoji });
    },
    onVolumeChange(vol) {
      currentVolume = vol;
      if (hostStreamer?.hostVideo && store.streaming.kind === 'file') {
        hostStreamer.hostVideo.volume = vol;
      }
      if (viewerReceiver) {
        viewerReceiver.setVolume(vol);
      }
    },
  });

  const chat = renderChat({
    container: hud.hudRoot,
    onSendMessage(text) {
      return net.emit('chat:send', { text });
    },
  });

  let hostControls = null;
  if (store.isHost && hostStreamer) {
    hostControls = renderHostControls({
      container: hud.hudRoot,
      hostStreamer,
    });
  }

  // Store listeners for scene updates
  const offStoreStatus = store.on('status', (statusText) => {
    screenBuilder.setStatus(statusText);
  });

  const offStoreStreaming = store.on('streaming', ({ active }) => {
    roomBuilder.setCurtainsOpen(active);
  });

  // Socket event handlers
  const unsubSockets = [];

  unsubSockets.push(
    net.on('peer:joined', ({ peer }) => {
      if (!peer) return;
      store.peers.set(peer.id, peer);
      if (peer.isHost) {
        store.hostPresent = true;
      }
      store.emit('peers', store.peers);
      avatarsBuilder.upsertAvatar(peer, store.selfId);
      seatsBuilder.refreshHover();

      if (store.isHost && hostStreamer && store.streaming.active) {
        hostStreamer.onViewerJoined(peer.id);
      }
    })
  );

  unsubSockets.push(
    net.on('peer:left', ({ id }) => {
      if (!id) return;
      store.peers.delete(id);
      store.emit('peers', store.peers);
      avatarsBuilder.removeAvatar(id);
      seatsBuilder.refreshHover();

      if (store.isHost && hostStreamer) {
        hostStreamer.onViewerLeft(id);
      }
    })
  );

  unsubSockets.push(
    net.on('seat:updated', ({ id, seat, position }) => {
      const peer = store.peers.get(id);
      if (peer) {
        peer.seat = seat;
        if (position) peer.position = position;
        store.emit('peers', store.peers);
      }
      seatsBuilder.refreshHover();
      if (position) {
        avatarsBuilder.setAvatarPosition(id, position, { immediate: id === store.selfId });
      } else {
        avatarsBuilder.moveAvatarToSeat(id, seat);
      }
      if (id === store.selfId) playerController?.resetFacing(position?.yaw || 0);
    })
  );

  unsubSockets.push(
    net.on('player:moved', ({ id, position }) => {
      if (!id || !position || id === store.selfId) return;
      const peer = store.peers.get(id);
      if (peer) peer.position = position;
      avatarsBuilder.setAvatarPosition(id, position);
    })
  );

  unsubSockets.push(
    net.on('chat:message', (msg) => {
      store.chat.push(msg);
      store.emit('chat', msg);
      chat.appendMessage(msg);
    })
  );

  unsubSockets.push(
    net.on('reaction', ({ id, emoji }) => {
      reactionsBuilder.spawnReaction(id, emoji);
    })
  );

  unsubSockets.push(
    net.on('stream:started', ({ kind }) => {
      store.hostPresent = true;
      store.setStreaming({ active: true, kind });
      if (store.isHost) {
        store.setStatus(STATUS_TEXT.LIVE);
      } else if (viewerReceiver) {
        store.setStatus(STATUS_TEXT.CONNECTING);
        viewerReceiver.startWatchdog();
      }
    })
  );

  unsubSockets.push(
    net.on('stream:stopped', () => {
      store.setStreaming({ active: false, kind: null });
      if (viewerReceiver) {
        viewerReceiver.reset();
      }
      if (store.hostPresent) {
        store.setStatus(STATUS_TEXT.WAITING);
      }
    })
  );

  unsubSockets.push(
    net.on('stream:resync-request', ({ from }) => {
      if (store.isHost && hostStreamer && from) {
        hostStreamer.resync(from);
      }
    })
  );

  unsubSockets.push(
    net.on('host:left', () => {
      store.hostPresent = false;
      store.setStreaming({ active: false, kind: null });
      if (viewerReceiver) {
        viewerReceiver.reset();
      }
      store.setStatus(STATUS_TEXT.HOST_LEFT);
    })
  );

  unsubSockets.push(
    net.on('host:returned', ({ id }) => {
      store.hostPresent = true;
      const hostPeer = store.peers.get(id);
      if (hostPeer) {
        hostPeer.isHost = true;
        avatarsBuilder.upsertAvatar(hostPeer, store.selfId);
      }
      if (!store.streaming.active) {
        store.setStatus(STATUS_TEXT.WAITING);
      }
    })
  );

  unsubSockets.push(
    net.on('room:error', (err) => {
      if (err?.code === 'HOST_REPLACED') {
        showToast(err.error || 'Host session opened in another window.');
        navigate('/');
      } else if (err?.error) {
        showToast(err.error);
      }
    })
  );

  unsubSockets.push(
    net.on('rtc:offer', ({ from, sdp }) => {
      if (!store.isHost && viewerReceiver && from && sdp) {
        viewerReceiver.handleOffer(from, sdp);
      }
    })
  );

  unsubSockets.push(
    net.on('rtc:answer', ({ from, sdp }) => {
      if (store.isHost && hostStreamer && from && sdp) {
        hostStreamer.handleAnswer(from, sdp);
      }
    })
  );

  unsubSockets.push(
    net.on('rtc:ice', ({ from, candidate }) => {
      if (store.isHost && hostStreamer) {
        hostStreamer.handleIce(from, candidate);
      } else if (!store.isHost && viewerReceiver) {
        viewerReceiver.handleIce(from, candidate);
      }
    })
  );

  // Reconnect handling (socket.io connect fired a second time)
  let initialConnectHandled = true;
  const onSocketReconnect = async () => {
    if (initialConnectHandled) {
      initialConnectHandled = false;
      return;
    }
    const localStreamWasActive = Boolean(
      store.isHost && hostStreamer && hostStreamer.stream
    );
    const localStreamKind = store.streaming.kind;

    if (await restoreRoomMembership()) {
      if (localStreamWasActive && hostStreamer) {
        store.setStreaming({ active: true, kind: localStreamKind });
        store.setStatus(STATUS_TEXT.LIVE);
        await net.emit('stream:start', { kind: localStreamKind });
        await hostStreamer.connectToAllViewers();
      } else if (!store.isHost && store.streaming.active && viewerReceiver) {
        store.setStatus(STATUS_TEXT.CONNECTING);
        viewerReceiver.startWatchdog();
      }
    }
  };
  socket.on('disconnect', () => {
    membershipReady = false;
  });
  socket.on('connect', onSocketReconnect);
  initialConnectHandled = false;

  // If viewer joins while streaming is already active, arm watchdog
  if (store.streaming.active && !store.isHost && viewerReceiver) {
    store.setStatus(STATUS_TEXT.CONNECTING);
    viewerReceiver.startWatchdog();
  }

  // Global keyboard shortcuts
  function onKeyDown(e) {
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const isInputFocused =
      activeTag === 'input' ||
      activeTag === 'textarea' ||
      document.activeElement?.isContentEditable;

    if (e.key === 'Escape') {
      if (chat.isInputFocused()) {
        chat.blurInput();
        return;
      }
      if (hud.isTheaterMode()) {
        hud.setTheaterMode(false);
        return;
      }
    }

    if (isInputFocused) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;
    if (key === 'f' || key === 'F') {
      e.preventDefault();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } else if (key === 'm' || key === 'M') {
      e.preventDefault();
      hud.toggleMute();
    } else if (key === 'h' || key === 'H') {
      e.preventDefault();
      hud.toggleTheaterMode();
    } else if (key === 'v' || key === 'V') {
      e.preventDefault();
      hud.toggleFirstPerson();
    } else if (key === 'Enter') {
      e.preventDefault();
      if (hud.isTheaterMode()) {
        hud.setTheaterMode(false);
      }
      chat.focusInput();
    } else if (key >= '1' && key <= '6') {
      const idx = Number(key) - 1;
      const emoji = EMOJIS[idx];
      if (emoji) {
        e.preventDefault();
        net.emit('reaction:send', { emoji });
      }
    }
  }

  window.addEventListener('keydown', onKeyDown);

  activeRoomCleanup = () => {
    window.removeEventListener('keydown', onKeyDown);
    playerController?.dispose();
    playerController = null;
    requestSeatAction = null;
    requestDrinkAction = null;
    cameraRig.setFirstPerson(false);
    avatarsBuilder.setAvatarVisible(store.selfId, true);
    companionBuilder?.setVisible(false);
    cameraRig.setFollowTarget(null);
    socket.off('connect', onSocketReconnect);
    unsubSockets.forEach((off) => off());
    offStoreStatus();
    offStoreStreaming();
    hostStreamer?.stop(undefined, { emitSocket: false });
    viewerReceiver?.dispose();
    hostControls?.destroy();
    chat.destroy();
    hud.destroy();
    avatarsBuilder?.clear();
    reactionsBuilder?.clear();
    screenBuilder?.setSource(null);
    net.disconnect();
    store.reset();
  };

  return joinRes;
}

async function handleRoute(route) {
  clearCurrentView();
  ensure3DScene();

  if (route.name === 'landing') {
    sceneCtx.canvas.classList.add('blurred');
    seatsBuilder.setInteractive(false);
    cameraRig.setOrbitMode(true);

    activeOverlay = renderLanding({
      container: appEl,
      onEnterRoomAsHost({ roomId, name, hostKey }) {
        unlockAudioGesture();
        enterRoom({ roomId, name, hostKey });
      },
      onNavigateToRoom(roomId) {
        navigate(`/r/${roomId}`);
      },
    });
    return;
  }

  if (route.name === 'room' && route.roomId) {
    const roomId = route.roomId;
    sceneCtx.canvas.classList.add('blurred');
    seatsBuilder.setInteractive(false);
    cameraRig.setOrbitMode(true);

    let roomInfo;
    try {
      roomInfo = await getRoomInfo(roomId);
    } catch {
      roomInfo = { exists: false };
    }

    if (!roomInfo.exists) {
      activeOverlay = renderStatusScreen({
        container: appEl,
        title: 'Room not found',
        message: 'This cinema room has closed or never existed.',
        onGoHome: () => navigate('/'),
      });
      return;
    }

    let savedHostKey = null;
    let savedName = null;
    try {
      savedHostKey = localStorage.getItem(`velvet:hostKey:${roomId}`);
      savedName = localStorage.getItem('velvet:name');
    } catch {
      // Ignore
    }

    // If this browser holds the hostKey and a saved name, enter straight into the room
    if (savedHostKey && savedName && savedName.trim()) {
      await enterRoom({
        roomId,
        name: savedName.trim(),
        hostKey: savedHostKey,
      });
      return;
    }

    if (roomInfo.count >= roomInfo.max && !savedHostKey) {
      activeOverlay = renderStatusScreen({
        container: appEl,
        title: 'This room is full.',
        message: 'All 8 seats in this screening are currently occupied.',
        onGoHome: () => navigate('/'),
      });
      return;
    }

    activeOverlay = renderJoinGate({
      container: appEl,
      roomInfo,
      async onJoin(name) {
        return enterRoom({
          roomId,
          name,
          hostKey: savedHostKey || undefined,
        });
      },
    });
    return;
  }

  // Fallback Not-found screen
  sceneCtx.canvas.classList.add('blurred');
  seatsBuilder.setInteractive(false);
  cameraRig.setOrbitMode(true);
  activeOverlay = renderStatusScreen({
    container: appEl,
    title: 'Page not found',
    message: "We couldn't find that screening room.",
    onGoHome: () => navigate('/'),
  });
}

initRouter(handleRoute);
