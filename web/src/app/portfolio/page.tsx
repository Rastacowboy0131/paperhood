"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, Portfolio, fmtUsd, fmtCompact, truncAddr } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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

  const refresh = useCallback(() => {
    if (!address) return;
    api.portfolio().then(setPf).catch((e) => setErr(e.message));
  }, [address]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) return <div className="py-12 text-center text-term-dim">Loading...</div>;
  if (!address)
    return <div className="py-12 text-center text-term-dim">Connect your wallet to see your portfolio.</div>;
  if (err) return <div className="py-12 text-center text-term-red">{err}</div>;
  if (!pf) return <div className="py-12 text-center text-term-dim">Loading portfolio...</div>;

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
        <h2 className="mb-2 text-sm font-semibold text-term-dim">OPEN POSITIONS (marked to exit)</h2>
        <div className="overflow-x-auto rounded border border-term-border">
          <table className="w-full text-sm">
            <thead className="bg-term-panel text-term-dim">
              <tr>
                <th className="px-3 py-2 text-left">Token</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Cost basis</th>
                <th className="px-3 py-2 text-right">Mark</th>
                <th className="px-3 py-2 text-right">Unrealized</th>
              </tr>
            </thead>
            <tbody>
              {pf.positions.map((p) => (
                <tr key={p.token} className="border-t border-term-border hover:bg-term-panel">
                  <td className="px-3 py-2">
                    <Link href={`/t/${p.token}`} className="font-semibold text-term-accent hover:underline">
                      {p.symbol}
                    </Link>
                  </td>
                  <td className="num px-3 py-2 text-right">{fmtCompact(p.qtyDec)}</td>
                  <td className="num px-3 py-2 text-right">${fmtUsd(p.costBasisUsd, 2)}</td>
                  <td className="num px-3 py-2 text-right">${fmtUsd(p.markUsd, 2)}</td>
                  <td className={`num px-3 py-2 text-right ${pnlClass(p.unrealizedPnlUsd)}`}>
                    {sign(p.unrealizedPnlUsd)}${fmtUsd(p.unrealizedPnlUsd, 2)}
                  </td>
                </tr>
              ))}
              {!pf.positions.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-term-dim">
                    No open positions. <Link href="/" className="text-term-accent underline">Find a token</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-term-dim">TRADE HISTORY (this season)</h2>
        <div className="overflow-x-auto rounded border border-term-border">
          <table className="w-full text-sm">
            <thead className="bg-term-panel text-term-dim">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Side</th>
                <th className="px-3 py-2 text-left">Token</th>
                <th className="px-3 py-2 text-right">USD</th>
                <th className="px-3 py-2 text-right">Fee</th>
                <th className="px-3 py-2 text-right">Impact</th>
                <th className="px-3 py-2 text-right">Realized</th>
              </tr>
            </thead>
            <tbody>
              {pf.history.map((t) => (
                <tr key={t.id} className="border-t border-term-border">
                  <td className="num px-3 py-2 text-xs text-term-dim">
                    {new Date(t.ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className={`px-3 py-2 font-semibold ${t.side === "buy" ? "text-term-green" : "text-term-red"}`}>
                    {t.side.toUpperCase()}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/t/${t.token}`} className="text-term-accent hover:underline" title={t.name}>
                      {t.symbol || truncAddr(t.token)}
                    </Link>
                  </td>
                  <td className="num px-3 py-2 text-right">
                    ${fmtUsd(Number(t.side === "buy" ? t.amountIn : t.amountOut), 2)}
                  </td>
                  <td className="num px-3 py-2 text-right text-term-dim">${fmtUsd(t.feeUsd, 4)}</td>
                  <td className="num px-3 py-2 text-right text-term-dim">
                    {t.priceImpactPct != null ? `${t.priceImpactPct.toFixed(2)}%` : "-"}
                  </td>
                  <td className={`num px-3 py-2 text-right ${t.realizedPnlUsd != null ? pnlClass(t.realizedPnlUsd) : "text-term-dim"}`}>
                    {t.realizedPnlUsd != null ? `${sign(t.realizedPnlUsd)}$${fmtUsd(t.realizedPnlUsd, 2)}` : "-"}
                  </td>
                </tr>
              ))}
              {!pf.history.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-term-dim">
                    No trades yet this season.
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
    <div className="rounded border border-term-border bg-term-panel p-3">
      <div className="text-xs text-term-dim">{label}</div>
      <div className={`num text-lg font-semibold ${cls || ""}`}>{value}</div>
      {sub && <div className="num text-xs text-term-dim">{sub}</div>}
    </div>
  );
}
