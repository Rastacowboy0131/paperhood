"use client";

import { useEffect, useState } from "react";
import { api, LeaderboardEntry, fmtUsd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import PrizePoolBanner from "@/components/PrizePoolBanner";

type Period = "1d" | "7d" | "all";

const TABS: { key: Period; label: string }[] = [
  { key: "1d", label: "Daily" },
  { key: "7d", label: "Weekly" },
  { key: "all", label: "All time" },
];

export default function LeaderboardPage() {
  const { address } = useAuth();
  const [period, setPeriod] = useState<Period>("1d");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .leaderboardWindow(period)
      .then((r) => setEntries(r.entries))
      .catch((e) => setErr(e.message));
    const id = setInterval(() => {
      api.leaderboardWindow(period).then((r) => setEntries(r.entries)).catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, [period]);

  const me = address?.toLowerCase();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-base font-bold">Leaderboard</h1>
        <span className="text-[11px] uppercase tracking-wider text-term-dim">realized PnL only</span>
        <div className="tab-track ml-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setPeriod(t.key)}
              className={`tab ${period === t.key ? "tab-active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <PrizePoolBanner window={period} />
      {err && <div className="mb-3 text-sm text-term-red">{err}</div>}
      <div className="panel overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-12 z-10 bg-term-panel">
            <tr>
              <th className="th text-left">Rank</th>
              <th className="th text-left">Trader</th>
              <th className="th text-right">Realized PnL</th>
              <th className="th text-right">PnL %</th>
              <th className="th text-right">Trades</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const isMe = me && e.address.toLowerCase() === me;
              return (
                <tr
                  key={e.userId}
                  className={`border-t border-gray-100 transition-colors hover:bg-gray-50 ${isMe ? "bg-term-accent/10" : ""}`}
                >
                  <td className="num px-3 py-2.5">
                    {i + 1}
                    {i === 0 ? " 🥇" : i === 1 ? " 🥈" : i === 2 ? " 🥉" : ""}
                  </td>
                  <td className="num px-3 py-2.5">
                    {e.display}
                    {isMe && <span className="ml-2 rounded-full bg-term-accent px-2 text-xs font-medium text-white">you</span>}
                  </td>
                  <td className={`num px-3 py-2.5 text-right ${e.realizedPnlUsd >= 0 ? "text-term-green" : "text-term-red"}`}>
                    {e.realizedPnlUsd >= 0 ? "+" : ""}${fmtUsd(e.realizedPnlUsd, 2)}
                  </td>
                  <td className={`num px-3 py-2.5 text-right ${e.pnlPct >= 0 ? "text-term-green" : "text-term-red"}`}>
                    {e.pnlPct >= 0 ? "+" : ""}
                    {e.pnlPct.toFixed(2)}%
                  </td>
                  <td className="num px-3 py-2.5 text-right">{e.trades}</td>
                </tr>
              );
            })}
            {!entries.length && !err && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-term-dim">
                  <div className="text-lg">🏆</div>
                  <div className="mt-1 text-xs">No closed trades in this window yet.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
