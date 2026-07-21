"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, TokenRow, fmtUsd, fmtCompact, fmtMcap } from "@/lib/api";
import { useLivePrices } from "@/lib/ws";
import { useDenom } from "@/lib/denom";
import Leaderboard from "@/components/Leaderboard";

type SortKey = "symbol" | "mcapUsd" | "change24hPct" | "liquidityUsd" | "volume24hUsd";

// Pools below this 24h volume are hidden by default (dead flatline charts).
const MIN_ACTIVE_VOL = 100;

export default function Screener() {
  const router = useRouter();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [ethUsd, setEthUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("liquidityUsd");
  const [sortDesc, setSortDesc] = useState(true);
  const [denom, setDenom] = useDenom();
  // Hide dead pools (flatline charts) by default; toggle to see everything.
  const [hideInactive, setHideInactive] = useState(true);

  useEffect(() => {
    api
      .tokens()
      .then((r) => {
        setTokens(r.tokens);
        setEthUsd(r.ethUsd);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const addrs = useMemo(() => tokens.map((t) => t.address), [tokens]);
  const live = useLivePrices(addrs);

  // Track previous live prices to flash rows on change.
  const prevPrices = useRef<Record<string, number>>({});
  const flashes = useMemo(() => {
    const out: Record<string, "up" | "down"> = {};
    for (const [addr, lp] of Object.entries(live)) {
      if (lp?.price == null) continue;
      const prev = prevPrices.current[addr];
      if (prev != null && lp.price !== prev) {
        out[addr] = lp.price > prev ? "up" : "down";
      }
      prevPrices.current[addr] = lp.price;
    }
    return out;
  }, [live]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tokens.map((t) => {
      const lp = live[t.address.toLowerCase()];
      if (!lp || lp.price == null) return t;
      const priceUsd = ethUsd != null ? lp.price * ethUsd : t.priceUsd;
      const mcapUsd = priceUsd != null && t.totalSupply != null ? priceUsd * t.totalSupply : t.mcapUsd;
      return { ...t, priceQuote: lp.price, priceUsd, mcapUsd };
    });
    if (hideInactive) {
      list = list.filter((t) => (t.volume24hUsd ?? 0) >= MIN_ACTIVE_VOL);
    }
    if (q) {
      list = list.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase() === q
      );
    }
    list.sort((a, b) => {
      const av = a[sortKey] ?? (typeof a[sortKey] === "string" ? "" : -Infinity);
      const bv = b[sortKey] ?? (typeof b[sortKey] === "string" ? "" : -Infinity);
      const cmp = typeof av === "string" ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [tokens, live, ethUsd, search, sortKey, sortDesc, hideInactive]);

  function th(key: SortKey, label: string, right = true) {
    return (
      <th
        className={`th cursor-pointer select-none ${right ? "text-right" : "text-left"} hover:text-term-text`}
        onClick={() => {
          if (sortKey === key) setSortDesc(!sortDesc);
          else {
            setSortKey(key);
            setSortDesc(true);
          }
        }}
      >
        {label}
        {sortKey === key ? (sortDesc ? " ▼" : " ▲") : ""}
      </th>
    );
  }

  return (
    <div>
      <Leaderboard />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol, name, or address"
          className="input w-72"
        />
        <button
          onClick={() => setDenom(denom === "usd" ? "eth" : "usd")}
          className="btn btn-ghost"
        >
          Price: {denom.toUpperCase()}
        </button>
        <button
          onClick={() => setHideInactive(!hideInactive)}
          className={`btn btn-ghost ${hideInactive ? "border-term-accent/50 text-term-accent hover:text-term-accent" : ""}`}
          title={`Hide pools with under $${MIN_ACTIVE_VOL} 24h volume`}
        >
          {hideInactive ? "Active only" : "All pools"}
        </button>
        <span className="num ml-auto text-xs text-term-dim">
          {rows.length} tokens · ETH ${fmtUsd(ethUsd, 2)}
        </span>
      </div>
      {err && <div className="mb-3 text-sm text-term-red">API error: {err}</div>}
      <div className="panel overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-12 z-10 bg-term-panel">
            <tr>
              {th("symbol", "Token", false)}
              {th("mcapUsd", "MCap")}
              {th("change24hPct", "24h")}
              {th("liquidityUsd", "Liquidity")}
              {th("volume24hUsd", "Volume 24h")}
              <th className="th text-right">Pool</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const flash = flashes[t.address.toLowerCase()];
              return (
                <tr
                  key={t.address}
                  onClick={() => router.push(`/t/${t.address}`)}
                  className={`cursor-pointer border-t border-term-line transition-colors hover:bg-term-hover ${
                    flash === "up" ? "animate-flash-up" : flash === "down" ? "animate-flash-down" : ""
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div className="max-w-[240px] truncate whitespace-nowrap">
                      <span className="font-semibold">{(t.symbol || "").slice(0, 12)}</span>{" "}
                      <span className="text-term-dim">{(t.name || "").slice(0, 40)}</span>
                    </div>
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    {denom === "usd"
                      ? fmtMcap(t.mcapUsd)
                      : t.mcapUsd != null && ethUsd > 0
                        ? `${fmtCompact(t.mcapUsd / ethUsd)} ETH`
                        : "-"}
                  </td>
                  <td
                    className={`num px-3 py-2.5 text-right ${(t.change24hPct ?? 0) >= 0 ? "text-term-green" : "text-term-red"}`}
                  >
                    {t.change24hPct != null ? `${t.change24hPct >= 0 ? "+" : ""}${t.change24hPct.toFixed(2)}%` : "-"}
                  </td>
                  <td className="num px-3 py-2.5 text-right">${fmtCompact(t.liquidityUsd)}</td>
                  <td className="num px-3 py-2.5 text-right">${fmtCompact(t.volume24hUsd)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-term-dim">
                    {t.dex} {t.version}
                  </td>
                </tr>
              );
            })}
            {loading &&
              !rows.length &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-term-line">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-3 py-2">
                      <div className={`skeleton h-3.5 ${j === 0 ? "w-32" : "ml-auto w-16"}`} />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && !rows.length && !err && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-term-dim">
                  <div className="text-lg">◎</div>
                  <div className="mt-1 text-xs">No tokens match</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
