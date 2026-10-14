import crypto from 'node:crypto';
import { customAlphabet, nanoid } from 'nanoid';
import {
  CONFIG,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  NAME_MAX_LEN,
  CHAT_HISTORY,
  PALETTE,
} from './config.js';
import { AppError, ERROR_CODES } from './errors.js';
import { stripControlChars } from './schemas.js';
import { logger } from './logger.js';
import { ensureRedisReady, redis, requireSharedRoomStore } from './redis.js';

const generateRoomId = customAlphabet(ROOM_ID_ALPHABET, ROOM_ID_LENGTH);
const ROOM_KEY_PREFIX = 'velvet:room:';
const ROOM_LOCK_PREFIX = 'velvet:room-lock:';
const ACTIVE_ROOM_TTL_SECONDS = 60 * 60 * 24;

/** Local cache used for fast, high-frequency player movement updates. */
/** @type {Map<string, any>} */
export const rooms = new Map();

function roomKey(roomId) {
  return `${ROOM_KEY_PREFIX}${roomId}`;
}

function serializeRoom(room) {
  return JSON.stringify({
    id: room.id,
    hostKey: room.hostKey,
    hostSocketId: room.hostSocketId,
    createdAt: room.createdAt,
    members: Array.from(room.members.values()),
    streaming: room.streaming,
    chat: room.chat,
  });
}

function deserializeRoom(serialized) {
  const data = JSON.parse(serialized);
  return {
    ...data,
    members: new Map((data.members || []).map((member) => [member.id, member])),
    emptyTimer: null,
  };
}

function startEmptyTimer(room) {
  if (room.emptyTimer) clearTimeout(room.emptyTimer);
  room.emptyTimer = setTimeout(() => {
    rooms.delete(room.id);
    logger.info({ roomId: room.id }, 'Room deleted after empty TTL');
  }, CONFIG.ROOM_EMPTY_TTL_MS);
  if (typeof room.emptyTimer.unref === 'function') room.emptyTimer.unref();
}

export async function saveRoom(room) {
  requireSharedRoomStore();
  rooms.set(room.id, room);
  if (!redis) return;

  const client = await ensureRedisReady();
  const ttlSeconds = room.members.size === 0
    ? Math.max(1, Math.ceil(CONFIG.ROOM_EMPTY_TTL_MS / 1000))
    : ACTIVE_ROOM_TTL_SECONDS;
  await client.set(roomKey(room.id), serializeRoom(room), 'EX', ttlSeconds);
}

export async function createRoom() {
  const client = await ensureRedisReady();
  let roomId = generateRoomId();
  let room;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    roomId = generateRoomId();
    if (redis) {
      const alreadyExists = await client.exists(roomKey(roomId));
      if (alreadyExists) continue;
    } else if (rooms.has(roomId)) {
      continue;
    }
    room = {
      id: roomId,
      hostKey: crypto.randomBytes(16).toString('hex'),
      hostSocketId: null,
      createdAt: Date.now(),
      members: new Map(),
      streaming: { active: false, kind: null },
      chat: [],
      emptyTimer: null,
    };
    break;
  }
  if (!room) throw new Error('Could not allocate a unique room ID.');

  await saveRoom(room);
  if (!redis) startEmptyTimer(room);
  logger.info({ roomId }, 'Room created');
  return { roomId, hostKey: room.hostKey };
}

export async function getRoom(roomId) {
  if (!roomId || typeof roomId !== 'string') return undefined;
  const normalizedId = roomId.toLowerCase();
  requireSharedRoomStore();
  if (!redis) return rooms.get(normalizedId);

  const client = await ensureRedisReady();
  const serialized = await client.get(roomKey(normalizedId));
  if (!serialized) {
    rooms.delete(normalizedId);
    return undefined;
  }
  const room = deserializeRoom(serialized);
  rooms.set(normalizedId, room);
  return room;
}

export function getCachedRoom(roomId) {
  return roomId && rooms.get(roomId.toLowerCase());
}

export async function getRoomCount() {
  requireSharedRoomStore();
  if (!redis) return rooms.size;
  const client = await ensureRedisReady();
  let cursor = '0';
  let count = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${ROOM_KEY_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;
    count += keys.length;
  } while (cursor !== '0');
  return count;
}

/** Serialize mutations for a room across Vercel function instances. */
export async function updateRoom(roomId, updater) {
  const normalizedId = roomId.toLowerCase();
  requireSharedRoomStore();
  if (!redis) {
    const room = rooms.get(normalizedId);
    if (!room) return null;
    const result = updater(room);
    await saveRoom(room);
    return { room, result };
  }

  const client = await ensureRedisReady();
  const lockKey = `${ROOM_LOCK_PREFIX}${normalizedId}`;
  const lockToken = crypto.randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    acquired = (await client.set(lockKey, lockToken, 'PX', 5000, 'NX')) === 'OK';
    if (acquired) break;
    await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 20)));
  }
  if (!acquired) throw new Error('Room is busy. Please retry.');

  try {
    const serialized = await client.get(roomKey(normalizedId));
    if (!serialized) return null;
    const room = deserializeRoom(serialized);
    const result = updater(room);
    await saveRoom(room);
    return { room, result };
  } finally {
    await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      lockToken
    );
  }
}

