import {
  CHAT_RATE,
  REACTION_COOLDOWN_MS,
  HOST_RESYNC_COOLDOWN_MS,
} from './config.js';
import { AppError, ERROR_CODES, formatAckError } from './errors.js';
import { logger } from './logger.js';
import {
  getRoom,
  getCachedRoom,
  updateRoom,
  addMember,
  removeMember,
  takeSeat,
  moveMember,
  createChatMessage,
  pushChat,
  snapshot,
} from './rooms.js';
import {
  roomJoinSchema,
  seatTakeSchema,
  playerMoveSchema,
  chatSendSchema,
  reactionSendSchema,
  streamStartSchema,
  emptyPayloadSchema,
  rtcOfferSchema,
  rtcAnswerSchema,
  rtcIceSchema,
} from './schemas.js';

function parseOrThrow(schema, payload, eventName, socketId) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    logger.warn({ event: eventName, socketId, issues: result.error.issues }, 'Rejected socket payload');
    throw new AppError(ERROR_CODES.BAD_PAYLOAD, 'Invalid payload.');
  }
  return result.data;
}

function wrapAckHandler(socket, eventName, handler) {
  return async (payload, ack) => {
    const safeAck = typeof ack === 'function' ? ack : () => {};
    try {
      const response = await handler(payload);
      safeAck({ ok: true, ...response });
    } catch (err) {
      if (!(err instanceof AppError)) {
        logger.error({ err, event: eventName, socketId: socket.id }, 'Uncaught socket handler error');
      }
      safeAck(formatAckError(err));
    }
  };
}

