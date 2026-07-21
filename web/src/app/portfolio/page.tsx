"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ClosedTrade, EquityPoint, Portfolio, UserBadge, fmtUsd, fmtCompact, truncAddr } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EquityChart } from "@/components/EquityChart";
import { BadgeGrid } from "@/components/Badges";
import { ShareButton } from "@/components/ShareCard";

function pnlClass(n: number) {
  return n >= 0 ? "text-term-green" : "text-term-red";
}

function sign(n: number) {
  return n >= 0 ? "+" : "";
}

export default function PortfolioPage() {
  const { address, loading } = useAuth();
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [closed, setClosed] = useState<{ trades: ClosedTrade[]; total: number } | null>(null);
  const [closedPage, setClosedPage] = useState(1);
  const CLOSED_PAGE_SIZE = 20;

  const refresh = useCallback(() => {
    if (!address) return;
    api.portfolio().then(setPf).catch((e) => setErr(e.message));
    api.equityCurve().then((r) => setEquity(r.points)).catch(() => {});
    api.myBadges().then((r) => setBadges(r.badges)).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!address) return;
    api.closedTrades(closedPage, CLOSED_PAGE_SIZE)
      .then((r) => setClosed({ trades: r.trades, total: r.total }))
      .catch(() => {});
  }, [address, closedPage]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading)
    return (
      <div className="space-y-3 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel p-3">
              <div className="skeleton h-3 w-14" />
              <div className="skeleton mt-2 h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  if (!address)
    return (
      <div className="py-16 text-center text-term-dim">
        <div className="text-2xl">🔌</div>
        <div className="mt-2 text-sm">Connect your wallet to see your portfolio.</div>
      </div>
    );
  if (err) return <div className="py-12 text-center text-term-red">{err}</div>;
  if (!pf)
    return (
      <div className="space-y-3 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel p-3">
              <div className="skeleton h-3 w-14" />
              <div className="skeleton mt-2 h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Equity" value={`$${fmtUsd(pf.equityUsd, 2)}`} sub={`${pf.equityEth.toFixed(4)} ETH`} />
        <Stat label="Cash" value={`$${fmtUsd(pf.cashUsd, 2)}`} sub={`${pf.cashEth.toFixed(4)} ETH`} />
        <Stat
          label="Realized PnL (season)"
          value={`${sign(pf.realizedPnlUsd)}$${fmtUsd(pf.realizedPnlUsd, 2)}`}
          cls={pnlClass(pf.realizedPnlUsd)}
        />
        <Stat
          label="Unrealized PnL"
          value={`${sign(pf.unrealizedPnlUsd)}$${fmtUsd(pf.unrealizedPnlUsd, 2)}`}
          cls={pnlClass(pf.unrealizedPnlUsd)}
        />
        <Stat label="Positions" value={String(pf.positions.length)} />
        <Stat label="Account" value={truncAddr(pf.user.address)} />
      </div>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Equity curve (this season)</h2>
        <div className="panel p-2">
          {equity.length > 1 ? (
            <EquityChart points={equity} />
          ) : (
            <div className="py-10 text-center text-xs text-term-dim">Not enough data yet. The curve fills in as you trade.</div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Badges</h2>
        <BadgeGrid badges={badges} />
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Open positions (marked to exit)</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-term-panel">
              <tr>
                <th className="th text-left">Token</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Cost basis</th>
                <th className="th text-right">Mark</th>
                <th className="th text-right">Unrealized</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody>
              {pf.positions.map((p) => (
                <tr key={p.token} className="border-t border-term-line transition-colors hover:bg-term-hover">
                  <td className="px-3 py-2.5">
                    <Link href={`/t/${p.token}`} className="font-semibold text-term-accent hover:underline">
                      {p.symbol}
                    </Link>
                  </td>
                  <td className="num px-3 py-2.5 text-right">{fmtCompact(p.qtyDec)}</td>
                  <td className="num px-3 py-2.5 text-right">${fmtUsd(p.costBasisUsd, 2)}</td>
                  <td className="num px-3 py-2.5 text-right">${fmtUsd(p.markUsd, 2)}</td>
                  <td className={`num px-3 py-2.5 text-right ${pnlClass(p.unrealizedPnlUsd)}`}>
                    {sign(p.unrealizedPnlUsd)}${fmtUsd(p.unrealizedPnlUsd, 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ShareButton
                      data={{
                        symbol: p.symbol,
                        side: "long",
                        entryPriceUsd: p.qtyDec > 0 ? p.costBasisUsd / p.qtyDec : null,
                        exitPriceUsd: p.qtyDec > 0 ? p.markUsd / p.qtyDec : null,
                        pnlPct: p.costBasisUsd > 0 ? (p.unrealizedPnlUsd / p.costBasisUsd) * 100 : null,
                        pnlUsd: p.unrealizedPnlUsd,
                        username: truncAddr(pf.user.address),
                      }}
                    />
                  </td>
                </tr>
              ))}
              {!pf.positions.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-term-dim">
                    <div className="text-lg">◎</div>
                    <div className="mt-1 text-xs">No open positions. <Link href="/" className="text-term-accent underline">Find a token</Link></div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Closed trades (all seasons)</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-term-panel">
              <tr>
                <th className="th text-left">Date</th>
                <th className="th text-left">Token</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Entry</th>
                <th className="th text-right">Exit</th>
                <th className="th text-right">PnL</th>
                <th className="th text-right">PnL %</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody>
              {closed?.trades.map((t) => (
                <tr key={t.id} className="border-t border-term-line transition-colors hover:bg-term-hover">
                  <td className="num px-3 py-2.5 text-xs text-term-dim">
                    {new Date(t.ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/t/${t.token}`} className="font-semibold text-term-accent hover:underline">
                      {t.symbol || truncAddr(t.token)}
                    </Link>
                  </td>
                  <td className="num px-3 py-2.5 text-right">{fmtCompact(t.qtyDec)}</td>
                  <td className="num px-3 py-2.5 text-right">{t.entryPriceUsd != null ? `$${fmtUsd(t.entryPriceUsd)}` : "-"}</td>
                  <td className="num px-3 py-2.5 text-right">${fmtUsd(t.exitPriceUsd)}</td>
                  <td className={`num px-3 py-2.5 text-right ${t.realizedPnlUsd != null ? pnlClass(t.realizedPnlUsd) : "text-term-dim"}`}>
                    {t.realizedPnlUsd != null ? `${sign(t.realizedPnlUsd)}$${fmtUsd(t.realizedPnlUsd, 2)}` : "-"}
                  </td>
                  <td className={`num px-3 py-2.5 text-right ${t.pnlPct != null ? pnlClass(t.pnlPct) : "text-term-dim"}`}>
                    {t.pnlPct != null ? `${sign(t.pnlPct)}${t.pnlPct.toFixed(2)}%` : "-"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ShareButton
                      data={{
                        symbol: t.symbol || truncAddr(t.token),
                        side: "closed",
                        entryPriceUsd: t.entryPriceUsd,
                        exitPriceUsd: t.exitPriceUsd,
                        pnlPct: t.pnlPct,
                        pnlUsd: t.realizedPnlUsd,
                        username: truncAddr(pf.user.address),
                      }}
                    />
                  </td>
                </tr>
              ))}
              {(!closed || !closed.trades.length) && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-term-dim">
                    <div className="text-lg">◎</div>
                    <div className="mt-1 text-xs">No closed trades yet.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {closed && closed.total > CLOSED_PAGE_SIZE && (
            <div className="flex items-center gap-2 border-t border-term-line px-3 py-2 text-xs">
              <button
                disabled={closedPage <= 1}
                onClick={() => setClosedPage((p) => p - 1)}
                className="rounded border border-term-border px-2 py-0.5 text-term-dim transition-colors enabled:hover:text-term-text disabled:opacity-40"
              >
                Prev
              </button>
              <span className="num text-term-dim">
                Page {closedPage} / {Math.max(1, Math.ceil(closed.total / CLOSED_PAGE_SIZE))}
              </span>
              <button
                disabled={closedPage >= Math.ceil(closed.total / CLOSED_PAGE_SIZE)}
                onClick={() => setClosedPage((p) => p + 1)}
                className="rounded border border-term-border px-2 py-0.5 text-term-dim transition-colors enabled:hover:text-term-text disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Trade history (this season)</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-term-panel">
              <tr>
                <th className="th text-left">Time</th>
                <th className="th text-left">Side</th>
                <th className="th text-left">Token</th>
                <th className="th text-right">USD</th>
                <th className="th text-right">Fee</th>
                <th className="th text-right">Impact</th>
                <th className="th text-right">Realized</th>
              </tr>
            </thead>
            <tbody>
              {pf.history.map((t) => (
                <tr key={t.id} className="border-t border-term-line transition-colors hover:bg-term-hover">
                  <td className="num px-3 py-2.5 text-xs text-term-dim">
                    {new Date(t.ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className={`px-3 py-2.5 text-xs font-semibold ${t.side === "buy" ? "text-term-green" : "text-term-red"}`}>
                    {t.side.toUpperCase()}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/t/${t.token}`} className="text-term-accent hover:underline" title={t.name}>
                      {t.symbol || truncAddr(t.token)}
                    </Link>
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    ${fmtUsd(Number(t.side === "buy" ? t.amountIn : t.amountOut), 2)}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-term-dim">${fmtUsd(t.feeUsd, 4)}</td>
                  <td className="num px-3 py-2.5 text-right text-term-dim">
                    {t.priceImpactPct != null ? `${t.priceImpactPct.toFixed(2)}%` : "-"}
                  </td>
                  <td className={`num px-3 py-2.5 text-right ${t.realizedPnlUsd != null ? pnlClass(t.realizedPnlUsd) : "text-term-dim"}`}>
                    {t.realizedPnlUsd != null ? `${sign(t.realizedPnlUsd)}$${fmtUsd(t.realizedPnlUsd, 2)}` : "-"}
                  </td>
                </tr>
              ))}
              {!pf.history.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-term-dim">
                    <div className="text-lg">◎</div>
                    <div className="mt-1 text-xs">No trades yet this season.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-term-dim">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${cls || ""}`}>{value}</div>
      {sub && <div className="num text-xs text-term-dim">{sub}</div>}
    </div>
  );
}
