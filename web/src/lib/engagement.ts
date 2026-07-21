// Client helpers for the engagement features (daily quests, activity feed,
// achievements). Kept separate from lib/api.ts to stay conflict-free while
// other features land in that file.
import { API_URL, BadgeDef, UserBadge } from "@/lib/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface QuestProgress {
  key: string;
  label: string;
  desc: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface QuestsResponse {
  dayStart: number;
  dayEnd: number;
  quests: QuestProgress[];
  streak: number;
  todayDone: boolean;
}

export interface ActivityEvent {
  id: number;
  type: "trade" | "big_win" | "badge" | "join" | "quest_streak";
  address: string | null;
  token: string | null;
  symbol: string | null;
  data: Record<string, unknown> | null;
  ts: number;
}

export const engagementApi = {
  quests: () => req<QuestsResponse>("/quests/me"),
  activity: () => req<{ events: ActivityEvent[] }>("/activity"),
  myBadges: () => req<{ defs: BadgeDef[]; badges: UserBadge[] }>("/badges/me"),
};

// Locked-badge hints for the achievements grid (key -> how to earn).
// Falls back to the badge desc when a key is missing.
export const BADGE_HINTS: Record<string, string> = {
  first_trade: "Place any paper trade",
  trades_10: "Place 10 trades",
  trades_100: "Place 100 trades",
  streak_3: "Close 3 winning trades in a row",
  streak_5: "Close 5 winning trades in a row",
  streak_10: "Close 10 winning trades in a row",
  survivor_50: "Close a trade at -50% or worse",
  first_2x: "Close a single trade at +100% or better",
  quest_streak_3: "Complete all 3 daily quests 3 days in a row",
  quest_streak_7: "Complete all 3 daily quests 7 days in a row",
  quest_streak_30: "Complete all 3 daily quests 30 days in a row",
};

export function relTime(tsS: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000) - tsS);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
