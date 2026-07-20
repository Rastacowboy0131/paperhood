# PaperHood

Paper trading terminal for Robinhood Chain (Arbitrum Orbit, chain ID 4663).

Trade tokenized stocks and top-liquidity dex tokens with a simulated AMM engine that fills against real on-chain Uniswap pool state, so slippage and price impact are real. Shared leaderboard (realized PnL), daily and weekly rewards.

## Layout

- `indexer/` - pool discovery + reserve/tick polling from RH chain (QuickNode RPC)
- `engine/` - simulated AMM fills (uni v2 constant product; v3/v4 tick math), portfolio ledger
- `api/` - REST/WebSocket API serving the web terminal
- `web/` - Next.js terminal (screener, trade panel, portfolio, leaderboard), Sign-In with Ethereum (SIWE)
- `docs/` - blueprint and design docs

## Status

Early scaffold. See `docs/BLUEPRINT.md` for the plan.

## Deploy

Two pieces: the backend (indexer + API, one long-running service) and the web frontend.

### Backend on Railway (indexer + API, single service)

The repo root has a `Dockerfile` and `railway.json`. `scripts/start.mjs` supervises both processes in one container (they share the SQLite file in WAL mode) and restarts either on crash with backoff.

1. Create a Railway project from this GitHub repo (root directory `/`). Railway picks up `railway.json` and builds the Dockerfile.
2. Add a volume mounted at `/app/data` (SQLite persistence; without it, history resets on every deploy).
3. Set service variables:
   - `RH_RPC_HTTP` (required): QuickNode HTTP RPC URL. Never commit this.
   - `RH_RPC_WSS` (optional, reserved for future websocket subscriptions).
   - `JWT_SECRET` (required): long random string, signs session cookies. `openssl rand -hex 32`.
   - `WEB_ORIGIN` (required for the browser): the Vercel URL, e.g. `https://paperhood.vercel.app` (comma-separated list allowed). Referred to as CORS_ORIGIN in some notes; the variable name is `WEB_ORIGIN`.
   - `SIWE_DOMAIN` (recommended): the web host, e.g. `paperhood.vercel.app`.
   - `PORT`: Railway injects this automatically; the API honors it (defaults to 8787).
   - `DATA_DIR`: already set to `/app/data` in the Dockerfile; override only if the volume mounts elsewhere.
   - Leave `DEV_AUTH` unset in production.
4. Deploy. Health check is `GET /health` (`snapshotAgeS` should stay under ~30s once the indexer warms up).
5. Generate a public domain for the service (Settings, Networking) and use it as the API URL.

CLI alternative once logged in (`railway login`): `railway init`, `railway volume add -m /app/data`, `railway variables set RH_RPC_HTTP=... JWT_SECRET=... WEB_ORIGIN=...`, `railway up`.

### Web on Vercel

1. Import the GitHub repo in Vercel, set root directory to `web` (framework preset Next.js, no vercel.json needed).
2. Set env vars:
   - `NEXT_PUBLIC_API_URL`: the Railway public URL, e.g. `https://paperhood-api.up.railway.app`. Build-time value; redeploy after changing.
   - Do not set `NEXT_PUBLIC_DEV_AUTH`.
3. Deploy, then set the resulting domain as `WEB_ORIGIN` and `SIWE_DOMAIN` on the Railway service.

CLI alternative: `cd web && vercel --prod` (set the env vars first with `vercel env add`).

Cookies are SameSite=Lax and CORS is credentialed; keeping web and API on sibling subdomains of one apex domain is the least-friction setup, but separate vercel.app/railway.app domains work for fetch-based auth.
