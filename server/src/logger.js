import pino from 'pino';
import { CONFIG } from './config.js';

export const logger = pino({
  level: CONFIG.LOG_LEVEL,
  redact: {
    paths: ['hostKey', '*.hostKey', 'sdp', '*.sdp', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
});

export default logger;
