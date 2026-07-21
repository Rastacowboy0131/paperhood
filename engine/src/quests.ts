// Daily quests: 3 quests per UTC day, picked deterministically from a pool.
// Progress is derived entirely from existing event tables (trades, orders,
// trade_notes), so there is no claiming step and no extra per-event writes.
// Streak = consecutive UTC days where all 3 quests were completed; streak
// badges are awarded at 3/7/30 via checkQuestBadges.
import { DatabaseSync } from "node:sqlite";
import { recordActivity } from "./activity.js";

export interface QuestDef {
  key: string;
  label: string;
  desc: string;
  target: number;
}

// Quest pool. Keys are stable; progress queries live in questProgress.
export const QUEST_POOL: QuestDef[] = [
  { key: "trades_3", label: "Volume Shooter", desc: "Make 3 trades today", target: 3 },
  { key: "close_profit", label: "Take Profit", desc: "Close a trade in profit", target: 1 },
  { key: "two_tokens", label: "Diversify", desc: "Trade 2 different tokens", target: 2 },
  { key: "journal_note", label: "Dear Diary", desc: "Add a journal note", target: 1 },
  { key: "limit_order", label: "Sniper Setup", desc: "Place a limit or stop order", target: 1 },
  { key: "volume_500", label: "Size Matters", desc: "Trade $500 in total volume", target: 500 },
  { key: "one_trade", label: "Show Up", desc: "Make a trade", target: 1 },
];

const DAY_S = 86400;

export function utcDayStart(tsS = Math.floor(Date.now() / 1000)): number {
  return tsS - (tsS % DAY_S);
}

// Deterministic pick of 3 distinct pool indices for a UTC day (LCG walk
// seeded by the day number, same result on every server).
export function questsForDay(dayStartS: number): QuestDef[] {
  const day = Math.floor(dayStartS / DAY_S);
  const picked: number[] = [];
  let x = (day * 2654435761) >>> 0;
  while (picked.length < 3) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const i = x % QUEST_POOL.length;
    if (!picked.includes(i)) picked.push(i);
  }
  return picked.map((i) => QUEST_POOL[i]);
}

export interface QuestProgress extends QuestDef {
  progress: number;
  done: boolean;
}

function count(db: DatabaseSync, sql: string, ...args: (number | string)[]): number {
  return Number((db.prepare(sql).get(...args) as { c: number }).c ?? 0);
}

function questValue(db: DatabaseSync, userId: number, key: string, fromS: number, toS: number): number {
  switch (key) {
    case "trades_3":
    case "one_trade":
      return count(db, "SELECT COUNT(*) AS c FROM trades WHERE user_id = ? AND ts >= ? AND ts < ?", userId, fromS, toS);
    case "close_profit":
      return count(db, "SELECT COUNT(*) AS c FROM trades WHERE user_id = ? AND side = 'sell' AND realized_pnl > 0 AND ts >= ? AND ts < ?", userId, fromS, toS);
    case "two_tokens":
      return count(db, "SELECT COUNT(DISTINCT token_address) AS c FROM trades WHERE user_id = ? AND ts >= ? AND ts < ?", userId, fromS, toS);
    case "journal_note":
      return count(db, "SELECT COUNT(*) AS c FROM trade_notes WHERE user_id = ? AND created_at >= ? AND created_at < ?", userId, fromS, toS);
    case "limit_order":
      return count(db, "SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND created_at >= ? AND created_at < ?", userId, fromS, toS);
    case "volume_500":
      return Number((db.prepare(
        "SELECT COALESCE(SUM(CASE WHEN side = 'buy' THEN CAST(amount_in AS REAL) ELSE CAST(amount_out AS REAL) END), 0) AS c FROM trades WHERE user_id = ? AND ts >= ? AND ts < ?"
      ).get(userId, fromS, toS) as { c: number }).c ?? 0);
    default:
      return 0;
  }
}

export function questProgress(db: DatabaseSync, userId: number, dayStartS: number): QuestProgress[] {
  const toS = dayStartS + DAY_S;
  return questsForDay(dayStartS).map((q) => {
    const v = questValue(db, userId, q.key, dayStartS, toS);
    return { ...q, progress: Math.min(v, q.target), done: v >= q.target };
  });
}

export function dayComplete(db: DatabaseSync, userId: number, dayStartS: number): boolean {
  return questProgress(db, userId, dayStartS).every((q) => q.done);
}

export interface StreakInfo {
  streak: number;      // consecutive completed days including today when done
  todayDone: boolean;
}

// Walk back day by day (capped) counting fully completed days. Today counts
// only once completed; an incomplete today does not break yesterday's run.
export function questStreak(db: DatabaseSync, userId: number, maxDays = 400): StreakInfo {
  const today = utcDayStart();
  const todayDone = dayComplete(db, userId, today);
  let streak = 0;
  let d = todayDone ? today : today - DAY_S;
  while (streak < maxDays) {
    if (dayComplete(db, userId, d)) {
      streak++;
      d -= DAY_S;
    } else break;
  }
  return { streak, todayDone };
}

// Quest streak badges (defs live in badges.ts BADGE_DEFS). Returns newly
// awarded badge keys.
const STREAK_BADGES: { key: string; days: number }[] = [
  { key: "quest_streak_3", days: 3 },
  { key: "quest_streak_7", days: 7 },
  { key: "quest_streak_30", days: 30 },
];

export function checkQuestBadges(db: DatabaseSync, userId: number, streak?: number): string[] {
  const s = streak ?? questStreak(db, userId).streak;
  if (s < 3) return [];
  const held = new Set(
    (db.prepare("SELECT badge FROM badges WHERE user_id = ?").all(userId) as { badge: string }[]).map((r) => r.badge)
  );
  const now = Math.floor(Date.now() / 1000);
  const ins = db.prepare("INSERT OR IGNORE INTO badges (user_id, badge, earned_at) VALUES (?, ?, ?)");
  const awarded: string[] = [];
  for (const b of STREAK_BADGES) {
    if (s >= b.days && !held.has(b.key)) {
      ins.run(userId, b.key, now);
      awarded.push(b.key);
      recordActivity(db, "quest_streak", { userId, data: { days: b.days, badge: b.key } });
    }
  }
  return awarded;
}
