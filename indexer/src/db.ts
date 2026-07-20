import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR overrides where the SQLite file lives (deployment: a mounted volume).
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(here, "../data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "paperhood.sqlite"));
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS pools (
  pair_address TEXT PRIMARY KEY,
  token_address TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  dex_id TEXT,
  version TEXT,           -- v2 | v3 | v4
  quote_token TEXT,
  quote_symbol TEXT,
  liquidity_usd REAL,
  volume24h REAL,
  active INTEGER DEFAULT 1,
  first_seen INTEGER,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_address TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- unix seconds
  reserve0 TEXT,                -- v2
  reserve1 TEXT,                -- v2
  sqrt_price_x96 TEXT,          -- v3
  tick INTEGER,                 -- v3
  liquidity TEXT,               -- v3
  price REAL                    -- token price in quote units, derived
);
CREATE INDEX IF NOT EXISTS idx_snap_pair_ts ON snapshots(pair_address, ts);

CREATE TABLE IF NOT EXISTS candles (
  pair_address TEXT NOT NULL,
  minute INTEGER NOT NULL,      -- unix seconds floored to minute
  open REAL, high REAL, low REAL, close REAL,
  n INTEGER,
  PRIMARY KEY (pair_address, minute)
);
`);
