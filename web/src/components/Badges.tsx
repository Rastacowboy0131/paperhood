"use client";

// Badge chips: emoji chips with tooltip, used on the portfolio profile and
// next to leaderboard names.

import { BadgeDef, UserBadge } from "@/lib/api";

export const BADGE_FALLBACK: Record<string, BadgeDef> = {
  first_trade: { key: "first_trade", label: "First Trade", emoji: "🐣", desc: "Placed your first trade" },
  trades_10: { key: "trades_10", label: "Regular", emoji: "📈", desc: "10 trades placed" },
  trades_100: { key: "trades_100", label: "Degen", emoji: "🎰", desc: "100 trades placed" },
  streak_3: { key: "streak_3", label: "Hat Trick", emoji: "🔥", desc: "3 winning trades in a row" },
  streak_5: { key: "streak_5", label: "Heater", emoji: "🌋", desc: "5 winning trades in a row" },
  streak_10: { key: "streak_10", label: "Untouchable", emoji: "👑", desc: "10 winning trades in a row" },
  survivor_50: { key: "survivor_50", label: "Survivor", emoji: "🩹", desc: "Closed a trade at -50% or worse and lived to tell" },
  first_2x: { key: "first_2x", label: "2x Club", emoji: "🚀", desc: "First 2x on a single trade" },
};

// Inline emoji row for leaderboard names (keys only).
export function BadgeEmojis({ keys, max = 4 }: { keys?: string[]; max?: number }) {
  if (!keys?.length) return null;
  const shown = keys.slice(0, max);
  return (
    <span className="ml-1 align-middle text-[13px]">
      {shown.map((k) => {
        const def = BADGE_FALLBACK[k];
        if (!def) return null;
        return (
          <span key={k} title={`${def.label}: ${def.desc}`}>
            {def.emoji}
          </span>
        );
      })}
      {keys.length > max && <span className="ml-0.5 text-[10px] text-term-dim">+{keys.length - max}</span>}
    </span>
  );
}

// Full badge cards for the profile page.
export function BadgeGrid({ badges }: { badges: UserBadge[] }) {
  if (!badges.length)
    return (
      <div className="panel px-3 py-6 text-center text-term-dim">
        <div className="text-lg">🏅</div>
        <div className="mt-1 text-xs">No badges yet. Close some winning trades.</div>
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {badges.map((b) => (
        <div key={b.key} className="panel flex items-center gap-2.5 px-3 py-2.5" title={b.desc}>
          <span className="text-xl">{b.emoji}</span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">{b.label}</div>
            <div className="text-[10px] text-term-dim">
              {new Date(b.earnedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
