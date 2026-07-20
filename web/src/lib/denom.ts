"use client";

// Shared USD/ETH display denomination, persisted in localStorage so the
// screener and trade pages stay in sync.

import { useEffect, useState } from "react";

export type Denom = "usd" | "eth";

const KEY = "paperhood.denom";

export function useDenom(): [Denom, (d: Denom) => void] {
  const [denom, setDenomState] = useState<Denom>("usd");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "eth" || saved === "usd") setDenomState(saved);
    } catch {}
  }, []);

  const setDenom = (d: Denom) => {
    setDenomState(d);
    try {
      window.localStorage.setItem(KEY, d);
    } catch {}
  };

  return [denom, setDenom];
}

// Compact ETH formatter (prices span many orders of magnitude).
export function fmtEth(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(6).replace(/\.?0+$/, "");
}
