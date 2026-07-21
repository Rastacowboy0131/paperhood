// Recap generator: shareable text summaries for a window (daily, weekly,
// season). Pulls from the equity leaderboards, trades table and fee-funded
// prize pool. Output is plain copy-pasteable text (short version fits an X
// post, long version has more detail). No posting integration; a human
// pastes it manually.
import { DatabaseSync } from "node:sqlite";
import { dailyLeaderboard, weeklyLeaderboard, seasonLeaderboard, LeaderboardEntry } from "./leaderboard.js";
import { getSeasonId, seasonInfo, truncateAddress } from "./ledger.js";

export type RecapWindow = "daily" | "weekly" | "season";

export interface RecapData {
  window: RecapWindow;
  windowStart: number;
  generatedAt: number;
  totalTrades: number;
  activeTraders: number;
  topGainer: { display: string; pnlUsd: number; pnlPct: number } | null;
  biggestLoss: { display: string; pnlUsd: number; pnlPct: number } | null;
  mostTraded: { symbol: string; trades: number } | null;
  prizePoolUsd: number;
  seasonNum: number | null;
  short: string;
  long: string;
}

function utcDayStart(nowSec: number): number {
  return nowSec - (nowSec % 86400);
}

function utcWeekStart(nowSec: number): number {
  const dayStart = utcDayStart(nowSec);
  const dow = new Date(nowSec * 1000).getUTCDay();
  return dayStart - ((dow + 6) % 7) * 86400;
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function buildRecap(db: DatabaseSync, window: RecapWindow, nowSec: number = Math.floor(Date.now() / 1000)): RecapData {
  const seasonId = getSeasonId(db, nowSec);
  const season = seasonInfo(db, seasonId);
  let windowStart: number;
  let entries: LeaderboardEntry[];
  if (window === "daily") {
    windowStart = utcDayStart(nowSec);
    entries = dailyLeaderboard(db, nowSec);
  } else if (window === "weekly") {
    windowStart = utcWeekStart(nowSec);
    entries = weeklyLeaderboard(db, nowSec);
  } else {
    windowStart = season?.startTs ?? 0;
    entries = seasonLeaderboard(db, seasonId);
  }

  const totalTrades = (db.prepare(
    "SELECT COUNT(*) AS c FROM trades WHERE ts >= ? AND season_id = ?"
  ).get(windowStart, seasonId) as { c: number }).c;

  const activeTraders = (db.prepare(
    "SELECT COUNT(DISTINCT user_id) AS c FROM trades WHERE ts >= ? AND season_id = ?"
  ).get(windowStart, seasonId) as { c: number }).c;

  const mt = db.prepare(
    `SELECT COALESCE(tok.symbol, po.symbol, '?') AS symbol, COUNT(*) AS c
     FROM trades t
     LEFT JOIN tokens tok ON tok.address = t.token_address
     LEFT JOIN pools po ON po.pair_address = t.pair_address
     WHERE t.ts >= ? AND t.season_id = ?
     GROUP BY t.token_address ORDER BY c DESC LIMIT 1`
  ).get(windowStart, seasonId) as { symbol: string; c: number } | undefined;

  // Prize pool: 0.5 * fees in the window (daily/weekly mirror /prizepool;
  // season uses the same rule over the season window).
  const prizePoolUsd = 0.5 * ((db.prepare(
    "SELECT COALESCE(SUM(fee), 0) AS f FROM trades WHERE ts >= ? AND ts <= ?"
  ).get(windowStart, nowSec) as { f: number }).f);

  const gainers = entries.filter((e) => e.pnlUsd > 0);
  const losers = entries.filter((e) => e.pnlUsd < 0);
  const topGainer = gainers.length
    ? { display: truncateAddress(gainers[0].address), pnlUsd: gainers[0].pnlUsd, pnlPct: gainers[0].pnlPct }
    : null;
  const worst = losers.length ? losers[losers.length - 1] : null;
  const biggestLoss = worst
    ? { display: truncateAddress(worst.address), pnlUsd: worst.pnlUsd, pnlPct: worst.pnlPct }
    : null;
  const mostTraded = mt ? { symbol: mt.symbol, trades: mt.c } : null;

  const label = window === "daily" ? "Daily" : window === "weekly" ? "Weekly" : `Season ${season?.num ?? "?"}`;

  // Short version: X-friendly, under 280 chars, few emojis, no markdown.
  const shortLines: string[] = [`PaperHood ${label} Recap`];
  if (topGainer) shortLines.push(`Top gainer: ${topGainer.display} ${fmtPct(topGainer.pnlPct)}`);
  if (biggestLoss) shortLines.push(`Biggest hit: ${biggestLoss.display} ${fmtPct(biggestLoss.pnlPct)}`);
  if (mostTraded) shortLines.push(`Most traded: $${mostTraded.symbol} (${mostTraded.trades} trades)`);
  shortLines.push(`${totalTrades} trades by ${activeTraders} traders`);
  if (prizePoolUsd > 0) shortLines.push(`Prize pool: $${fmtUsd(prizePoolUsd)} 🏆`);
  shortLines.push("paperhood.vercel.app");
  let short = shortLines.join("\n");
  if (short.length > 280) {
    // Drop the biggest loss line first, then the link, until it fits.
    const trimmed = shortLines.filter((l) => !l.startsWith("Biggest hit"));
    short = trimmed.join("\n");
    if (short.length > 280) short = trimmed.slice(0, -1).join("\n");
  }

  const longLines: string[] = [
    `PaperHood ${label} Recap`,
    "",
    topGainer
      ? `Top gainer: ${topGainer.display} with ${fmtPct(topGainer.pnlPct)} equity (${topGainer.pnlUsd >= 0 ? "+" : ""}$${fmtUsd(topGainer.pnlUsd)})`
      : "Top gainer: nobody in the green yet",
    biggestLoss
      ? `Biggest loss: ${biggestLoss.display} at ${fmtPct(biggestLoss.pnlPct)} ($${fmtUsd(biggestLoss.pnlUsd)})`
      : "Biggest loss: no red on the board",
    mostTraded
      ? `Most traded token: $${mostTraded.symbol} with ${mostTraded.trades} trades`
      : "Most traded token: no trades in this window",
    `Total trades: ${totalTrades}`,
    `Active traders: ${activeTraders}`,
    `Prize pool: $${fmtUsd(prizePoolUsd)}`,
    "",
    "Trade tokenized stocks and RH chain tokens with a fake $10k.",
    "paperhood.vercel.app",
  ];
  const long = longLines.join("\n");

  return {
    window,
    windowStart,
    generatedAt: nowSec,
    totalTrades,
    activeTraders,
    topGainer,
    biggestLoss,
    mostTraded,
    prizePoolUsd,
    seasonNum: season?.num ?? null,
    short,
    long,
  };
}
