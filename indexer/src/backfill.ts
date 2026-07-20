// Historical OHLCV backfill from the GeckoTerminal public API.
//
// Network slug for Robinhood Chain is "robinhood" (same as dexscreener).
// Endpoint: /api/v2/networks/robinhood/pools/{pair}/ohlcv/{timeframe}
// Free, no key, rate limit ~30 req/min, so we space requests ~2.1s apart.
//
// Orientation: we request currency=token, which returns prices as quote
// token per base token for the pool, the same convention our live candles
// use (quote per tracked token) as long as GeckoTerminal's base token is
// our tracked token. The response meta tells us the base token address;
// if it is the pool's quote token instead, we invert (1/price, swap h/l).
//
// Minute candles for roughly the last 24h go into the existing `candles`
// table with INSERT OR IGNORE so live-polled candles are never overwritten.
// Hourly candles for roughly the last 30 days go into `candles_hourly`.

import { db } from "./db.js";

const GT_BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const REQUEST_GAP_MS = 2100; // ~28 req/min, under the ~30/min limit
const MIN_LIVE_CANDLES = 100; // pools with at least this many 1m candles are skipped

type Pool = { pair_address: string; token_address: string; quote_token: string; symbol: string };

type OhlcvRow = [number, number, number, number, number, number]; // ts, o, h, l, c, v

const getPools = db.prepare(`
  SELECT pair_address, token_address, quote_token, symbol
  FROM pools WHERE active = 1 ORDER BY liquidity_usd DESC
`);

const countMinute = db.prepare(`SELECT COUNT(*) AS n FROM candles WHERE pair_address = ?`);
const countHourly = db.prepare(`SELECT COUNT(*) AS n FROM candles_hourly WHERE pair_address = ?`);

const insertMinute = db.prepare(`
  INSERT OR IGNORE INTO candles (pair_address, minute, open, high, low, close, n)
  VALUES (@pair, @t, @o, @h, @l, @c, 0)
`);

const insertHourly = db.prepare(`
  INSERT OR IGNORE INTO candles_hourly (pair_address, hour, open, high, low, close)
  VALUES (@pair, @t, @o, @h, @l, @c)
`);

let lastRequest = 0;
async function gtFetch(url: string): Promise<any> {
  const wait = lastRequest + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 429) {
    // Backed up against the rate limit; wait a minute and retry once.
    await new Promise((r) => setTimeout(r, 65_000));
    lastRequest = Date.now();
    const retry = await fetch(url, { headers: { accept: "application/json" } });
    if (!retry.ok) throw new Error(`geckoterminal ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
  return res.json();
}

// Fetch one OHLCV page. Returns rows (newest first) and whether the pool's
// base token per GeckoTerminal is our tracked token.
async function fetchOhlcv(
  pool: Pool,
  timeframe: "minute" | "hour",
  limit: number,
  beforeTs?: number
): Promise<OhlcvRow[]> {
  let url =
    `${GT_BASE}/pools/${pool.pair_address}/ohlcv/${timeframe}` +
    `?aggregate=1&limit=${limit}&currency=token`;
  if (beforeTs) url += `&before_timestamp=${beforeTs}`;
  const body = await gtFetch(url);
  const list: OhlcvRow[] = body?.data?.attributes?.ohlcv_list ?? [];
  const baseAddr: string | undefined = body?.meta?.base?.address?.toLowerCase();
  if (list.length === 0) return [];
  if (baseAddr && baseAddr !== pool.token_address.toLowerCase()) {
    // GeckoTerminal's base is our quote; invert prices (and swap high/low).
    return list.map(([t, o, h, l, c, v]): OhlcvRow => [t, 1 / o, 1 / l, 1 / h, 1 / c, v]);
  }
  return list;
}

function storeMinute(pair: string, rows: OhlcvRow[]): number {
  let n = 0;
  for (const [t, o, h, l, c] of rows) {
    if (!isFinite(o) || !isFinite(c) || o <= 0) continue;
    insertMinute.run({ pair, t: t - (t % 60), o, h, l, c });
    n++;
  }
  return n;
}

function storeHourly(pair: string, rows: OhlcvRow[]): number {
  let n = 0;
  for (const [t, o, h, l, c] of rows) {
    if (!isFinite(o) || !isFinite(c) || o <= 0) continue;
    insertHourly.run({ pair, t: t - (t % 3600), o, h, l, c });
    n++;
  }
  return n;
}

// One-shot backfill at startup. Pools are processed deepest-liquidity first.
// Pools that already have enough history are skipped.
export async function runBackfill(): Promise<void> {
  const pools = getPools.all() as Pool[];
  const now = Math.floor(Date.now() / 1000);
  let done = 0;

  for (const pool of pools) {
    const haveMinute = (countMinute.get(pool.pair_address) as { n: number }).n;
    const haveHourly = (countHourly.get(pool.pair_address) as { n: number }).n;
    const needMinute = haveMinute < MIN_LIVE_CANDLES;
    const needHourly = haveHourly < MIN_LIVE_CANDLES;
    if (!needMinute && !needHourly) continue;

    try {
      let mins = 0;
      let hours = 0;
      if (needMinute) {
        // Last ~24h of minute candles: one page of 1000 (~16.7h) plus one
        // more page before it to cover the rest of the day.
        const page1 = await fetchOhlcv(pool, "minute", 1000);
        mins += storeMinute(pool.pair_address, page1);
        if (page1.length === 1000) {
          const oldest = page1[page1.length - 1][0];
          if (oldest > now - 24 * 3600) {
            const page2 = await fetchOhlcv(pool, "minute", 500, oldest);
            mins += storeMinute(pool.pair_address, page2);
          }
        }
      }
      if (needHourly) {
        // Last ~30 days of hourly candles in one page.
        const rows = await fetchOhlcv(pool, "hour", 720);
        hours += storeHourly(pool.pair_address, rows);
      }
      done++;
      console.log(`backfill: ${pool.symbol} ${pool.pair_address} +${mins} 1m, +${hours} 1h (${done} pools done)`);
    } catch (e) {
      console.warn(`backfill failed for ${pool.symbol} ${pool.pair_address}:`, (e as Error).message);
    }
  }
  console.log(`backfill complete: ${done} pools backfilled`);
}
