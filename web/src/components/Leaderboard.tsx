"use client";

import { useEffect, useState } from "react";
import { api, LeaderboardEntry, fmtUsd } from "@/lib/api";
import PrizePoolBanner from "@/components/PrizePoolBanner";

type Window = "1d" | "7d" | "all";

const TABS: { key: Window; label: string }[] = [
  { key: "1d", label: "Daily" },
  { key: "7d", label: "Weekly" },
  { key: "all", label: "All time" },
];

const LS_KEY = "leaderboard-window";

function pnlColor(v: number) {
  return v >= 0 ? "text-term-green" : "text-term-red";
}

function pnlStr(v: number) {
  return `${v >= 0 ? "+" : "-"}$${fmtUsd(Math.abs(v), 2)}`;
}

// Podium card. Order rendered: 2nd, 1st (elevated), 3rd.
function PodiumCard({ entry, rank }: { entry?: LeaderboardEntry; rank: 1 | 2 | 3 }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
  const accent =
    rank === 1
      ? "border-yellow-500/60"
      : rank === 2
        ? "border-gray-400/50"
        : "border-amber-700/60";
  const elevate = rank === 1 ? "sm:-translate-y-3 sm:scale-105" : "";
  return (
    <div
      className={`flex flex-1 flex-col items-center rounded-md border ${accent} bg-term-panel px-4 py-4 transition-transform ${elevate}`}
    >
      <div className="text-2xl">{medal}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-term-dim">#{rank}</div>
      {entry ? (
        <>
          <div className="num mt-2 text-sm">{entry.display}</div>
          <div className={`num mt-1 text-lg font-bold ${pnlColor(entry.realizedPnlUsd)}`}>
            {pnlStr(entry.realizedPnlUsd)}
          </div>
          <div className={`num text-xs ${pnlColor(entry.pnlPct)}`}>
            {entry.pnlPct >= 0 ? "+" : ""}
            {entry.pnlPct.toFixed(2)}% · {entry.trades} trades
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-term-dim">unclaimed</div>
      )}
    </div>
  );
}

export default function Leaderboard() {
  const [win, setWin] = useState<Window>("1d");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY) as Window | null;
    if (saved === "1d" || saved === "7d" || saved === "all") setWin(saved);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    const load = () =>
      api
        .leaderboardWindow(win)
        .then((r) => {
          if (alive) setEntries(r.entries);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 45000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [win, loaded]);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 10);

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold">Leaderboard</h2>
        <span className="text-[11px] uppercase tracking-wider text-term-dim">realized PnL</span>
        <div className="ml-auto flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setWin(t.key);
                localStorage.setItem(LS_KEY, t.key);
              }}
              className={`tab ${win === t.key ? "tab-active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <PrizePoolBanner window={win} />

      {entries.length ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:pt-3">
            <PodiumCard entry={top3[1]} rank={2} />
            <PodiumCard entry={top3[0]} rank={1} />
            <PodiumCard entry={top3[2]} rank={3} />
          </div>
          {rest.length > 0 && (
            <div className="panel mt-3 overflow-hidden">
              {rest.map((e, i) => (
                <div
                  key={e.userId}
                  className="flex items-center gap-3 border-t border-term-border/60 px-3 py-1.5 text-[13px] transition-colors first:border-t-0 hover:bg-term-hover"
                >
                  <span className="num w-6 text-term-dim">{i + 4}</span>
                  <span className="num">{e.display}</span>
                  <span className={`num ml-auto ${pnlColor(e.realizedPnlUsd)}`}>
                    {pnlStr(e.realizedPnlUsd)}
                  </span>
                  <span className={`num w-20 text-right text-xs ${pnlColor(e.pnlPct)}`}>
                    {e.pnlPct >= 0 ? "+" : ""}
                    {e.pnlPct.toFixed(2)}%
                  </span>
                  <span className="num w-16 text-right text-xs text-term-dim">{e.trades} tr</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="panel px-3 py-8 text-center text-term-dim">
          <div className="text-lg">🏆</div>
          <div className="mt-1 text-xs">No closed trades in this window yet. Be the first on the podium.</div>
        </div>
      )}
    </div>
  );
}
