// Per-pool historical OHLCV backfill from GeckoTerminal, for use right after
// a token import so the chart is not empty from the import moment.
//
// The indexer has its own bulk startup backfill (indexer/src/backfill.ts);
// this is the engine-side single-pool variant, parameterized on the db handle
// the API already holds. Same conventions: prices are quote per tracked token
// (inverted when GeckoTerminal's base is our quote token), minute candles go
// into `candles` and hourly candles into `candles_hourly`, both with
// INSERT OR IGNORE so live-polled candles are never overwritten.
//
// Network slug for Robinhood Chain on GeckoTerminal is "robinhood".
// Rate limit is ~30 req/min; requests are serialized with a gap. A single
// import triggers at most 3 requests, so this stays well under the limit
// even alongside the indexer's own startup backfill.
import { DatabaseSync } from "node:sqlite";

const GT_BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const REQUEST_GAP_MS = 2500;

type OhlcvRow = [number, number, number, number, number, number]; // ts, o, h, l, c, v

let lastRequest = 0;
let chain: Promise<void> = Promise.resolve();

// Serialize all backfill requests process-wide, spaced REQUEST_GAP_MS apart.
function gtFetch(url: string): Promise<any> {
  const run = async () => {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 65_000));
      lastRequest = Date.now();
      const retry = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!retry.ok) throw new Error(`geckoterminal ${retry.status}`);
      return retry.json();
    }
    if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
    return res.json();
  };
  const result = chain.then(run);
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function fetchOhlcv(
  pair: string,
  token: string,
  timeframe: "minute" | "hour",
  limit: number,
  beforeTs?: number
): Promise<OhlcvRow[]> {
  let url = `${GT_BASE}/pools/${pair}/ohlcv/${timeframe}?aggregate=1&limit=${limit}&currency=token`;
  if (beforeTs) url += `&before_timestamp=${beforeTs}`;
  const body = await gtFetch(url);
  const list: OhlcvRow[] = body?.data?.attributes?.ohlcv_list ?? [];
  const baseAddr: string | undefined = body?.meta?.base?.address?.toLowerCase();
  if (list.length === 0) return [];
  if (baseAddr && baseAddr !== token.toLowerCase()) {
    // GeckoTerminal's base is our quote; invert prices (and swap high/low).
    return list.map(([t, o, h, l, c, v]): OhlcvRow => [t, 1 / o, 1 / l, 1 / h, 1 / c, v]);
  }
  return list;
}

// Backfill one pool: last ~24h of 1m candles plus ~30 days of hourly candles.
// Returns counts for logging. Never overwrites existing rows.
export async function backfillPairHistory(
  db: DatabaseSync,
  pair: string,
  token: string
): Promise<{ minutes: number; hours: number }> {
  const now = Math.floor(Date.now() / 1000);

  const insertMinute = db.prepare(`
    INSERT OR IGNORE INTO candles (pair_address, minute, open, high, low, close, n)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `);
  const insertHourly = db.prepare(`
    INSERT OR IGNORE INTO candles_hourly (pair_address, hour, open, high, low, close)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const storeMinute = (rows: OhlcvRow[]) => {
    let n = 0;
    for (const [t, o, h, l, c] of rows) {
      if (!isFinite(o) || !isFinite(c) || o <= 0) continue;
      insertMinute.run(pair, t - (t % 60), o, h, l, c);
      n++;
    }
    return n;
  };

  let minutes = 0;
  const page1 = await fetchOhlcv(pair, token, "minute", 1000);
  minutes += storeMinute(page1);
  if (page1.length === 1000) {
    const oldest = page1[page1.length - 1][0];
    if (oldest > now - 24 * 3600) {
      minutes += storeMinute(await fetchOhlcv(pair, token, "minute", 500, oldest));
    }
  }

  let hours = 0;
  for (const [t, o, h, l, c] of await fetchOhlcv(pair, token, "hour", 720)) {
    if (!isFinite(o) || !isFinite(c) || o <= 0) continue;
    insertHourly.run(pair, t - (t % 3600), o, h, l, c);
    hours++;
  }

  return { minutes, hours };
}
