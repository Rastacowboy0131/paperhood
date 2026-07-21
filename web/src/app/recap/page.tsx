"use client";

// Recap page: pick a window, get copy-pasteable text for X. Manual paste
// workflow, no posting integration.
import { useEffect, useState } from "react";
import { api, Recap } from "@/lib/api";

const WINDOWS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "season", label: "Season" },
] as const;

export default function RecapPage() {
  const [win, setWin] = useState<"daily" | "weekly" | "season">("daily");
  const [recap, setRecap] = useState<Recap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"short" | "long" | null>(null);

  useEffect(() => {
    setRecap(null);
    setErr(null);
    api.recap(win).then(setRecap).catch((e) => setErr(e.message));
  }, [win]);

  function copy(text: string, which: "short" | "long") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Recap generator</h1>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWin(w.key)}
              className={`rounded border px-3 py-1 text-xs transition-colors ${
                win === w.key
                  ? "border-term-accent bg-term-accent/10 font-semibold text-term-accent"
                  : "border-term-border text-term-dim hover:text-term-text"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-term-dim">
        Generated from live leaderboard and trade data. Copy and paste to X.
      </p>

      {err && <div className="panel p-4 text-sm text-term-red">{err}</div>}
      {!recap && !err && <div className="panel skeleton h-40" />}

      {recap && (
        <>
          <section className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-term-dim">
                Short (for X, {recap.short.length}/280 chars)
              </h2>
              <button onClick={() => copy(recap.short, "short")} className="btn btn-primary text-xs">
                {copied === "short" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded bg-term-raised p-3 text-[13px] leading-relaxed">
              {recap.short}
            </pre>
          </section>

          <section className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-term-dim">Long version</h2>
              <button onClick={() => copy(recap.long, "long")} className="btn btn-ghost text-xs">
                {copied === "long" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded bg-term-raised p-3 text-[13px] leading-relaxed">
              {recap.long}
            </pre>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Trades" value={String(recap.totalTrades)} />
            <MiniStat label="Traders" value={String(recap.activeTraders)} />
            <MiniStat label="Top token" value={recap.mostTraded ? `$${recap.mostTraded.symbol}` : "-"} />
            <MiniStat label="Prize pool" value={`$${recap.prizePoolUsd.toFixed(2)}`} />
          </div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-term-dim">{label}</div>
      <div className="num mt-0.5 text-base font-semibold">{value}</div>
    </div>
  );
}
