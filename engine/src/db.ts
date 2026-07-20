import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Shared SQLite db written by the indexer. Engine adds its own tables.
// DATA_DIR overrides the location (used in deployment, points at a mounted volume).
export const DEFAULT_DB_PATH = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, "paperhood.sqlite")
  : path.resolve(here, "../../indexer/data/paperhood.sqlite");

export function openDb(dbPath: string = DEFAULT_DB_PATH): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

function hasColumn(db: DatabaseSync, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === col);
}

export function migrate(db: DatabaseSync): void {
  // Token metadata cache (decimals/symbol fetched from chain once).
  db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  address TEXT PRIMARY KEY,
  symbol TEXT,
  decimals INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,       -- lowercase 0x wallet address
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts INTEGER UNIQUE NOT NULL,   -- Monday 00:00 UTC
  end_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  season_id INTEGER NOT NULL,
  pair_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  side TEXT NOT NULL,                 -- buy | sell
  amount_in TEXT NOT NULL,            -- buy: USD spent; sell: token qty (raw units)
  amount_out TEXT NOT NULL,           -- buy: token qty (raw units); sell: USD received
  exec_price REAL NOT NULL,           -- USD per token
  impact REAL NOT NULL,               -- percent
  fee REAL NOT NULL,                  -- USD
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_user_season ON trades(user_id, season_id);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);
`);

  // Migration: users were previously keyed by discord_id (test data only).
  // Drop and recreate with wallet address as the key.
  if (hasColumn(db, "users", "discord_id")) {
    db.exec(`
DROP TABLE users;
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);
DELETE FROM trades;
`);
  }

  // Pools table exists from the indexer; the engine needs fee tier and token0
  // orientation, cached lazily on first quote.
  if (!hasColumn(db, "pools", "fee")) db.exec("ALTER TABLE pools ADD COLUMN fee INTEGER");
  if (!hasColumn(db, "pools", "token0")) db.exec("ALTER TABLE pools ADD COLUMN token0 TEXT");

  // Per-trade realized PnL (sells only; USD). Added later, backfilled by
  // replaying each user's season trades FIFO.
  if (!hasColumn(db, "trades", "realized_pnl")) {
    db.exec("ALTER TABLE trades ADD COLUMN realized_pnl REAL");
    backfillRealizedPnl(db);
  }

  // Limit / stop orders (see orders.ts).
  db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  pair_address TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  trigger_price REAL NOT NULL,
  amount REAL NOT NULL,
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

// Replay trades per user/season/token in order, pricing each sell against
// FIFO buy lots, and store the per-sell realized PnL.
function backfillRealizedPnl(db: DatabaseSync): void {
  const groups = db.prepare(
    "SELECT DISTINCT user_id, season_id, token_address FROM trades WHERE side = 'sell'"
  ).all() as { user_id: number; season_id: number; token_address: string }[];

  const upd = db.prepare("UPDATE trades SET realized_pnl = ? WHERE id = ?");
  for (const g of groups) {
    const decRow = db.prepare("SELECT decimals FROM tokens WHERE address = ?").get(g.token_address) as { decimals: number } | undefined;
    const scale = 10 ** (decRow?.decimals ?? 18);
    const rows = db.prepare(
      "SELECT id, side, amount_in, amount_out, exec_price FROM trades WHERE user_id = ? AND season_id = ? AND token_address = ? ORDER BY id"
    ).all(g.user_id, g.season_id, g.token_address) as { id: number; side: string; amount_in: string; amount_out: string; exec_price: number }[];

    const lots: { qty: bigint; price: number }[] = [];
    for (const t of rows) {
      if (t.side === "buy") {
        lots.push({ qty: BigInt(t.amount_out), price: t.exec_price });
      } else {
        let toConsume = BigInt(t.amount_in);
        let cost = 0;
        while (toConsume > 0n && lots.length > 0) {
          const lot = lots[0];
          const take = lot.qty < toConsume ? lot.qty : toConsume;
          cost += (Number(take) / scale) * lot.price;
          lot.qty -= take;
          toConsume -= take;
          if (lot.qty === 0n) lots.shift();
        }
        upd.run(Number(t.amount_out) - cost, t.id);
      }
    }
  }
}
