"use client";

// Daily quests panel: today's 3 quests with progress checkmarks and the
// completion streak flame. Full variant for the portfolio page, compact
// variant for the home screener. Auto-refreshes on a slow poll; progress is
// computed server-side from existing events, so there is nothing to claim.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { engagementApi, QuestsResponse } from "@/lib/engagement";

function useQuests(pollMs = 30000): QuestsResponse | null {
  const { address } = useAuth();
  const [data, setData] = useState<QuestsResponse | null>(null);
  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }
    let alive = true;
    const load = () => engagementApi.quests().then((r) => alive && setData(r)).catch(() => {});
    load();
    const id = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [address, pollMs]);
  return data;
}

function Check({ done }: { done: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
        done ? "border-term-green bg-term-green/15 text-term-green" : "border-term-border text-term-faint"
      }`}
      aria-hidden
    >
      {done ? "\u2713" : ""}
    </span>
  );
}

function StreakFlame({ streak }: { streak: number }) {
  return (
    <span
      className={`num inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
        streak > 0 ? "border-term-amber/50 text-term-amber" : "border-term-border text-term-dim"
      }`}
      title="Consecutive UTC days completing all 3 quests"
    >
      <span aria-hidden>{"\uD83D\uDD25"}</span>
      {streak}d
    </span>
  );
}

export function QuestsPanel() {
  const data = useQuests();
  if (!data) return null;
  const doneCount = data.quests.filter((q) => q.done).length;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">
        Daily quests
        <span className="num normal-case tracking-normal text-term-faint">{doneCount}/3 today, resets 00:00 UTC</span>
      </h2>
      <div className="panel divide-y divide-term-line">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs text-term-dim">
            {data.todayDone ? "All quests complete. See you tomorrow." : "Complete all 3 to extend your streak."}
          </span>
          <StreakFlame streak={data.streak} />
        </div>
        {data.quests.map((q) => (
          <div key={q.key} className="flex items-center gap-2.5 px-3 py-2.5">
            <Check done={q.done} />
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] font-medium ${q.done ? "text-term-dim line-through" : ""}`}>{q.desc}</div>
            </div>
            <span className="num text-xs text-term-dim">
              {q.key === "volume_500" ? `$${Math.round(q.progress)}/$${q.target}` : `${q.progress}/${q.target}`}
            </span>
          </div>
        ))}
        <div className="px-3 py-2 text-[11px] text-term-faint">
          Streak badges at 3, 7 and 30 days. <Link href="/achievements" className="text-term-accent hover:underline">View achievements</Link>
        </div>
      </div>
    </section>
  );
}

// One-line version for the home page header area.
export function QuestsCompact() {
  const data = useQuests(60000);
  if (!data) return null;
  return (
    <Link
      href="/portfolio"
      className="panel flex items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-term-hover"
      title="Daily quests, tracked automatically. Tap for details."
    >
      <span className="font-semibold uppercase tracking-wider text-term-dim">Quests</span>
      <span className="flex items-center gap-2">
        {data.quests.map((q) => (
          <span key={q.key} className="flex items-center gap-1" title={q.desc}>
            <Check done={q.done} />
          </span>
        ))}
      </span>
      <span className="num text-term-dim">{data.quests.filter((q) => q.done).length}/3</span>
      <span className="ml-auto">
        <StreakFlame streak={data.streak} />
      </span>
    </Link>
  );
}
