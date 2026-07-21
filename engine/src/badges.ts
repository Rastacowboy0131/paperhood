// Achievement badges: computed server-side from the trade log and stored in
// the badges table (insert-once, never revoked). Recompute is cheap: a single
// pass over the user's trades, run after each trade or order fill.
import { DatabaseSync } from "node:sqlite";
import { recordActivity } from "./activity.js";

export interface BadgeDef {
  key: string;
  label: string;
  emoji: string;
  desc: string;
}

export const BADGE_DEFS: BadgeDef[] = [
  { key: "first_trade", label: "First Trade", emoji: "🐣", desc: "Placed your first trade" },
  { key: "trades_10", label: "Regular", emoji: "📈", desc: "10 trades placed" },
  { key: "trades_100", label: "Degen", emoji: "🎰", desc: "100 trades placed" },
  { key: "streak_3", label: "Hat Trick", emoji: "🔥", desc: "3 winning trades in a row" },
  { key: "streak_5", label: "Heater", emoji: "🌋", desc: "5 winning trades in a row" },
  { key: "streak_10", label: "Untouchable", emoji: "👑", desc: "10 winning trades in a row" },
  { key: "survivor_50", label: "Survivor", emoji: "🩹", desc: "Closed a trade at -50% or worse and lived to tell" },
  { key: "first_2x", label: "2x Club", emoji: "🚀", desc: "First 2x on a single trade" },
  { key: "quest_streak_3", label: "Warming Up", emoji: "🔥", desc: "Complete all daily quests 3 days in a row" },
  { key: "quest_streak_7", label: "On Fire", emoji: "🎯", desc: "Complete all daily quests 7 days in a row" },
  { key: "quest_streak_30", label: "Iron Discipline", emoji: "🏆", desc: "Complete all daily quests 30 days in a row" },
];

const DEF_BY_KEY = new Map(BADGE_DEFS.map((b) => [b.key, b]));

export interface UserBadge extends BadgeDef {
  earnedAt: number;
}

interface SellRow {
  amount_out: string; // USD received
  realized_pnl: number | null;
  ts: number;
}

// Full recompute for one user. Awards any badges not yet held; earned_at is
// the ts of the trade that completed the condition.
export function checkBadges(db: DatabaseSync, userId: number): string[] {
  const held = new Set(
    (db.prepare("SELECT badge FROM badges WHERE user_id = ?").all(userId) as { badge: string }[]).map((r) => r.badge)
  );
  const award: { key: string; ts: number }[] = [];

  // Trade-count badges.
  const counts = db.prepare(
    "SELECT COUNT(*) AS c FROM trades WHERE user_id = ?"
  ).get(userId) as { c: number };
  const tsOfNth = (n: number): number => {
    const r = db.prepare("SELECT ts FROM trades WHERE user_id = ? ORDER BY id LIMIT 1 OFFSET ?").get(userId, n - 1) as { ts: number } | undefined;
    return r?.ts ?? Math.floor(Date.now() / 1000);
  };
  if (counts.c >= 1 && !held.has("first_trade")) award.push({ key: "first_trade", ts: tsOfNth(1) });
  if (counts.c >= 10 && !held.has("trades_10")) award.push({ key: "trades_10", ts: tsOfNth(10) });
  if (counts.c >= 100 && !held.has("trades_100")) award.push({ key: "trades_100", ts: tsOfNth(100) });

  // Sell-based badges: streaks, survivor, 2x. PnL percent per sell uses cost
  // basis reconstructed from proceeds - pnl.
  const sells = db.prepare(
    "SELECT amount_out, realized_pnl, ts FROM trades WHERE user_id = ? AND side = 'sell' AND realized_pnl IS NOT NULL ORDER BY id"
  ).all(userId) as unknown as SellRow[];

  let streak = 0;
  for (const s of sells) {
    const pnl = s.realized_pnl ?? 0;
    const proceeds = Number(s.amount_out);
    const cost = proceeds - pnl;
    const pct = cost > 0 ? (pnl / cost) * 100 : 0;

    streak = pnl > 0 ? streak + 1 : 0;
    if (streak >= 3 && !held.has("streak_3") && !award.some((a) => a.key === "streak_3")) award.push({ key: "streak_3", ts: s.ts });
    if (streak >= 5 && !held.has("streak_5") && !award.some((a) => a.key === "streak_5")) award.push({ key: "streak_5", ts: s.ts });
    if (streak >= 10 && !held.has("streak_10") && !award.some((a) => a.key === "streak_10")) award.push({ key: "streak_10", ts: s.ts });
    if (pct <= -50 && !held.has("survivor_50") && !award.some((a) => a.key === "survivor_50")) award.push({ key: "survivor_50", ts: s.ts });
    if (pct >= 100 && !held.has("first_2x") && !award.some((a) => a.key === "first_2x")) award.push({ key: "first_2x", ts: s.ts });
  }

  const ins = db.prepare("INSERT OR IGNORE INTO badges (user_id, badge, earned_at) VALUES (?, ?, ?)");
  for (const a of award) {
    ins.run(userId, a.key, a.ts);
    const def = DEF_BY_KEY.get(a.key);
    recordActivity(db, "badge", { userId, data: { badge: a.key, label: def?.label, emoji: def?.emoji } });
  }
  return award.map((a) => a.key);
}

export function getUserBadges(db: DatabaseSync, userId: number): UserBadge[] {
  const rows = db.prepare(
    "SELECT badge, earned_at FROM badges WHERE user_id = ? ORDER BY earned_at"
  ).all(userId) as { badge: string; earned_at: number }[];
  const out: UserBadge[] = [];
  for (const r of rows) {
    const def = DEF_BY_KEY.get(r.badge);
    if (def) out.push({ ...def, earnedAt: r.earned_at });
  }
  return out;
}

// Badge keys for a set of users in one query (leaderboard decoration).
export function badgesForUsers(db: DatabaseSync, userIds: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (userIds.length === 0) return map;
  const list = userIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT user_id, badge FROM badges WHERE user_id IN (${list}) ORDER BY earned_at`
  ).all(...userIds) as { user_id: number; badge: string }[];
  for (const r of rows) {
    if (!DEF_BY_KEY.has(r.badge)) continue;
    const arr = map.get(r.user_id) ?? [];
    arr.push(r.badge);
    map.set(r.user_id, arr);
  }
  return map;
}
