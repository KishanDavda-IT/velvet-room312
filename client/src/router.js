export const ROOM_PATH_RE = /^\/r\/([a-z2-9]{8})$/;
const ROOM_CODE_RE = /^[a-z2-9]{8}$/;

export function parseRoomInput(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (ROOM_CODE_RE.test(trimmed)) {
    return trimmed;
  }

  const directMatch = trimmed.match(ROOM_PATH_RE);
  if (directMatch) {
    return directMatch[1];
  }

  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:5173';
    const url = new URL(trimmed, base);
    const match = url.pathname.toLowerCase().match(ROOM_PATH_RE);
    if (match) {
      return match[1];
    }
  } catch {
    // Ignore invalid URL
  }
  return null;
}

export function matchRoute(pathname = typeof window !== 'undefined' ? window.location.pathname : '/') {
  if (pathname === '/' || pathname === '') {
    return { name: 'landing', roomId: null };
  }
  const match = pathname.toLowerCase().match(ROOM_PATH_RE);
  if (match) {
    return { name: 'room', roomId: match[1] };
  }
  return { name: 'not-found', roomId: null };
}

let routeHandler = null;

export function navigate(path, { replace = false } = {}) {
  if (typeof window !== 'undefined') {
    if (replace) {
      window.history.replaceState({}, '', path);
    } else {
      window.history.pushState({}, '', path);
    }
  }
  if (routeHandler) {
    routeHandler(matchRoute());
  }
}

export function initRouter(onRoute) {
  routeHandler = onRoute;
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
      if (routeHandler) {
        routeHandler(matchRoute(window.location.pathname));
      }
    });
  }
  routeHandler(matchRoute());
}
