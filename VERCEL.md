# Deploy Velvet Room to Vercel

The repository is configured to build the client as a Vercel static site and route `/api/*` requests, including Socket.IO, through a Vercel Function. Room data and cross-instance broadcasts use Upstash Redis.

## Setup

1. Import this repository into Vercel with the repository root as the project root. Keep the detected npm install command and use `npm run build` as the build command. The output directory is `client/dist`.
2. Add an Upstash Redis database from the Vercel Marketplace and set `REDIS_URL` to its TLS connection URL (`rediss://...`). The REST-only URL and token are not enough; Socket.IO needs Redis Pub/Sub.
3. Add `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_SECRET` if screen sharing should work across restrictive networks. Keep the secret in Vercel's server-side environment variables.
4. Deploy. The site and API use the same Vercel domain, so room invite links need no separate API host setting.

## Notes

Vercel Hobby Functions have a 300-second maximum duration. Socket.IO clients reconnect and rejoin the room when that limit closes a connection. A reconnect can interrupt an active screen-share session, so the host may need to start sharing again. Upstash usage and limits depend on the selected plan.
