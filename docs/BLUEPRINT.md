# PaperHood — RH Chain Paper Trading Terminal — Blueprint v0.1

Name DECIDED (Rasta, 2026-07-20 00:26): **PaperHood** — "clicks easily with trenchers".

Owner: Rastacowboy (community tool). Drafted 2026-07-19 with Nora.

## Decisions locked (from Rasta)
- Asset scope v1: tokenized stocks + top-liquidity dex tokens (REVISED 22:59, Rasta flipped order). v2: low-cap memes.
- Stock token notes (verified 2026-07-18): shared "Stock" impl, no whitelist, contracts can hold them; but registry blocklist, issuer pause, and rebase multiplier on splits — never cache balances, tolerate per-stock pause. Mag7 liquidity deep, long tail thin. Sushi confirmed venue for stocks.
- Price source: on-chain pool reserve reads (not API mid-price).
- Fill model: simulated AMM swap against reserve snapshot (constant product), so slippage/price impact is real.
- Surface: web terminal.
- Shared leaderboard, gamified.
- Rewards: % of accumulated fees (from Rasta's product fees) funds daily + weekly prizes.

## Architecture

### 1. Indexer / price service (backend, Node or Python)
- Discover meme pairs on RH chain dexes (dexscreener API for discovery, on-chain for truth).
- Poll pool contracts (getReserves / slot0 for v3-style) every ~5-10s for tracked pairs.
- Store reserve snapshots in Postgres (or SQLite v1) keyed by pair + timestamp.
- Maintain a tradeable universe list with liquidity floor (e.g. >$3k liq) to keep the sim honest; below floor = untradeable or flagged degen tier.
- RH stock tokens later: same engine, but respect rebase multiplier (never cache balances) and issuer pause states.

### 2. Simulation engine
- Constant-product fill: dx in, dy out from latest reserve snapshot, including the pool's real fee tier.
- Optional realism knobs (v1.5): apply user's own trade impact to their subsequent fills within same block-window; cap trade size at % of pool so nobody "buys" $1M into a $10k pool at quoted price.
- Portfolio ledger: every user starts with fixed paper balance (e.g. $10k USD-equiv). All fills recorded as immutable trade rows; portfolio value = live mark-to-market against current reserves (marked at what you could actually SELL into the pool, not mid — this alone kills most fake-PnL complaints).
- Season resets: weekly reset for weekly comp; daily PnL computed from daily snapshot baselines (no reset needed for daily).

### 3. Web terminal (frontend)
- Stack: Next.js/React + chart lib (lightweight-charts from TradingView is free + good).
- Views:
  - Token screener: tradeable universe, liq, vol, 24h change.
  - Trade view: chart (candles from indexer snapshots or geckoterminal OHLC), buy/sell panel with slippage preview ("you'll get X, price impact Y%"), position info.
  - Portfolio: holdings, realized/unrealized PnL, trade history.
  - Leaderboard: daily + weekly, PnL % (not absolute, so everyone competes fairly from same start).
- Auth: Discord OAuth (community tool, everyone has Discord, gives identity for leaderboard + prize distribution).

### 4. Leaderboard + rewards
- Daily: top N by daily PnL %. Weekly: top N by weekly PnL % (weekly = fresh $10k each Monday).
- Anti-cheat (matters once money is on the line):
  - Multi-account: Discord account age / server membership minimum.
  - Wash-pump exploit: someone buys a thin real pool with real money to pump their paper position. Mitigations: liquidity floor, mark-to-exit pricing, cap position size vs pool depth, winner review before payout.
  - Lottery-ticket meta (everyone apes one 100x degen): cap per-token allocation (e.g. max 40% of portfolio per token) or just accept it as part of the game — decide during beta.
- Payouts: manual at first (Rasta sends from fee wallet), automate later.

## Build order
1. Indexer + universe list + reserve polling (this is the foundation, everything reads from it).
2. Sim engine + ledger + API (REST/WebSocket).
3. Web terminal MVP: screener, trade panel with impact preview, portfolio.
4. Discord OAuth + leaderboard.
5. Beta with the community, no rewards yet, tune anti-cheat.
6. Turn on daily/weekly rewards.

## Answered (Rasta, 2026-07-19 23:01)
- Dex: Uniswap is the main liq venue on RH chain — index Uniswap pools (confirm v2 vs v3 deployments; v3 needs slot0/tick-based quoting, v2 is getReserves).
- Rewards funded by fees from a token Rasta will launch tied to the app.
- Paper balance: dual-denominated, ETH and USD.

## Decisions round 3 (Rasta, 2026-07-20 00:00)
- RPC: paid, QuickNode. VERIFIED 2026-07-20: QuickNode officially supports Robinhood chain (beta) — mainnet chain ID 4663, testnet 46630, HTTP + WSS, archive access, docs at quicknode.com/docs/robinhood. Free tier exists to start; upgrade when polling load demands. RH chain is Arbitrum Orbit (Nitro stack), fully EVM-compatible.
- Leaderboard counts REALIZED PnL only. Kills most market-hours concern; note side effect: encourages closing positions to lock rank (fine, arguably more skill-based). Still show unrealized in portfolio view.
- Charts: gecko backfill + own snapshots forward. Confirmed.
- Ship iteratively, upgrades every few days.
- Prize mechanics: design together later.
- Division of labor: Nora builds as much as possible; Rasta's agent picks up remainder. Repo on GitHub. Frontend on Vercel; NOTE: indexer/sim need a persistent 24/7 process, Vercel can't run that — needs a small VPS (or Railway/Fly) alongside.
- Priority: RPC first, then rest in order.

## RPC (received from Rasta 2026-07-20, verified live)
- QuickNode HTTP + WSS endpoints stored in `projects/rh-paper-terminal/.env.local` (NOT committed to repo, keep out of git).
- Verified: eth_chainId returns 0x1237 (4663, RH mainnet), block ~14.4M. Working.

## Naming candidates (Robinhood/Sherwood theme + paper theme)
- Quiver / Quiver Terminal — where arrows are kept, clean ticker potential ($QVR)
- Sherwood Terminal — on-the-nose RH theme
- PaperHood — paper trading + hood, meme-friendly
- Longbow — archery, "going long"
- Fletch / Fletcher — arrow maker, craft-your-skills angle
- DryRun — literal paper-trading name
- Nottingham — villain angle, contrarian branding

1. RPC: QuickNode (Rasta willing to pay) — verify RH chain support first. Multicall batching mandatory.
2. Stock market hours: RH stock tokens track equities — do their pools go stale nights/weekends? Leaderboard fairness issue (stock positions frozen while crypto moves). Options: mark stocks at last-trade during closed hours and exclude stale moves, or just accept it. Needs a look at real weekend pool behavior.
3. Charts/OHLC: build own candles from reserve snapshots (self-sufficient, only from launch onward) vs geckoterminal OHLC API (instant history, rate-limited dependency). Probably both: gecko for backfill, own snapshots forward.
4. Order types: v1 market orders only. Limit orders = big UX win but needs a background trigger engine; slot for v1.5.
5. Trade fees in sim: charge the pool's real fee tier (0.3% etc) — yes, keeps it honest. Maybe add a fake "gas" cost so spam trading isn't free.
6. Prize mechanics: prize sizes, top-N split, min-trades requirement to qualify (stops one-lucky-trade + inactive accounts winning).
7. Repo + build split: who writes what (Rasta's agent vs Nora), repo location, hosting target.
8. Name/branding for the terminal + the token tie-in.

## Open questions
- ~~Uniswap v2 or v3?~~ ANSWERED (Rasta, 23:20): v2, v3, AND v4 pools all live on RH chain. Indexer needs three quoting paths: v2 getReserves (constant product), v3 slot0 + tick liquidity, v4 same math as v3 via singleton PoolManager + pool keys. Per-token: pick deepest pool as canonical venue, ignore dust pools. Suggested phasing: v2+v3 first, add v4 when a top-liq token actually lives there.
- Hosting: single VPS is fine for v1 (indexer + API + frontend).
- Reward token launch mechanics/timing (Rasta's side).
