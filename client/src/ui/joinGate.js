import { getSavedOrDefaultName } from './landing.js';

// 1-frame silent WAV data URL to unlock audio autoplay on user gesture
const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export function unlockAudioGesture() {
  try {
    const audio = new Audio(SILENT_AUDIO_DATA_URI);
    audio.volume = 0.01;
    audio.play().catch(() => {});
  } catch {
    // Ignore
  }
}

export function renderJoinGate({
  container,
  roomInfo,
  initialError = '',
  onJoin,
}) {
  const overlay = document.createElement('div');
  overlay.className = 'screen-overlay';

  const count = roomInfo?.count ?? 0;
  const max = roomInfo?.max ?? 8;
  const isStreaming = Boolean(roomInfo?.streaming);

  overlay.innerHTML = `
    <div class="glass gate-card">
      <h1 class="gate-title">You're invited</h1>
      <div class="gate-meta">
        <span>${count} of ${max} seats taken</span>
        ${
          isStreaming
            ? `<span class="pill"><span class="live-dot"></span>Movie in progress</span>`
            : ''
        }
      </div>
      <div class="gate-form">
        <input
          type="text"
          class="text-input"
          id="join-gate-name"
          placeholder="Your name"
          maxlength="20"
          autocomplete="off"
        />
        <button type="button" class="btn-gold" id="join-gate-btn">Take a seat</button>
        <div class="inline-error" id="join-gate-error" aria-live="polite"></div>
      </div>
    </div>
  `;

  container.appendChild(overlay);

  const nameInput = overlay.querySelector('#join-gate-name');
  const joinBtn = overlay.querySelector('#join-gate-btn');
  const errorEl = overlay.querySelector('#join-gate-error');

  nameInput.value = getSavedOrDefaultName();
  if (initialError) {
    errorEl.textContent = initialError;
  }

  async function submitJoin() {
    errorEl.textContent = '';
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Please enter a name.';
      nameInput.focus();
      return;
    }

    unlockAudioGesture();

    try {
      localStorage.setItem('velvet:name', name);
    } catch {
      // Ignore
    }

    joinBtn.disabled = true;
    const result = await onJoin(name);
    if (result && !result.ok) {
      joinBtn.disabled = false;
      if (result.code === 'ROOM_FULL') {
        errorEl.textContent = 'This room is full.';
      } else if (result.code === 'INVALID_NAME') {
        errorEl.textContent = 'Please enter a name.';
      } else {
        errorEl.textContent = result.error || 'Could not join room.';
      }
    }
  }

  joinBtn.addEventListener('click', submitJoin);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitJoin();
    }
  });

  return {
    setError(msg) {
      errorEl.textContent = msg;
      joinBtn.disabled = false;
    },
    destroy() {
      overlay.remove();
    },
  };
}

export function renderStatusScreen({ container, title, message, onGoHome }) {
  const overlay = document.createElement('div');
  overlay.className = 'screen-overlay';

  overlay.innerHTML = `
    <div class="glass gate-card">
      <h1 class="gate-title">${title}</h1>
      <p style="margin:0;color:var(--muted);">${message}</p>
      <button type="button" class="btn-gold" id="status-home-btn">Create your own room</button>
    </div>
  `;

  container.appendChild(overlay);

  const homeBtn = overlay.querySelector('#status-home-btn');
  homeBtn.addEventListener('click', () => {
    onGoHome();
  });

  return {
    destroy() {
      overlay.remove();
    },
  };
}
