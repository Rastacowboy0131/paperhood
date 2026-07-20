"use client";

import { useEffect, useMemo, useState } from "react";
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
      .catch((e) => setErr(e.message));
  }, []);

  const addrs = useMemo(() => tokens.map((t) => t.address), [tokens]);
  const live = useLivePrices(addrs);

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
        className={`cursor-pointer select-none px-3 py-2 ${right ? "text-right" : "text-left"} text-term-dim hover:text-term-text`}
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
      <div className="mb-3 flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol, name, or address"
          className="w-72 rounded border border-term-border bg-term-panel px-3 py-1.5 text-sm outline-none focus:border-term-accent"
        />
        <button
          onClick={() => setDenom(denom === "usd" ? "eth" : "usd")}
          className="rounded border border-term-border px-3 py-1.5 text-sm text-term-dim hover:text-term-text"
        >
          Price: {denom.toUpperCase()}
        </button>
        <button
          onClick={() => setHideInactive(!hideInactive)}
          className={`rounded border border-term-border px-3 py-1.5 text-sm hover:text-term-text ${hideInactive ? "text-term-accent" : "text-term-dim"}`}
          title={`Hide pools with under $${MIN_ACTIVE_VOL} 24h volume`}
        >
          {hideInactive ? "Active only" : "All pools"}
        </button>
        <span className="ml-auto text-xs text-term-dim">
          {rows.length} tokens · ETH ${fmtUsd(ethUsd, 2)}
        </span>
      </div>
      {err && <div className="mb-3 text-sm text-term-red">API error: {err}</div>}
      <div className="overflow-x-auto rounded border border-term-border">
        <table className="w-full text-sm">
          <thead className="bg-term-panel">
            <tr>
              {th("symbol", "Token", false)}
              {th("mcapUsd", "MCap")}
              {th("change24hPct", "24h")}
              {th("liquidityUsd", "Liquidity")}
              {th("volume24hUsd", "Volume 24h")}
              <th className="px-3 py-2 text-right text-term-dim">Pool</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.address}
                onClick={() => router.push(`/t/${t.address}`)}
                className="cursor-pointer border-t border-term-border hover:bg-term-panel"
              >
                <td className="px-3 py-2">
                  <div className="max-w-[240px] truncate whitespace-nowrap">
                    <span className="font-semibold">{(t.symbol || "").slice(0, 12)}</span>{" "}
                    <span className="text-term-dim">{(t.name || "").slice(0, 40)}</span>
                  </div>
                </td>
                <td className="num px-3 py-2 text-right">
                  {denom === "usd"
                    ? fmtMcap(t.mcapUsd)
                    : t.mcapUsd != null && ethUsd > 0
                      ? `${fmtCompact(t.mcapUsd / ethUsd)} ETH`
                      : "-"}
                </td>
                <td
                  className={`num px-3 py-2 text-right ${(t.change24hPct ?? 0) >= 0 ? "text-term-green" : "text-term-red"}`}
                >
                  {t.change24hPct != null ? `${t.change24hPct >= 0 ? "+" : ""}${t.change24hPct.toFixed(2)}%` : "-"}
                </td>
                <td className="num px-3 py-2 text-right">${fmtCompact(t.liquidityUsd)}</td>
                <td className="num px-3 py-2 text-right">${fmtCompact(t.volume24hUsd)}</td>
                <td className="px-3 py-2 text-right text-xs text-term-dim">
                  {t.dex} {t.version}
                </td>
              </tr>
            ))}
            {!rows.length && !err && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-term-dim">
                  Loading universe...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
