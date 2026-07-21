// Small typed fetch wrapper for the PaperHood API. Cookie auth via credentials: include.

// Direct backend origin (used for WebSockets, and as the proxy target).
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
// Browser HTTP calls go through the same-origin /api proxy (next.config rewrite)
// so the session cookie is first-party. Safari drops third-party cookies, which
// broke auth when the web (vercel.app) called the API (railway.app) directly.
export const API_URL = "/api";
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
  imageUrl?: string | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  imported?: boolean;
  source?: string | null;
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
  imageUrl?: string | null;
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

export interface Order {
  id: number;
  token: string;
  pair: string;
  side: "buy" | "sell";
  type: "limit" | "stop";
  triggerPrice: number;
  amount: number;
  status: "open" | "filled" | "cancelled" | "failed";
  failReason: string | null;
  createdAt: number;
  filledAt: number | null;
  filledPriceUsd: number | null;
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
  pnlUsd: number;
  realizedPnlUsd: number; // legacy alias of pnlUsd
  pnlPct: number;
  trades: number;
  badges?: string[];
  referralFlair?: "silver" | "gold" | null;
}

export interface BadgeDef {
  key: string;
  label: string;
  emoji: string;
  desc: string;
}

export interface UserBadge extends BadgeDef {
  earnedAt: number;
}

export interface SeasonInfo {
  id: number;
  num: number;
  startTs: number;
  endTs: number;
}

export interface SeasonsResponse {
  current: SeasonInfo | null;
  badgeDefs: BadgeDef[];
  archive: { season: SeasonInfo; winners: LeaderboardEntry[] }[];
  all: SeasonInfo[];
}

export interface ClosedTrade {
  id: number;
  token: string;
  symbol: string;
  qtyDec: number;
  entryPriceUsd: number | null;
  exitPriceUsd: number;
  proceedsUsd: number;
  realizedPnlUsd: number | null;
  pnlPct: number | null;
  ts: number;
}

export interface EquityPoint {
  ts: number;
  equityUsd: number;
}

export interface PrizePool {
  dailyUsd: number;
  weeklyUsd: number;
  dayEndsAt: number; // unix seconds, next 00:00 UTC
  weekEndsAt: number; // unix seconds, next Monday 00:00 UTC
}

