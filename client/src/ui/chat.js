import { ICONS } from '../constants.js';
import { store } from '../store.js';
import { showToast } from './toast.js';

export function renderChat({ container, onSendMessage }) {
  const chatPanel = document.createElement('aside');
  chatPanel.className = 'glass hud-chat hud-interactive';

  let isCollapsed = false;
  try {
    const saved = localStorage.getItem('velvet:chat');
    if (saved !== null) {
      isCollapsed = saved === 'collapsed';
    } else if (window.innerWidth < 768) {
      isCollapsed = true;
    }
  } catch {
    if (window.innerWidth < 768) {
      isCollapsed = true;
    }
  }

  const header = document.createElement('div');
  header.className = 'chat-header';

  const title = document.createElement('span');
  title.className = 'chat-header-title';
  title.textContent = 'Chat';

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'chat-collapse-btn';
  collapseBtn.setAttribute('aria-label', 'Toggle chat');
  collapseBtn.innerHTML = ICONS.chevronDown;

  header.append(title, collapseBtn);

  const messageList = document.createElement('div');
  messageList.className = 'chat-messages';

  const inputRow = document.createElement('div');
  inputRow.className = 'chat-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-input';
  input.placeholder = 'Say something…';
  input.maxLength = 200;
  input.autocomplete = 'off';

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'chat-send-btn';
  sendBtn.title = 'Send message';
  sendBtn.setAttribute('aria-label', 'Send message');
  sendBtn.innerHTML = ICONS.send;

  inputRow.append(input, sendBtn);
  chatPanel.append(header, messageList, inputRow);
  container.appendChild(chatPanel);

  function applyCollapsedState(collapsed) {
    isCollapsed = Boolean(collapsed);
    chatPanel.classList.toggle('collapsed', isCollapsed);
    document.body.classList.toggle('chat-is-collapsed', isCollapsed);
    try {
      localStorage.setItem('velvet:chat', isCollapsed ? 'collapsed' : 'open');
    } catch {
      // Ignore
    }
  }

  applyCollapsedState(isCollapsed);

  header.addEventListener('click', () => {
    applyCollapsedState(!isCollapsed);
  });

  function isNearBottom() {
    const distance =
      messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    return distance <= 80;
  }

  function scrollToBottom() {
    messageList.scrollTop = messageList.scrollHeight;
  }

  function appendMessageElement(msg, forceScroll = false) {
    if (!msg) return;
    const shouldScroll = forceScroll || isNearBottom();

    const row = document.createElement('div');
    if (msg.kind === 'system' || !msg.from) {
      row.className = 'chat-msg system';
      row.textContent = msg.text || '';
    } else {
      row.className = 'chat-msg';
      const whoSpan = document.createElement('span');
      whoSpan.className = 'who';
      whoSpan.style.color = msg.from.color || '#f4ecdc';
      whoSpan.textContent = msg.from.name || 'Guest';

      const textSpan = document.createElement('span');
      textSpan.textContent = msg.text || '';

      row.append(whoSpan, textSpan);
    }

    messageList.appendChild(row);
    if (shouldScroll) {
      scrollToBottom();
    }
  }

  // Render initial chat history
  for (const msg of store.chat) {
    appendMessageElement(msg, true);
  }

  async function submitChat() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const res = await onSendMessage(text);
    if (res && !res.ok && res.error) {
      showToast(res.error);
    }
  }

  sendBtn.addEventListener('click', submitChat);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submitChat();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      input.blur();
    }
  });

  return {
    chatPanel,
    appendMessage: appendMessageElement,
    focusInput() {
      if (isCollapsed) {
        applyCollapsedState(false);
      }
      input.focus();
    },
    blurInput() {
      input.blur();
    },
    isInputFocused() {
      return document.activeElement === input;
    },
    destroy() {
      document.body.classList.remove('chat-is-collapsed');
      chatPanel.remove();
    },
  };
}
