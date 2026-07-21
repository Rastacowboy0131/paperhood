"use client";

// Platform activity feed: paper trades, big wins, badge unlocks, joins and
// quest streak milestones. Polls /activity every 10s; new rows slide in
// unless the user prefers reduced motion.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtCompact, fmtUsd, truncAddr } from "@/lib/api";
import { engagementApi, ActivityEvent, relTime } from "@/lib/engagement";

function eventLine(ev: ActivityEvent): { icon: string; body: React.ReactNode } | null {
  const who = ev.address ? (
    <Link href={`/u/${ev.address}`} className="num font-medium text-term-text hover:underline">
      {truncAddr(ev.address)}
    </Link>
  ) : (
    <span className="text-term-dim">someone</span>
  );
  const tok = ev.token ? (
    <Link href={`/t/${ev.token}`} className="font-semibold text-term-accent hover:underline">
      {ev.symbol || truncAddr(ev.token)}
    </Link>
  ) : null;

  switch (ev.type) {
    case "trade": {
      const side = String(ev.data?.side || "");
      const qty = Number(ev.data?.qtyDec ?? 0);
      const usd = Number(ev.data?.usd ?? 0);
      return {
        icon: side === "buy" ? "\uD83D\uDFE2" : "\uD83D\uDD34",
        body: (
          <>
            {who} {side === "buy" ? "bought" : "sold"}{" "}
            <span className="num">{qty > 0 ? fmtCompact(qty) : `$${fmtUsd(usd, 0)}`}</span> {tok}
          </>
        ),
      };
    }
    case "big_win": {
      const pct = Number(ev.data?.pnlPct ?? 0);
      return {
        icon: "\uD83D\uDCB0",
        body: (
          <>
            {who} closed {tok} for <span className="num font-semibold text-term-green">+{pct.toFixed(0)}%</span>
          </>
        ),
      };
    }
    case "badge": {
      const label = String(ev.data?.label || ev.data?.badge || "a badge");
      const emoji = String(ev.data?.emoji || "\uD83C\uDFC5");
      return {
        icon: emoji,
        body: (
          <>
            {who} unlocked <Link href="/achievements" className="font-semibold text-term-amber hover:underline">{label}</Link>
          </>
        ),
      };
    }
    case "join":
      return { icon: "\uD83D\uDC4B", body: <>{who} joined PaperHood</> };
    case "quest_streak": {
      const days = Number(ev.data?.days ?? 0);
      return {
        icon: "\uD83D\uDD25",
        body: (
          <>
            {who} hit a <span className="num font-semibold text-term-amber">{days}-day</span> quest streak
          </>
        ),
      };
    }
    default:
      return null;
  }
}

export function ActivityFeed({ limit = 30 }: { limit?: number }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seen = useRef<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    const load = () =>
      engagementApi
        .activity()
        .then((r) => {
          if (!alive) return;
          const evs = r.events.slice(0, limit);
          const newIds = new Set<number>();
          for (const e of evs) if (!seen.current.has(e.id)) newIds.add(e.id);
          const first = seen.current.size === 0;
          for (const e of evs) seen.current.add(e.id);
          setEvents(evs);
          setLoaded(true);
          if (!first && newIds.size) {
            setFresh(newIds);
            setTimeout(() => alive && setFresh(new Set()), 1500);
          }
        })
        .catch(() => setLoaded(true));
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [limit]);

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Live activity</h2>
      <div className="panel max-h-80 overflow-y-auto">
        {!loaded && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-3.5 w-full" />
            ))}
          </div>
        )}
        {loaded && !events.length && (
          <div className="px-3 py-6 text-center text-xs text-term-dim">Quiet in here. Make a trade to get things moving.</div>
        )}
        <ul className="divide-y divide-term-line">
          {events.map((ev) => {
            const line = eventLine(ev);
            if (!line) return null;
            return (
              <li
                key={ev.id}
                className={`flex items-start gap-2 px-3 py-2 text-[13px] leading-snug motion-safe:transition-colors motion-safe:duration-700 ${
                  fresh.has(ev.id) ? "bg-term-accent/5 motion-safe:animate-feed-in" : ""
                }`}
              >
                <span className="mt-px shrink-0 text-sm" aria-hidden>
                  {line.icon}
                </span>
                <span className="min-w-0 flex-1 break-words text-term-dim">{line.body}</span>
                <span className="num shrink-0 text-[11px] text-term-faint" title={new Date(ev.ts * 1000).toLocaleString()}>
                  {relTime(ev.ts)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
