export const ERROR_CODES = Object.freeze({
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  INVALID_NAME: 'INVALID_NAME',
  SEAT_TAKEN: 'SEAT_TAKEN',
  NOT_HOST: 'NOT_HOST',
  RATE_LIMITED: 'RATE_LIMITED',
  BAD_PAYLOAD: 'BAD_PAYLOAD',
  HOST_REPLACED: 'HOST_REPLACED',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  INTERNAL: 'INTERNAL',
});

const DEFAULT_MESSAGES = Object.freeze({
  ROOM_NOT_FOUND: 'Room not found',
  ROOM_FULL: 'This room is full.',
  INVALID_NAME: 'Please enter a name.',
  SEAT_TAKEN: 'That seat is already taken.',
  NOT_HOST: 'Only the host can perform this action.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
  BAD_PAYLOAD: 'Invalid request payload.',
  HOST_REPLACED: 'Host session was taken over by another tab.',
  NOT_IN_ROOM: 'You are not in a room.',
  INTERNAL: 'Something went wrong',
});

export class AppError extends Error {
  constructor(code, message = DEFAULT_MESSAGES[code] || 'Error', details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

export function formatAckError(err) {
  if (err instanceof AppError) {
    return { ok: false, ...err.toJSON() };
  }
  return {
    ok: false,
    error: 'Something went wrong',
    code: ERROR_CODES.INTERNAL,
    details: null,
  };
}
