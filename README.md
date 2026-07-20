# PaperHood

Paper trading terminal for Robinhood Chain (Arbitrum Orbit, chain ID 4663).

Trade tokenized stocks and top-liquidity dex tokens with a simulated AMM engine that fills against real on-chain Uniswap pool state, so slippage and price impact are real. Shared leaderboard (realized PnL), daily and weekly rewards.

## Layout

- `indexer/` — pool discovery + reserve/tick polling from RH chain (QuickNode RPC)
- `engine/` — simulated AMM fills (uni v2 constant product; v3/v4 tick math), portfolio ledger
- `api/` — REST/WebSocket API serving the web terminal
- `web/` — Next.js terminal (screener, trade panel, portfolio, leaderboard), Sign-In with Ethereum (SIWE)
- `docs/` — blueprint and design docs

## Status

Early scaffold. See `docs/BLUEPRINT.md` for the plan.
