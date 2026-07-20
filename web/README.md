# PaperHood Web

Next.js frontend for the PaperHood paper trading terminal on Robinhood Chain.

## Stack

- Next.js 14 app router, TypeScript, Tailwind
- wagmi + viem for wallet connect and SIWE sign-in (injected wallets: MetaMask, Rabby)
- lightweight-charts (TradingView OSS) for candles
- Live prices over the API's WebSocket

## Pages

- `/` screener: tradeable universe, price (USD/ETH toggle), 24h change, liquidity, volume; sortable, searchable, live WS prices; click a row to trade
- `/t/[address]` trade view: candlestick chart (1m/5m/1h), buy/sell panel with live quote preview (amount out, exec price, price impact with color warnings above 2% and 5%, fee tier, route), position summary
- `/portfolio` balances in USD and ETH, open positions marked to exit, unrealized and realized season PnL, trade history
- `/leaderboard` daily and weekly realized PnL, your row highlighted

## Setup

```bash
cd web
npm install
```

## Env vars

| Var | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8787` | PaperHood API base URL |
| `NEXT_PUBLIC_DEV_AUTH` | unset | `1` shows the Dev login button (API must run with `DEV_AUTH=1`) |
| `NEXT_PUBLIC_RH_RPC` | public placeholder | RPC used by wagmi for the injected chain config; signing does not need it |

Create `web/.env.local` for local overrides.

## Dev workflow

Run the full stack (three processes):

```bash
# 1. indexer (needs RH_RPC_HTTP from the repo-root ../.env.local)
cd indexer && npm run dev

# 2. API
cd api && DEV_AUTH=1 WEB_ORIGIN=http://localhost:3000 npm run dev

# 3. web
cd web && NEXT_PUBLIC_API_URL=http://localhost:8787 NEXT_PUBLIC_DEV_AUTH=1 npm run dev
```

Open http://localhost:3000. Use Dev login (amber button) or a real injected wallet.

Auth flow (SIWE): connect wallet, fetch `/auth/nonce`, sign an EIP-4361 message (`viem/siwe` `createSiweMessage`, chainId 4663), POST `/auth/verify`; the session lives in an httpOnly cookie, all requests use `credentials: include`.

## Build

```bash
npm run build && npm start
```

## Deploy

- Web: Vercel works out of the box (framework preset Next.js, root directory `web`, no vercel.json needed). Env vars on Vercel:
  - `NEXT_PUBLIC_API_URL`: the public API URL, for example `https://api.paperhood.xyz` or the Railway service URL. Baked in at build time; redeploy after changing it. It drives every REST call and the WebSocket URL (`ws(s)://` is derived from it in `src/lib/ws.ts`).
  - Do not set `NEXT_PUBLIC_DEV_AUTH` in production.
  - `NEXT_PUBLIC_RH_RPC` optional (wagmi chain config only; signing does not need it).
- API + indexer cannot run on Vercel: they are persistent 24/7 processes with a shared SQLite file. Host both on a small VPS (or Railway/Fly) behind HTTPS. On the API set `WEB_ORIGIN` to the Vercel domain, `SIWE_DOMAIN` to the web host (for example `app.paperhood.xyz`), a real `JWT_SECRET`, and leave `DEV_AUTH` unset.
- Cookies are SameSite=Lax; the browser sends them cross-origin on top-level navigation but fetch needs CORS with credentials, which the API already handles via `WEB_ORIGIN`. Keep web and API on sibling subdomains of the same site for the least friction.
