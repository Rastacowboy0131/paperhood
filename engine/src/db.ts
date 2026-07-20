import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Shared SQLite db written by the indexer. Engine adds its own tables.
export const DEFAULT_DB_PATH = path.resolve(here, "../../indexer/data/paperhood.sqlite");

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
  discord_id TEXT UNIQUE NOT NULL,
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

  // Pools table exists from the indexer; the engine needs fee tier and token0
  // orientation, cached lazily on first quote.
  if (!hasColumn(db, "pools", "fee")) db.exec("ALTER TABLE pools ADD COLUMN fee INTEGER");
  if (!hasColumn(db, "pools", "token0")) db.exec("ALTER TABLE pools ADD COLUMN token0 TEXT");
}
