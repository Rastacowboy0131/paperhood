# PaperHood Engine

Simulation engine for PaperHood: quoting, portfolio ledger, and leaderboards. Shares the SQLite database written by the indexer (`indexer/data/paperhood.sqlite`).

## Run

```bash
cd engine
npm install
npm test                      # ledger unit tests + live quote tests against RH chain
npx tsx src/cache-tokens.ts   # one-shot: cache decimals/symbol for all universe tokens
```

`RH_RPC_HTTP` is required for live quoting; it is auto-loaded from `../../.env.local` (never committed).

## Modules

### `src/quote.ts`

`quoteSwap(db, pair, tokenIn, amountIn)` returns amountOut, spot price, execution price, price impact %, fee paid, and which quote path was used.

- **v2** (`v2-reserves`): constant-product exact-in from the latest reserve snapshot, using the pool's real fee.
- **v3 primary** (`v3-quoter`): the on-chain **QuoterV2** contract via `eth_call`. This is real Uniswap tick-crossing math executed by the deployed contract, so fills are exact, including swaps that cross ticks. QuoterV2 is live on Robinhood Chain at `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` (official Uniswap v3 deployment list for Robinhood Chain; verified with eth_getCode and live quotes).
- **v3 fallback** (`v3-approx`): if the quoter call fails, a single-tick approximation from the snapshot `sqrtPriceX96` and in-range `liquidity`. Only valid while the swap stays in the current tick range; large trades in the fallback path understate depth beyond the current range and should be size-capped by callers.

Token decimals/symbols are fetched from chain on first use and cached in the `tokens` table. Pool fee tier and token0 orientation are cached in new `pools.fee` / `pools.token0` columns.

### `src/ledger.ts`

- `users` (id, discord_id, created_at). Every user starts each season with 10,000 paper USD.
- `trades` are immutable rows: user, token, side, amount_in, amount_out, exec_price, impact %, fee (USD), timestamp, season.
- Positions and cash are derived from trades, never stored.
- Realized PnL on sells uses FIFO cost basis over the season's buy lots.
- Unrealized PnL marks the position at exit: `getPortfolio` quotes selling the FULL position into the pool right now, so thin pools cannot show fantasy marks.
- Dual denomination: USD internally, ETH exposed via `cashEth`/`equityEth`.

**ETH/USD rate:** there is no WETH/stablecoin pool on Robinhood chain (all 133 active WETH-quoted pools; zero USD pools), so the rate is derived from dexscreener (`priceUsd / priceNative` of the deepest pool), cached in SQLite with a 60s TTL and stale-fallback. If a real WETH/USDC pool appears later, swap `getEthUsd` to read it on-chain.

### `src/leaderboard.ts`

- Weekly: realized PnL % of the 10k start, over the current season. Season = Monday 00:00 UTC to Monday 00:00 UTC (`seasons` table, created lazily).
- Daily: realized PnL % counting only sells closed since 00:00 UTC today.
- Only realized PnL counts (locked decision); users with zero trades in the window are excluded.

## Known limitations

- v3 quotes use the QuoterV2 at the **latest block**, not the snapshot timestamp, so a quote can be a few seconds fresher than the indexer's candle data. Fine for a sim.
- The v3 fallback path is single-tick only; the engine reports `path` on every quote so the API layer can warn or cap size when `v3-approx` is used.
- No gas cost is charged on paper trades yet (blueprint v1.5 idea).
- The user's own trades do not move the pool (no impact persistence between fills). Also a v1.5 knob.
- ETH/USD depends on dexscreener when the cache is cold. Rate errors bound the fill price error, not the pool math.
- `fifoCostBasis` and `realizedPnl` walk a user's season trades in JS; fine up to tens of thousands of trades per user per week.

## Notes for the API layer

- `buy(db, userId, pair, token, usdAmount)` and `sell(db, userId, pair, token, tokenQtyRaw)` are the only mutation entry points. Both validate balances and throw on overdraft/oversell.
- `quoteSwap` is safe to expose directly for the trade-preview panel ("you'll get X, impact Y%").
- All token quantities in the ledger are raw bigint units stored as TEXT; convert with `tokens.decimals` for display.