function requireSocketMembership(socket) {
  const roomId = socket.data.roomId;
  const room = roomId ? getCachedRoom(roomId) : null;
  if (!roomId || !room?.members.has(socket.id)) {
    throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You have not joined a room.');
  }
  return room;
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.isHost = false;
    socket.data.hostSocketId = null;
    socket.data.replaced = false;
    socket.data.chatTimestamps = [];
    socket.data.lastReactionAt = 0;
    socket.data.lastResyncAt = 0;
    socket.data.lastPlayerMoveAt = 0;

    socket.on(
      'room:join',
      wrapAckHandler(socket, 'room:join', async (payload) => {
        const { roomId: rawRoomId, name, hostKey } = parseOrThrow(
          roomJoinSchema,
          payload,
          'room:join',
          socket.id
        );
        const roomId = rawRoomId.toLowerCase();

        if (socket.data.roomId && socket.data.roomId !== roomId) {
          const previousRoomId = socket.data.roomId;
          await updateRoom(previousRoomId, (previousRoom) => removeMember(previousRoom, socket.id));
          await socket.leave(previousRoomId);
        }

        const updated = await updateRoom(roomId, (room) => {
          const joinResult = addMember(room, socket.id, name, hostKey);
          const joinMessage = createChatMessage({ kind: 'system', text: `${joinResult.member.name} joined` });
          pushChat(room, joinMessage);
          return { ...joinResult, joinMessage };
        });
        if (!updated) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found');

        const { room, result } = updated;
        const { member, replacedHostSocketId, joinMessage } = result;
        if (replacedHostSocketId) {
          io.to(replacedHostSocketId).emit(
            'room:error',
            new AppError(ERROR_CODES.HOST_REPLACED, 'Host session was opened in another window.').toJSON()
          );
          io.in(replacedHostSocketId).disconnectSockets(true);
          io.to(room.id).emit('peer:left', { id: replacedHostSocketId });
        }

        await socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.isHost = member.isHost;
        socket.data.hostSocketId = room.hostSocketId;
        socket.data.replaced = false;

        socket.to(room.id).emit('peer:joined', { peer: member });
        if (member.isHost) socket.to(room.id).emit('host:returned', { id: socket.id });
        socket.to(room.id).emit('chat:message', joinMessage);

        logger.info(
          { roomId: room.id, name: member.name, memberCount: room.members.size, isHost: member.isHost },
          'Member joined room'
        );
        return { state: snapshot(room, socket.id) };
      })
    );

    socket.on(
      'seat:take',
      wrapAckHandler(socket, 'seat:take', async (payload) => {
        const { seatIndex } = parseOrThrow(seatTakeSchema, payload, 'seat:take', socket.id);
        const roomId = socket.data.roomId;
        if (!roomId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You have not joined a room.');
        const updated = await updateRoom(roomId, (room) => takeSeat(room, socket.id, seatIndex));
        if (!updated) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found');
        const member = updated.result;
        io.to(roomId).emit('seat:updated', { id: socket.id, seat: seatIndex, position: member.position });
        return {};
      })
    );

    socket.on('player:move', (payload) => {
      const parsed = playerMoveSchema.safeParse(payload);
      if (!parsed.success) return;
      const now = Date.now();
      if (now - socket.data.lastPlayerMoveAt < 65) return;
      socket.data.lastPlayerMoveAt = now;
      try {
        const room = requireSocketMembership(socket);
        const position = moveMember(room, socket.id, parsed.data);
        socket.to(room.id).emit('player:moved', { id: socket.id, position });
      } catch {
        // Ignore stale movement packets after a client disconnects or leaves.
      }
    });

    socket.on(
      'chat:send',
      wrapAckHandler(socket, 'chat:send', async (payload) => {
        const { text } = parseOrThrow(chatSendSchema, payload, 'chat:send', socket.id);
        const roomId = socket.data.roomId;
        if (!roomId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You have not joined a room.');
        const now = Date.now();
        socket.data.chatTimestamps = socket.data.chatTimestamps.filter((ts) => now - ts < CHAT_RATE.windowMs);
        if (socket.data.chatTimestamps.length >= CHAT_RATE.count) {
          logger.warn({ roomId, socketId: socket.id }, 'Chat rate limit hit');
          throw new AppError(ERROR_CODES.RATE_LIMITED, 'You are sending messages too fast. Please wait a moment.');
        }
        socket.data.chatTimestamps.push(now);

        const updated = await updateRoom(roomId, (room) => {
          const member = room.members.get(socket.id);
          if (!member) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You are not in this room.');
          const message = createChatMessage({ kind: 'user', from: member, text });
          return pushChat(room, message);
        });
        if (!updated) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found');
        io.to(roomId).emit('chat:message', updated.result);
        return {};
      })
    );

    socket.on(
      'reaction:send',
      wrapAckHandler(socket, 'reaction:send', async (payload) => {
        const { emoji } = parseOrThrow(reactionSendSchema, payload, 'reaction:send', socket.id);
        const room = requireSocketMembership(socket);
        const now = Date.now();
        if (now - socket.data.lastReactionAt < REACTION_COOLDOWN_MS) return {};
        socket.data.lastReactionAt = now;
        io.to(room.id).emit('reaction', { id: socket.id, emoji });
        return {};
      })
    );

    socket.on(
      'stream:start',
      wrapAckHandler(socket, 'stream:start', async (payload) => {
        const { kind } = parseOrThrow(streamStartSchema, payload, 'stream:start', socket.id);
        const roomId = socket.data.roomId;
        if (!roomId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You have not joined a room.');
        const updated = await updateRoom(roomId, (room) => {
          if (room.hostSocketId !== socket.id) throw new AppError(ERROR_CODES.NOT_HOST, 'Only the host can start the stream.');
          room.streaming = { active: true, kind };
        });
        if (!updated) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found');
        logger.info({ roomId, kind }, 'Stream started');
        io.to(roomId).emit('stream:started', { kind });
        return {};
      })
    );

    socket.on(
      'stream:stop',
      wrapAckHandler(socket, 'stream:stop', async (payload) => {
        parseOrThrow(emptyPayloadSchema, payload, 'stream:stop', socket.id);
        const roomId = socket.data.roomId;
        if (!roomId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You have not joined a room.');
        const updated = await updateRoom(roomId, (room) => {
          if (room.hostSocketId !== socket.id) throw new AppError(ERROR_CODES.NOT_HOST, 'Only the host can stop the stream.');
          room.streaming = { active: false, kind: null };
        });
        if (!updated) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found');
        logger.info({ roomId }, 'Stream stopped');
        io.to(roomId).emit('stream:stopped', {});
        return {};
      })
    );

    socket.on(
      'stream:resync',
      wrapAckHandler(socket, 'stream:resync', async (payload) => {
        parseOrThrow(emptyPayloadSchema, payload, 'stream:resync', socket.id);
        const roomId = socket.data.roomId;
        if (!roomId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You have not joined a room.');
        const room = await getRoom(roomId);
        if (!room?.members.has(socket.id)) throw new AppError(ERROR_CODES.NOT_IN_ROOM, 'You are not in this room.');
        if (room.hostSocketId === socket.id) throw new AppError(ERROR_CODES.BAD_PAYLOAD, 'Host cannot request stream resync.');
        const now = Date.now();
        if (now - socket.data.lastResyncAt < HOST_RESYNC_COOLDOWN_MS) return {};
        socket.data.lastResyncAt = now;
        socket.data.hostSocketId = room.hostSocketId;
        if (room.hostSocketId) io.to(room.hostSocketId).emit('stream:resync-request', { from: socket.id });
        return {};
      })
    );

    // WebRTC signaling is relayed through Socket.IO; SDP and ICE payloads are never logged.
    socket.on('rtc:offer', (payload) => {
      const parsed = rtcOfferSchema.safeParse(payload);
      if (!parsed.success || !socket.data.isHost || !socket.data.roomId) return;
      const { to, sdp } = parsed.data;
      if (to !== socket.id) io.to(to).emit('rtc:offer', { from: socket.id, sdp });
    });

    socket.on('rtc:answer', (payload) => {
      const parsed = rtcAnswerSchema.safeParse(payload);
      if (!parsed.success || socket.data.isHost || !socket.data.roomId) return;
      const { to, sdp } = parsed.data;
      if (to === socket.data.hostSocketId && to !== socket.id) {
        io.to(to).emit('rtc:answer', { from: socket.id, sdp });
      }
    });

    socket.on('rtc:ice', (payload) => {
      const parsed = rtcIceSchema.safeParse(payload);
      if (!parsed.success || !socket.data.roomId) return;
      const { to, candidate } = parsed.data;
      const authorized = socket.data.isHost
        ? to !== socket.id
        : to === socket.data.hostSocketId && to !== socket.id;
      if (authorized) io.to(to).emit('rtc:ice', { from: socket.id, candidate });
    });

    socket.on('disconnect', async () => {
      try {
        if (socket.data.replaced || !socket.data.roomId) return;
        const roomId = socket.data.roomId;
        const updated = await updateRoom(roomId, (room) => {
          const removed = removeMember(room, socket.id);
          if (!removed) return null;
          const { member, wasHost } = removed;
          const message = createChatMessage({
            kind: 'system',
            text: wasHost ? 'The host left' : `${member.name} left`,
          });
          pushChat(room, message);
          return { member, wasHost, message };
        });
        const result = updated?.result;
        if (!result) return;
        const { member, wasHost, message } = result;
        logger.info({ roomId, name: member.name, memberCount: updated.room.members.size, wasHost }, 'Member left room');
        socket.to(roomId).emit('peer:left', { id: socket.id });
        if (wasHost) {
          socket.to(roomId).emit('host:left', {});
          io.to(roomId).emit('stream:stopped', {});
        }
        socket.to(roomId).emit('chat:message', message);
      } catch (err) {
        logger.error({ err, socketId: socket.id }, 'Error handling socket disconnect');
      }
    });
  });
}
