// Watchlist and trade journal: small per-user features.
// Watchlist rows are (user, token) pairs; notes are short freeform text,
// optionally attached to a specific trade id.
import { DatabaseSync } from "node:sqlite";

export const NOTE_MAX_CHARS = 500;

// ---------- watchlist ----------

export function getWatchlist(db: DatabaseSync, userId: number): { token: string; createdAt: number }[] {
  const rows = db.prepare(
    "SELECT token_address, created_at FROM watchlist WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as { token_address: string; created_at: number }[];
  return rows.map((r) => ({ token: r.token_address, createdAt: r.created_at }));
}

export function addWatch(db: DatabaseSync, userId: number, token: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO watchlist (user_id, token_address, created_at) VALUES (?, ?, ?)"
  ).run(userId, token.toLowerCase(), Math.floor(Date.now() / 1000));
}

export function removeWatch(db: DatabaseSync, userId: number, token: string): boolean {
  const before = (db.prepare("SELECT COUNT(*) AS c FROM watchlist WHERE user_id = ? AND token_address = ?").get(userId, token.toLowerCase()) as { c: number }).c;
  db.prepare("DELETE FROM watchlist WHERE user_id = ? AND token_address = ?").run(userId, token.toLowerCase());
  return before > 0;
}

// ---------- trade journal ----------

export interface NoteRow {
  id: number;
  user_id: number;
  token_address: string;
  trade_id: number | null;
  text: string;
  created_at: number;
  updated_at: number;
}

export function createNote(db: DatabaseSync, userId: number, token: string, text: string, tradeId?: number | null): NoteRow {
  const t = text.trim().slice(0, NOTE_MAX_CHARS);
  if (!t) throw new Error("note text required");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    "INSERT INTO trade_notes (user_id, token_address, trade_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, token.toLowerCase(), tradeId ?? null, t, now, now);
  const id = Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  return db.prepare("SELECT * FROM trade_notes WHERE id = ?").get(id) as unknown as NoteRow;
}

export function updateNote(db: DatabaseSync, userId: number, id: number, text: string): NoteRow | null {
  const t = text.trim().slice(0, NOTE_MAX_CHARS);
  if (!t) throw new Error("note text required");
  const row = db.prepare("SELECT * FROM trade_notes WHERE id = ? AND user_id = ?").get(id, userId) as NoteRow | undefined;
  if (!row) return null;
  db.prepare("UPDATE trade_notes SET text = ?, updated_at = ? WHERE id = ?").run(t, Math.floor(Date.now() / 1000), id);
  return db.prepare("SELECT * FROM trade_notes WHERE id = ?").get(id) as unknown as NoteRow;
}

export function deleteNote(db: DatabaseSync, userId: number, id: number): boolean {
  const row = db.prepare("SELECT id FROM trade_notes WHERE id = ? AND user_id = ?").get(id, userId) as { id: number } | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM trade_notes WHERE id = ?").run(id);
  return true;
}

// Notes for one token (Journal tab) or all tokens (portfolio rollup),
// newest first, joined with token symbols for display.
export function listNotes(db: DatabaseSync, userId: number, token?: string, limit = 200): (NoteRow & { symbol: string })[] {
  const symStmt = db.prepare(
    "SELECT symbol FROM pools WHERE token_address = ? COLLATE NOCASE ORDER BY liquidity_usd DESC LIMIT 1"
  );
  const rows = (token
    ? db.prepare(
        "SELECT * FROM trade_notes WHERE user_id = ? AND token_address = ? ORDER BY created_at DESC, id DESC LIMIT ?"
      ).all(userId, token.toLowerCase(), limit)
    : db.prepare(
        "SELECT * FROM trade_notes WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
      ).all(userId, limit)) as unknown as NoteRow[];
  return rows.map((r) => ({
    ...r,
    symbol: (symStmt.get(r.token_address) as { symbol: string | null } | undefined)?.symbol ?? "?",
  }));
}
