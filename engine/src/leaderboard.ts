import { DatabaseSync } from "node:sqlite";
import { getSeasonId, realizedPnl, truncateAddress, STARTING_BALANCE_USD } from "./ledger.js";

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
