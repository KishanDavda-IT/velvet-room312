export async function createRoom() {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Failed to create room');
    err.code = data.code || 'INTERNAL';
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getRoomInfo(roomId) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    return {
      exists: false,
      code: data.code || 'ROOM_NOT_FOUND',
      error: data.error || 'Room not found',
    };
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Failed to check room');
    err.code = data.code || 'INTERNAL';
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getIceConfig() {
  const res = await fetch('/api/ice');
  if (!res.ok) {
    return {
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
      maxBitrate: 1500000,
    };
  }
  return res.json();
}

export async function searchMovies({ query = '', genre = '', page = 1 } = {}) {
  const params = new URLSearchParams({
    q: query,
    genre,
    page: String(page),
  });
  const res = await fetch(`/api/movies?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Could not load the movie catalog.');
  }
  return data;
}

export async function getMovieStream(identifier) {
  const res = await fetch(`/api/movies/${encodeURIComponent(identifier)}/stream`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Could not load this movie.');
  }
  return data;
}
