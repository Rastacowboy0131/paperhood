# PaperHood API

REST + WebSocket layer over the indexer's SQLite data and the sim engine. Fastify, TypeScript, Node 22+ (uses `node:sqlite`).

## Run

```bash
cd api
npm install
# env: RH_RPC_HTTP required (auto-loaded from ../../.env.local by the engine)
DEV_AUTH=1 npm run dev          # local dev, fake login, port 8787
npm test                        # endpoint tests, no network needed
```

Run alongside the indexer: the indexer must be running (or have recently run) so `indexer/data/paperhood.sqlite` has fresh pools/snapshots/candles. The API opens the same file in WAL mode; both processes coexist fine. Check freshness at `GET /health` (`snapshotAgeS`).

## Env vars

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `RH_RPC_HTTP` | yes | | QuickNode RPC, loaded from `../../.env.local` locally or set directly in prod, never committed |
| `DATA_DIR` | prod yes | `../indexer/data` | directory holding `paperhood.sqlite`; point at a persistent volume in prod |
| `JWT_SECRET` | prod yes | dev fallback under DEV_AUTH | signs session JWTs |
| `DEV_AUTH` | no | | `1` enables `GET /auth/dev` fake wallet login |
| `SIWE_DOMAIN` | recommended in prod | accept message's own domain | pins the `domain` field of SIWE messages, e.g. `app.paperhood.xyz` |
| `WEB_ORIGIN` | no | allow all | comma-separated CORS origins |
| `PORT` / `HOST` | no | 8787 / 0.0.0.0 | |
| `WS_PUSH_INTERVAL_MS` | no | 5000 | ws push cadence |

## Auth

Sign-In with Ethereum (SIWE, EIP-4361). Users authenticate with their wallet; sessions are httpOnly `ph_session` cookies (HS256 JWT, 7 day expiry, SameSite=Lax, Secure in production). Rewards are later paid to the signed-in address.

Flow:

1. `GET /auth/nonce` -> `{"nonce":"a1b2c3...","expiresInS":300}`. Nonces are single use and expire after 5 minutes.
2. Frontend builds an EIP-4361 message and has the wallet sign it (`personal_sign`). Required fields:
   - `domain`: the site the user is on, e.g. `app.paperhood.xyz` (checked against `SIWE_DOMAIN` when set)
   - `address`: the wallet address (EIP-55 checksummed)
   - `uri`: the origin URL, e.g. `https://app.paperhood.xyz`
   - `version`: `"1"`
   - `chainId`: `4663` (Robinhood chain) or `1` (mainnet); anything else is rejected
   - `nonce`: the value from step 1
   - `issuedAt` (auto with most SIWE libs); optional `expirationTime`/`notBefore` are honored

   With viem: `createSiweMessage({ address, chainId: 4663, domain, nonce, uri, version: "1" })` then `walletClient.signMessage({ message })`.
3. `POST /auth/verify` with `{"message":"<full SIWE message string>","signature":"0x..."}`. On success the API creates/finds the user by lowercase address and sets the session cookie. Response: `{"ok":true,"user":{"userId":1,"address":"0x..."}}`.
4. All authed requests just need `credentials: "include"` on fetch; no token handling in JS.

Other auth routes: `GET /auth/me` (current session: `{user:{userId,address,createdAt}}` or 401), `POST /auth/logout` (clears cookie), and in dev mode `GET /auth/dev?address=0x...` (fake wallet login, no signature).

Sample exchange with a throwaway key (see also the SIWE tests in `test/api.test.ts`):

```bash
# 1. nonce
curl -s http://localhost:8787/auth/nonce
# {"nonce":"3f9c0a1d2b4e5f6a7b8c9d0e","expiresInS":300}

# 2. sign locally (throwaway key) with viem
node --input-type=module -e '
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
const account = privateKeyToAccount(generatePrivateKey());
const message = createSiweMessage({ address: account.address, chainId: 4663, domain: "localhost:8787", nonce: "3f9c0a1d2b4e5f6a7b8c9d0e", uri: "http://localhost:8787", version: "1" });
const signature = await account.signMessage({ message });
console.log(JSON.stringify({ message, signature }));
'

# 3. verify (paste the JSON from step 2 as the body), keep the cookie
curl -s -c /tmp/ph.jar -H "Content-Type: application/json" -d @body.json http://localhost:8787/auth/verify
# {"ok":true,"user":{"userId":1,"address":"0x..."}}

# 4. authed requests
curl -s -b /tmp/ph.jar http://localhost:8787/auth/me
curl -s -b /tmp/ph.jar http://localhost:8787/portfolio
```

## Endpoints

### GET /tokens

Universe list (canonical = deepest active pool per token), sorted by liquidity.

```json
{"ethUsd":1868.39,"tokens":[{"address":"0x020b...18b4","symbol":"CASHCAT","name":"CashCat","pair":"0xA70f...E313","dex":"uniswap","version":"v3","liquidityUsd":3169378.86,"volume24hUsd":6473386.19,"priceQuote":0.0000374,"priceUsd":0.0698,"change24hPct":0.42}]}
```

