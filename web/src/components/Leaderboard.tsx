"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, LeaderboardEntry, fmtUsd } from "@/lib/api";
import PrizePoolBanner from "@/components/PrizePoolBanner";
import { BadgeEmojis } from "@/components/Badges";
import { ReferralFlair } from "@/components/ReferralFlair";

type Window = "1d" | "7d" | "all";
type Metric = "equity" | "realized";

const TABS: { key: Window; label: string }[] = [
  { key: "1d", label: "Daily" },
  { key: "7d", label: "Weekly" },
  { key: "all", label: "All time" },
];

const LS_KEY = "leaderboard-window";
const LS_METRIC_KEY = "leaderboard-metric";

function pnlColor(v: number) {
  return v >= 0 ? "text-term-green" : "text-term-red";
}

function pnlStr(v: number) {
  return `${v >= 0 ? "+" : "-"}$${fmtUsd(Math.abs(v), 2)}`;
}

// Inline rank art: crown for #1, trophies for #2/#3. No external assets.
function RankArt({ rank }: { rank: 1 | 2 | 3 }) {
  if (rank === 1) {
    return (
      <svg viewBox="0 0 48 36" className="podium-crown h-9 w-12" aria-hidden="true">
        <path
          d="M6 28 L3 10 L14 18 L24 5 L34 18 L45 10 L42 28 Z"
          fill="#facc15" stroke="#ca8a04" strokeWidth="1.5" strokeLinejoin="round"
        />
        <rect x="6" y="28" width="36" height="4" rx="1.5" fill="#eab308" stroke="#ca8a04" strokeWidth="1" />
        <circle cx="24" cy="14" r="2.2" fill="#fef9c3" />
        <circle cx="12" cy="20" r="1.6" fill="#fef9c3" />
        <circle cx="36" cy="20" r="1.6" fill="#fef9c3" />
      </svg>
    );
  }
  const main = rank === 2 ? "#cbd5e1" : "#fdba74";
  const edge = rank === 2 ? "#64748b" : "#c2410c";
  return (
    <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden="true">
      <path
        d="M12 6 h16 v10 a8 8 0 0 1 -16 0 Z"
        fill={main} stroke={edge} strokeWidth="1.5" strokeLinejoin="round"
      />
      <path d="M12 8 H6 a6 6 0 0 0 6 8 M28 8 h6 a6 6 0 0 1 -6 8" fill="none" stroke={edge} strokeWidth="1.5" />
      <rect x="17" y="23" width="6" height="6" fill={main} stroke={edge} strokeWidth="1" />
      <rect x="12" y="29" width="16" height="4" rx="1" fill={main} stroke={edge} strokeWidth="1" />
      <text x="20" y="15.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill={edge}>{rank}</text>
    </svg>
  );
}

const CONFETTI_COLORS = ["#facc15", "#22c55e", "#3b82f6", "#ec4899", "#f97316", "#a855f7"];

function Confetti() {
  return (
    <div className="podium-confetti absolute inset-0" aria-hidden="true">
      {CONFETTI_COLORS.map((c, i) => (
        <span
          key={i}
          style={{
            left: `${8 + i * 15}%`,
            background: c,
            animationDelay: `${i * 0.55}s`,
            animationDuration: `${3 + (i % 3) * 0.7}s`,
          }}
        />
      ))}
    </div>
  );
}

// Podium card. Order rendered: 2nd, 1st (elevated), 3rd.
function PodiumCard({ entry, rank }: { entry?: LeaderboardEntry; rank: 1 | 2 | 3 }) {
  const pnl = entry ? (entry.pnlUsd ?? entry.realizedPnlUsd) : 0;
  const medal = rank === 1 ? "\u{1F947}" : rank === 2 ? "\u{1F948}" : "\u{1F949}";
  const flair = rank === 1 ? "podium-gold podium-shine" : rank === 2 ? "podium-silver" : "podium-bronze";
  const elevate = rank === 1 ? "sm:-translate-y-3 sm:scale-105" : "";
  return (
    <div
      className={`podium-card flex flex-1 flex-col items-center rounded-xl border ${flair} px-4 py-4 shadow-sm ${elevate}`}
    >
      {rank === 1 && entry && <Confetti />}
      <RankArt rank={rank} />
      <div className="mt-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-term-dim">
        <span>{medal}</span>
        <span>#{rank}</span>
      </div>
      {entry ? (
        <>
          <div className="num mt-2 text-sm">
            <Link href={`/u/${entry.address}`} className="hover:text-term-accent hover:underline" title="View trader profile">
              {entry.display}
            </Link>
            <BadgeEmojis keys={entry.badges} max={3} />
            <ReferralFlair flair={entry.referralFlair} />
          </div>
          <div className={`num mt-1 text-lg font-bold ${pnlColor(pnl)}`}>
            {pnlStr(pnl)}
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
  const [metric, setMetric] = useState<Metric>("equity");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY) as Window | null;
    if (saved === "1d" || saved === "7d" || saved === "all") setWin(saved);
    const savedMetric = localStorage.getItem(LS_METRIC_KEY) as Metric | null;
    if (savedMetric === "equity" || savedMetric === "realized") setMetric(savedMetric);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    const load = () =>
      api
        .leaderboardWindow(win, metric)
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
  }, [win, metric, loaded]);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 10);

  return (
    <div className="mb-6">
      <PrizePoolBanner window={win} />

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold">Leaderboard</h2>
        <span className="text-[11px] uppercase tracking-wider text-term-dim">{metric} PnL</span>
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
      <div className="mb-3 flex gap-1">
        {(["equity", "realized"] as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMetric(m);
              localStorage.setItem(LS_METRIC_KEY, m);
            }}
            className={`tab ${metric === m ? "tab-active" : ""}`}
          >
            {m === "equity" ? "Equity" : "Realized"}
          </button>
        ))}
      </div>

      {entries.length ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:pt-3">
            <PodiumCard entry={top3[1]} rank={2} />
            <PodiumCard entry={top3[0]} rank={1} />
            <PodiumCard entry={top3[2]} rank={3} />
          </div>
          {rest.length > 0 && (
            <div className="panel mt-3 overflow-hidden">
              {rest.map((e, i) => {
                const pnl = e.pnlUsd ?? e.realizedPnlUsd;
                return (
                <div
                  key={e.userId}
                  className="flex items-center gap-3 border-t border-term-line px-3 py-2 text-[13px] transition-colors first:border-t-0 hover:bg-term-hover"
                >
                  <span className="num w-6 text-term-dim">{i + 4}</span>
                  <span className="num">
                    <Link href={`/u/${e.address}`} className="hover:text-term-accent hover:underline" title="View trader profile">
                      {e.display}
                    </Link>
                    <BadgeEmojis keys={e.badges} max={3} />
                    <ReferralFlair flair={e.referralFlair} />
                  </span>
                  <span className={`num ml-auto ${pnlColor(pnl)}`}>
                    {pnlStr(pnl)}
                  </span>
                  <span className={`num w-20 text-right text-xs ${pnlColor(e.pnlPct)}`}>
                    {e.pnlPct >= 0 ? "+" : ""}
                    {e.pnlPct.toFixed(2)}%
                  </span>
                  <span className="num w-16 text-right text-xs text-term-dim">{e.trades} tr</span>
                </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="panel px-3 py-8 text-center text-term-dim">
          <div className="text-lg">🏆</div>
          <div className="mt-1 text-xs">No activity in this window yet. Be the first on the podium.</div>
        </div>
      )}
    </div>
  );
}
