import { ICONS } from '../constants.js';
import { store } from '../store.js';
import { renderMoviePicker } from './moviePicker.js';

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function renderHostControls({ container, hostStreamer }) {
  const panel = document.createElement('div');
  panel.className = 'glass hud-host-controls hud-interactive';

  // Row 1 buttons
  const row1 = document.createElement('div');
  row1.className = 'host-row-1';

  const movieBtn = document.createElement('button');
  movieBtn.type = 'button';
  movieBtn.className = 'btn-gold';
  movieBtn.innerHTML = `${ICONS.film}<span>Browse movies</span>`;

  const screenBtn = document.createElement('button');
  screenBtn.type = 'button';
  screenBtn.className = 'btn-ghost';
  screenBtn.innerHTML = `${ICONS.monitor}<span>Share screen</span>`;

  const fileBtn = document.createElement('button');
  fileBtn.type = 'button';
  fileBtn.className = 'btn-ghost';
  fileBtn.innerHTML = `${ICONS.film}<span>Play a file</span>`;

  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'btn-ghost';
  stopBtn.innerHTML = `${ICONS.stop}<span>Stop</span>`;
  stopBtn.disabled = !store.streaming.active;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'video/*';
  fileInput.style.display = 'none';

  row1.append(movieBtn, screenBtn, fileBtn, stopBtn, fileInput);

  // Row 2 (only while kind === 'file')
  const row2 = document.createElement('div');
  row2.className = 'host-row-2';
  row2.style.display = 'none';

  const playPauseBtn = document.createElement('button');
  playPauseBtn.type = 'button';
  playPauseBtn.className = 'btn-ghost';
  playPauseBtn.textContent = 'Pause';

  const seekSlider = document.createElement('input');
  seekSlider.type = 'range';
  seekSlider.className = 'host-seek-slider';
  seekSlider.min = '0';
  seekSlider.max = '100';
  seekSlider.step = '0.1';
  seekSlider.value = '0';

  const timeLabel = document.createElement('span');
  timeLabel.className = 'host-time-label';
  timeLabel.textContent = '00:00 / 00:00';

  row2.append(playPauseBtn, seekSlider, timeLabel);

  // Hint text shown while idle
  const hintEl = document.createElement('div');
  hintEl.className = 'host-hint';
  hintEl.textContent = 'Pick a public-domain movie to watch together without screen sharing.';

  panel.append(row1, row2, hintEl);
  container.appendChild(panel);

  let starting = false;
  let boundVideo = null;
  let isSeeking = false;
  let moviePicker = null;

  function onTimeUpdate() {
    if (!boundVideo || isSeeking) return;
    const cur = boundVideo.currentTime || 0;
    const dur = Number.isFinite(boundVideo.duration) ? boundVideo.duration : 0;
    seekSlider.max = dur > 0 ? String(dur) : '100';
    seekSlider.value = String(cur);
    timeLabel.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    playPauseBtn.textContent = boundVideo.paused ? 'Play' : 'Pause';
  }

  function bindFileVideo(videoEl) {
    if (boundVideo === videoEl) return;
    if (boundVideo) {
      boundVideo.removeEventListener('timeupdate', onTimeUpdate);
      boundVideo.removeEventListener('play', onTimeUpdate);
      boundVideo.removeEventListener('pause', onTimeUpdate);
      boundVideo.removeEventListener('loadedmetadata', onTimeUpdate);
    }
    boundVideo = videoEl;
    if (boundVideo) {
      boundVideo.addEventListener('timeupdate', onTimeUpdate);
      boundVideo.addEventListener('play', onTimeUpdate);
      boundVideo.addEventListener('pause', onTimeUpdate);
      boundVideo.addEventListener('loadedmetadata', onTimeUpdate);
      onTimeUpdate();
    }
  }

  function syncUiState() {
    const { active, kind } = store.streaming;
    panel.style.display = store.isHost ? 'flex' : 'none';
    movieBtn.disabled = starting;
    screenBtn.disabled = starting;
    fileBtn.disabled = starting;
    stopBtn.disabled = starting || !active;
    hintEl.style.display = !active ? 'block' : 'none';

    if (active && kind === 'file' && hostStreamer?.hostVideo) {
      row2.style.display = 'flex';
      bindFileVideo(hostStreamer.hostVideo);
    } else {
      row2.style.display = 'none';
      bindFileVideo(null);
    }
  }

  screenBtn.addEventListener('click', async () => {
    if (starting) return;
    starting = true;
    syncUiState();
    try {
      await hostStreamer.startScreen();
    } finally {
      starting = false;
      syncUiState();
    }
  });

  movieBtn.addEventListener('click', () => {
    if (starting || moviePicker) return;
    moviePicker = renderMoviePicker({
      container: document.body,
      onClose() {
        moviePicker = null;
      },
      async onPlay(movie) {
        starting = true;
        syncUiState();
        try {
          return await hostStreamer.startArchiveMovie(movie.identifier);
        } finally {
          starting = false;
          syncUiState();
        }
      },
    });
  });

  fileBtn.addEventListener('click', () => {
    if (starting) return;
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file || starting) return;
    starting = true;
    syncUiState();
    try {
      await hostStreamer.startFile(file);
    } finally {
      starting = false;
      syncUiState();
    }
  });

  stopBtn.addEventListener('click', () => {
    if (starting) return;
    hostStreamer.stop();
    syncUiState();
  });

  playPauseBtn.addEventListener('click', () => {
    const v = hostStreamer?.hostVideo;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    onTimeUpdate();
  });

  seekSlider.addEventListener('input', () => {
    isSeeking = true;
    const v = hostStreamer?.hostVideo;
    if (!v) return;
    const target = Number(seekSlider.value) || 0;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    timeLabel.textContent = `${formatTime(target)} / ${formatTime(dur)}`;
  });

  seekSlider.addEventListener('change', () => {
    const v = hostStreamer?.hostVideo;
    if (v) {
      v.currentTime = Number(seekSlider.value) || 0;
    }
    isSeeking = false;
    onTimeUpdate();
  });

  const offStreaming = store.on('streaming', syncUiState);
  const offPeers = store.on('peers', syncUiState);
  syncUiState();

  return {
    syncUiState,
    destroy() {
      offStreaming();
      offPeers();
      moviePicker?.close();
      moviePicker = null;
      bindFileVideo(null);
      panel.remove();
    },
  };
}
