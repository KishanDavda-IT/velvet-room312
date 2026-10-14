import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { logger } from './logger.js';

const redisUrl = process.env.REDIS_URL;

export const redis = redisUrl
  ? new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    })
  : null;

if (redis) {
  redis.on('error', (err) => logger.error({ message: err.message }, 'Redis connection error'));
}

let redisReadyPromise = null;
let adapterReadyPromise = null;

export function requireSharedRoomStore() {
  if (!redis && process.env.VERCEL) {
    throw new Error('REDIS_URL is required to run Velvet Room on Vercel.');
  }
}

export async function ensureRedisReady() {
  requireSharedRoomStore();
  if (!redis) return null;
  if (!redisReadyPromise) {
    redisReadyPromise = redis.connect().catch((err) => {
      redisReadyPromise = null;
      throw err;
    });
  }
  await redisReadyPromise;
  return redis;
}

export function configureRedisAdapter(io) {
  if (!redis) return Promise.resolve(false);
  if (!adapterReadyPromise) {
    adapterReadyPromise = (async () => {
      await ensureRedisReady();
      const pubClient = redis.duplicate();
      const subClient = redis.duplicate();
      pubClient.on('error', (err) => logger.error({ message: err.message }, 'Redis adapter publisher error'));
      subClient.on('error', (err) => logger.error({ message: err.message }, 'Redis adapter subscriber error'));
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      return true;
    })().catch((err) => {
      adapterReadyPromise = null;
      throw err;
    });
  }
  return adapterReadyPromise;
}

export async function ensureSocketAdapterReady() {
  if (!redis) {
    requireSharedRoomStore();
    return false;
  }
  // The first Socket.IO server is responsible for attaching the shared adapter.
  if (!adapterReadyPromise) return false;
  return adapterReadyPromise;
}
