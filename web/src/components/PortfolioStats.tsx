"use client";

// Portfolio stats: allocation donut (positions + cash by USD value), max
// drawdown from the equity snapshot history, and win rate / avg win / avg
// loss from closed trades. Pure inline SVG, no chart deps.
import { useMemo, useState } from "react";
import { ClosedTrade, EquityPoint, Portfolio, fmtUsd } from "@/lib/api";

const COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444",
  "#14b8a6", "#eab308", "#ec4899", "#8b5cf6", "#f97316",
];
const CASH_COLOR = "#64748b";

interface Slice {
  label: string;
  value: number;
  color: string;
}

function buildSlices(pf: Portfolio): Slice[] {
  const pos = [...pf.positions]
    .filter((p) => p.markUsd > 0)
    .sort((a, b) => b.markUsd - a.markUsd);
  const slices: Slice[] = [];
  const MAX = 8;
  pos.slice(0, MAX).forEach((p, i) => slices.push({ label: p.symbol, value: p.markUsd, color: COLORS[i % COLORS.length] }));
  const rest = pos.slice(MAX).reduce((s, p) => s + p.markUsd, 0);
  if (rest > 0) slices.push({ label: "Other", value: rest, color: "#94a3b8" });
  if (pf.cashUsd > 0) slices.push({ label: "Cash", value: pf.cashUsd, color: CASH_COLOR });
  return slices;
}

// Max drawdown over the equity curve: largest peak-to-trough drop, in %.
export function maxDrawdownPct(points: EquityPoint[]): number | null {
  if (points.length < 2) return null;
  let peak = points[0].equityUsd;
  let maxDd = 0;
  for (const p of points) {
    if (p.equityUsd > peak) peak = p.equityUsd;
    else if (peak > 0) maxDd = Math.max(maxDd, (peak - p.equityUsd) / peak);
  }
  return maxDd * 100;
}

interface TradeStats {
  winRate: number;
  wins: number;
  losses: number;
  avgWin: number;
  avgLoss: number;
}

function tradeStats(closed: ClosedTrade[]): TradeStats | null {
  const done = closed.filter((t) => t.realizedPnlUsd != null);
  if (!done.length) return null;
  const wins = done.filter((t) => (t.realizedPnlUsd ?? 0) > 0);
  const losses = done.filter((t) => (t.realizedPnlUsd ?? 0) < 0);
  return {
    winRate: (wins.length / done.length) * 100,
    wins: wins.length,
    losses: losses.length,
    avgWin: wins.length ? wins.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0) / losses.length : 0,
  };
}

function Donut({ slices }: { slices: Slice[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label="Allocation donut chart">
        {slices.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * C;
          const el = (
            <circle
              key={i}
              cx="50" cy="50" r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === i ? 15 : 12}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              className="transition-all"
              opacity={hover == null || hover === i ? 1 : 0.35}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="min-w-0 space-y-1 text-xs">
        {slices.map((s, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 transition-opacity ${hover != null && hover !== i ? "opacity-40" : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="truncate font-medium">{s.label}</span>
            <span className="num ml-auto pl-2 text-term-dim">
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PortfolioStats({ pf, equity, closed }: { pf: Portfolio; equity: EquityPoint[]; closed: ClosedTrade[] }) {
  const slices = useMemo(() => buildSlices(pf), [pf]);
  const dd = useMemo(() => maxDrawdownPct(equity), [equity]);
  const ts = useMemo(() => tradeStats(closed), [closed]);

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Stats</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-term-dim">Allocation</div>
          {slices.length ? (
            <Donut slices={slices} />
          ) : (
            <div className="py-6 text-center text-xs text-term-dim">Nothing to allocate yet.</div>
          )}
        </div>
        <div className="grid grid-cols-2 content-start gap-3">
          <StatBox label="Max drawdown" value={dd != null ? `-${dd.toFixed(2)}%` : "-"} cls={dd != null && dd > 0 ? "text-term-red" : ""} />
          <StatBox
            label="Win rate"
            value={ts ? `${ts.winRate.toFixed(0)}%` : "-"}
            sub={ts ? `${ts.wins}W / ${ts.losses}L` : "no closed trades"}
          />
          <StatBox label="Avg win" value={ts && ts.wins ? `+$${fmtUsd(ts.avgWin, 2)}` : "-"} cls="text-term-green" />
          <StatBox label="Avg loss" value={ts && ts.losses ? `-$${fmtUsd(Math.abs(ts.avgLoss), 2)}` : "-"} cls="text-term-red" />
        </div>
      </div>
    </section>
  );
}

function StatBox({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-term-dim">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${cls || ""}`}>{value}</div>
      {sub && <div className="num text-xs text-term-dim">{sub}</div>}
    </div>
  );
}
