import { z } from 'zod';
import { CHAT_MAX_LEN, EMOJIS } from './config.js';

export function stripControlChars(str) {
  return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

export const roomJoinSchema = z.object({
  roomId: z.string().trim().min(1).max(32),
  name: z.string(),
  hostKey: z.string().optional(),
});

export const seatTakeSchema = z.object({
  seatIndex: z.number().int().min(0).max(7),
});

export const playerMoveSchema = z.object({
  x: z.number().finite().min(-7.2).max(7.2),
  z: z.number().finite().min(-9.2).max(9.2),
  yaw: z.number().finite().min(-Math.PI).max(Math.PI),
  moving: z.boolean(),
});

export const chatSendSchema = z.object({
  text: z
    .string()
    .transform((val) => stripControlChars(val))
    .pipe(z.string().min(1).max(CHAT_MAX_LEN)),
});

export const reactionSendSchema = z.object({
  emoji: z.enum(EMOJIS),
});

export const streamStartSchema = z.object({
  kind: z.enum(['screen', 'file']),
});

export const emptyPayloadSchema = z.object({}).passthrough().optional().default({});

export const rtcOfferSchema = z.object({
  to: z.string().min(1),
  sdp: z.string().min(1),
});

export const rtcAnswerSchema = z.object({
  to: z.string().min(1),
  sdp: z.string().min(1),
});

export const rtcIceSchema = z.object({
  to: z.string().min(1),
  candidate: z.record(z.any()).nullable(),
});
