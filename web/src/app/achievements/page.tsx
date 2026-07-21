"use client";

// Achievements: every badge in the game, earned in color with a date, locked
// greyed out with a how-to-earn hint.
import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeDef, UserBadge } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { engagementApi, BADGE_HINTS } from "@/lib/engagement";
import { BADGE_FALLBACK } from "@/components/Badges";

export default function AchievementsPage() {
  const { address, loading } = useAuth();
  const [defs, setDefs] = useState<BadgeDef[]>(Object.values(BADGE_FALLBACK));
  const [earned, setEarned] = useState<Map<string, UserBadge>>(new Map());
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!address) {
      setEarned(new Map());
      setFetched(false);
      return;
    }
    engagementApi
      .myBadges()
      .then((r) => {
        if (r.defs.length) setDefs(r.defs);
        setEarned(new Map(r.badges.map((b) => [b.key, b])));
        setFetched(true);
      })
      .catch(() => setFetched(true));
  }, [address]);

  const earnedCount = defs.filter((d) => earned.has(d.key)).length;

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-bold">Achievements</h1>
        {address && fetched && (
          <span className="num text-sm text-term-dim">
            {earnedCount}/{defs.length} earned
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="panel p-3">
              <div className="skeleton h-8 w-8 rounded-full" />
              <div className="skeleton mt-2 h-3 w-20" />
              <div className="skeleton mt-1.5 h-3 w-28" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {!address && (
            <div className="panel px-3 py-3 text-sm text-term-dim">
              Connect your wallet to track which badges you have earned. Here is everything up for grabs:
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {defs.map((d) => {
              const e = earned.get(d.key);
              return (
                <div
                  key={d.key}
                  className={`panel flex flex-col gap-1.5 p-3 ${e ? "" : "opacity-60"}`}
                  title={e ? d.desc : BADGE_HINTS[d.key] || d.desc}
                >
                  <div className={`text-2xl ${e ? "" : "grayscale"}`}>{d.emoji}</div>
                  <div className="text-[13px] font-semibold leading-tight">{d.label}</div>
                  {e ? (
                    <div className="text-[11px] text-term-green">
                      Earned{" "}
                      {new Date(e.earnedAt * 1000).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] leading-snug text-term-dim">{BADGE_HINTS[d.key] || d.desc}</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="text-xs text-term-dim">
        Quest streak badges come from the <Link href="/portfolio" className="text-term-accent hover:underline">daily quests</Link> on your portfolio page.
      </div>
    </div>
  );
}
