let stackEl = null;

function ensureStack() {
  if (stackEl && document.body.contains(stackEl)) {
    return stackEl;
  }
  stackEl = document.createElement('div');
  stackEl.className = 'toast-stack';
  document.body.appendChild(stackEl);
  return stackEl;
}

export function showToast(text, ms = 3500) {
  if (!text) return;
  const container = ensureStack();

  const item = document.createElement('div');
  item.className = 'glass toast-item';
  item.setAttribute('role', 'status');
  item.textContent = text;
  container.appendChild(item);

  // Trigger 150ms fade-in
  requestAnimationFrame(() => {
    item.classList.add('toast-visible');
  });

  setTimeout(() => {
    item.classList.remove('toast-visible');
    item.classList.add('toast-hiding');
    setTimeout(() => {
      item.remove();
    }, 250);
  }, ms);
}
