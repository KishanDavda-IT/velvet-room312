import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { AppError, ERROR_CODES } from './errors.js';
import { createRoom, getRoom, getRoomCount } from './rooms.js';
import { registerSocketHandlers } from './socket.js';
import { configureRedisAdapter, requireSharedRoomStore } from './redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_ADVANCED_SEARCH = 'https://archive.org/advancedsearch.php';
const ARCHIVE_METADATA = 'https://archive.org/metadata';
const MOVIE_PAGE_SIZE = 24;
const UNSUITABLE_MOVIE_TERMS = /\b(?:adult\s+film|adults?\s+only|porn(?:ography|ographic)?|erotic|nudity|nude|striptease|xxx|stag\s+film|bare\s+mountain)\b/i;

const MOVIE_GENRES = Object.freeze({
  horror: 'subject:(horror* OR "Horror films")',
  'sci-fi': 'subject:("Science fiction" OR "Science fiction films")',
  comedy: 'subject:(comedy* OR "Comedy films")',
  crime: 'subject:(crime* OR "Crime films")',
  western: 'subject:(western* OR "Western films")',
  animation: 'subject:(animation* OR cartoons)',
  documentary: 'subject:(documentary* OR "Documentary films")',
});

function isPublicDomain(record) {
  const rights = Array.isArray(record.rights) ? record.rights.join(' ') : String(record.rights || '');
  const license = String(record.licenseurl || '');
  return /public\s*domain/i.test(rights) || /creativecommons\.org\/publicdomain\//i.test(license);
}

function normalizeMovieRecord(record) {
  return {
    identifier: String(record.identifier || ''),
    title: Array.isArray(record.title) ? record.title[0] : String(record.title || 'Untitled film'),
    creator: Array.isArray(record.creator) ? record.creator.join(', ') : String(record.creator || ''),
    year: String(record.year || record.date || '').slice(0, 4),
    description: Array.isArray(record.description)
      ? record.description[0]
      : String(record.description || ''),
    downloads: Number(record.downloads) || 0,
    licenseurl: String(record.licenseurl || ''),
    detailsUrl: `https://archive.org/details/${encodeURIComponent(String(record.identifier || ''))}`,
  };
}

function hasMpeg4(record) {
  const formats = Array.isArray(record.format) ? record.format.join(' ') : String(record.format || '');
  return /mpeg\s?-?4/i.test(formats);
}

async function fetchArchiveJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new Error(`Internet Archive returned ${response.status}`);
  }
  return response.json();
}

