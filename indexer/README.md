# PaperHood Indexer

Discovers Uniswap pools on Robinhood Chain (chain ID 4663) and polls their on-chain state so the sim engine can quote realistic AMM fills.

## Run

```bash
cd indexer
npm install
# env: RH_RPC_HTTP is required (see ../.env.example)
set -a; source ../../.env.local; set +a   # or export RH_RPC_HTTP=...
npm run dev        # tsx, dev mode
npm run build && npm start   # compiled
```

Config env vars (defaults in parens): `RH_RPC_HTTP` (required), `MIN_LIQ_USD` (3000), `POLL_INTERVAL_MS` (10000), `DISCOVERY_INTERVAL_MS` (900000).

Data lands in `indexer/data/paperhood.sqlite` (gitignored). Tables:

- `pools`: tradeable universe (token, symbol, pair, dex, version, quote token, liquidity, vol24h, active flag)
- `snapshots`: raw pool state, pruned to last 24h. v2 rows have reserve0/reserve1; v3 rows have sqrt_price_x96/tick/liquidity. `price` is a raw ratio (not decimal-adjusted); the sim engine should work from raw reserves/sqrtPrice.
- `candles`: 1-minute OHLC built from snapshot prices, kept forever

## Implementation notes / findings (2026-07-20)

- SQLite via Node's built-in `node:sqlite` (Node 22.5+). better-sqlite3 was dropped because the deploy box has no C toolchain; zero native deps now.
- Dexscreener chain slug is `robinhood`, confirmed live. There is no list-all-pairs endpoint, so discovery fans out ~20 search queries and keeps anything with `chainId === "robinhood"`. First run: 298 pairs seen, 137 active at >= $3000 liquidity (114 v3, 23 v2). v4 pairs exist (labels `v4`) but are skipped for now per blueprint phasing.
- Multicall3 is deployed at the canonical `0xcA11bde05977b3631167028862bE2a173976CA11` (verified via eth_getCode). All pool reads go through one multicall per 10s tick.
- Verified against the live QuickNode RPC: 134 of 137 pools snapshotted per tick (a few fail multicall, likely nonstandard contracts; they are skipped via allowFailure). ~800 snapshots and ~270 candles after 60s.
- Poll failures trigger exponential backoff (doubles, capped at 120s extra) then reset on success. No rate limiting observed at 10s intervals on the current QuickNode tier.

## Notes for the sim engine

- v3 dominates the chain (114 of 137 pools). The constant-product-only fill model from the blueprint is not enough; v3 tick-based quoting is needed for most of the universe. A cheap v1 approximation: treat v3 as constant product around the current price using `liquidity` and `sqrtPriceX96` (valid for small trades within the current tick), and cap trade size accordingly.
- v3 fee tier is not stored yet (needs a `fee()` call per pool at discovery time); add before fills charge real fees.
- Token decimals are not fetched yet; `price` in snapshots is a raw ratio. Fetch decimals per token (one-time, cache in pools table) before showing human prices.
