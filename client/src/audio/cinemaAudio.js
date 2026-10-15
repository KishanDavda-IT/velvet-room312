const EARLY_REFLECTIONS = [
  { delay: 0.022, gain: 0.075 },
  { delay: 0.039, gain: 0.04 },
];

function createCinemaImpulse(context) {
  const duration = 0.62;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const impulse = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel);
    const channelOffset = channel * 0.17;
    for (let i = 0; i < length; i += 1) {
      const progress = i / length;
      const decay = Math.pow(1 - progress, 3.2);
      const noise = Math.random() * 2 - 1;
      samples[i] = noise * decay * (0.12 + channelOffset);
    }
  }

  return impulse;
}

/** Adds a restrained, local cinema-room ambience to a media element. */
export class CinemaAudio {
  constructor({ enabled = true } = {}) {
    this.enabled = Boolean(enabled);
    this.context = null;
    this.source = null;
    this.sourceElement = null;
    this.sourceByElement = new WeakMap();
    this.nodes = [];
    this.effectNodes = null;
    this.resumeEvents = ['pointerdown', 'keydown'];
    this.handleResumeGesture = this.handleResumeGesture.bind(this);

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        this.context = new AudioContextClass();
        this.resumeEvents.forEach((eventName) => {
          document.addEventListener(eventName, this.handleResumeGesture, true);
        });
        this.resume();
      } catch {
        // Keep native media playback if Web Audio is unavailable.
      }
    }
  }

  isEnabled() {
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.updateEffectLevels();
    this.resume();
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  async resume() {
    if (!this.context || this.context.state === 'closed') return false;
    if (this.context.state === 'running') return true;
    try {
      await this.context.resume();
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }

  handleResumeGesture() {
    this.resume();
  }

  setSource(element) {
    if (element === this.sourceElement) {
      this.resume();
      return;
    }

    this.disconnectSource();
    if (!element || !this.context || this.context.state === 'closed') return;

    try {
      this.source = this.sourceByElement.get(element) || this.context.createMediaElementSource(element);
      this.sourceByElement.set(element, this.source);
      this.sourceElement = element;
      this.buildGraph();
      this.source.connect(this.nodes[1]);
      this.updateEffectLevels();
      this.resume();
    } catch {
      const fallbackSource = this.source;
      this.disconnectSource();
      if (fallbackSource && this.context) {
        try {
          fallbackSource.connect(this.context.destination);
          this.source = fallbackSource;
          this.sourceElement = element;
        } catch {
          // Keep the source disconnected only if the browser rejects audio output.
        }
      }
    }
  }

  buildGraph() {
    const context = this.context;
    const output = context.createGain();
    output.gain.value = 1;
    this.nodes.push(output);

    const direct = context.createGain();
    direct.gain.value = this.enabled ? 0.88 : 1;
    this.nodes.push(direct);
    direct.connect(output);

    for (const reflection of EARLY_REFLECTIONS) {
      const delay = context.createDelay(0.08);
      delay.delayTime.value = reflection.delay;
      const reflectionGain = context.createGain();
      reflectionGain.gain.value = this.enabled ? reflection.gain : 0;
      this.nodes.push(delay, reflectionGain);
      delay.connect(reflectionGain);
      reflectionGain.connect(output);
      this.source.connect(delay);
    }

    const convolver = context.createConvolver();
    convolver.normalize = false;
    convolver.buffer = createCinemaImpulse(context);
    const roomGain = context.createGain();
    roomGain.gain.value = this.enabled ? 0.22 : 0;
    this.nodes.push(convolver, roomGain);
    this.source.connect(convolver);
    convolver.connect(roomGain);
    roomGain.connect(output);

    output.connect(context.destination);
    this.effectNodes = {
      direct,
      reflectionGains: this.nodes.filter((node) => node !== direct && node.gain && node !== output && node !== roomGain && !node.delayTime && !node.buffer),
      roomGain,
    };
  }

  updateEffectLevels() {
    if (!this.context || !this.effectNodes) return;
    const now = this.context.currentTime;
    this.effectNodes.direct.gain.setTargetAtTime(this.enabled ? 0.88 : 1, now, 0.025);
    this.effectNodes.reflectionGains.forEach((gain, index) => {
      const level = EARLY_REFLECTIONS[index]?.gain || 0;
      gain.gain.setTargetAtTime(this.enabled ? level : 0, now, 0.025);
    });
    this.effectNodes.roomGain.gain.setTargetAtTime(this.enabled ? 0.22 : 0, now, 0.025);
  }

  disconnectSource() {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // Ignore already disconnected nodes.
      }
    }
    this.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // Ignore already disconnected nodes.
      }
    });
    this.nodes = [];
    this.effectNodes = null;
    this.source = null;
    this.sourceElement = null;
  }

  dispose() {
    this.disconnectSource();
    this.resumeEvents.forEach((eventName) => {
      document.removeEventListener(eventName, this.handleResumeGesture, true);
    });
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
    }
    this.context = null;
  }
}

