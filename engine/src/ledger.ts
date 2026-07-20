import { DatabaseSync } from "node:sqlite";
import { quoteSwap, getTokenMeta, Quote } from "./quote.js";

export const STARTING_BALANCE_USD = 10_000;

// ---------- ETH/USD rate ----------
// There is no liquid WETH/stablecoin pool on Robinhood chain (every active
// pool quotes in WETH). USD rate comes from dexscreener: priceUsd/priceNative
// of a deep pool gives the implied WETH price in USD. Cached in SQLite with a
// 60s TTL and used as fallback if the API is down.

const RATE_TTL_S = 60;

export function ensureRateTable(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS eth_usd_rate (id INTEGER PRIMARY KEY CHECK (id=1), rate REAL, ts INTEGER)");
}

export async function getEthUsd(db: DatabaseSync): Promise<number> {
  ensureRateTable(db);
  const row = db.prepare("SELECT rate, ts FROM eth_usd_rate WHERE id=1").get() as { rate: number; ts: number } | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (row && now - row.ts < RATE_TTL_S) return row.rate;

  const pool = db.prepare(
    "SELECT pair_address FROM pools WHERE active=1 AND quote_symbol='WETH' ORDER BY liquidity_usd DESC LIMIT 1"
  ).get() as { pair_address: string } | undefined;

  try {
    if (!pool) throw new Error("no pool");
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${pool.pair_address}`);
    const j = (await res.json()) as { pairs?: { priceUsd?: string; priceNative?: string }[] };
    const p = j.pairs?.[0];
    const usd = Number(p?.priceUsd), native = Number(p?.priceNative);
    if (!(usd > 0) || !(native > 0)) throw new Error("bad rate data");
    const rate = usd / native;
    db.prepare("INSERT OR REPLACE INTO eth_usd_rate (id, rate, ts) VALUES (1, ?, ?)").run(rate, now);
    return rate;
  } catch {
    if (row) return row.rate; // stale fallback
    throw new Error("cannot determine ETH/USD rate");
  }
}

export function setEthUsdForTest(db: DatabaseSync, rate: number): void {
  ensureRateTable(db);
  db.prepare("INSERT OR REPLACE INTO eth_usd_rate (id, rate, ts) VALUES (1, ?, ?)").run(rate, Math.floor(Date.now() / 1000));
}

// ---------- seasons ----------
// Weekly season: fresh 10k every Monday 00:00 UTC.

export function seasonStart(tsSec: number): number {
  const d = new Date(tsSec * 1000);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const daysSinceMonday = (day + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday);
  return Math.floor(monday / 1000);
}

export function getSeasonId(db: DatabaseSync, tsSec: number = Math.floor(Date.now() / 1000)): number {
  const start = seasonStart(tsSec);
  const row = db.prepare("SELECT id FROM seasons WHERE start_ts = ?").get(start) as { id: number } | undefined;
  if (row) return row.id;
  db.prepare("INSERT INTO seasons (start_ts, end_ts) VALUES (?, ?)").run(start, start + 7 * 86400);
  return (db.prepare("SELECT id FROM seasons WHERE start_ts = ?").get(start) as { id: number }).id;
}

// ---------- users ----------

// Users are keyed by lowercase wallet address.
export function getOrCreateUser(db: DatabaseSync, address: string): number {
  const addr = address.toLowerCase();
  const row = db.prepare("SELECT id FROM users WHERE address = ?").get(addr) as { id: number } | undefined;
  if (row) return row.id;
  db.prepare("INSERT INTO users (address, created_at) VALUES (?, ?)").run(addr, Math.floor(Date.now() / 1000));
  return (db.prepare("SELECT id FROM users WHERE address = ?").get(addr) as { id: number }).id;
}

// Display identity: 0x1234...abcd
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ---------- trades / positions ----------

interface TradeRow {
  id: number; side: string; amount_in: string; amount_out: string;
  exec_price: number; fee: number; ts: number; token_address: string; pair_address: string;
}

// Cash = starting balance + sell proceeds - buy spends, within a season.
export function cashBalanceUsd(db: DatabaseSync, userId: number, seasonId: number): number {
  const rows = db.prepare(
    "SELECT side, amount_in, amount_out FROM trades WHERE user_id = ? AND season_id = ?"
  ).all(userId, seasonId) as { side: string; amount_in: string; amount_out: string }[];
  let cash = STARTING_BALANCE_USD;
  for (const t of rows) {
    if (t.side === "buy") cash -= Number(t.amount_in);
    else cash += Number(t.amount_out);
  }
  return cash;
}

// Token quantity held (raw units) for a user/token in a season.
export function positionQty(db: DatabaseSync, userId: number, seasonId: number, token: string): bigint {
  const rows = db.prepare(
    "SELECT side, amount_in, amount_out FROM trades WHERE user_id = ? AND season_id = ? AND token_address = ? COLLATE NOCASE ORDER BY id"
  ).all(userId, seasonId, token.toLowerCase()) as { side: string; amount_in: string; amount_out: string }[];
  let qty = 0n;
  for (const t of rows) {
    if (t.side === "buy") qty += BigInt(t.amount_out);
    else qty -= BigInt(t.amount_in);
  }
  return qty;
}

export interface BuyResult { tradeId: number; quote: Quote; tokensOut: bigint; execPriceUsd: number }
export interface SellResult { tradeId: number; quote: Quote; usdOut: number; realizedPnlUsd: number }

// Buy: spend usdAmount of paper cash on `token` via its canonical pool.
export async function buy(db: DatabaseSync, userId: number, pair: string, token: string, usdAmount: number): Promise<BuyResult> {
  if (usdAmount <= 0) throw new Error("amount must be positive");
  const seasonId = getSeasonId(db);
  const cash = cashBalanceUsd(db, userId, seasonId);
  if (usdAmount > cash + 1e-9) throw new Error(`insufficient balance: have $${cash.toFixed(2)}, need $${usdAmount.toFixed(2)}`);

  const pool = db.prepare("SELECT quote_token FROM pools WHERE pair_address = ? COLLATE NOCASE").get(pair) as { quote_token: string } | undefined;
  if (!pool) throw new Error(`unknown pool ${pair}`);
  const quoteTok = pool.quote_token;
  const quoteMeta = await getTokenMeta(db, quoteTok);
  const ethUsd = await getEthUsd(db);

  // Convert USD to raw WETH in, then quote the swap WETH -> token.
  const ethIn = usdAmount / ethUsd;
  const amountIn = BigInt(Math.round(ethIn * 10 ** quoteMeta.decimals));
  const q = await quoteSwap(db, pair, quoteTok, amountIn);
  if (q.amountOut <= 0n) throw new Error("quote returned zero out");

  const outMeta = await getTokenMeta(db, q.tokenOut);
  const tokensOutDec = Number(q.amountOut) / 10 ** outMeta.decimals;
  const execPriceUsd = usdAmount / tokensOutDec;
  const feeUsd = (Number(q.feePaid) / 10 ** quoteMeta.decimals) * ethUsd;

  db.prepare(
    `INSERT INTO trades (user_id, season_id, pair_address, token_address, side, amount_in, amount_out, exec_price, impact, fee, ts)
     VALUES (?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?)`
  ).run(userId, seasonId, q.pair, q.tokenOut.toLowerCase(), String(usdAmount), q.amountOut.toString(), execPriceUsd, q.priceImpactPct, feeUsd, Math.floor(Date.now() / 1000));
  const tradeId = Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  return { tradeId, quote: q, tokensOut: q.amountOut, execPriceUsd };
}

// Sell: swap `tokenQty` raw units of token back into the quote token, credit USD.
// Realized PnL uses FIFO cost basis over this season's buys.
export async function sell(db: DatabaseSync, userId: number, pair: string, token: string, tokenQty: bigint): Promise<SellResult> {
  if (tokenQty <= 0n) throw new Error("quantity must be positive");
  const seasonId = getSeasonId(db);
  const held = positionQty(db, userId, seasonId, token);
  if (tokenQty > held) throw new Error(`insufficient position: have ${held}, selling ${tokenQty}`);

  const q = await quoteSwap(db, pair, token, tokenQty);
  if (q.amountOut <= 0n) throw new Error("quote returned zero out");

  const quoteMeta = await getTokenMeta(db, q.tokenOut);
  const tokenMeta = await getTokenMeta(db, token);
  const ethUsd = await getEthUsd(db);
  const usdOut = (Number(q.amountOut) / 10 ** quoteMeta.decimals) * ethUsd;
  const qtyDec = Number(tokenQty) / 10 ** tokenMeta.decimals;
  const execPriceUsd = usdOut / qtyDec;
  const feeUsd = (Number(q.feePaid) / 10 ** tokenMeta.decimals) * (execPriceUsd);

  const costBasis = fifoCostBasis(db, userId, seasonId, token, tokenQty, tokenMeta.decimals);
  const realizedPnlUsd = usdOut - costBasis;

  db.prepare(
    `INSERT INTO trades (user_id, season_id, pair_address, token_address, side, amount_in, amount_out, exec_price, impact, fee, realized_pnl, ts)
     VALUES (?, ?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, seasonId, q.pair, token.toLowerCase(), tokenQty.toString(), String(usdOut), execPriceUsd, q.priceImpactPct, feeUsd, realizedPnlUsd, Math.floor(Date.now() / 1000));
  const tradeId = Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  return { tradeId, quote: q, usdOut, realizedPnlUsd };
}

// FIFO: walk this season's trades in order, consume buy lots with prior sells,
// then price the lots the current sell consumes at their recorded USD cost.
export function fifoCostBasis(db: DatabaseSync, userId: number, seasonId: number, token: string, sellQty: bigint, decimals: number): number {
  const rows = db.prepare(
    "SELECT side, amount_in, amount_out, exec_price FROM trades WHERE user_id = ? AND season_id = ? AND token_address = ? COLLATE NOCASE ORDER BY id"
  ).all(userId, seasonId, token.toLowerCase()) as { side: string; amount_in: string; amount_out: string; exec_price: number }[];

  // Build open lots: [qty raw, usdPerToken]
  const lots: { qty: bigint; price: number }[] = [];
  for (const t of rows) {
    if (t.side === "buy") {
      lots.push({ qty: BigInt(t.amount_out), price: t.exec_price });
    } else {
      let toConsume = BigInt(t.amount_in);
      while (toConsume > 0n && lots.length > 0) {
        const lot = lots[0];
        const take = lot.qty < toConsume ? lot.qty : toConsume;
        lot.qty -= take;
        toConsume -= take;
        if (lot.qty === 0n) lots.shift();
      }
    }
  }

  let remaining = sellQty;
  let cost = 0;
  for (const lot of lots) {
    if (remaining <= 0n) break;
    const take = lot.qty < remaining ? lot.qty : remaining;
    cost += (Number(take) / 10 ** decimals) * lot.price;
    remaining -= take;
  }
  return cost;
}

// ---------- portfolio view ----------

export interface Position {
  token: string; symbol: string; pair: string;
  qty: bigint; qtyDec: number;
  costBasisUsd: number;
  markUsd: number;        // what selling the full position now would return
  unrealizedPnlUsd: number;
}

export interface Portfolio {
  cashUsd: number; cashEth: number;
  positions: Position[];
  equityUsd: number; equityEth: number;
  realizedPnlUsd: number;
}

export async function getPortfolio(db: DatabaseSync, userId: number, seasonId: number = getSeasonId(db)): Promise<Portfolio> {
  const ethUsd = await getEthUsd(db);
  const cashUsd = cashBalanceUsd(db, userId, seasonId);

  const tokens = db.prepare(
    "SELECT DISTINCT token_address, pair_address FROM trades WHERE user_id = ? AND season_id = ?"
  ).all(userId, seasonId) as { token_address: string; pair_address: string }[];

  const positions: Position[] = [];
  for (const t of tokens) {
    const qty = positionQty(db, userId, seasonId, t.token_address);
    if (qty <= 0n) continue;
    const meta = await getTokenMeta(db, t.token_address);
    const qtyDec = Number(qty) / 10 ** meta.decimals;

    // Mark at exit: quote selling the FULL position into the pool now.
    let markUsd = 0;
    try {
      const q = await quoteSwap(db, t.pair_address, t.token_address, qty);
      const quoteMeta = await getTokenMeta(db, q.tokenOut);
      markUsd = (Number(q.amountOut) / 10 ** quoteMeta.decimals) * ethUsd;
    } catch { /* pool gone or no snapshot: mark 0 */ }

    const costBasisUsd = fifoCostBasis(db, userId, seasonId, t.token_address, qty, meta.decimals);
    positions.push({
      token: t.token_address, symbol: meta.symbol, pair: t.pair_address,
      qty, qtyDec, costBasisUsd, markUsd, unrealizedPnlUsd: markUsd - costBasisUsd,
    });
  }

  const realizedPnlUsd = realizedPnl(db, userId, seasonId);
  const equityUsd = cashUsd + positions.reduce((s, p) => s + p.markUsd, 0);
  return { cashUsd, cashEth: cashUsd / ethUsd, positions, equityUsd, equityEth: equityUsd / ethUsd, realizedPnlUsd };
}

// Total realized PnL for a user in a season (sum over sells of proceeds - FIFO cost).
// Only counts sells with ts >= sinceTs (for daily rankings).
export function realizedPnl(db: DatabaseSync, userId: number, seasonId: number, sinceTs = 0): number {
  const tokens = db.prepare(
    "SELECT DISTINCT token_address FROM trades WHERE user_id = ? AND season_id = ?"
  ).all(userId, seasonId) as { token_address: string }[];

  let total = 0;
  for (const tok of tokens) {
    const decRow = db.prepare("SELECT decimals FROM tokens WHERE address = ?").get(tok.token_address) as { decimals: number } | undefined;
    const scale = 10 ** (decRow?.decimals ?? 18);
    const rows = db.prepare(
      "SELECT side, amount_in, amount_out, exec_price, ts FROM trades WHERE user_id = ? AND season_id = ? AND token_address = ? ORDER BY id"
    ).all(userId, seasonId, tok.token_address) as { side: string; amount_in: string; amount_out: string; exec_price: number; ts: number }[];
    const lots: { qty: bigint; price: number }[] = [];
    for (const t of rows) {
      if (t.side === "buy") {
        lots.push({ qty: BigInt(t.amount_out), price: t.exec_price });
      } else {
        let toConsume = BigInt(t.amount_in);
        let cost = 0;
        let sold = 0n;
        while (toConsume > 0n && lots.length > 0) {
          const lot = lots[0];
          const take = lot.qty < toConsume ? lot.qty : toConsume;
          cost += (Number(take) / scale) * lot.price;
          sold += take;
          lot.qty -= take;
          toConsume -= take;
          if (lot.qty === 0n) lots.shift();
        }
        if (t.ts >= sinceTs) total += (Number(sold) / scale) * t.exec_price - cost;
      }
    }
  }
  return total;
}