function pickColor(room) {
  const usedColors = new Set(Array.from(room.members.values(), (member) => member.color));
  for (const color of PALETTE) {
    if (!usedColors.has(color)) return color;
  }
  return PALETTE[room.members.size % PALETTE.length];
}

function pickLowestFreeSeat(room) {
  const takenSeats = new Set(Array.from(room.members.values(), (member) => member.seat));
  for (let index = 0; index < 8; index += 1) {
    if (!takenSeats.has(index)) return index;
  }
  return 0;
}

function getSeatPosition(seatIndex) {
  const columns = [-3.6, -1.2, 1.2, 3.6];
  const row = seatIndex < 4 ? 0 : 1;
  return {
    x: columns[seatIndex % 4],
    y: row === 0 ? 0 : 0.5,
    z: row === 0 ? 0 : 3,
    yaw: 0,
    moving: false,
  };
}

function getFloorHeight(x, z) {
  return z >= 1.25 && z <= 4.75 && Math.abs(x) <= 6 ? 0.5 : 0;
}

export function addMember(room, socketId, rawName, hostKey) {
  const name = stripControlChars(typeof rawName === 'string' ? rawName : '');
  if (name.length < 1 || name.length > NAME_MAX_LEN) {
    throw new AppError(ERROR_CODES.INVALID_NAME, 'Please enter a name.');
  }

  const isHost = Boolean(hostKey && hostKey === room.hostKey);
  const existingHostId = room.hostSocketId && room.hostSocketId !== socketId && room.members.has(room.hostSocketId)
    ? room.hostSocketId
    : null;
  const isReplacingHost = isHost && existingHostId !== null;
  const alreadyMember = room.members.has(socketId);
  if (!isReplacingHost && !alreadyMember && room.members.size >= CONFIG.MAX_ROOM_SIZE) {
    throw new AppError(ERROR_CODES.ROOM_FULL, 'This room is full.');
  }

  let replacedHostSocketId = null;
  let preferredSeat = null;
  let preferredColor = null;
  let preferredPosition = null;
  if (isReplacingHost && existingHostId) {
    const previousHost = room.members.get(existingHostId);
    if (previousHost) {
      preferredSeat = previousHost.seat;
      preferredColor = previousHost.color;
      preferredPosition = previousHost.position ? { ...previousHost.position } : null;
    }
    room.members.delete(existingHostId);
    replacedHostSocketId = existingHostId;
  }

  const seat = preferredSeat !== null ? preferredSeat : pickLowestFreeSeat(room);
  const color = preferredColor !== null ? preferredColor : pickColor(room);
  const member = {
    id: socketId,
    name,
    color,
    seat,
    isHost,
    position: preferredPosition || getSeatPosition(seat),
  };
  room.members.set(socketId, member);
  if (isHost) room.hostSocketId = socketId;
  return { member, replacedHostSocketId };
}

export function removeMember(room, socketId) {
  const member = room.members.get(socketId);
  if (!member) return null;
  room.members.delete(socketId);
  const wasHost = room.hostSocketId === socketId || member.isHost;
  if (wasHost) {
    room.hostSocketId = null;
    room.streaming = { active: false, kind: null };
  }
  if (room.members.size === 0 && !redis) startEmptyTimer(room);
  return { member, wasHost };
}

export function takeSeat(room, socketId, seatIndex) {
  const member = room.members.get(socketId);
  if (!member) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You are not in this room.');
  for (const other of room.members.values()) {
    if (other.id !== socketId && other.seat === seatIndex) {
      throw new AppError(ERROR_CODES.SEAT_TAKEN, 'That seat is already taken.');
    }
  }
  member.seat = seatIndex;
  member.position = getSeatPosition(seatIndex);
  return member;
}

export function moveMember(room, socketId, { x, z, yaw, moving }) {
  const member = room.members.get(socketId);
  if (!member) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You are not in this room.');
  member.position = { x, y: getFloorHeight(x, z), z, yaw, moving };
  return member.position;
}

export function createChatMessage({ kind, from = null, text }) {
  return {
    id: nanoid(12),
    kind,
    from: from ? { id: from.id, name: from.name, color: from.color } : null,
    text,
    ts: new Date().toISOString(),
  };
}

export function pushChat(room, message) {
  room.chat.push(message);
  if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
  return message;
}

export function snapshot(room, forSocketId) {
  return {
    roomId: room.id,
    selfId: forSocketId,
    isHost: room.hostSocketId === forSocketId,
    peers: Array.from(room.members.values()).map((member) => ({
      id: member.id,
      name: member.name,
      color: member.color,
      seat: member.seat,
      isHost: member.isHost,
      position: member.position ? { ...member.position } : getSeatPosition(member.seat),
    })),
    streaming: { active: room.streaming.active, kind: room.streaming.kind },
    chat: [...room.chat],
    maxRoomSize: CONFIG.MAX_ROOM_SIZE,
  };
}
