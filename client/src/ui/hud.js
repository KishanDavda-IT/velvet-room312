import { EMOJIS, ICONS, STATUS_TEXT } from '../constants.js';
import { store } from '../store.js';
import { showToast } from './toast.js';

export function renderHud({
  container,
  onSendReaction,
  onVolumeChange,
  onToggleLights = () => true,
  onToggleCompanion = () => false,
  onToggleFirstPerson = () => false,
  onDrink = () => {},
  onToggleFullscreen = () => {},
  initialLightsEnabled = true,
  initialFirstPerson = false,
  initialVolume = 0.8,
}) {
  const hudRoot = document.createElement('div');
  hudRoot.className = 'hud-layer';

  // Top bar
  const topBar = document.createElement('div');
  topBar.className = 'hud-topbar';

  const logoEl = document.createElement('div');
  logoEl.className = 'glass hud-logo hud-interactive';
  logoEl.textContent = 'Velvet Room';

  const inviteUrl = `${window.location.origin}/r/${store.roomId}?join=1`;
  const inviteBtn = document.createElement('button');
  inviteBtn.type = 'button';
  inviteBtn.className = 'glass hud-invite-btn hud-interactive';
  inviteBtn.textContent = 'Invite';
  inviteBtn.setAttribute('aria-haspopup', 'dialog');
  inviteBtn.setAttribute('aria-expanded', 'false');

  const inviteBackdrop = document.createElement('div');
  inviteBackdrop.className = 'invite-backdrop hud-interactive';
  inviteBackdrop.hidden = true;
  inviteBackdrop.innerHTML = `
    <section class="invite-dialog glass" role="dialog" aria-modal="true" aria-labelledby="invite-title" aria-describedby="invite-description">
      <button class="invite-close icon-btn" type="button" aria-label="Close invite dialog">×</button>
      <span class="invite-eyebrow">VELVET ROOM</span>
      <h2 id="invite-title">Bring someone in</h2>
      <p id="invite-description">Share this room link so friends can join your screening.</p>
      <label class="invite-link-label" for="invite-link">Room link</label>
      <input id="invite-link" class="text-input invite-link-input" type="text" readonly>
      <div class="invite-actions">
        <button class="btn-gold invite-copy-btn" type="button">Copy invite link</button>
        <button class="btn-ghost invite-share-btn" type="button">Share…</button>
      </div>
    </section>
  `;
  const inviteInput = inviteBackdrop.querySelector('.invite-link-input');
  const inviteCopyBtn = inviteBackdrop.querySelector('.invite-copy-btn');
  const inviteShareBtn = inviteBackdrop.querySelector('.invite-share-btn');
  const inviteCloseBtn = inviteBackdrop.querySelector('.invite-close');
  inviteInput.value = inviteUrl;
  inviteShareBtn.hidden = typeof navigator.share !== 'function';

  function closeInviteDialog() {
    inviteBackdrop.hidden = true;
    inviteBtn.setAttribute('aria-expanded', 'false');
    inviteBtn.focus();
  }

  function openInviteDialog() {
    inviteBackdrop.hidden = false;
    inviteBtn.setAttribute('aria-expanded', 'true');
    inviteCopyBtn.focus();
  }

  async function copyInviteLink() {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        copied = true;
      }
    } catch {
      // Try the selection-based fallback below.
    }

    if (!copied && document.execCommand) {
      const fallback = document.createElement('textarea');
      fallback.value = inviteUrl;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.appendChild(fallback);
      fallback.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        fallback.remove();
      }
    }

    if (copied) {
      showToast('Invite link copied');
      return;
    }

    inviteInput.focus();
    inviteInput.select();
    showToast('Select and copy the room link');
  }

  inviteBtn.addEventListener('click', openInviteDialog);
  inviteCloseBtn.addEventListener('click', closeInviteDialog);
  inviteBackdrop.addEventListener('click', (event) => {
    if (event.target === inviteBackdrop) closeInviteDialog();
  });
  inviteCopyBtn.addEventListener('click', copyInviteLink);
  inviteShareBtn.addEventListener('click', async () => {
    try {
      await navigator.share({
        title: 'Join my Velvet Room',
        text: 'Come watch with me in Velvet Room.',
        url: inviteUrl,
      });
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Could not open sharing');
    }
  });
  function onInviteKeydown(event) {
    if (event.key === 'Escape' && !inviteBackdrop.hidden) closeInviteDialog();
  }
  document.addEventListener('keydown', onInviteKeydown);

  const countPill = document.createElement('div');
  countPill.className = 'pill hud-interactive';
  countPill.textContent = `${store.peers.size}/${store.maxRoomSize} in the room`;

  topBar.append(logoEl, inviteBtn, countPill);

  // Status pill under top bar, centered
  const statusWrap = document.createElement('div');
  statusWrap.className = 'hud-status-wrap';
  const statusPill = document.createElement('div');
  statusPill.className = 'pill hud-interactive';
  statusWrap.appendChild(statusPill);

  const quickControls = document.createElement('div');
  quickControls.className = 'hud-quick-controls hud-interactive';

  const lightsBtn = document.createElement('button');
  lightsBtn.type = 'button';
  lightsBtn.className = 'glass hud-quick-btn';

  function updateLightsButton(enabled) {
    lightsBtn.textContent = enabled ? 'Lights off' : 'Lights on';
    lightsBtn.title = enabled ? 'Turn room lights off' : 'Turn room lights on';
    lightsBtn.setAttribute('aria-pressed', String(!enabled));
  }

  updateLightsButton(initialLightsEnabled);
  lightsBtn.addEventListener('click', () => {
    updateLightsButton(onToggleLights());
  });

  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.type = 'button';
  fullscreenBtn.className = 'glass hud-quick-btn';

  function updateFullscreenButton() {
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenBtn.textContent = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
    fullscreenBtn.title = isFullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)';
    fullscreenBtn.setAttribute('aria-pressed', String(isFullscreen));
  }

  updateFullscreenButton();
  fullscreenBtn.addEventListener('click', onToggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);

  const companionBtn = document.createElement('button');
  companionBtn.type = 'button';
  companionBtn.className = 'glass hud-quick-btn';
  companionBtn.textContent = 'Spawn buddy';
  companionBtn.title = 'Have a seated companion join you';
  companionBtn.setAttribute('aria-pressed', 'false');
  companionBtn.addEventListener('click', () => {
    const visible = onToggleCompanion();
    companionBtn.textContent = visible ? 'Dismiss buddy' : 'Spawn buddy';
    companionBtn.title = visible ? 'Remove your seated companion' : 'Have a seated companion join you';
    companionBtn.setAttribute('aria-pressed', String(visible));
  });

  const firstPersonBtn = document.createElement('button');
  firstPersonBtn.type = 'button';
  firstPersonBtn.className = 'glass hud-quick-btn';
  firstPersonBtn.setAttribute('aria-pressed', String(initialFirstPerson));
  function updateFirstPersonButton(enabled) {
    firstPersonBtn.textContent = enabled ? 'Third person' : 'First person';
    firstPersonBtn.title = enabled ? 'Switch to third-person view (V)' : 'Switch to first-person view (V)';
    firstPersonBtn.setAttribute('aria-pressed', String(enabled));
  }
  updateFirstPersonButton(initialFirstPerson);
  function toggleFirstPerson() {
    updateFirstPersonButton(onToggleFirstPerson());
  }
  firstPersonBtn.addEventListener('click', toggleFirstPerson);

  const drinkBtn = document.createElement('button');
  drinkBtn.type = 'button';
  drinkBtn.className = 'glass hud-quick-btn';
  drinkBtn.textContent = 'Drink';
  drinkBtn.title = 'Have a drink from the counter';
  async function haveDrink() {
    drinkBtn.disabled = true;
    drinkBtn.textContent = 'Cheers!';
    try {
      await onDrink();
    } finally {
      window.setTimeout(() => {
        if (!drinkBtn.isConnected) return;
        drinkBtn.disabled = false;
        drinkBtn.textContent = 'Drink';
      }, 1500);
    }
  }
  drinkBtn.addEventListener('click', haveDrink);

  quickControls.append(lightsBtn, fullscreenBtn, companionBtn, firstPersonBtn, drinkBtn);

  function updateStatusPill(statusText) {
    statusPill.innerHTML = '';
    if (statusText === STATUS_TEXT.LIVE) {
      const dot = document.createElement('span');
      dot.className = 'live-dot';
      const label = document.createElement('span');
      label.textContent = 'LIVE';
      statusPill.append(dot, label);
    } else {
      statusPill.textContent = statusText;
    }
  }
  updateStatusPill(store.status);

  // Reactions bar (bottom-left)
  const reactionsBar = document.createElement('div');
  reactionsBar.className = 'glass hud-reactions hud-interactive';

  const movementHint = document.createElement('div');
  movementHint.className = 'glass hud-movement-hint hud-interactive';
  movementHint.textContent = 'WASD / arrows to move · drag to look';

  EMOJIS.forEach((emoji, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reaction-btn';
    btn.title = `Reaction ${index + 1}`;
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      onSendReaction(emoji);
    });
    reactionsBar.appendChild(btn);
  });

  // Volume bar (bottom-right)
  const volumeBar = document.createElement('div');
  volumeBar.className = 'glass hud-volume hud-interactive';

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'volume-icon-btn';
  muteBtn.title = 'Mute / Unmute (M)';
  muteBtn.setAttribute('aria-label', 'Toggle mute');
  muteBtn.innerHTML = ICONS.volume;

  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.className = 'volume-slider';
  volumeSlider.min = '0';
  volumeSlider.max = '1';
  volumeSlider.step = '0.01';
  volumeSlider.value = String(initialVolume);

  let currentVolume = initialVolume;
  let lastNonZeroVolume = initialVolume > 0 ? initialVolume : 0.8;
  let isMuted = initialVolume === 0;

  function applyVolume(vol, save = true) {
    currentVolume = Math.min(Math.max(Number(vol) || 0, 0), 1);
    isMuted = currentVolume === 0;
    if (currentVolume > 0) {
      lastNonZeroVolume = currentVolume;
    }
    volumeSlider.value = String(currentVolume);
    muteBtn.style.opacity = isMuted ? '0.4' : '0.95';
    if (save) {
      try {
        localStorage.setItem('velvet:volume', String(currentVolume));
      } catch {
        // Ignore
      }
    }
    onVolumeChange(currentVolume);
  }

  function toggleMute() {
    if (isMuted || currentVolume === 0) {
      applyVolume(lastNonZeroVolume || 0.8);
    } else {
      applyVolume(0);
    }
  }

  volumeSlider.addEventListener('input', () => {
    applyVolume(Number(volumeSlider.value));
  });
  muteBtn.addEventListener('click', toggleMute);

  volumeBar.append(muteBtn, volumeSlider);
  hudRoot.append(topBar, statusWrap, quickControls, movementHint, reactionsBar, volumeBar, inviteBackdrop);
  container.appendChild(hudRoot);

  const visibilityToggle = document.createElement('button');
  visibilityToggle.type = 'button';
  visibilityToggle.className = 'glass hud-visibility-toggle';
  visibilityToggle.setAttribute('aria-pressed', 'false');
  visibilityToggle.setAttribute('aria-label', 'Hide user interface');
  visibilityToggle.title = 'Hide controls (H)';
  visibilityToggle.innerHTML = '<span class="hud-visibility-icon" aria-hidden="true">◉</span><span class="hud-visibility-label">Hide UI</span>';
  container.appendChild(visibilityToggle);

  const offPeers = store.on('peers', () => {
    countPill.textContent = `${store.peers.size}/${store.maxRoomSize} in the room`;
  });

  const offStatus = store.on('status', (statusText) => {
    updateStatusPill(statusText);
  });

  let theaterHidden = false;
  function setTheaterMode(hidden) {
    theaterHidden = Boolean(hidden);
    hudRoot.classList.toggle('hud-hidden', theaterHidden);
    visibilityToggle.setAttribute('aria-pressed', String(theaterHidden));
    visibilityToggle.setAttribute('aria-label', theaterHidden ? 'Show user interface' : 'Hide user interface');
    visibilityToggle.title = theaterHidden ? 'Show controls (H)' : 'Hide controls (H)';
    visibilityToggle.querySelector('.hud-visibility-label').textContent = theaterHidden ? 'Show UI' : 'Hide UI';
    visibilityToggle.querySelector('.hud-visibility-icon').textContent = theaterHidden ? '◎' : '◉';
  }

  visibilityToggle.addEventListener('click', () => setTheaterMode(!theaterHidden));

  return {
    hudRoot,
    toggleMute,
    getVolume() {
      return currentVolume;
    },
    isTheaterMode() {
      return theaterHidden;
    },
    setTheaterMode,
    toggleFirstPerson,
    toggleTheaterMode() {
      setTheaterMode(!theaterHidden);
    },
    destroy() {
      offPeers();
      offStatus();
      document.removeEventListener('fullscreenchange', updateFullscreenButton);
      document.removeEventListener('keydown', onInviteKeydown);
      hudRoot.remove();
      visibilityToggle.remove();
    },
  };
}
