import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

function parseNumber(val, fallback) {
  if (val === undefined || val === null || String(val).trim() === '') {
    return fallback;
  }
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

const rawStun = process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';
const stunUrls = rawStun
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (stunUrls.length === 0) {
  stunUrls.push('stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302');
}

export const ROOM_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const ROOM_ID_LENGTH = 8;
export const NAME_MAX_LEN = 20;
export const CHAT_MAX_LEN = 200;
export const CHAT_HISTORY = 50;
export const CHAT_RATE = Object.freeze({ count: 5, windowMs: 5000 });
export const REACTION_COOLDOWN_MS = 300;
export const HOST_RESYNC_COOLDOWN_MS = 5000;
export const EMOJIS = Object.freeze(['👍', '😂', '😮', '❤️', '👏', '😢']);
export const PALETTE = Object.freeze([
  '#e8a33d',
  '#e0566b',
  '#5aa9e6',
  '#7bc67b',
  '#b48ead',
  '#f2c94c',
  '#56cfe1',
  '#ff8a65',
]);

export const CONFIG = Object.freeze({
  PORT: parseNumber(process.env.PORT, 3001),
  NODE_ENV: (process.env.NODE_ENV || 'development').trim(),
  PUBLIC_ORIGIN: (process.env.PUBLIC_ORIGIN || 'http://localhost:5173').trim(),
  STUN_URLS: Object.freeze(stunUrls),
  TURN_URL: (process.env.TURN_URL || '').trim(),
  TURN_USERNAME: (process.env.TURN_USERNAME || '').trim(),
  TURN_CREDENTIAL: (process.env.TURN_CREDENTIAL || '').trim(),
  CLOUDFLARE_TURN_KEY_ID: (process.env.CLOUDFLARE_TURN_KEY_ID || '').trim(),
  CLOUDFLARE_TURN_KEY_SECRET: (process.env.CLOUDFLARE_TURN_KEY_SECRET || '').trim(),
  MAX_ROOM_SIZE: clamp(Math.floor(parseNumber(process.env.MAX_ROOM_SIZE, 8)), 2, 8),
  ROOM_EMPTY_TTL_MS: Math.max(1000, parseNumber(process.env.ROOM_EMPTY_TTL_MS, 60000)),
  VIDEO_MAX_BITRATE: Math.max(100000, parseNumber(process.env.VIDEO_MAX_BITRATE, 4000000)),
  LOG_LEVEL: (process.env.LOG_LEVEL || 'info').trim(),
});

export default CONFIG;
