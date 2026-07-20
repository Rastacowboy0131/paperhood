"use client";

import { useEffect, useState } from "react";
import { api, LeaderboardEntry, fmtUsd } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Period = "daily" | "weekly";

export default function LeaderboardPage() {
  const { address } = useAuth();
  const [period, setPeriod] = useState<Period>("daily");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .leaderboard(period)
      .then((r) => setEntries(r.entries))
      .catch((e) => setErr(e.message));
    const id = setInterval(() => {
      api.leaderboard(period).then((r) => setEntries(r.entries)).catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, [period]);

  const me = address?.toLowerCase();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-lg font-bold">Leaderboard</h1>
        <span className="text-xs text-term-dim">realized PnL only</span>
        <div className="ml-auto flex gap-1">
          {(["daily", "weekly"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-sm ${period === p ? "bg-term-accent text-black" : "border border-term-border text-term-dim hover:text-term-text"}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="mb-3 text-sm text-term-red">{err}</div>}
      <div className="overflow-x-auto rounded border border-term-border">
        <table className="w-full text-sm">
          <thead className="bg-term-panel text-term-dim">
            <tr>
              <th className="px-3 py-2 text-left">Rank</th>
              <th className="px-3 py-2 text-left">Trader</th>
              <th className="px-3 py-2 text-right">Realized PnL</th>
              <th className="px-3 py-2 text-right">PnL %</th>
              <th className="px-3 py-2 text-right">Trades</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const isMe = me && e.address.toLowerCase() === me;
              return (
                <tr
                  key={e.userId}
                  className={`border-t border-term-border ${isMe ? "bg-term-accent/10" : ""}`}
                >
                  <td className="num px-3 py-2">
                    {i + 1}
                    {i === 0 ? " 🥇" : i === 1 ? " 🥈" : i === 2 ? " 🥉" : ""}
                  </td>
                  <td className="num px-3 py-2">
                    {e.display}
                    {isMe && <span className="ml-2 rounded bg-term-accent px-1.5 text-xs text-black">you</span>}
                  </td>
                  <td className={`num px-3 py-2 text-right ${e.realizedPnlUsd >= 0 ? "text-term-green" : "text-term-red"}`}>
                    {e.realizedPnlUsd >= 0 ? "+" : ""}${fmtUsd(e.realizedPnlUsd, 2)}
                  </td>
                  <td className={`num px-3 py-2 text-right ${e.pnlPct >= 0 ? "text-term-green" : "text-term-red"}`}>
                    {e.pnlPct >= 0 ? "+" : ""}
                    {e.pnlPct.toFixed(2)}%
                  </td>
                  <td className="num px-3 py-2 text-right">{e.trades}</td>
                </tr>
              );
            })}
            {!entries.length && !err && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-term-dim">
                  No closed trades this {period === "daily" ? "day" : "week"} yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
