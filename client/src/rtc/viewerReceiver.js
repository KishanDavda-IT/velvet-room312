import { getIceConfig } from './iceConfig.js';
import { enhanceOpusSdp } from './sdp.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { STATUS_TEXT } from '../constants.js';
import { showToast } from '../ui/toast.js';

const STREAM_CONNECT_TIMEOUT_MS = 15000;

export class ViewerReceiver {
  constructor({ onRemoteVideoChange, getVolume } = {}) {
    this.pc = null;
    this.pendingIce = [];
    this.watchdogTimer = null;
    this.watchdogPhase = 0;
    this.recoveryTimer = null;
    this.hasTrack = false;
    this._liveFrameToken = 0;
    this.tapOverlayEl = null;
    this.onRemoteVideoChange = onRemoteVideoChange || (() => {});
    this.getVolume = getVolume || (() => 0.8);

    this._video = document.createElement('video');
    this._video.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;pointer-events:none;';
    this._video.playsInline = true;
    this._video.autoplay = true;
    this._video.muted = false;
    this._video.volume = this.getVolume();
    document.body.appendChild(this._video);
  }

  get video() {
    return this._video;
  }

  setVolume(vol) {
    if (this._video) {
      this._video.volume = Math.min(Math.max(vol, 0), 1);
    }
  }

  scheduleResync(delay = 1800) {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (!this.pc || this.pc.connectionState === 'connected' || !store.streaming.active) return;
      store.setStatus(STATUS_TEXT.RECONNECTING);
      net.emit('stream:resync', {});
      this.startWatchdog();
    }, delay);
  }

  startWatchdog() {
    this.clearWatchdog();
    this.hasTrack = false;
    this.watchdogPhase = 1;

    this.watchdogTimer = setTimeout(() => {
      if (this.hasTrack || !store.streaming.active) return;
      // First timeout: request resync and restart timer once more
      store.setStatus(STATUS_TEXT.RECONNECTING);
      net.emit('stream:resync', {});
      this.watchdogPhase = 2;

      this.watchdogTimer = setTimeout(() => {
        if (this.hasTrack || !store.streaming.active) return;
        showToast("Can't connect to the stream. The host may be behind a strict network.");
      }, STREAM_CONNECT_TIMEOUT_MS);
    }, STREAM_CONNECT_TIMEOUT_MS);
  }

  clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.watchdogPhase = 0;
  }

  _awaitFirstFrameAndSetLive() {
    const token = ++this._liveFrameToken;
    let notified = false;
    const onLive = () => {
      if (notified || token !== this._liveFrameToken) return;
      notified = true;
      if (!store.streaming.active) return;
      store.setStatus(STATUS_TEXT.LIVE);
      this.onRemoteVideoChange(this._video);
    };

    if (typeof this._video.requestVideoFrameCallback === 'function') {
      this._video.requestVideoFrameCallback(() => {
        onLive();
      });
      // Fallback in case stream is audio-only or paused at start
      this._video.addEventListener('loadeddata', onLive, { once: true });
    } else {
      this._video.addEventListener('loadeddata', onLive, { once: true });
      this._video.addEventListener('playing', onLive, { once: true });
    }
  }

  showTapToPlayOverlay() {
    if (this.tapOverlayEl) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tap-to-play-overlay';
    btn.innerHTML = `<span class="btn-gold">Tap to start the movie</span>`;
    btn.addEventListener('click', () => {
      this._video.muted = false;
      this._video.volume = this.getVolume();
      this._video.play().catch(() => {});
      this.hideTapToPlayOverlay();
    });
    document.body.appendChild(btn);
    this.tapOverlayEl = btn;
  }

  hideTapToPlayOverlay() {
    if (this.tapOverlayEl) {
      this.tapOverlayEl.remove();
      this.tapOverlayEl = null;
    }
  }

  async handleOffer(from, sdp) {
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // Ignore
      }
      this.pc = null;
    }
    this.pendingIce = [];

    const { iceServers } = await getIceConfig();
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        if (this.recoveryTimer) {
          clearTimeout(this.recoveryTimer);
          this.recoveryTimer = null;
        }
        this.clearWatchdog();
        if (store.streaming.active && this._video?.readyState >= 2) {
          this.hasTrack = true;
          store.setStatus(STATUS_TEXT.LIVE);
          this.onRemoteVideoChange(this._video);
        }
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        store.setStatus(STATUS_TEXT.RECONNECTING);
        this.scheduleResync(pc.connectionState === 'failed' ? 0 : 1800);
      }
    };

    pc.ontrack = (e) => {
      if (this.recoveryTimer) {
        clearTimeout(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      this.hasTrack = true;
      this.clearWatchdog();

      const remoteStream = e.streams?.[0] || new MediaStream([e.track]);
      if (this._video.srcObject !== remoteStream) {
        this._video.srcObject = remoteStream;
      }
      this._video.volume = this.getVolume();
      if (e.track.kind === 'video') {
        this._awaitFirstFrameAndSetLive();
      }

      this._video.play().catch(() => {
        this.showTapToPlayOverlay();
      });
    };

    pc.onicecandidate = (e) => {
      net.emit('rtc:ice', {
        to: from,
        candidate: e.candidate ? e.candidate.toJSON() : null,
      });
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });

    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) {
      if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          // Ignore InvalidStateError
        }
      }
    }

    const answer = await pc.createAnswer();
    answer.sdp = enhanceOpusSdp(answer.sdp);
    await pc.setLocalDescription(answer);

    net.emit('rtc:answer', {
      to: from,
      sdp: answer.sdp,
    });
  }

  async handleIce(_from, candidate) {
    if (!this.pc) return;
    if (!this.pc.remoteDescription || !this.pc.remoteDescription.type) {
      if (candidate) {
        this.pendingIce.push(candidate);
      }
      return;
    }
    if (!candidate) return;
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Ignore InvalidStateError
    }
  }

  reset() {
    this._liveFrameToken += 1;
    this.clearWatchdog();
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.hideTapToPlayOverlay();
    this.hasTrack = false;
    this.pendingIce = [];

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // Ignore
      }
      this.pc = null;
    }

    if (this._video) {
      try {
        this._video.pause();
        this._video.srcObject = null;
      } catch {
        // Ignore
      }
    }

    this.onRemoteVideoChange(null);
  }

  dispose() {
    this.reset();
    if (this._video) {
      this._video.remove();
      this._video = null;
    }
  }
}