`priceQuote` is the raw snapshot ratio in quote-token (WETH) units; `priceUsd` applies the engine's ETH/USD rate.

### GET /tokens/:address

Detail + latest price + pool info. 404 if not in universe.

### GET /tokens/:address/candles?tf=1m|5m|1h&limit=N

OHLC from the indexer's 1m candles; 5m/1h are aggregated server-side. `limit` max 1000, default 300. Candle: `{t, o, h, l, c}` with `t` in unix seconds, bucket-aligned.

```json
{"pair":"0x905A...2A6e","tf":"5m","candles":[{"t":1784525400,"o":960597.95,"h":960597.95,"l":960597.95,"c":960597.95}]}
```

Prices in candles are quote-token ratios (multiply by `ethUsd` for USD).

### POST /quote

Body: `{"tokenIn":"0x..","tokenOut":"0x..","amountIn":"raw integer string"}`. One side must be a universe token; its canonical pool is used. Rate limited 60/min per user or IP.

```json
{"pair":"0x905A...2A6e","tokenIn":"0x0bd7...ad73","tokenOut":"0x57a9...8419","amountIn":"1000000000000000000","amountOut":"957697818910557661420933","spotPrice":960597.95,"execPrice":957697.81,"priceImpactPct":0.3019,"feePaid":"3000000000000000","feeTier":3000,"path":"v3-quoter"}
```

`path` is `v2-reserves`, `v3-quoter` (exact on-chain math), or `v3-approx` (single-tick fallback; the UI should warn or cap size).

### POST /trade (auth)

Body: `{"token":"0x..","side":"buy"|"sell","amount":...}`. Buy: `amount` is USD to spend (number or string). Sell: `amount` is the raw token quantity as an integer string (use `qty` from `/portfolio`). Rate limited 20/min per user. Overdrafts and oversells return 400 with a message.

```json
{"tradeId":3,"side":"buy","token":"0x020b...18b4","usdIn":1000,"tokensOut":"14246160340860588862819","execPriceUsd":0.07019,"priceImpactPct":0.4989,"path":"v3-quoter"}
{"tradeId":4,"side":"sell","token":"0x020b...18b4","tokensIn":"14246160340860588862819","usdOut":979.55,"realizedPnlUsd":-20.44,"priceImpactPct":1.5536,"path":"v3-quoter"}
```

### GET /portfolio (auth)

Cash + equity in USD and ETH, positions marked at exit (quote selling the full position now), realized/unrealized PnL, and up to 200 recent trades this season.

```json
{"user":{"address":"0xaaaa...aaaa","display":"0xaaaa...aaaa"},"cashUsd":9000,"cashEth":4.8169,"equityUsd":9979.55,"equityEth":5.3412,"realizedPnlUsd":0,"unrealizedPnlUsd":-20.44,"positions":[{"token":"0x020b...18b4","symbol":"CASHCAT","name":"CashCat","pair":"0xA70f...E313","qty":"14246160340860588862819","qtyDec":14246.16,"costBasisUsd":1000,"markUsd":979.55,"unrealizedPnlUsd":-20.44}],"history":[...]}
```

Positions include `symbol` and `name`; history rows include `symbol`, `name`, and `realizedPnlUsd` (per-trade realized PnL on sells, `null` on buys), so the frontend needs no client-side joins.

### GET /leaderboard?period=daily|weekly

Realized PnL only (locked decision). Weekly is per-season (fresh 10k every Monday 00:00 UTC); daily counts sells closed since 00:00 UTC.

```json
{"period":"weekly","entries":[{"userId":2,"address":"0x1111111111111111111111111111111111111111","display":"0x1111...1111","realizedPnlUsd":-20.44,"pnlPct":-0.204,"trades":2}]}
```

### GET /health

`{"ok":true,"activePools":137,"latestSnapshotTs":1784525460,"snapshotAgeS":42}`

## WebSocket /ws

Connect to `ws://host/ws`. Messages are JSON.

Client -> server:

```json
{"op":"subscribe","tokens":["0x020b...18b4"]}
{"op":"unsubscribe","tokens":["0x..."]}
{"op":"subscribe_leaderboard"}
{"op":"unsubscribe_leaderboard"}
```

Server -> client (pushed every `WS_PUSH_INTERVAL_MS`, only when values change; immediately on subscribe):

```json
{"type":"prices","updates":[{"token":"0x020b...18b4","pair":"0xA70f...E313","price":0.0000374,"ts":1784525460}]}
{"type":"leaderboard","daily":[...],"weekly":[...]}
```

`price` is the quote-token ratio from the latest snapshot (same as `priceQuote` in `/tokens`).

## Notes for the frontend

- All token quantities cross the wire as raw integer strings; convert with the token's `decimals` from `GET /tokens/:address`.
- Cookie auth: use `credentials: "include"` and same-site or properly CORS-configured origins (`WEB_ORIGIN`).
- Thin pools are honest here: marks are at exit, so dumping a large position into a shallow pool shows heavy impact (that is by design, see the smoke test where a $500 buy in a near-dead pool marked at $0.23).
- Some stock-token pools have near-zero real volume and stale prices off-hours; `liquidityUsd` and `volume24hUsd` are the signals to surface.
