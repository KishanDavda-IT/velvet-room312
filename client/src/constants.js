export const ROOM   = { W: 16, H: 7, D: 20 };            // x: -8..8, y: 0..7, z: -10..10
export const SCREEN = { W: 9.6, H: 5.4, CENTER: [0, 3.6, -9.85] };  // 16:9
export const SEAT_COLS_X = [-3.6, -1.2, 1.2, 3.6];
export const SEAT_ROWS = [ { z: 0, y: 0 }, { z: 3, y: 0.5 } ];       // row 1 sits on a 0.5 m riser
export const SEATS = SEAT_ROWS.flatMap((r, ri) =>
  SEAT_COLS_X.map((x, ci) => ({ index: ri * 4 + ci, pos: [x, r.y, r.z] })));   // 8 seats, index 0..7
export const EYE_HEIGHT = 1.35;                          // above seat y
export const PALETTE = ['#e8a33d','#e0566b','#5aa9e6','#7bc67b','#b48ead','#f2c94c','#56cfe1','#ff8a65'];
export const EMOJIS = ['👍','😂','😮','❤️','👏','😢'];

export const STATUS_TEXT = Object.freeze({
  WAITING: 'Waiting for the host to start the movie…',
  CONNECTING: 'Connecting to stream…',
  RECONNECTING: 'Reconnecting…',
  LIVE: 'LIVE',
  HOST_LEFT: 'The host left. The room will wait for them.',
});

export const ICONS = Object.freeze({
  send: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
  monitor: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`,
  film: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  volume: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
});
