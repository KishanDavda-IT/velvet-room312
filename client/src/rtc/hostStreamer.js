import { getIceConfig } from './iceConfig.js';
import { enhanceOpusSdp } from './sdp.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { STATUS_TEXT } from '../constants.js';
import { showToast } from '../ui/toast.js';
import { getMovieStream } from '../api.js';

export class HostStreamer {
  constructor({ onLocalVideoChange, getVolume } = {}) {
    this.pcs = new Map();
    this.pendingIce = new Map();
    this.retryCounts = new Map();
    this._stream = null;
    this._hostVideo = null;
    this._objectUrl = null;
    this._kind = null;
    this.onLocalVideoChange = onLocalVideoChange || (() => {});
    this.getVolume = getVolume || (() => 0.8);
  }

  get stream() {
    return this._stream;
  }

  get hostVideo() {
    return this._hostVideo;
  }

  async startScreen() {
    let mediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        showToast('Screen share cancelled');
        return false;
      }
      showToast('Could not start screen sharing.');
      return false;
    }

    // Stop any previous stream silently before starting the new one
    this._cleanupLocalMedia();
    this._closeAllPeerConnections();

    const [videoTrack] = mediaStream.getVideoTracks();
    if (videoTrack) {
      try {
        videoTrack.contentHint = 'motion';
      } catch {
        // Ignore if contentHint is read-only in some browsers
      }
      videoTrack.addEventListener('ended', () => {
        if (this._stream === mediaStream) {
          this.stop('Screen sharing ended');
        }
      });
    }

    if (mediaStream.getAudioTracks().length === 0) {
      showToast(
        "No audio captured. Pick a Chrome tab and tick 'Share tab audio' so everyone can hear the movie."
      );
    }

    const previewVideo = document.createElement('video');
    previewVideo.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;pointer-events:none;';
    previewVideo.muted = true;
    previewVideo.playsInline = true;
    previewVideo.srcObject = mediaStream;
    document.body.appendChild(previewVideo);
    await previewVideo.play().catch(() => {});

    this._stream = mediaStream;
    this._hostVideo = previewVideo;
    this._kind = 'screen';

    this.onLocalVideoChange(this._hostVideo);
    store.setStreaming({ active: true, kind: 'screen' });
    store.setStatus(STATUS_TEXT.LIVE);

    await net.emit('stream:start', { kind: 'screen' });
    await this.connectToAllViewers();
    return true;
  }

  async startFile(file) {
    if (!file) return false;

    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;pointer-events:none;';
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.volume = this.getVolume();
    document.body.appendChild(video);

    const metadataLoaded = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, 8000);

      video.addEventListener(
        'loadedmetadata',
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        },
        { once: true }
      );

      video.addEventListener(
        'error',
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(false);
        },
        { once: true }
      );
    });

    if (!metadataLoaded) {
      URL.revokeObjectURL(objectUrl);
      video.remove();
      showToast("Couldn't read that video. Try an MP4 (H.264/AAC) or WebM file.");
      return false;
    }

    this._cleanupLocalMedia();
    this._closeAllPeerConnections();

    try {
      await video.play();
    } catch {
      URL.revokeObjectURL(objectUrl);
      video.remove();
      showToast("Couldn't read that video. Try an MP4 (H.264/AAC) or WebM file.");
      return false;
    }

    const captureFn = video.captureStream || video.mozCaptureStream;
    if (typeof captureFn !== 'function') {
      URL.revokeObjectURL(objectUrl);
      video.remove();
      showToast('Your browser does not support video file streaming.');
      return false;
    }

    const mediaStream = captureFn.call(video);
    const [videoTrack] = mediaStream.getVideoTracks();
    if (videoTrack) {
      try {
        videoTrack.contentHint = 'motion';
      } catch {
        // Ignore
      }
    }

    video.addEventListener('ended', () => {
      if (this._hostVideo === video) {
        this.stop('The movie ended');
      }
    });

    this._stream = mediaStream;
    this._hostVideo = video;
    this._objectUrl = objectUrl;
    this._kind = 'file';

    this.onLocalVideoChange(this._hostVideo);
    store.setStreaming({ active: true, kind: 'file' });
    store.setStatus(STATUS_TEXT.LIVE);

    await net.emit('stream:start', { kind: 'file' });
    await this.connectToAllViewers();
    return true;
  }

  async startArchiveMovie(identifier) {
    let movie;
    try {
      movie = await getMovieStream(identifier);
    } catch (err) {
      showToast(err.message || 'Could not load this movie.');
      return false;
    }

    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;pointer-events:none;';
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.playsInline = true;
    video.volume = this.getVolume();
    video.src = movie.url;
    document.body.appendChild(video);

    const metadataLoaded = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, 15000);

      video.addEventListener('loadedmetadata', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }, { once: true });

      video.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }, { once: true });
    });

    if (!metadataLoaded) {
      video.remove();
      showToast('This film could not be played by your browser. Choose another title or check the Archive source.');
      return false;
    }

    this._cleanupLocalMedia();
    this._closeAllPeerConnections();

    try {
      await video.play();
      const captureFn = video.captureStream || video.mozCaptureStream;
      if (typeof captureFn !== 'function') {
        throw new Error('Your browser does not support in-app movie playback.');
      }

      const mediaStream = captureFn.call(video);
      if (!mediaStream.getVideoTracks().length) {
        throw new Error('The movie server did not provide a playable video stream.');
      }
      const [videoTrack] = mediaStream.getVideoTracks();
      try {
        videoTrack.contentHint = 'motion';
      } catch {
        // Ignore unsupported content hints.
      }

      video.addEventListener('ended', () => {
        if (this._hostVideo === video) this.stop('The movie ended');
      });
      video.addEventListener('error', () => {
        if (this._hostVideo === video) this.stop('Movie playback stopped because the source became unavailable.');
      });

      this._stream = mediaStream;
      this._hostVideo = video;
      this._kind = 'file';
      this.onLocalVideoChange(video);
      store.setStreaming({ active: true, kind: 'file' });
      store.setStatus(STATUS_TEXT.LIVE);

      await net.emit('stream:start', { kind: 'file' });
      await this.connectToAllViewers();
      return true;
    } catch (err) {
      video.pause();
      video.remove();
      this.stop(err.message || 'Could not start this movie.');
      return false;
    }
  }

  async connectToAllViewers() {
    if (!this._stream) return;
    const promises = [];
    for (const peer of store.peers.values()) {
      if (peer.id !== store.selfId && !peer.isHost) {
        promises.push(this.connectToViewer(peer.id));
      }
    }
    await Promise.allSettled(promises);
  }

  async connectToViewer(peerId) {
    if (!this._stream || !peerId || peerId === store.selfId) return;

    if (this.pcs.has(peerId)) {
      try {
        this.pcs.get(peerId).close();
      } catch {
        // Ignore
      }
      this.pcs.delete(peerId);
    }
    this.pendingIce.set(peerId, []);

    const { iceServers } = await getIceConfig();
    if (!this._stream) return;

    const pc = new RTCPeerConnection({ iceServers });
    this.pcs.set(peerId, pc);

    for (const track of this._stream.getTracks()) {
      pc.addTrack(track, this._stream);
    }

    pc.onicecandidate = (e) => {
      net.emit('rtc:ice', {
        to: peerId,
        candidate: e.candidate ? e.candidate.toJSON() : null,
      });
    };

    pc.onconnectionstatechange = () => {
      if (this.pcs.get(peerId) !== pc) return;
      if (pc.connectionState === 'failed') {
        const count = this.retryCounts.get(peerId) || 0;
        if (count < 2) {
          this.retryCounts.set(peerId, count + 1);
          this.connectToViewer(peerId);
        }
      } else if (pc.connectionState === 'connected') {
        this.retryCounts.set(peerId, 0);
      } else if (pc.connectionState === 'closed') {
        this.pcs.delete(peerId);
        this.pendingIce.delete(peerId);
      }
    };

    const offer = await pc.createOffer();
    offer.sdp = enhanceOpusSdp(offer.sdp);
    await pc.setLocalDescription(offer);

    net.emit('rtc:offer', {
      to: peerId,
      sdp: offer.sdp,
    });
  }

  onViewerJoined(peerId) {
    this.retryCounts.set(peerId, 0);
    if (this._stream && store.streaming.active) {
      this.connectToViewer(peerId);
    }
  }

  onViewerLeft(peerId) {
    this.retryCounts.delete(peerId);
    this.pendingIce.delete(peerId);
    const pc = this.pcs.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
      this.pcs.delete(peerId);
    }
  }

  resync(peerId) {
    if (this._stream && store.streaming.active) {
      this.retryCounts.set(peerId, 0);
      this.connectToViewer(peerId);
    }
  }

  async handleAnswer(from, sdp) {
    const pc = this.pcs.get(from);
    if (!pc) return;

    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      return;
    }

    const queued = this.pendingIce.get(from) || [];
    this.pendingIce.set(from, []);
    for (const candidate of queued) {
      if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          // Ignore InvalidStateError
        }
      }
    }

    // Apply maxBitrate and degradationPreference on video sender
    try {
      const { maxBitrate } = await getIceConfig();
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === 'video') {
          const params = sender.getParameters();
          params.encodings = params.encodings?.length ? params.encodings : [{}];
          params.encodings[0].maxBitrate = maxBitrate;
          params.degradationPreference = 'maintain-resolution';
          await sender.setParameters(params);
        }
      }
    } catch {
      // Ignore if setParameters is partially unsupported
    }
  }

  async handleIce(from, candidate) {
    const pc = this.pcs.get(from);
    if (!pc) return;
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      const list = this.pendingIce.get(from) || [];
      if (candidate) list.push(candidate);
      this.pendingIce.set(from, list);
      return;
    }
    if (!candidate) return;
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Ignore InvalidStateError
    }
  }

  _closeAllPeerConnections() {
    for (const pc of this.pcs.values()) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
    }
    this.pcs.clear();
    this.pendingIce.clear();
    this.retryCounts.clear();
  }

  _cleanupLocalMedia() {
    if (this._stream) {
      for (const track of this._stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      }
      this._stream = null;
    }
    if (this._hostVideo) {
      try {
        this._hostVideo.pause();
        this._hostVideo.srcObject = null;
        this._hostVideo.removeAttribute('src');
        this._hostVideo.load();
        this._hostVideo.remove();
      } catch {
        // Ignore
      }
      this._hostVideo = null;
    }
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
    this._kind = null;
  }

  stop(reason, { emitSocket = true } = {}) {
    const wasActive = Boolean(this._stream || store.streaming.active);
    this._cleanupLocalMedia();
    this._closeAllPeerConnections();
    this.onLocalVideoChange(null);

    store.setStreaming({ active: false, kind: null });
    if (store.hostPresent) {
      store.setStatus(STATUS_TEXT.WAITING);
    }

    if (emitSocket && wasActive) {
      net.emit('stream:stop', {});
    }
    if (reason) {
      showToast(reason);
    }
  }
}
