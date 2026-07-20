// Read-side queries against the shared SQLite db (indexer + engine tables).
import { DatabaseSync } from "node:sqlite";

export interface TokenListItem {
  address: string;
  symbol: string;
  name: string;
  pair: string;
  dex: string;
  version: string;
  liquidityUsd: number;
  volume24hUsd: number;
  priceQuote: number | null;   // token price in quote-token units (usually WETH), raw ratio
  priceUsd: number | null;
  change24hPct: number | null;
}

interface PoolRow {
  pair_address: string; token_address: string; symbol: string; name: string;
  dex_id: string; version: string; quote_token: string; quote_symbol: string;
  liquidity_usd: number; volume24h: number;
}

// Canonical pool per token: deepest active pool.
export function universePools(db: DatabaseSync): PoolRow[] {
  return db.prepare(`
    SELECT p.* FROM pools p
    WHERE p.active = 1
      AND p.liquidity_usd = (
        SELECT MAX(p2.liquidity_usd) FROM pools p2
        WHERE p2.token_address = p.token_address AND p2.active = 1
      )
    GROUP BY p.token_address
    ORDER BY p.liquidity_usd DESC
  `).all() as unknown as PoolRow[];
}

export function poolForToken(db: DatabaseSync, tokenAddress: string): PoolRow | undefined {
  return db.prepare(`
    SELECT * FROM pools WHERE token_address = ? COLLATE NOCASE AND active = 1
    ORDER BY liquidity_usd DESC LIMIT 1
  `).get(tokenAddress.toLowerCase()) as PoolRow | undefined;
}

export function latestPrice(db: DatabaseSync, pair: string): { price: number; ts: number } | undefined {
  return db.prepare(
    "SELECT price, ts FROM snapshots WHERE pair_address = ? COLLATE NOCASE AND price IS NOT NULL ORDER BY ts DESC LIMIT 1"
  ).get(pair) as { price: number; ts: number } | undefined;
}

// Price ~24h ago from candles (closest candle at or before target minute).
export function price24hAgo(db: DatabaseSync, pair: string): number | undefined {
  const target = Math.floor(Date.now() / 1000) - 86400;
  const row = db.prepare(
    "SELECT close FROM candles WHERE pair_address = ? COLLATE NOCASE AND minute <= ? ORDER BY minute DESC LIMIT 1"
  ).get(pair, target) as { close: number } | undefined;
  if (row) return row.close;
  // Fall back to the earliest candle we have (younger than 24h of data).
  const first = db.prepare(
    "SELECT open FROM candles WHERE pair_address = ? COLLATE NOCASE ORDER BY minute ASC LIMIT 1"
  ).get(pair) as { open: number } | undefined;
  return first?.open;
}

export function listTokens(db: DatabaseSync, ethUsd: number | null): TokenListItem[] {
  const out: TokenListItem[] = [];
  for (const p of universePools(db)) {
    const snap = latestPrice(db, p.pair_address);
    const prev = price24hAgo(db, p.pair_address);
    const price = snap?.price ?? null;
    const change = price != null && prev != null && prev > 0 ? ((price - prev) / prev) * 100 : null;
    out.push({
      address: p.token_address,
      symbol: p.symbol,
      name: p.name,
      pair: p.pair_address,
      dex: p.dex_id,
      version: p.version,
      liquidityUsd: p.liquidity_usd,
      volume24hUsd: p.volume24h,
      priceQuote: price,
      priceUsd: price != null && ethUsd != null && p.quote_symbol === "WETH" ? price * ethUsd : null,
      change24hPct: change,
    });
  }
  return out;
}

export interface Candle { t: number; o: number; h: number; l: number; c: number }

const TF_SECONDS: Record<string, number> = { "1m": 60, "5m": 300, "1h": 3600 };

export function getCandles(db: DatabaseSync, pair: string, tf: string, limit: number): Candle[] {
  const step = TF_SECONDS[tf];
  if (!step) throw new Error(`unsupported timeframe ${tf}`);
  const rows = db.prepare(`
    SELECT minute, open, high, low, close FROM candles
    WHERE pair_address = ? COLLATE NOCASE
    ORDER BY minute DESC LIMIT ?
  `).all(pair, tf === "1m" ? limit : limit * (step / 60)) as
    { minute: number; open: number; high: number; low: number; close: number }[];
  rows.reverse();

  if (tf === "1m") {
    return rows.map((r) => ({ t: r.minute, o: r.open, h: r.high, l: r.low, c: r.close }));
  }

  // Aggregate 1m candles into the larger timeframe.
  const buckets = new Map<number, Candle>();
  for (const r of rows) {
    const t = r.minute - (r.minute % step);
    const b = buckets.get(t);
    if (!b) {
      buckets.set(t, { t, o: r.open, h: r.high, l: r.low, c: r.close });
    } else {
      b.h = Math.max(b.h, r.high);
      b.l = Math.min(b.l, r.low);
      b.c = r.close;
    }
  }
  const agg = [...buckets.values()].sort((a, b) => a.t - b.t);
  return agg.slice(-limit);
}
