"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, LeaderboardEntry, SeasonInfo, SeasonsResponse, FeeTotals, ReferralSummaryRow, fmtUsd, fmtCompact } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import PrizePoolBanner from "@/components/PrizePoolBanner";
import { BadgeEmojis } from "@/components/Badges";
import { ReferralFlair } from "@/components/ReferralFlair";

type Period = "1d" | "7d" | "all" | "season";

const TABS: { key: Period; label: string; desc: string }[] = [
  { key: "1d", label: "Daily", desc: "equity change since 00:00 UTC today" },
  { key: "7d", label: "Weekly", desc: "equity change since Monday 00:00 UTC" },
  { key: "season", label: "Season", desc: "equity change vs fresh $10k at season start" },
  { key: "all", label: "All time", desc: "cumulative equity PnL across all seasons" },
];

function seasonRange(s: SeasonInfo): string {
  const f = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${f(s.startTs)} to ${f(s.endTs - 1)} UTC`;
}

export default function LeaderboardPage() {
  const { address } = useAuth();
  const [period, setPeriod] = useState<Period>("1d");
  const [metric, setMetric] = useState<"equity" | "realized">("equity");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [realized, setRealized] = useState<LeaderboardEntry[]>([]);
  const [referrers, setReferrers] = useState<ReferralSummaryRow[]>([]);
  const [fees, setFees] = useState<FeeTotals | null>(null);
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [seasons, setSeasons] = useState<SeasonsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.seasons().then(setSeasons).catch(() => {});
    api.fees().then(setFees).catch(() => {});
    api.referralsSummary().then((r) => setReferrers(r.referrers.slice(0, 10))).catch(() => {});
  }, []);

  useEffect(() => {
    const load = () => {
      if (period === "season") {
        return api
          .leaderboardSeason("current", metric)
          .then((r) => {
            setEntries(r.entries);
            setSeason(r.season);
          });
      }
      return api.leaderboardWindow(period, metric).then((r) => setEntries(r.entries));
    };
    const loadRealized = () => {
      if (period === "season") {
        return api.leaderboardSeason("current", "realized").then((r) => setRealized(r.entries.slice(0, 10)));
      }
      return api.leaderboardWindow(period, "realized").then((r) => setRealized(r.entries.slice(0, 10)));
    };
    load().catch((e) => setErr(e.message));
    loadRealized().catch(() => {});
    const id = setInterval(() => {
      load().catch(() => {});
      loadRealized().catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, [period, metric]);

  const me = address?.toLowerCase();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-base font-bold">Leaderboard</h1>
        <span className="text-[11px] uppercase tracking-wider text-term-dim">
          {TABS.find((t) => t.key === period)?.desc}
        </span>
        <div className="tab-track ml-auto">
          {(
            [
              { key: "equity", label: "Equity" },
              { key: "realized", label: "Realized" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`tab ${metric === m.key ? "tab-active" : ""}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="tab-track">
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
      {period === "season" && season && (
        <div className="panel mb-3 flex items-center gap-2 px-3 py-2 text-xs">
          <span className="font-semibold">Season {season.num}</span>
          <span className="text-term-dim">{seasonRange(season)}</span>
          <span className="ml-auto text-term-dim">fresh $10k each season</span>
        </div>
      )}
      {period !== "season" && <PrizePoolBanner window={period as "1d" | "7d" | "all"} />}
      {err && <div className="mb-3 text-sm text-term-red">{err}</div>}
      <div className="panel overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-12 z-10 bg-term-panel">
            <tr>
              <th className="th text-left">Rank</th>
              <th className="th text-left">Trader</th>
              <th className="th text-right">PnL $</th>
              <th className="th text-right">PnL %</th>
              <th className="th text-right">Trades</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const pnl = e.pnlUsd ?? e.realizedPnlUsd;
              const isMe = me && e.address.toLowerCase() === me;
              const rowFlair =
                i === 0 ? "row-gold" : i === 1 ? "row-silver" : i === 2 ? "row-bronze" : "";
              return (
                <tr
                  key={e.userId}
                  className={`border-t border-term-line transition-colors hover:bg-term-hover ${rowFlair} ${isMe ? "bg-term-accent/10" : ""}`}
                >
                  <td className="num px-3 py-2.5">
                    {i + 1}
                    {i === 0 ? " 🥇" : i === 1 ? " 🥈" : i === 2 ? " 🥉" : ""}
                  </td>
                  <td className="num px-3 py-2.5">
                    {e.display}
                    <BadgeEmojis keys={e.badges} max={3} />
                    {isMe && <span className="ml-2 rounded-full bg-term-accent px-2 text-xs font-medium text-white">you</span>}
                  </td>
                  <td className={`num px-3 py-2.5 text-right ${pnl >= 0 ? "text-term-green" : "text-term-red"}`}>
                    {pnl >= 0 ? "+" : "-"}${fmtUsd(Math.abs(pnl), 2)}
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
                  <div className="mt-1 text-xs">No activity in this window yet.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Fee stats + side-by-side mini leaderboards */}
      <section className="mt-6">
        <div className="panel mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wider text-term-dim">Supply collected in fees</span>
            <span className="num text-sm font-semibold">{fees ? fmtCompact(fees.supplyCollected) : "..."}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wider text-term-dim">ETH collected in fees</span>
            <span className="num text-sm font-semibold">{fees ? fees.ethCollected.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "..."}</span>
          </div>
          <span className="ml-auto text-[10px] text-term-dim">updated manually</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="panel px-3 py-2.5">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">
              Realized PnL from trades
            </h2>
            <div className="space-y-1">
              {realized.map((e, i) => {
                const pnl = e.pnlUsd ?? e.realizedPnlUsd;
                return (
                  <div key={e.userId} className="flex items-center gap-2 text-[13px]">
                    <span className="num w-5 text-term-dim">{i + 1}</span>
                    <Link href={`/u/${e.address}`} className="num hover:text-term-accent hover:underline" title="View trader profile">
                      {e.display}
                    </Link>
                    <ReferralFlair flair={e.referralFlair} />
                    <span className={`num ml-auto ${pnl >= 0 ? "text-term-green" : "text-term-red"}`}>
                      {pnl >= 0 ? "+" : "-"}${fmtUsd(Math.abs(pnl), 2)}
                    </span>
                  </div>
                );
              })}
              {!realized.length && (
                <div className="py-6 text-center text-xs text-term-dim">No realized trades in this window yet.</div>
              )}
            </div>
          </div>
          <div className="panel px-3 py-2.5">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">
              Referral leaderboard
            </h2>
            <div className="space-y-1">
              {referrers.map((r, i) => (
                <div key={r.userId} className="flex items-center gap-2 text-[13px]">
                  <span className="num w-5 text-term-dim">{i + 1}</span>
                  <Link
                    href={`/u/${r.address}`}
                    className="num hover:text-term-accent hover:underline"
                    title="View trader profile"
                  >
                    {r.address.slice(0, 6)}...{r.address.slice(-4)}
                  </Link>
                  {r.tierName && (
                    <span className="rounded-full border border-term-line px-2 text-[10px] text-term-dim">{r.tierName}</span>
                  )}
                  <ReferralFlair flair={r.tier != null && r.tier >= 3 ? "gold" : r.tier != null && r.tier >= 2 ? "silver" : null} />
                  <span className="num ml-auto text-term-dim">
                    {r.qualified} qualified
                  </span>
                </div>
              ))}
              {!referrers.length && (
                <div className="py-6 text-center text-xs text-term-dim">
                  No referrers yet. Share your link on the <Link href="/referrals" className="text-term-accent hover:underline">Referrals</Link> page.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {seasons && seasons.archive.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Past seasons</h2>
          <div className="space-y-3">
            {seasons.archive.map((a) => (
              <div key={a.season.id} className="panel px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">Season {a.season.num}</span>
                  <span className="text-term-dim">{seasonRange(a.season)}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {a.winners.map((w, i) => {
                    const wp = w.pnlUsd ?? w.realizedPnlUsd;
                    return (
                    <div key={w.userId} className="flex items-center gap-2 text-[13px]">
                      <span>{i === 0 ? "\ud83e\udd47" : i === 1 ? "\ud83e\udd48" : "\ud83e\udd49"}</span>
                      <span className="num">{w.display}</span>
                      <BadgeEmojis keys={w.badges} max={3} />
                      <span className={`num ml-auto ${wp >= 0 ? "text-term-green" : "text-term-red"}`}>
                        {wp >= 0 ? "+" : "-"}${fmtUsd(Math.abs(wp), 2)}
                      </span>
                      <span className={`num w-20 text-right text-xs ${w.pnlPct >= 0 ? "text-term-green" : "text-term-red"}`}>
                        {w.pnlPct >= 0 ? "+" : ""}
                        {w.pnlPct.toFixed(2)}%
                      </span>
                    </div>
                    );
                  })}
                  {!a.winners.length && <div className="text-xs text-term-dim">No activity that season.</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
