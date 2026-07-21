// Leaderboards ranked by EQUITY CHANGE per timeframe, not just realized PnL.
// Equity = cash + mark-to-market open positions, sampled into equity_snapshots
// by the periodic sampler (see equity.ts). Each tab compares the user's
// latest equity against a baseline snapshot at the start of its window:
//   daily  = vs 00:00 UTC today (clamped to season start)
//   weekly = vs Monday 00:00 UTC (clamped to season start)
//   season = vs the fresh $10k starting balance at season start
//   all    = cumulative across seasons (sum of per-season equity PnL)
// Users with no baseline snapshot fall back to their first snapshot in the
// window, or the season starting balance for fresh joiners. Users with zero
// trades in the season are excluded entirely; a trade in-window is NOT
// required (open positions moving counts).
import { DatabaseSync } from "node:sqlite";
import { getSeasonId, listSeasons, realizedPnl, truncateAddress, STARTING_BALANCE_USD, SeasonInfo } from "./ledger.js";

export interface LeaderboardEntry {
  userId: number;
  address: string;
  display: string; // truncated address, e.g. 0x1234...abcd
  pnlUsd: number; // PnL over the window (equity change or realized, per metric)
  realizedPnlUsd: number; // kept as an alias of pnlUsd for older clients
  pnlPct: number; // PnL as % of the window baseline
  trades: number; // trades executed inside the window
}

// Ranking metric: equity = mark-to-market equity change (default),
// realized = FIFO realized PnL from closed sells only.
export type LeaderboardMetric = "equity" | "realized";

function usersInSeason(db: DatabaseSync, seasonId: number): { id: number; address: string }[] {
  return db.prepare(
    `SELECT u.id, u.address FROM users u
     WHERE EXISTS (SELECT 1 FROM trades t WHERE t.user_id = u.id AND t.season_id = ?)`
  ).all(seasonId) as { id: number; address: string }[];
}

// Last snapshot at or before ts (within a season).
function snapshotAtOrBefore(db: DatabaseSync, userId: number, seasonId: number, ts: number): number | null {
  const row = db.prepare(
    "SELECT equity_usd FROM equity_snapshots WHERE user_id = ? AND season_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1"
  ).get(userId, seasonId, ts) as { equity_usd: number } | undefined;
  return row ? row.equity_usd : null;
}

// First snapshot strictly after ts (within a season).
function firstSnapshotAfter(db: DatabaseSync, userId: number, seasonId: number, ts: number): number | null {
  const row = db.prepare(
    "SELECT equity_usd FROM equity_snapshots WHERE user_id = ? AND season_id = ? AND ts > ? ORDER BY ts ASC LIMIT 1"
  ).get(userId, seasonId, ts) as { equity_usd: number } | undefined;
  return row ? row.equity_usd : null;
}

// Latest known equity in a season. Falls back to starting balance + realized
// PnL (cash-only approximation) if the user has no snapshots yet.
function latestEquity(db: DatabaseSync, userId: number, seasonId: number): number {
  const row = db.prepare(
    "SELECT equity_usd FROM equity_snapshots WHERE user_id = ? AND season_id = ? ORDER BY ts DESC LIMIT 1"
  ).get(userId, seasonId) as { equity_usd: number } | undefined;
  if (row) return row.equity_usd;
  return STARTING_BALANCE_USD + realizedPnl(db, userId, seasonId);
}

// Baseline equity at windowStart for a user within a season.
// Preference: last snapshot at/before windowStart -> season starting balance
// for users whose first trade is inside the window -> first snapshot in the
// window -> season starting balance.
function baselineEquity(db: DatabaseSync, userId: number, seasonId: number, windowStart: number, seasonStart: number): number {
  if (windowStart <= seasonStart) return STARTING_BALANCE_USD;
  const before = snapshotAtOrBefore(db, userId, seasonId, windowStart);
  if (before != null) return before;
  const firstTrade = db.prepare(
    "SELECT MIN(ts) AS t FROM trades WHERE user_id = ? AND season_id = ?"
  ).get(userId, seasonId) as { t: number | null };
  if (firstTrade.t != null && firstTrade.t >= windowStart) return STARTING_BALANCE_USD;
  const after = firstSnapshotAfter(db, userId, seasonId, windowStart);
  if (after != null) return after;
  return STARTING_BALANCE_USD;
}

function tradesInWindow(db: DatabaseSync, userId: number, seasonId: number, sinceTs: number): number {
  return (db.prepare(
    "SELECT COUNT(*) AS c FROM trades WHERE user_id = ? AND season_id = ? AND ts >= ?"
  ).get(userId, seasonId, sinceTs) as { c: number }).c;
}

// Core ranking: equity change from windowStart to now for every user with
// trades in the season. windowStart <= seasonStart means "full season".
// Realized-only ranking: FIFO realized PnL from sells inside the window.
function rankByRealized(db: DatabaseSync, seasonId: number, windowStart: number): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  for (const u of usersInSeason(db, seasonId)) {
    const pnl = realizedPnl(db, u.id, seasonId, windowStart);
    const trades = tradesInWindow(db, u.id, seasonId, windowStart);
    if (trades === 0 && pnl === 0) continue;
    entries.push({
      userId: u.id,
      address: u.address,
      display: truncateAddress(u.address),
      pnlUsd: pnl,
      realizedPnlUsd: pnl,
      pnlPct: (pnl / STARTING_BALANCE_USD) * 100,
      trades,
    });
  }
  entries.sort((a, b) => b.pnlPct - a.pnlPct);
  return entries;
}

