import { DatabaseSync } from "node:sqlite";
import { getSeasonId, listSeasons, realizedPnl, truncateAddress, STARTING_BALANCE_USD, SeasonInfo } from "./ledger.js";

export interface LeaderboardEntry {
  userId: number;
  address: string;
  display: string; // truncated address, e.g. 0x1234...abcd
  realizedPnlUsd: number;
  pnlPct: number; // realized PnL as % of starting balance
  trades: number;
}

function usersInSeason(db: DatabaseSync, seasonId: number): { id: number; address: string }[] {
  return db.prepare(
    `SELECT u.id, u.address FROM users u
     WHERE EXISTS (SELECT 1 FROM trades t WHERE t.user_id = u.id AND t.season_id = ?)`
  ).all(seasonId) as { id: number; address: string }[];
}

function rank(db: DatabaseSync, seasonId: number, sinceTs: number): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  for (const u of usersInSeason(db, seasonId)) {
    const pnl = realizedPnl(db, u.id, seasonId, sinceTs);
    const trades = (db.prepare(
      "SELECT COUNT(*) AS c FROM trades WHERE user_id = ? AND season_id = ? AND ts >= ?"
    ).get(u.id, seasonId, sinceTs) as { c: number }).c;
    if (trades === 0) continue;
    entries.push({
      userId: u.id,
      address: u.address,
      display: truncateAddress(u.address),
      realizedPnlUsd: pnl,
      pnlPct: (pnl / STARTING_BALANCE_USD) * 100,
      trades,
    });
  }
  entries.sort((a, b) => b.pnlPct - a.pnlPct);
  return entries;
}

// Weekly: realized PnL % over the whole current season (fresh 10k each Monday 00:00 UTC).
export function weeklyLeaderboard(db: DatabaseSync, nowSec: number = Math.floor(Date.now() / 1000)): LeaderboardEntry[] {
  const seasonId = getSeasonId(db, nowSec);
  return rank(db, seasonId, 0);
}

// Daily: realized PnL % from sells closed since 00:00 UTC today, within the current season.
export function dailyLeaderboard(db: DatabaseSync, nowSec: number = Math.floor(Date.now() / 1000)): LeaderboardEntry[] {
  const seasonId = getSeasonId(db, nowSec);
  const dayStart = nowSec - (nowSec % 86400);
  return rank(db, seasonId, dayStart);
}

// ---------- windowed leaderboard (main page podium) ----------
// Windows: 1d = rolling 24h, 7d = rolling 7 days, all = everything.
// Ranking is realized PnL only (FIFO within each season), summed across all
// seasons the user traded in. Unrealized PnL change is intentionally excluded:
// marking every open position requires a pool quote per position per user,
// which is too expensive for a page that refreshes every 30-60s.

export type LeaderboardWindow = "1d" | "7d" | "all";

export function windowLeaderboard(
  db: DatabaseSync,
  window: LeaderboardWindow,
  nowSec: number = Math.floor(Date.now() / 1000)
): LeaderboardEntry[] {
  const sinceTs = window === "1d" ? nowSec - 86400 : window === "7d" ? nowSec - 7 * 86400 : 0;

  const users = db.prepare(
    `SELECT u.id, u.address FROM users u
     WHERE EXISTS (SELECT 1 FROM trades t WHERE t.user_id = u.id AND t.ts >= ?)`
  ).all(sinceTs) as { id: number; address: string }[];

  const entries: LeaderboardEntry[] = [];
  for (const u of users) {
    const seasons = db.prepare(
      "SELECT DISTINCT season_id FROM trades WHERE user_id = ?"
    ).all(u.id) as { season_id: number }[];
    let pnl = 0;
    for (const s of seasons) pnl += realizedPnl(db, u.id, s.season_id, sinceTs);
    const trades = (db.prepare(
      "SELECT COUNT(*) AS c FROM trades WHERE user_id = ? AND ts >= ?"
    ).get(u.id, sinceTs) as { c: number }).c;
    if (trades === 0) continue;
    entries.push({
      userId: u.id,
      address: u.address,
      display: truncateAddress(u.address),
      realizedPnlUsd: pnl,
      pnlPct: (pnl / STARTING_BALANCE_USD) * 100,
      trades,
    });
  }
  entries.sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd);
  return entries;
}

// ---------- season leaderboard and archive ----------

// Full-season ranking by realized PnL % (fresh 10k per season).
export function seasonLeaderboard(db: DatabaseSync, seasonId: number): LeaderboardEntry[] {
  return rank(db, seasonId, 0);
}

export interface SeasonArchiveEntry {
  season: SeasonInfo;
  winners: LeaderboardEntry[]; // top 3
}

// Top 3 of every finished season, newest first.
export function seasonArchive(db: DatabaseSync, nowSec: number = Math.floor(Date.now() / 1000)): SeasonArchiveEntry[] {
  const past = listSeasons(db).filter((s) => s.endTs <= nowSec);
  past.sort((a, b) => b.startTs - a.startTs);
  return past.map((season) => ({ season, winners: seasonLeaderboard(db, season.id).slice(0, 3) }));
}
