"use client";

// PnL share card: renders a branded image to a canvas client-side with the
// trade or position stats, offered as download or clipboard copy.

import { useEffect, useRef, useState } from "react";

export interface ShareCardData {
  symbol: string;
  side: "long" | "closed";
  entryPriceUsd: number | null;
  exitPriceUsd: number | null; // exit for closed trades, current mark for open
  pnlPct: number | null;
  pnlUsd: number | null;
  username: string;
}

const W = 1200;
const H = 630;

function fmtPrice(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.001 ? 6 : 8;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

function themed(): { bg: string; panel: string; text: string; dim: string; line: string; accent: string; green: string; red: string } {
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
  };
}

function drawCard(canvas: HTMLCanvasElement, d: ShareCardData): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const t = themed();
  const win = (d.pnlPct ?? 0) >= 0;
  const pnlColor = win ? t.green : t.red;

  canvas.width = W;
  canvas.height = H;

  // Background and panel.
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = t.panel;
  roundRect(ctx, 40, 40, W - 80, H - 80, 28);
  ctx.fill();
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 2;
  roundRect(ctx, 40, 40, W - 80, H - 80, 28);
  ctx.stroke();

  // Subtle accent glow behind the PnL number.
  const glow = ctx.createRadialGradient(W / 2, 330, 40, W / 2, 330, 420);
  glow.addColorStop(0, win ? "rgba(31,196,122,0.10)" : "rgba(238,85,102,0.10)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(40, 40, W - 80, H - 80);

  const mono = "'SFMono-Regular', 'Menlo', 'Consolas', monospace";
  const sans = "'Inter', 'Helvetica Neue', Arial, sans-serif";

  // Brand.
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 44px ${sans}`;
  ctx.fillStyle = t.accent;
  ctx.fillText("Paper", 90, 128);
  const paperW = ctx.measureText("Paper").width;
  ctx.fillStyle = t.text;
  ctx.fillText("Hood", 90 + paperW, 128);
  ctx.font = `28px ${sans}`;
  ctx.fillText("🏹", 90 + paperW + ctx.measureText("Hood").width + 46, 124);

  // Ticker and side tag.
  ctx.font = `bold 56px ${mono}`;
  ctx.fillStyle = t.text;
  ctx.textAlign = "right";
  ctx.fillText(`$${d.symbol}`, W - 90, 128);
  ctx.textAlign = "left";
  ctx.font = `26px ${sans}`;
  ctx.fillStyle = t.dim;
  const tag = d.side === "closed" ? "CLOSED TRADE" : "OPEN POSITION";
  ctx.textAlign = "right";
  ctx.fillText(tag, W - 90, 168);
  ctx.textAlign = "left";

  // Big PnL %.
  const pct = d.pnlPct;
  const pctStr = pct == null ? "-" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  ctx.font = `bold 150px ${mono}`;
  ctx.fillStyle = pnlColor;
  ctx.textAlign = "center";
  ctx.fillText(pctStr, W / 2, 370);
  if (d.pnlUsd != null) {
    ctx.font = `bold 44px ${mono}`;
    ctx.fillText(`${d.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(d.pnlUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`, W / 2, 432);
  }
  ctx.textAlign = "left";

  // Entry / exit row.
  const rowY = 512;
  ctx.font = `24px ${sans}`;
  ctx.fillStyle = t.dim;
  ctx.fillText("ENTRY", 130, rowY);
  ctx.fillText(d.side === "closed" ? "EXIT" : "CURRENT", 470, rowY);
  ctx.fillText("TRADER", 810, rowY);
  ctx.font = `bold 34px ${mono}`;
  ctx.fillStyle = t.text;
  ctx.fillText(fmtPrice(d.entryPriceUsd), 130, rowY + 42);
  ctx.fillText(fmtPrice(d.exitPriceUsd), 470, rowY + 42);
  ctx.fillStyle = t.accent;
  ctx.fillText(d.username, 810, rowY + 42);

  // Footer.
  ctx.font = `22px ${sans}`;
  ctx.fillStyle = t.dim;
  ctx.textAlign = "center";
  ctx.fillText("paper trade · paperhood", W / 2, H - 60);
  ctx.textAlign = "left";
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

export function ShareCardModal({ data, onClose }: { data: ShareCardData; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawCard(canvasRef.current, data);
  }, [data]);

  function download(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `paperhood-${data.symbol.toLowerCase()}-pnl.png`;
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
          <h3 className="text-sm font-bold">Share your PnL</h3>
          <button onClick={onClose} className="ml-auto text-term-dim hover:text-term-text" aria-label="Close">✕</button>
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

// Small share button that opens the modal.
export function ShareButton({ data }: { data: ShareCardData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-term-border px-2 py-0.5 text-[11px] text-term-dim transition-colors hover:bg-term-hover hover:text-term-text"
        title="Share PnL card"
      >
        Share
      </button>
      {open && <ShareCardModal data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