function rankByEquity(db: DatabaseSync, seasonId: number, windowStart: number): LeaderboardEntry[] {
  const season = db.prepare("SELECT start_ts FROM seasons WHERE id = ?").get(seasonId) as { start_ts: number } | undefined;
  const seasonStart = season?.start_ts ?? 0;
  const entries: LeaderboardEntry[] = [];
  for (const u of usersInSeason(db, seasonId)) {
    const hasSnapshots = (db.prepare(
      "SELECT COUNT(*) AS c FROM equity_snapshots WHERE user_id = ? AND season_id = ?"
    ).get(u.id, seasonId) as { c: number }).c > 0;
    let baseline: number;
    let pnl: number;
    if (hasSnapshots) {
      baseline = baselineEquity(db, u.id, seasonId, windowStart, seasonStart);
      pnl = latestEquity(db, u.id, seasonId) - baseline;
    } else {
      // No snapshots yet (fresh deploy or test data): realized-only fallback.
      baseline = STARTING_BALANCE_USD;
      pnl = realizedPnl(db, u.id, seasonId, windowStart);
    }
    const trades = tradesInWindow(db, u.id, seasonId, windowStart);
    // Skip users with nothing happening in the window: no trades and no
    // equity movement (e.g. joined but idle, or window is in the future).
    if (trades === 0 && pnl === 0) continue;
    const denom = baseline > 0 ? baseline : STARTING_BALANCE_USD;
    entries.push({
      userId: u.id,
      address: u.address,
      display: truncateAddress(u.address),
      pnlUsd: pnl,
      realizedPnlUsd: pnl,
      pnlPct: (pnl / denom) * 100,
      trades,
    });
  }
  entries.sort((a, b) => b.pnlPct - a.pnlPct);
  return entries;
}

function utcDayStart(nowSec: number): number {
  return nowSec - (nowSec % 86400);
}

// Monday 00:00 UTC of the current week.
function utcWeekStart(nowSec: number): number {
  const dayStart = utcDayStart(nowSec);
  const dow = new Date(nowSec * 1000).getUTCDay(); // 0=Sun..6=Sat
  return dayStart - ((dow + 6) % 7) * 86400;
}

// Daily: PnL since 00:00 UTC today (or season start if newer).
export function dailyLeaderboard(db: DatabaseSync, nowSec: number = Math.floor(Date.now() / 1000), metric: LeaderboardMetric = "equity"): LeaderboardEntry[] {
  const seasonId = getSeasonId(db, nowSec);
  const rank = metric === "realized" ? rankByRealized : rankByEquity;
  return rank(db, seasonId, utcDayStart(nowSec));
}

// Weekly: PnL since Monday 00:00 UTC (or season start if newer).
export function weeklyLeaderboard(db: DatabaseSync, nowSec: number = Math.floor(Date.now() / 1000), metric: LeaderboardMetric = "equity"): LeaderboardEntry[] {
  const seasonId = getSeasonId(db, nowSec);
  const rank = metric === "realized" ? rankByRealized : rankByEquity;
  return rank(db, seasonId, utcWeekStart(nowSec));
}

// ---------- windowed leaderboard (main page podium + leaderboard tabs) ----------
// 1d = since 00:00 UTC today, 7d = since Monday 00:00 UTC, all = all time
// (cumulative equity PnL across every season, fresh 10k each season).

export type LeaderboardWindow = "1d" | "7d" | "all";

export function windowLeaderboard(
  db: DatabaseSync,
  window: LeaderboardWindow,
  nowSec: number = Math.floor(Date.now() / 1000),
  metric: LeaderboardMetric = "equity"
): LeaderboardEntry[] {
  if (window === "1d") return dailyLeaderboard(db, nowSec, metric);
  if (window === "7d") return weeklyLeaderboard(db, nowSec, metric);
  return allTimeLeaderboard(db, nowSec, metric);
}

// All time: sum of per-season equity PnL (each season starts fresh at 10k).
// Percentage is relative to a single 10k stake for readability.
export function allTimeLeaderboard(db: DatabaseSync, _nowSec: number = Math.floor(Date.now() / 1000), metric: LeaderboardMetric = "equity"): LeaderboardEntry[] {
  const users = db.prepare(
    `SELECT u.id, u.address FROM users u
     WHERE EXISTS (SELECT 1 FROM trades t WHERE t.user_id = u.id)`
  ).all() as { id: number; address: string }[];

  const entries: LeaderboardEntry[] = [];
  for (const u of users) {
    const seasons = db.prepare(
      "SELECT DISTINCT season_id FROM trades WHERE user_id = ?"
    ).all(u.id) as { season_id: number }[];
    // Per season: final (or latest) equity minus the fresh 10k start,
    // or realized-only when the realized metric is selected.
    let pnl = 0;
    for (const s of seasons) {
      pnl += metric === "realized"
        ? realizedPnl(db, u.id, s.season_id)
        : latestEquity(db, u.id, s.season_id) - STARTING_BALANCE_USD;
    }
    const trades = (db.prepare(
      "SELECT COUNT(*) AS c FROM trades WHERE user_id = ?"
    ).get(u.id) as { c: number }).c;
    if (trades === 0) continue;
    entries.push({
      userId: u.id,
      address: u.address,
      display: truncateAddress(u.address),
      pnlUsd: pnl,
      realizedPnlUsd: pnl,
      pnlPct: (pnl / STARTING_BALANCE_USD) * 100,
      trades,
    });
  }
  entries.sort((a, b) => b.pnlUsd - a.pnlUsd);
  return entries;
}

// ---------- season leaderboard and archive ----------

// Full-season ranking: equity change vs the fresh $10k season start,
// or realized-only when the realized metric is selected.
export function seasonLeaderboard(db: DatabaseSync, seasonId: number, metric: LeaderboardMetric = "equity"): LeaderboardEntry[] {
  const rank = metric === "realized" ? rankByRealized : rankByEquity;
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
