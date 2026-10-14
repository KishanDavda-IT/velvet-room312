# Velvet Room

A multiplayer 3D hangout room with chat, screen sharing, and public-domain movie playback.

## Run locally

Install dependencies with `npm install`, then start the app with `npm run dev`.

## Deploy to Vercel

See [VERCEL.md](VERCEL.md) for setup instructions. The deployment needs an Upstash Redis TCP connection URL in the `REDIS_URL` environment variable. Cloudflare TURN credentials can be added for screen sharing across restrictive networks.