export interface Recap {
  window: "daily" | "weekly" | "season";
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

export interface Me {
  user: { userId: number; address: string; createdAt?: string } | null;
}

// Watchlist entries (server-side, per wallet).
export interface WatchEntry {
  token: string;
  createdAt: number;
}

// Trade journal note.
export interface Note {
  id: number;
  token: string;
  symbol: string;
  tradeId: number | null;
  text: string;
  createdAt: number;
  updatedAt: number;
}

// Public trader profile (/traders/:address).
export interface TraderPosition {
  token: string;
  symbol: string;
  pair: string;
  imageUrl?: string | null;
  qtyDec: number;
  entryPriceUsd: number | null;
  sizeUsd: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
}

export interface TraderProfile {
  address: string;
  display: string;
  joinedAt: number;
  badges: UserBadge[];
  badgeDefs: BadgeDef[];
  equityUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  equityCurve: EquityPoint[];
  positions: TraderPosition[];
  closedTrades: ClosedTrade[];
}

// POST /tokens/import response.
export interface ImportResult {
  address: string;
  symbol: string;
  name: string;
  pair: string;
  liquidityUsd: number;
  thinLiquidity: boolean;
  alreadyTracked: boolean;
}

// Token info panel payloads (/tokens/:address/trades, /holders, /paper-trades).
export interface PoolTrade {
  txHash: string;
  wallet: string;
  side: "buy" | "sell";
  tokenAmount: number;
  volumeUsd: number;
  priceUsd: number;
  ts: number;
}

export interface TopTrader {
  wallet: string;
  buys: number;
  sells: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  netVolumeUsd: number;
}

export interface Holder {
  address: string;
  isContract: boolean;
  balance: number;
  pctOfSupply: number | null;
}

export interface PaperTrade {
  id: number;
  display: string;
  side: "buy" | "sell";
  amountOutDec: number;
  usd: number;
  execPriceUsd: number;
  realizedPnlUsd: number | null;
  ts: number;
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
  importToken: (address: string) =>
    req<ImportResult>("/tokens/import", { method: "POST", body: JSON.stringify({ address }) }),
  token: (addr: string) => req<TokenRow & { decimals: number; ethUsd?: number }>(`/tokens/${addr}`),
  candles: (addr: string, tf: string, limit = 300) =>
    req<{ pair: string; tf: string; candles: Candle[] }>(`/tokens/${addr}/candles?tf=${tf}&limit=${limit}`),
  tokenTrades: (addr: string) =>
    req<{ pair: string; explorer: string; trades: PoolTrade[]; topTraders: TopTrader[]; windowTrades: number }>(
      `/tokens/${addr}/trades`
    ),
  tokenHolders: (addr: string) =>
    req<{ explorer: string; holders: Holder[] }>(`/tokens/${addr}/holders`),
  paperTrades: (addr: string) =>
    req<{ trades: PaperTrade[] }>(`/tokens/${addr}/paper-trades`),
  quote: (body: { tokenIn: string; tokenOut: string; amountIn: string }) =>
    req<QuoteResponse>("/quote", { method: "POST", body: JSON.stringify(body) }),
  trade: (body: { token: string; side: "buy" | "sell"; amount: string | number; note?: string }) =>
    req<TradeResult>("/trade", { method: "POST", body: JSON.stringify(body) }),
  watchlist: () => req<{ watchlist: WatchEntry[] }>("/watchlist"),
  addWatch: (token: string) => req<{ ok: boolean }>(`/watchlist/${token}`, { method: "PUT" }),
  removeWatch: (token: string) => req<{ ok: boolean }>(`/watchlist/${token}`, { method: "DELETE" }),
  notes: (token?: string) =>
    req<{ notes: Note[]; maxChars: number }>(`/notes${token ? `?token=${token}` : ""}`),
  createNote: (body: { token: string; text: string; tradeId?: number }) =>
    req<{ note: Note }>("/notes", { method: "POST", body: JSON.stringify(body) }),
  updateNote: (id: number, text: string) =>
    req<{ note: Note }>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify({ text }) }),
  deleteNote: (id: number) => req<{ ok: boolean }>(`/notes/${id}`, { method: "DELETE" }),
  trader: (address: string) => req<TraderProfile>(`/traders/${address}`),
  portfolio: () => req<Portfolio>("/portfolio"),
  orders: (token?: string) =>
    req<{ orders: Order[] }>(`/orders${token ? `?token=${token}` : ""}`),
  createOrder: (body: { token: string; side: "buy" | "sell"; type: "limit" | "stop"; triggerPrice: number; amount: number }) =>
    req<{ order: Order }>("/orders", { method: "POST", body: JSON.stringify(body) }),
  cancelOrder: (id: number) => req<{ ok: boolean }>(`/orders/${id}`, { method: "DELETE" }),
  updateOrder: (id: number, body: { triggerPrice: number }) =>
    req<{ order: Order }>(`/orders/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  leaderboard: (period: "daily" | "weekly") =>
    req<{ period: string; entries: LeaderboardEntry[] }>(`/leaderboard?period=${period}`),
  leaderboardWindow: (window: "1d" | "7d" | "all", metric: "equity" | "realized" = "equity") =>
    req<{ window: string; entries: LeaderboardEntry[] }>(`/leaderboard?window=${window}&metric=${metric}`),
  leaderboardSeason: (season: number | "current", metric: "equity" | "realized" = "equity") =>
    req<{ season: SeasonInfo; entries: LeaderboardEntry[] }>(`/leaderboard?season=${season}&metric=${metric}`),
  seasons: () => req<SeasonsResponse>("/seasons"),
  closedTrades: (page = 1, pageSize = 20) =>
    req<{ page: number; pageSize: number; total: number; trades: ClosedTrade[] }>(
      `/portfolio/closed?page=${page}&pageSize=${pageSize}`
    ),
  equityCurve: () => req<{ seasonId: number; points: EquityPoint[] }>("/portfolio/equity"),
  myBadges: () => req<{ defs: BadgeDef[]; badges: UserBadge[] }>("/badges/me"),
  prizePool: () =>
    req<PrizePool>("/prizepool"),
  recap: (window: "daily" | "weekly" | "season") => req<Recap>(`/recap?window=${window}`),
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
