import { io } from 'socket.io-client';

let socket = null;

export const net = {
  connect() {
    if (socket) {
      if (!socket.connected) {
        socket.connect();
      }
      return socket;
    }

    socket = io({
      path: import.meta.env.PROD ? '/api/socket.io' : '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    return socket;
  },

  disconnect() {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  },

  getSocket() {
    return socket;
  },

  on(event, fn) {
    const s = this.connect();
    s.on(event, fn);
    return () => s.off(event, fn);
  },

  off(event, fn) {
    if (socket) {
      socket.off(event, fn);
    }
  },

  emit(event, payload = {}, ack) {
    const s = this.connect();
    if (typeof ack === 'function') {
      s.emit(event, payload, ack);
      return;
    }
    if (event.startsWith('rtc:')) {
      s.emit(event, payload);
      return;
    }
    return new Promise((resolve) => {
      s.timeout(12000).emit(event, payload, (timeoutError, response) => {
        if (timeoutError) {
          resolve({
            ok: false,
            code: 'NETWORK',
            error: 'The room server did not respond. Please try again.',
          });
          return;
        }
        resolve(response || { ok: false, code: 'INTERNAL', error: 'No response' });
      });
    });
  },

  send(event, payload = {}) {
    this.connect().emit(event, payload);
  },
};

export default net;
