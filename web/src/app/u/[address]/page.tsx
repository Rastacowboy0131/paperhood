"use client";

// Public trader profile: a read-only transparency view of another trader.
// Linked from leaderboard rows and podium cards. No copy execution.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, TraderProfile, fmtUsd, fmtCompact, truncAddr } from "@/lib/api";
import { EquityChart } from "@/components/EquityChart";
import { BadgeGrid } from "@/components/Badges";
import { TokenLogo } from "@/components/TokenLogo";

function pnlClass(n: number) {
  return n >= 0 ? "text-term-green" : "text-term-red";
}

function sign(n: number) {
  return n >= 0 ? "+" : "";
}

export default function TraderPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    api.trader(address).then((p) => { if (alive) setProfile(p); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [address]);

  if (err)
    return (
      <div className="py-16 text-center text-term-dim">
        <div className="text-2xl">◎</div>
        <div className="mt-2 text-sm">{err === "trader not found" ? "No trader found at this address." : err}</div>
        <Link href="/" className="mt-2 inline-block text-xs text-term-accent underline">Back to screener</Link>
      </div>
    );
  if (!profile)
    return (
      <div className="space-y-3 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="num text-lg font-bold">{profile.display}</h1>
        <span className="rounded border border-term-border px-1.5 py-0.5 text-[10px] uppercase text-term-faint" title="Read-only transparency view">
          trader profile
        </span>
        <span className="num ml-auto text-[11px] text-term-dim">
          joined {new Date(profile.joinedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Equity (season)" value={`$${fmtUsd(profile.equityUsd, 2)}`} />
        <Stat
          label="Realized PnL"
          value={`${sign(profile.realizedPnlUsd)}$${fmtUsd(profile.realizedPnlUsd, 2)}`}
          cls={pnlClass(profile.realizedPnlUsd)}
        />
        <Stat
          label="Unrealized PnL"
          value={`${sign(profile.unrealizedPnlUsd)}$${fmtUsd(profile.unrealizedPnlUsd, 2)}`}
          cls={pnlClass(profile.unrealizedPnlUsd)}
        />
        <Stat label="Open positions" value={String(profile.positions.length)} />
      </div>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Equity curve (this season)</h2>
        <div className="panel p-2">
          {profile.equityCurve.length > 1 ? (
            <EquityChart points={profile.equityCurve} />
          ) : (
            <div className="py-10 text-center text-xs text-term-dim">Not enough data yet.</div>
          )}
        </div>
      </section>

      {profile.badges.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Badges</h2>
          <BadgeGrid badges={profile.badges} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Open positions</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-term-panel">
              <tr>
                <th className="th text-left">Token</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Entry</th>
                <th className="th text-right">Size (USD)</th>
                <th className="th text-right">Unrealized</th>
              </tr>
            </thead>
            <tbody>
              {profile.positions.map((p) => (
                <tr key={p.token} className="border-t border-term-line transition-colors hover:bg-term-hover">
                  <td className="px-3 py-2.5">
                    <Link href={`/t/${p.token}`} className="flex items-center gap-2 font-semibold text-term-accent hover:underline">
                      <TokenLogo src={p.imageUrl} symbol={p.symbol} size={22} />
                      {p.symbol}
                    </Link>
                  </td>
                  <td className="num px-3 py-2.5 text-right">{fmtCompact(p.qtyDec)}</td>
                  <td className="num px-3 py-2.5 text-right">{p.entryPriceUsd != null ? `$${fmtUsd(p.entryPriceUsd)}` : "-"}</td>
                  <td className="num px-3 py-2.5 text-right">${fmtUsd(p.sizeUsd, 2)}</td>
                  <td className={`num px-3 py-2.5 text-right ${pnlClass(p.unrealizedPnlUsd)}`}>
                    {sign(p.unrealizedPnlUsd)}${fmtUsd(p.unrealizedPnlUsd, 2)}
                  </td>
                </tr>
              ))}
              {!profile.positions.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-term-dim">
                    <div className="text-lg">◎</div>
                    <div className="mt-1 text-xs">No open positions.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Recent closed trades</h2>
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
              </tr>
            </thead>
            <tbody>
              {profile.closedTrades.map((t) => (
                <tr key={t.id} className="border-t border-term-line transition-colors hover:bg-term-hover">
                  <td className="num px-3 py-2.5 text-xs text-term-dim">
                    {new Date(t.ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/t/${t.token}`} className="font-semibold text-term-accent hover:underline">
                      {t.symbol !== "?" ? t.symbol : truncAddr(t.token)}
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
                </tr>
              ))}
              {!profile.closedTrades.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-term-dim">
                    <div className="text-lg">◎</div>
                    <div className="mt-1 text-xs">No closed trades yet.</div>
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

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-term-dim">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${cls || ""}`}>{value}</div>
    </div>
  );
}
