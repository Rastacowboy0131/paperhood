// Equity snapshots: sampled points of a user's total equity (cash + marked
// positions) within a season, powering the profile equity curve. Points are
// recorded after each trade and by a periodic sampler for users with open
// activity, throttled so the table stays small.
import { DatabaseSync } from "node:sqlite";
import { getPortfolio, getSeasonId, STARTING_BALANCE_USD } from "./ledger.js";

// Skip a new snapshot if the last one for this user is younger than this.
const MIN_GAP_S = 300;

export function recordEquitySnapshot(db: DatabaseSync, userId: number, seasonId: number, equityUsd: number, force = false): void {
  const now = Math.floor(Date.now() / 1000);
  if (!force) {
    const last = db.prepare(
      "SELECT ts FROM equity_snapshots WHERE user_id = ? AND season_id = ? ORDER BY ts DESC LIMIT 1"
    ).get(userId, seasonId) as { ts: number } | undefined;
    if (last && now - last.ts < MIN_GAP_S) return;
  }
  db.prepare(
    "INSERT INTO equity_snapshots (user_id, season_id, equity_usd, ts) VALUES (?, ?, ?, ?)"
  ).run(userId, seasonId, equityUsd, now);
}

// Compute current equity via the portfolio (quotes every open position) and
// store it. Errors are swallowed: snapshots are best effort.
export async function snapshotUser(db: DatabaseSync, userId: number, force = false): Promise<void> {
  try {
    const seasonId = getSeasonId(db);
    const p = await getPortfolio(db, userId, seasonId);
    recordEquitySnapshot(db, userId, seasonId, p.equityUsd, force);
  } catch { /* best effort */ }
}

// Periodic sampler: snapshot every user who traded in the current season.
export async function snapshotActiveUsers(db: DatabaseSync): Promise<number> {
  const seasonId = getSeasonId(db);
  const users = db.prepare(
    "SELECT DISTINCT user_id FROM trades WHERE season_id = ? LIMIT 500"
  ).all(seasonId) as { user_id: number }[];
  let done = 0;
  for (const u of users) {
    await snapshotUser(db, u.user_id);
    done++;
  }
  return done;
}

export interface EquityPoint { ts: number; equityUsd: number }

// Curve for the profile chart. Prepends a synthetic starting point at the
// season start (fresh 10k) so the line always begins at the baseline.
export function getEquityCurve(db: DatabaseSync, userId: number, seasonId: number, limit = 500): EquityPoint[] {
  const rows = db.prepare(
    "SELECT equity_usd, ts FROM equity_snapshots WHERE user_id = ? AND season_id = ? ORDER BY ts DESC LIMIT ?"
  ).all(userId, seasonId, limit) as { equity_usd: number; ts: number }[];
  rows.reverse();
  const season = db.prepare("SELECT start_ts FROM seasons WHERE id = ?").get(seasonId) as { start_ts: number } | undefined;
  const firstTrade = db.prepare(
    "SELECT MIN(ts) AS t FROM trades WHERE user_id = ? AND season_id = ?"
  ).get(userId, seasonId) as { t: number | null };
  const startTs = firstTrade.t ?? season?.start_ts;
  const out: EquityPoint[] = [];
  if (startTs != null && (rows.length === 0 || rows[0].ts > startTs)) {
    out.push({ ts: startTs - 1, equityUsd: STARTING_BALANCE_USD });
  }
  for (const r of rows) out.push({ ts: r.ts, equityUsd: r.equity_usd });
  return out;
}
