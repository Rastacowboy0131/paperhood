"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, TokenRow, fmtUsd, fmtCompact } from "@/lib/api";
import { useLivePrices } from "@/lib/ws";

type SortKey = "symbol" | "priceUsd" | "change24hPct" | "liquidityUsd" | "volume24hUsd";

export default function Screener() {
  const router = useRouter();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [ethUsd, setEthUsd] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("liquidityUsd");
  const [sortDesc, setSortDesc] = useState(true);
  const [denom, setDenom] = useState<"usd" | "eth">("usd");

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
      if (!lp) return t;
      return { ...t, priceQuote: lp.price, priceUsd: lp.price * ethUsd };
    });
    if (q) {
      list = list.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase() === q
      );
    }
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [tokens, live, ethUsd, search, sortKey, sortDesc]);

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
              {th("priceUsd", "Price")}
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
                  <span className="font-semibold">{t.symbol}</span>{" "}
                  <span className="text-term-dim">{t.name}</span>
                </td>
                <td className="num px-3 py-2 text-right">
                  {denom === "usd" ? `$${fmtUsd(t.priceUsd)}` : `${t.priceQuote.toPrecision(6)} ETH`}
                </td>
                <td
                  className={`num px-3 py-2 text-right ${t.change24hPct >= 0 ? "text-term-green" : "text-term-red"}`}
                >
                  {t.change24hPct >= 0 ? "+" : ""}
                  {t.change24hPct.toFixed(2)}%
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
