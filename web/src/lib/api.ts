// Small typed fetch wrapper for the PaperHood API. Cookie auth via credentials: include.

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
export const DEV_AUTH = process.env.NEXT_PUBLIC_DEV_AUTH === "1";

export interface TokenRow {
  address: string;
  symbol: string;
  name: string;
  pair: string;
  dex: string;
  version: string;
  liquidityUsd: number;
  volume24hUsd: number;
  priceQuote: number;
  priceUsd: number;
  change24hPct: number;
  decimals?: number;
  totalSupply?: number | null;
  mcapUsd?: number | null;
}

export interface TokensResponse {
  ethUsd: number;
  tokens: TokenRow[];
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface QuoteResponse {
  pair: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  spotPrice: number;
  execPrice: number;
  priceImpactPct: number;
  feePaid: string;
  feeTier: number;
  path: string;
}

export interface Position {
  token: string;
  symbol: string;
  name: string;
  pair: string;
  qty: string;
  qtyDec: number;
  costBasisUsd: number;
  markUsd: number;
  unrealizedPnlUsd: number;
}

// POST /trade response shape.
export interface TradeResult {
  tradeId: number;
  side: "buy" | "sell";
  token: string;
  usdIn?: number;
  usdOut?: number;
  tokensOut?: string;
  tokensIn?: string;
  execPriceUsd?: number;
  realizedPnlUsd?: number;
  priceImpactPct?: number;
  path?: string;
}

// Rows in portfolio.history.
export interface HistoryRow {
  id: number;
  pair: string;
  token: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  execPriceUsd: number;
  priceImpactPct: number;
  feeUsd: number;
  realizedPnlUsd: number | null;
  ts: number;
}

export interface Portfolio {
  user: { address: string; display: string };
  cashUsd: number;
  cashEth: number;
  equityUsd: number;
  equityEth: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  positions: Position[];
  history: HistoryRow[];
}

export interface LeaderboardEntry {
  userId: number;
  address: string;
  display: string;
  realizedPnlUsd: number;
  pnlPct: number;
  trades: number;
}

export interface Me {
  user: { userId: number; address: string; createdAt?: string } | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tokens: () => req<TokensResponse>("/tokens"),
  token: (addr: string) => req<TokenRow & { decimals: number; ethUsd?: number }>(`/tokens/${addr}`),
  candles: (addr: string, tf: string, limit = 300) =>
    req<{ pair: string; tf: string; candles: Candle[] }>(`/tokens/${addr}/candles?tf=${tf}&limit=${limit}`),
  quote: (body: { tokenIn: string; tokenOut: string; amountIn: string }) =>
    req<QuoteResponse>("/quote", { method: "POST", body: JSON.stringify(body) }),
  trade: (body: { token: string; side: "buy" | "sell"; amount: string | number }) =>
    req<TradeResult>("/trade", { method: "POST", body: JSON.stringify(body) }),
  portfolio: () => req<Portfolio>("/portfolio"),
  leaderboard: (period: "daily" | "weekly") =>
    req<{ period: string; entries: LeaderboardEntry[] }>(`/leaderboard?period=${period}`),
  nonce: () => req<{ nonce: string; expiresInS: number }>("/auth/nonce"),
  verify: (message: string, signature: string) =>
    req<{ ok: boolean; user: { userId: number; address: string } }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    }),
  me: async (): Promise<Me> => {
    try {
      return await req<Me>("/auth/me");
    } catch {
      return { user: null };
    }
  },
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  devLogin: (address?: string) =>
    req<{ ok: boolean }>(`/auth/dev${address ? `?address=${address}` : ""}`),
};

export function truncAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function fmtUsd(n: number | undefined | null, digits?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  const d = digits ?? (abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6);
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtCompact(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}

// Human-readable market cap: $12.5K / $3.4M / $1.2B.
export function fmtMcap(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e12) return "$" + (n / 1e12).toFixed(1) + "T";
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}
