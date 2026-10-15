<div align="center">

# 🛋️ Velvet Room

**A multiplayer 3D cinema where friends can meet, chat, and watch together.**

Create a room, share an invite link, and join the movie from your browser.

[Live demo](https://velvet-room312.vercel.app) · [Report a bug](https://github.com/KishanDavda-IT/velvet-room/issues/new) · [Request a feature](https://github.com/KishanDavda-IT/velvet-room/issues/new)

[![MIT License](https://img.shields.io/github/license/KishanDavda-IT/velvet-room)](LICENSE) [![Deploy on Vercel](https://img.shields.io/badge/Deploy%20on-Vercel-black?logo=vercel)](https://vercel.com/)

</div>

---

## Features

- **Shared 3D room:** walk around with an avatar and meet up to seven other people.
- **First- and third-person views:** choose how you want to explore the room.
- **Room invites:** copy a link so friends can join from their browsers.
- **Chat and reactions:** send messages and quick emoji reactions.
- **Watch together:** the host can share a screen with audio, play a local video, or choose a public-domain film.
- **Cinema controls:** adjust the room lights, sit, hide the interface, and use fullscreen viewing.
- **Room extras:** enjoy drinks and a seated companion.
- **No installation:** open the live demo or run the project locally in a browser.

## Live demo

Try Velvet Room at **[velvet-room312.vercel.app](https://velvet-room312.vercel.app)**. Open it in two browser windows to try the room with another guest.

## Tech stack

| Area | Technology |
| --- | --- |
| Client and 3D scene | JavaScript, Three.js, Vite |
| Realtime room and chat | Node.js, Express, Socket.IO |
| Shared room state | In-memory storage locally; Redis and the Socket.IO Redis adapter for multi-instance deployments |
| Screen and video sharing | WebRTC with STUN; optional TURN relay |
| Movie catalog | Public-domain films hosted by Internet Archive |
| Hosting | Vercel or Docker |

## Project structure

```text
velvet-room/
├── api/             # Vercel API and Socket.IO routes
├── client/          # Browser UI, 3D room, and media controls
├── server/          # Realtime server and room logic
├── .env.example     # Environment variable template
├── Dockerfile       # Container build
├── vercel.json      # Vercel build and routing settings
├── package.json     # Workspace scripts
└── LICENSE          # MIT License
```

## Run locally

### Requirements

- Node.js 20 or later
- npm

### Start the app

```bash
git clone https://github.com/KishanDavda-IT/velvet-room.git
cd velvet-room
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Open [http://localhost:5173](http://localhost:5173). The Vite client runs on port `5173`; the realtime server runs on port `3001`.

Redis is optional for local development. Without `REDIS_URL`, rooms use in-memory state and are cleared when the server restarts. Set `REDIS_URL` when you want to test Redis-backed room state locally.

### Environment variables

Start with [`.env.example`](.env.example). The main settings are:

| Variable | Purpose |
| --- | --- |
| `PORT` | Realtime server port; defaults to `3001`. |
| `PUBLIC_ORIGIN` | Allowed client origin during local development; defaults to `http://localhost:5173`. |
| `REDIS_URL` | Upstash Redis TLS connection URL. Optional locally; required on Vercel for shared room state and Socket.IO broadcasts. |
| `STUN_URLS` | Comma-separated STUN servers used to establish WebRTC connections. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Optional TURN relay credentials for networks that block direct WebRTC connections. |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_KEY_SECRET` | Optional server-side credentials for Cloudflare Realtime TURN. Keep the secret private. |
| `MAX_ROOM_SIZE` | Maximum room size, including the host; defaults to `8`. |
| `ROOM_EMPTY_TTL_MS` | How long an empty room is retained; defaults to `60000` ms. |
| `VIDEO_MAX_BITRATE` | Per-viewer screen-share video bitrate cap; defaults to `4000000` bits/sec. |
| `LOG_LEVEL` | Server log level; defaults to `info`. |

Do not commit real credentials or put server secrets in client-side `VITE_` variables.

## Play together

1. Open the app and create a room.
2. Use **Invite** to copy the room link and send it to friends.
3. Move with **WASD** or the arrow keys; drag to look around.
4. The host can share a screen, select a local video, or open the movie library.

When sharing a browser tab, enable the browser's **Share tab audio** option so guests can hear it.

### Keyboard controls

| Key | Action |
| --- | --- |
| WASD / Arrow keys | Move |
| Drag | Look around |
| V | Toggle first-person view |
| H | Hide or show the interface |
| F | Toggle fullscreen |
| M | Mute or unmute |
| Enter | Open chat |
| 1–6 | Send an emoji reaction |
| Escape | Close chat or show the interface |

## Deploy

### Vercel

The repository includes a `vercel.json` configuration. Import the repository with its root as the project root; it uses `npm run build` and serves the client from `client/dist`.

Add `REDIS_URL` as a server-side environment variable. Use the Upstash Redis **TLS/TCP connection URL** (`rediss://...`); REST credentials alone do not provide the Redis Pub/Sub connection used by Socket.IO. Optional Cloudflare TURN credentials can improve connectivity on restrictive networks.

Vercel Functions have a configured maximum duration of 300 seconds. If a connection reaches that limit, clients reconnect; the host may need to restart an active screen share.

### Docker

```bash
docker build -t velvet-room .
docker run --rm -p 3001:3001 --env-file .env velvet-room
```

The container exposes port `3001`. Set `REDIS_URL` when you need room state shared across instances.

## How it works

```text
Browser A ── Socket.IO ── Realtime server ── Redis (when configured)
    │                           │
    └──────── WebRTC media ─────┴──────── Browser B
                    STUN / optional TURN
```

Room membership and chat use Socket.IO. Redis stores shared room state and broadcasts events when configured. Screen and video streams use WebRTC between participants, with TURN available as a relay when direct connections are blocked.

## Known limitations

- Screen-share quality depends on the host's upload connection and each viewer's network.
- Some networks block direct WebRTC connections; configure TURN for those cases.
- On Vercel, a function reconnect can interrupt a screen-share session.
- Public-domain movie playback depends on the availability of the external movie host.

## Contributing

Bug reports and pull requests are welcome. For a bug report, include the steps to reproduce it, your browser, and any relevant error message. Do not include private room links, credentials, or other secrets.

1. Fork the repository.
2. Create a branch: `git checkout -b feature/your-feature`.
3. Commit your changes: `git commit -m "Add your feature"`.
4. Push the branch and open a pull request.

## License

Velvet Room is licensed under the MIT License. See [`LICENSE`](LICENSE) for the full text.

## Maintainer

[Kishan Davda](https://github.com/KishanDavda-IT)

---

If you enjoy the project, consider giving it a ⭐.