function movieFileFromMetadata(data) {
  const metadata = data.metadata || {};
  const rightsRecord = {
    rights: metadata.rights,
    licenseurl: metadata.licenseurl,
  };
  if (!isPublicDomain(rightsRecord)) return null;

  const files = (data.files || []).filter((file) => {
    const name = String(file.name || '').toLowerCase();
    const size = Number(file.size) || 0;
    return name.endsWith('.mp4') && (!size || size <= 2_000_000_000);
  });
  files.sort((a, b) => {
    const rank = (file) => {
      const name = String(file.name || '').toLowerCase();
      return name.endsWith('.ia.mp4') ? 0 : /iphone|ipod|psp/.test(name) ? 1 : 2;
    };
    return rank(a) - rank(b) || (Number(a.size) || Infinity) - (Number(b.size) || Infinity);
  });
  return files[0] || null;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  if (CONFIG.NODE_ENV !== 'production') {
    app.use(
      cors({
        origin: CONFIG.PUBLIC_ORIGIN,
      })
    );
  }

  const createRoomLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn({ ip: req.ip }, 'Room creation rate limit hit');
      const err = new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many rooms created. Please try again in a minute.'
      );
      res.status(429).json(err.toJSON());
    },
  });

  const iceConfigLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/api/rooms', createRoomLimiter, async (req, res, next) => {
    try {
      const { roomId, hostKey } = await createRoom();
      res.status(201).json({ roomId, hostKey });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/rooms/:roomId', async (req, res, next) => {
    try {
      const room = await getRoom(req.params.roomId);
      if (!room) {
        const err = new AppError(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found');
        return res.status(404).json(err.toJSON());
      }
      return res.status(200).json({
        exists: true,
        count: room.members.size,
        max: CONFIG.MAX_ROOM_SIZE,
        streaming: room.streaming.active,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/ice', iceConfigLimiter, async (req, res) => {
    const turnKeyId = CONFIG.CLOUDFLARE_TURN_KEY_ID;
    const turnKeySecret = CONFIG.CLOUDFLARE_TURN_KEY_SECRET;

    if (turnKeyId && turnKeySecret) {
      try {
        const credentialsResponse = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${turnKeySecret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ttl: 86400 }),
            signal: AbortSignal.timeout(10000),
          }
        );
        const credentials = await credentialsResponse.json().catch(() => null);
        if (!credentialsResponse.ok || !Array.isArray(credentials?.iceServers)) {
          logger.warn(
            { status: credentialsResponse.status },
            'Cloudflare TURN credential request failed'
          );
          return res.status(503).json({ error: 'Screen-sharing relay is temporarily unavailable.' });
        }

        return res.status(200).json({
          iceServers: credentials.iceServers,
          maxBitrate: CONFIG.VIDEO_MAX_BITRATE,
        });
      } catch (err) {
        logger.warn({ err }, 'Cloudflare TURN credential request failed');
        return res.status(503).json({ error: 'Screen-sharing relay is temporarily unavailable.' });
      }
    }

    if (turnKeyId || turnKeySecret) {
      logger.error('Cloudflare TURN requires both CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_SECRET');
      return res.status(503).json({ error: 'Screen-sharing relay is not configured correctly.' });
    }

    const iceServers = [{ urls: [...CONFIG.STUN_URLS] }];
    if (CONFIG.TURN_URL) {
      const turnServer = { urls: CONFIG.TURN_URL };
      if (CONFIG.TURN_USERNAME) turnServer.username = CONFIG.TURN_USERNAME;
      if (CONFIG.TURN_CREDENTIAL) turnServer.credential = CONFIG.TURN_CREDENTIAL;
      iceServers.push(turnServer);
    }
    res.status(200).json({
      iceServers,
      maxBitrate: CONFIG.VIDEO_MAX_BITRATE,
    });
  });

  app.get('/api/movies', async (req, res) => {
    const page = Math.min(1000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
    const search = String(req.query.q || '')
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .trim()
      .slice(0, 80);
    const genre = String(req.query.genre || '').toLowerCase();
    const clauses = [
      'collection:feature_films',
      'mediatype:movies',
      'rights:"Public Domain"',
      'format:"MPEG4"',
    ];
    if (MOVIE_GENRES[genre]) clauses.push(MOVIE_GENRES[genre]);
    if (search) {
      const words = search.split(/\s+/).filter(Boolean).slice(0, 6);
      for (const word of words) {
        const term = word.replace(/([+\-!(){}\[\]^"~*?:\\/])/g, '\\$1');
        clauses.push(`(title:${term}* OR creator:${term}* OR subject:${term}*)`);
      }
    }

    const url = new URL(ARCHIVE_ADVANCED_SEARCH);
    url.searchParams.set('q', clauses.join(' AND '));
    for (const field of ['identifier', 'title', 'creator', 'year', 'date', 'description', 'downloads', 'rights', 'licenseurl', 'format']) {
      url.searchParams.append('fl[]', field);
    }
    url.searchParams.set('rows', String(MOVIE_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('output', 'json');
    url.searchParams.append('sort[]', 'downloads desc');

    try {
      const data = await fetchArchiveJson(url);
      const response = data.response || {};
      const items = (response.docs || [])
        .filter((record) => {
          const text = [record.title, record.description, record.subject]
            .flat(Infinity)
            .filter(Boolean)
            .join(' ');
          return record.identifier && isPublicDomain(record) && hasMpeg4(record) && !UNSUITABLE_MOVIE_TERMS.test(text);
        })
        .map(normalizeMovieRecord);
      return res.status(200).json({
        source: 'Internet Archive',
        page,
        pageSize: MOVIE_PAGE_SIZE,
        total: Number(response.numFound) || items.length,
        items,
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'Internet Archive movie search failed');
      return res.status(502).json({ error: 'The movie catalog is temporarily unavailable.' });
    }
  });

  app.get('/api/movies/:identifier/stream', async (req, res) => {
    const identifier = String(req.params.identifier || '');
    if (!/^[a-zA-Z0-9._-]{5,80}$/.test(identifier) || identifier.includes('..')) {
      return res.status(400).json({ error: 'Invalid movie identifier.' });
    }

    try {
      const data = await fetchArchiveJson(`${ARCHIVE_METADATA}/${encodeURIComponent(identifier)}`);
      const file = movieFileFromMetadata(data);
      if (!file) {
        return res.status(404).json({ error: 'No public-domain MP4 stream is available for this title.' });
      }

      const filePath = String(file.name).split('/').map(encodeURIComponent).join('/');
      return res.status(200).json({
        identifier,
        title: data.metadata?.title || identifier,
        url: `https://cors.archive.org/cors/${encodeURIComponent(identifier)}/${filePath}`,
        sourceUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
      });
    } catch (err) {
      logger.warn({ err: err.message, identifier }, 'Internet Archive movie lookup failed');
      return res.status(502).json({ error: 'Could not load this movie from Internet Archive.' });
    }
  });

  const healthHandler = async (_req, res, next) => {
    try {
      res.status(200).json({ ok: true, rooms: await getRoomCount() });
    } catch (err) {
      next(err);
    }
  };
  app.get('/healthz', healthHandler);
  app.get('/api/healthz', healthHandler);

  if (CONFIG.NODE_ENV === 'production') {
    const clientDist = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
      }
      return res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Fallback error handler
  app.use((err, req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(400).json(err.toJSON());
    }
    if (String(err?.message || '').includes('REDIS_URL')) {
      logger.error({ err }, 'Vercel room storage is not configured');
      return res.status(503).json({
        error: 'Room storage is not configured. Add the Upstash REDIS_URL to this Vercel project.',
      });
    }
    logger.error({ err }, 'Unhandled Express error');
    return res.status(500).json({
      error: 'Something went wrong',
      code: ERROR_CODES.INTERNAL,
      details: null,
    });
  });

  return app;
}

export function createServer() {
  const app = createApp();
  const httpServer = http.createServer(app);

  const ioOptions =
    CONFIG.NODE_ENV === 'production'
      ? { path: process.env.VERCEL ? '/api/socket.io' : '/socket.io' }
      : {
          cors: {
            origin: CONFIG.PUBLIC_ORIGIN,
            methods: ['GET', 'POST'],
          },
        };

  const io = new SocketIOServer(httpServer, ioOptions);
  const redisAdapterReady = configureRedisAdapter(io);
  io.use(async (_socket, next) => {
    try {
      requireSharedRoomStore();
      await redisAdapterReady;
      next();
    } catch (err) {
      next(err);
    }
  });
  registerSocketHandlers(io);

  return { app, httpServer, io, redisAdapterReady };
}

// Start server if invoked directly
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { httpServer } = createServer();
  httpServer.listen(CONFIG.PORT, () => {
    logger.info(
      { port: CONFIG.PORT, env: CONFIG.NODE_ENV },
      'Velvet Room server listening'
    );
  });
}
