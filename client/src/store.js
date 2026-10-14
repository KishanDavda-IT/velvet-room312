import { STATUS_TEXT } from './constants.js';

const listeners = new Map();

export const store = {
  roomId: null,
  selfId: null,
  isHost: false,
  peers: new Map(),
  streaming: { active: false, kind: null },
  status: STATUS_TEXT.WAITING,
  hostPresent: true,
  chat: [],
  maxRoomSize: 8,

  on(event, fn) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },

  off(event, fn) {
    const set = listeners.get(event);
    if (set) {
      set.delete(fn);
    }
  },

  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Error in store listener [${event}]:`, err);
      }
    }
  },

  reset() {
    this.roomId = null;
    this.selfId = null;
    this.isHost = false;
    this.peers = new Map();
    this.streaming = { active: false, kind: null };
    this.status = STATUS_TEXT.WAITING;
    this.hostPresent = true;
    this.chat = [];
    this.maxRoomSize = 8;
  },

  loadRoomState(state) {
    this.roomId = state.roomId;
    this.selfId = state.selfId;
    this.isHost = Boolean(state.isHost);
    this.peers = new Map();
    let hasHost = false;
    for (const peer of state.peers || []) {
      this.peers.set(peer.id, { ...peer });
      if (peer.isHost) {
        hasHost = true;
      }
    }
    this.hostPresent = hasHost;
    this.streaming = {
      active: Boolean(state.streaming?.active),
      kind: state.streaming?.kind || null,
    };
    this.chat = Array.isArray(state.chat) ? [...state.chat] : [];
    this.maxRoomSize = state.maxRoomSize || 8;

    if (!this.hostPresent) {
      this.status = STATUS_TEXT.HOST_LEFT;
    } else if (this.streaming.active) {
      this.status = this.isHost ? STATUS_TEXT.LIVE : STATUS_TEXT.CONNECTING;
    } else {
      this.status = STATUS_TEXT.WAITING;
    }

    this.emit('peers', this.peers);
    this.emit('streaming', this.streaming);
    this.emit('status', this.status);
  },

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', this.status);
  },

  setStreaming(streaming) {
    this.streaming = {
      active: Boolean(streaming?.active),
      kind: streaming?.kind || null,
    };
    this.emit('streaming', this.streaming);
  },
};

export default store;
