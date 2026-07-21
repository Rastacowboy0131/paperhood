"use client";

import { useEffect, useState } from "react";
import { api, PrizePool, fmtUsd } from "@/lib/api";

// Live countdown string like "2d 4h 12m" or "3h 07m".
function countdown(endsAtS: number, nowMs: number): string {
  let s = Math.max(0, endsAtS - Math.floor(nowMs / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

// Prize pool banner. Fee-funded pools, display only.
// window controls which pool is featured: 1d = daily, 7d = weekly, all = both small.
export default function PrizePoolBanner({ window: win }: { window: "1d" | "7d" | "all" }) {
  const [pool, setPool] = useState<PrizePool | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .prizePool()
        .then((p) => {
          if (alive) setPool(p);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 45000);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(tick);
    };
  }, []);

  if (!pool) return null;

  if (win === "all") {
    return (
      <div className="panel mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-xs text-term-dim">
        <span>
          Daily prize pool{" "}
          <span className="num font-bold text-term-accent">${fmtUsd(pool.dailyUsd, 2)}</span>
        </span>
        <span>
          Weekly pool{" "}
          <span className="num font-bold text-term-accent">${fmtUsd(pool.weeklyUsd, 2)}</span>{" "}
          (top 3 split)
        </span>
        <span className="ml-auto">funded by trading fees</span>
      </div>
    );
  }

  const daily = win === "1d";
  const amount = daily ? pool.dailyUsd : pool.weeklyUsd;
  const endsAt = daily ? pool.dayEndsAt : pool.weekEndsAt;

  return (
    <div className="panel mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
      <span className="text-[11px] uppercase tracking-wider text-term-dim">
        {daily ? "Daily prize pool" : "Weekly prize pool"}
      </span>
      <span className="num text-xl font-bold text-term-accent">${fmtUsd(amount, 2)}</span>
      {!daily && <span className="text-xs text-term-dim">top 3 split</span>}
      <span className="num ml-auto text-xs text-term-dim">
        {daily ? "resets 00:00 UTC" : "week ends"} · {countdown(endsAt, now)} left
      </span>
    </div>
  );
}
