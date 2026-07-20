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

// Schema version. Bump when the shape or meaning of indexer data changes.
// v2: normalized prices (quote per tracked token, decimal adjusted) plus
// token0/token1/decimals on pools. Old snapshots/candles held raw ratios,
// so they are dropped on upgrade (data is short-lived by design).
// v3: adds candles_hourly (backfilled hourly OHLC). Additive, so upgrading
// from v2 keeps existing data; anything older still gets dropped.
const SCHEMA_VERSION = 3;
const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
if (row.user_version < 2) {
  console.log(`schema version ${row.user_version} -> ${SCHEMA_VERSION}: dropping indexer tables`);
  db.exec("DROP TABLE IF EXISTS pools; DROP TABLE IF EXISTS snapshots; DROP TABLE IF EXISTS candles;");
}
if (row.user_version !== SCHEMA_VERSION) {
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

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
  token0 TEXT,             -- pool token0 address, lowercase
  token1 TEXT,             -- pool token1 address, lowercase
  decimals0 INTEGER,
  decimals1 INTEGER,
  fee INTEGER,             -- pool fee tier, cached by the engine
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
  price REAL                    -- quote tokens per 1 tracked token, decimal adjusted
);
CREATE INDEX IF NOT EXISTS idx_snap_pair_ts ON snapshots(pair_address, ts);

CREATE TABLE IF NOT EXISTS candles (
  pair_address TEXT NOT NULL,
  minute INTEGER NOT NULL,      -- unix seconds floored to minute
  open REAL, high REAL, low REAL, close REAL,
  n INTEGER,
  PRIMARY KEY (pair_address, minute)
);

CREATE TABLE IF NOT EXISTS candles_hourly (
  pair_address TEXT NOT NULL,
  hour INTEGER NOT NULL,        -- unix seconds floored to hour
  open REAL, high REAL, low REAL, close REAL,
  PRIMARY KEY (pair_address, hour)
);
`);

// Additive columns (v3 stays the schema version; these are safe to re-run).
// total_supply is decimal adjusted (human units) for the tracked token;
// supply_ts is when it was last read, used for periodic refresh.
for (const col of ["total_supply REAL", "supply_ts INTEGER"]) {
  try {
    db.exec(`ALTER TABLE pools ADD COLUMN ${col}`);
  } catch {
    // column already exists
  }
}

// Read-side queries filter with COLLATE NOCASE, which the case-sensitive
// primary keys and idx_snap_pair_ts cannot serve, so every lookup was a
// full table scan (slow once candles grew after the history backfill).
// These NOCASE indexes let those queries use an index without touching
// any call sites. Safe to re-run.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_snap_pair_nocase_ts ON snapshots(pair_address COLLATE NOCASE, ts);
CREATE INDEX IF NOT EXISTS idx_candles_pair_nocase_minute ON candles(pair_address COLLATE NOCASE, minute);
CREATE INDEX IF NOT EXISTS idx_candles_hourly_pair_nocase_hour ON candles_hourly(pair_address COLLATE NOCASE, hour);
`);
