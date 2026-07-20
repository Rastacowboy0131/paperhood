// Limit / stop orders: stored in SQLite, checked against fresh price
// snapshots on a fixed interval, and filled through the regular ledger
// buy()/sell() functions at the CURRENT price so all cap and balance
// validation still applies.
import { DatabaseSync } from "node:sqlite";
import { buy, sell, positionQty, getSeasonId } from "./ledger.js";

export type OrderSide = "buy" | "sell";
export type OrderType = "limit" | "stop";
export type OrderStatus = "open" | "filled" | "cancelled" | "failed";

export interface OrderRow {
  id: number;
  user_id: number;
  token_address: string;
  pair_address: string;
  side: OrderSide;
  type: OrderType;
  trigger_price: number;   // quote tokens per 1 token (same unit as snapshots.price)
  amount: number;          // buy: USD to spend; sell: percent of position (0-100]
  status: OrderStatus;
  fail_reason: string | null;
  created_at: number;
  filled_at: number | null;
  filled_price_usd: number | null; // USD per token at execution
}

export function ensureOrdersTable(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  pair_address TEXT NOT NULL,
  side TEXT NOT NULL,                -- buy | sell
  type TEXT NOT NULL,                -- limit | stop
  trigger_price REAL NOT NULL,       -- quote (WETH) per token
  amount REAL NOT NULL,              -- buy: USD; sell: percent of position
  status TEXT NOT NULL DEFAULT 'open',
  fail_reason TEXT,
  created_at INTEGER NOT NULL,
  filled_at INTEGER,
  filled_price_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
`);
}

export interface CreateOrderInput {
  token: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  triggerPrice: number;
  amount: number;
}

export function createOrder(db: DatabaseSync, userId: number, o: CreateOrderInput): OrderRow {
  ensureOrdersTable(db);
  if (o.side !== "buy" && o.side !== "sell") throw new Error("side must be buy or sell");
  if (o.type !== "limit" && o.type !== "stop") throw new Error("type must be limit or stop");
  if (o.side === "buy" && o.type === "stop") throw new Error("stop orders are sell-only");
  if (!(o.triggerPrice > 0)) throw new Error("triggerPrice must be positive");
  if (!(o.amount > 0)) throw new Error("amount must be positive");
  if (o.side === "sell" && o.amount > 100) throw new Error("sell amount is a percent of position (max 100)");

  db.prepare(
    `INSERT INTO orders (user_id, token_address, pair_address, side, type, trigger_price, amount, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
  ).run(userId, o.token.toLowerCase(), o.pair, o.side, o.type, o.triggerPrice, o.amount, Math.floor(Date.now() / 1000));
  const id = Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  return getOrder(db, id)!;
}

export function getOrder(db: DatabaseSync, id: number): OrderRow | undefined {
  ensureOrdersTable(db);
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
}

// Open orders plus recent terminal ones, newest first.
export function listOrders(db: DatabaseSync, userId: number, token?: string, limit = 50): OrderRow[] {
  ensureOrdersTable(db);
  if (token) {
    return db.prepare(
      `SELECT * FROM orders WHERE user_id = ? AND token_address = ? COLLATE NOCASE
       ORDER BY (status = 'open') DESC, id DESC LIMIT ?`
    ).all(userId, token.toLowerCase(), limit) as unknown as OrderRow[];
  }
  return db.prepare(
    "SELECT * FROM orders WHERE user_id = ? ORDER BY (status = 'open') DESC, id DESC LIMIT ?"
  ).all(userId, limit) as unknown as OrderRow[];
}

// Cancel an own open order. Returns false if not found / not open / not owned.
export function cancelOrder(db: DatabaseSync, userId: number, id: number): boolean {
  ensureOrdersTable(db);
  const res = db.prepare(
    "UPDATE orders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'open'"
  ).run(id, userId);
  return Number(res.changes) > 0;
}

// Trigger rule (price in quote terms, same as snapshots.price):
//   limit buy   fills when price <= trigger
//   limit sell  (take profit) fills when price >= trigger
//   stop  sell  (stop loss)   fills when price <= trigger
export function shouldTrigger(side: OrderSide, type: OrderType, trigger: number, price: number): boolean {
  if (side === "buy") return price <= trigger;
  if (type === "limit") return price >= trigger;
  return price <= trigger; // stop loss
}

function latestQuotePrice(db: DatabaseSync, pair: string): number | undefined {
  const row = db.prepare(
    "SELECT price FROM snapshots WHERE pair_address = ? COLLATE NOCASE AND price IS NOT NULL ORDER BY ts DESC LIMIT 1"
  ).get(pair) as { price: number } | undefined;
  return row?.price;
}

// Scan open orders against the freshest snapshot price of each pair and fill
// the triggered ones through the ledger at the current price. Ledger errors
// (insufficient balance/position, over cap) mark the order failed with the
// reason. Returns the number of orders that changed state.
export async function checkOpenOrders(db: DatabaseSync): Promise<number> {
  ensureOrdersTable(db);
  const open = db.prepare("SELECT * FROM orders WHERE status = 'open' ORDER BY id").all() as unknown as OrderRow[];
  if (open.length === 0) return 0;

  const priceCache = new Map<string, number | undefined>();
  let changed = 0;

  for (const o of open) {
    let price = priceCache.get(o.pair_address);
    if (!priceCache.has(o.pair_address)) {
      price = latestQuotePrice(db, o.pair_address);
      priceCache.set(o.pair_address, price);
    }
    if (price == null || !shouldTrigger(o.side, o.type, o.trigger_price, price)) continue;

    const now = Math.floor(Date.now() / 1000);
    try {
      if (o.side === "buy") {
        const r = await buy(db, o.user_id, o.pair_address, o.token_address, o.amount);
        db.prepare("UPDATE orders SET status='filled', filled_at=?, filled_price_usd=? WHERE id=?")
          .run(now, r.execPriceUsd, o.id);
      } else {
        const seasonId = getSeasonId(db);
        const held = positionQty(db, o.user_id, seasonId, o.token_address);
        const qty = (held * BigInt(Math.round(Math.min(o.amount, 100) * 100))) / 10000n;
        if (qty <= 0n) throw new Error("no position to sell");
        const r = await sell(db, o.user_id, o.pair_address, o.token_address, qty);
        const decRow = db.prepare("SELECT decimals FROM tokens WHERE address = ?").get(o.token_address) as { decimals: number } | undefined;
        const qtyDec = Number(qty) / 10 ** (decRow?.decimals ?? 18);
        db.prepare("UPDATE orders SET status='filled', filled_at=?, filled_price_usd=? WHERE id=?")
          .run(now, qtyDec > 0 ? r.usdOut / qtyDec : null, o.id);
      }
    } catch (e) {
      db.prepare("UPDATE orders SET status='failed', filled_at=?, fail_reason=? WHERE id=?")
        .run(now, (e as Error).message, o.id);
    }
    changed++;
  }
  return changed;
}
