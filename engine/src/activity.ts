// Platform activity feed: append-only event log rendered on the home page.
// Events: paper trades, big wins (closed trade over +50%), badge unlocks,
// new users joining, quest streak milestones. Kept intentionally small; the
// API serves the latest 50 rows and the web polls it.
import { DatabaseSync } from "node:sqlite";

export type ActivityType = "trade" | "big_win" | "badge" | "join" | "quest_streak";

export interface ActivityInput {
  userId?: number | null;
  address?: string | null;
  token?: string | null;
  symbol?: string | null;
  data?: Record<string, unknown> | null;
  ts?: number;
}

export function ensureActivityTable(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  user_id INTEGER,
  address TEXT,
  token_address TEXT,
  symbol TEXT,
  data TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
`);
}

export function recordActivity(db: DatabaseSync, type: ActivityType, ev: ActivityInput = {}): void {
  try {
    let address = ev.address ?? null;
    if (!address && ev.userId != null) {
      const row = db.prepare("SELECT address FROM users WHERE id = ?").get(ev.userId) as { address: string } | undefined;
      address = row?.address ?? null;
    }
    db.prepare(
      "INSERT INTO activity (type, user_id, address, token_address, symbol, data, ts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      type,
      ev.userId ?? null,
      address,
      ev.token?.toLowerCase() ?? null,
      ev.symbol ?? null,
      ev.data ? JSON.stringify(ev.data) : null,
      ev.ts ?? Math.floor(Date.now() / 1000)
    );
  } catch { /* feed is best effort, never block the caller */ }
}

export interface ActivityEventRow {
  id: number;
  type: ActivityType;
  address: string | null;
  token: string | null;
  symbol: string | null;
  data: Record<string, unknown> | null;
  ts: number;
}

export function listActivity(db: DatabaseSync, limit = 50): ActivityEventRow[] {
  const rows = db.prepare(
    "SELECT id, type, address, token_address, symbol, data, ts FROM activity ORDER BY id DESC LIMIT ?"
  ).all(Math.min(Math.max(limit, 1), 100)) as { id: number; type: string; address: string | null; token_address: string | null; symbol: string | null; data: string | null; ts: number }[];
  return rows.map((r) => {
    let data: Record<string, unknown> | null = null;
    if (r.data) { try { data = JSON.parse(r.data); } catch { data = null; } }
    return { id: r.id, type: r.type as ActivityType, address: r.address, token: r.token_address, symbol: r.symbol, data, ts: r.ts };
  });
}
