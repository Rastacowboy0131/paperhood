"use client";

// Season trophy room: past season winners with shareable canvas winner cards,
// current season shown as in progress with a countdown.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, LeaderboardEntry, SeasonInfo, SeasonsResponse, fmtUsd } from "@/lib/api";

const MEDALS = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
const PLACE_LABEL = ["Champion", "2nd place", "3rd place"];

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function seasonRange(s: SeasonInfo): string {
  return `${fmtDate(s.startTs)} to ${fmtDate(s.endTs)}`;
}

function useCountdown(endTs: number): string {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(endTs - now, 0);
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// ---------- winner card canvas ----------

const W = 1200;
const H = 630;

function themed() {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const css = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const rgb = (name: string, fallback: string) => {
    const v = css?.getPropertyValue(name).trim();
    return v ? `rgb(${v})` : fallback;
  };
  return {
    bg: rgb("--term-bg", dark ? "#0e1013" : "#fafafa"),
    panel: rgb("--term-panel", dark ? "#16181d" : "#ffffff"),
    text: rgb("--term-text", dark ? "#cdd6df" : "#1f2937"),
    dim: rgb("--term-dim", dark ? "#5f6f7f" : "#6b7280"),
    line: rgb("--term-border", dark ? "#24282f" : "#e5e7eb"),
    accent: rgb("--term-accent", "#00c805"),
    green: rgb("--term-green", "#1fc47a"),
    red: rgb("--term-red", "#ee5566"),
    gold: "#f5c451",
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWinnerCard(canvas: HTMLCanvasElement, season: SeasonInfo, winners: LeaderboardEntry[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const t = themed();
  canvas.width = W;
  canvas.height = H;

  const mono = "'SFMono-Regular', 'Menlo', 'Consolas', monospace";
  const sans = "'Inter', 'Helvetica Neue', Arial, sans-serif";

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = t.panel;
  roundRect(ctx, 40, 40, W - 80, H - 80, 28);
  ctx.fill();
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 2;
  roundRect(ctx, 40, 40, W - 80, H - 80, 28);
  ctx.stroke();

  // Gold glow behind the champion line.
  const glow = ctx.createRadialGradient(W / 2, 280, 40, W / 2, 280, 420);
  glow.addColorStop(0, "rgba(245,196,81,0.12)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(40, 40, W - 80, H - 80);

  // Brand.
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 44px ${sans}`;
  ctx.fillStyle = t.accent;
  ctx.fillText("Paper", 90, 128);
  const paperW = ctx.measureText("Paper").width;
  ctx.fillStyle = t.text;
  ctx.fillText("Hood", 90 + paperW, 128);

  // Season label + dates.
  ctx.textAlign = "right";
  ctx.font = `bold 40px ${sans}`;
  ctx.fillStyle = t.gold;
  ctx.fillText(`SEASON ${season.num} CHAMPIONS`, W - 90, 118);
  ctx.font = `24px ${sans}`;
  ctx.fillStyle = t.dim;
  ctx.fillText(seasonRange(season), W - 90, 156);
  ctx.textAlign = "left";

  // Champion.
  const champ = winners[0];
  if (champ) {
    ctx.textAlign = "center";
    ctx.font = `64px ${sans}`;
    ctx.fillText("\ud83c\udfc6", W / 2, 262);
    ctx.font = `bold 66px ${mono}`;
    ctx.fillStyle = t.text;
    ctx.fillText(champ.display, W / 2, 340);
    const cp = champ.pnlUsd ?? champ.realizedPnlUsd;
    ctx.font = `bold 46px ${mono}`;
    ctx.fillStyle = cp >= 0 ? t.green : t.red;
    ctx.fillText(
      `${cp >= 0 ? "+" : "-"}$${Math.abs(cp).toLocaleString("en-US", { maximumFractionDigits: 2 })}  (${champ.pnlPct >= 0 ? "+" : ""}${champ.pnlPct.toFixed(2)}%)`,
      W / 2,
      400
    );
    ctx.textAlign = "left";
  }

  // Silver and bronze row.
  const rowY = 496;
  const cols = [220, 700];
  for (let i = 1; i < Math.min(winners.length, 3); i++) {
    const w = winners[i];
    const x = cols[i - 1];
    ctx.font = `34px ${sans}`;
    ctx.fillText(MEDALS[i], x, rowY);
    ctx.font = `bold 32px ${mono}`;
    ctx.fillStyle = t.text;
    ctx.fillText(w.display, x + 52, rowY);
    const p = w.pnlUsd ?? w.realizedPnlUsd;
    ctx.font = `bold 26px ${mono}`;
    ctx.fillStyle = p >= 0 ? t.green : t.red;
    ctx.fillText(`${p >= 0 ? "+" : "-"}$${Math.abs(p).toLocaleString("en-US", { maximumFractionDigits: 2 })}`, x + 52, rowY + 36);
  }

  ctx.font = `22px ${sans}`;
  ctx.fillStyle = t.dim;
  ctx.textAlign = "center";
  ctx.fillText("paper trade \u00b7 paperhood", W / 2, H - 62);
  ctx.textAlign = "left";
}

function WinnerCardModal({ season, winners, onClose }: { season: SeasonInfo; winners: LeaderboardEntry[]; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawWinnerCard(canvasRef.current, season, winners);
  }, [season, winners]);

  function download(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `paperhood-season-${season.num}-winners.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  async function copy(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("render failed");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMsg("Copied to clipboard");
    } catch {
      setMsg("Copy not supported here, use Download");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel w-full max-w-xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <h3 className="text-sm font-bold">Season {season.num} winner card</h3>
          <button onClick={onClose} className="ml-auto text-term-dim hover:text-term-text" aria-label="Close">
            {"\u2715"}
          </button>
        </div>
        <canvas ref={canvasRef} className="w-full rounded-lg border border-term-border" style={{ aspectRatio: `${W}/${H}` }} />
        <div className="mt-3 flex items-center gap-2">
          <button onClick={download} className="btn btn-primary">Download PNG</button>
          <button onClick={copy} className="btn border border-term-border text-term-dim hover:text-term-text">Copy image</button>
          {msg && <span className="text-xs text-term-dim">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------- page ----------

function CurrentSeasonCard({ season }: { season: SeasonInfo }) {
  const countdown = useCountdown(season.endTs);
  return (
    <div className="panel border-term-accent/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Season {season.num}</span>
        <span className="rounded-full border border-term-accent/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-term-accent">
          in progress
        </span>
        <span className="text-xs text-term-dim">{seasonRange(season)}</span>
        <span className="num ml-auto text-xs text-term-dim">
          ends in <span className="font-semibold text-term-text">{countdown}</span>
        </span>
      </div>
      <div className="mt-2 text-xs text-term-dim">
        Trophies are awarded when the season closes. Track the race on the{" "}
        <Link href="/leaderboard" className="text-term-accent hover:underline">leaderboard</Link>.
      </div>
    </div>
  );
}

export default function SeasonsPage() {
  const [seasons, setSeasons] = useState<SeasonsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<{ season: SeasonInfo; winners: LeaderboardEntry[] } | null>(null);

  useEffect(() => {
    api.seasons().then(setSeasons).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">Trophy room</h1>
      <p className="mb-4 text-xs text-term-dim">
        Every season starts fresh with $10,000 of paper money. Top three at the close take the podium, forever.
      </p>

      {err && <div className="mb-3 text-sm text-term-red">API error: {err}</div>}
      {!seasons && !err && (
        <div className="space-y-3">
          <div className="skeleton h-20 w-full" />
          <div className="skeleton h-40 w-full" />
        </div>
      )}

      {seasons?.current && <CurrentSeasonCard season={seasons.current} />}

      <div className="mt-4 space-y-4">
        {seasons?.archive.map((a) => (
          <div key={a.season.id} className="panel px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">Season {a.season.num}</span>
              <span className="text-xs text-term-dim">{seasonRange(a.season)}</span>
              {a.winners.length > 0 && (
                <button
                  onClick={() => setShareFor({ season: a.season, winners: a.winners })}
                  className="btn btn-ghost ml-auto text-xs"
                  title="Generate a shareable winner card image"
                >
                  Winner card
                </button>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {a.winners.map((w, i) => {
                const wp = w.pnlUsd ?? w.realizedPnlUsd;
                return (
                  <div
                    key={w.userId}
                    className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ${
                      i === 0 ? "border border-term-amber/40 bg-term-raised" : "bg-term-raised"
                    }`}
                  >
                    <span className="text-lg">{MEDALS[i]}</span>
                    <div className="min-w-0 leading-tight">
                      <Link href={`/u/${w.address}`} className="num text-[13px] font-semibold hover:text-term-accent hover:underline">
                        {w.display}
                      </Link>
                      <div className="text-[10px] uppercase tracking-wider text-term-dim">{PLACE_LABEL[i]}</div>
                    </div>
                    <div className="num ml-auto text-right leading-tight">
                      <div className={`text-[13px] font-semibold ${wp >= 0 ? "text-term-green" : "text-term-red"}`}>
                        {wp >= 0 ? "+" : "-"}${fmtUsd(Math.abs(wp), 2)}
                      </div>
                      <div className={`text-[11px] ${w.pnlPct >= 0 ? "text-term-green" : "text-term-red"}`}>
                        {w.pnlPct >= 0 ? "+" : ""}{w.pnlPct.toFixed(2)}% final PnL
                      </div>
                    </div>
                  </div>
                );
              })}
              {!a.winners.length && <div className="text-xs text-term-dim">No activity that season.</div>}
            </div>
          </div>
        ))}
        {seasons && !seasons.archive.length && (
          <div className="panel px-4 py-8 text-center text-term-dim">
            <div className="text-2xl">{"\ud83c\udfc6"}</div>
            <div className="mt-2 text-xs">No finished seasons yet. The first trophies land when season {seasons.current?.num ?? 1} closes.</div>
          </div>
        )}
      </div>

      {shareFor && <WinnerCardModal season={shareFor.season} winners={shareFor.winners} onClose={() => setShareFor(null)} />}
    </div>
  );
}
