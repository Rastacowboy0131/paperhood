// Token info panel data: recent on-chain trades (GeckoTerminal), holders
// (Blockscout), and top traders aggregated from the trade window.
// Everything is proxied + cached server-side; the browser never talks to
// the upstream APIs directly (CORS + rate limits).
import { DatabaseSync } from "node:sqlite";

const GECKO_BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const BLOCKSCOUT_BASE = "https://robinhoodchain.blockscout.com/api/v2";
export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";

const TRADES_TTL_MS = 15_000;
const HOLDERS_TTL_MS = 60_000;

interface CacheEntry<T> { at: number; data: T }
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string, ttlMs: number): T | undefined {
  const e = cache.get(key);
  if (e && Date.now() - e.at < ttlMs) return e.data as T;
  return undefined;
}
function setCached(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
  // Bounded: drop oldest entries past 200 keys.
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------- recent trades (GeckoTerminal) ----------

export interface PoolTrade {
  txHash: string;
  wallet: string;
  side: "buy" | "sell";
  tokenAmount: number;
  volumeUsd: number;
  priceUsd: number;
  ts: number; // unix seconds
}

interface GeckoTradeAttrs {
  tx_hash: string;
  tx_from_address: string;
  kind: "buy" | "sell";
  from_token_amount: string;
  to_token_amount: string;
  price_to_in_usd: string;
  price_from_in_usd: string;
  volume_in_usd: string;
  block_timestamp: string;
  from_token_address: string;
  to_token_address: string;
}

export async function getPoolTrades(pool: string, tokenAddress: string): Promise<PoolTrade[]> {
  const key = `trades:${pool.toLowerCase()}`;
  const cached = getCached<PoolTrade[]>(key, TRADES_TTL_MS);
  if (cached) return cached;

  const body = await fetchJson<{ data: { attributes: GeckoTradeAttrs }[] }>(
    `${GECKO_BASE}/pools/${pool}/trades`
  );
  const token = tokenAddress.toLowerCase();
  const trades: PoolTrade[] = (body.data || []).map((d) => {
    const a = d.attributes;
    const tokenIsTo = a.to_token_address?.toLowerCase() === token;
    return {
      txHash: a.tx_hash,
      wallet: a.tx_from_address,
      side: a.kind,
      tokenAmount: Number(tokenIsTo ? a.to_token_amount : a.from_token_amount),
      volumeUsd: Number(a.volume_in_usd),
      priceUsd: Number(tokenIsTo ? a.price_to_in_usd : a.price_from_in_usd),
      ts: Math.floor(Date.parse(a.block_timestamp) / 1000),
    };
  });
  setCached(key, trades);
  return trades;
}

// ---------- top traders (aggregated over the fetched trade window) ----------

export interface TopTrader {
  wallet: string;
  buys: number;
  sells: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  netVolumeUsd: number;
}

export function aggregateTopTraders(trades: PoolTrade[], top = 10): TopTrader[] {
  const byWallet = new Map<string, TopTrader>();
  for (const t of trades) {
    const w = t.wallet.toLowerCase();
    let e = byWallet.get(w);
    if (!e) {
      e = { wallet: t.wallet, buys: 0, sells: 0, buyVolumeUsd: 0, sellVolumeUsd: 0, netVolumeUsd: 0 };
      byWallet.set(w, e);
    }
    if (t.side === "buy") { e.buys++; e.buyVolumeUsd += t.volumeUsd; }
    else { e.sells++; e.sellVolumeUsd += t.volumeUsd; }
  }
  const out = [...byWallet.values()];
  for (const e of out) e.netVolumeUsd = e.buyVolumeUsd - e.sellVolumeUsd;
  out.sort((a, b) => (b.buyVolumeUsd + b.sellVolumeUsd) - (a.buyVolumeUsd + a.sellVolumeUsd));
  return out.slice(0, top);
}

// ---------- holders (Blockscout) ----------

export interface Holder {
  address: string;
  isContract: boolean;
  balance: number;      // decimal adjusted
  pctOfSupply: number | null;
}

interface BlockscoutHolderItem {
  address: { hash: string; is_contract: boolean };
  value: string;
}

export async function getHolders(tokenAddress: string): Promise<{ holders: Holder[]; decimals: number }> {
  const key = `holders:${tokenAddress.toLowerCase()}`;
  const cached = getCached<{ holders: Holder[]; decimals: number }>(key, HOLDERS_TTL_MS);
  if (cached) return cached;

  const [info, page] = await Promise.all([
    fetchJson<{ decimals: string | null; total_supply: string | null }>(
      `${BLOCKSCOUT_BASE}/tokens/${tokenAddress}`
    ),
    fetchJson<{ items: BlockscoutHolderItem[] }>(
      `${BLOCKSCOUT_BASE}/tokens/${tokenAddress}/holders`
    ),
  ]);

  const decimals = Number(info.decimals ?? 18) || 18;
  const totalSupply = info.total_supply ? Number(info.total_supply) / 10 ** decimals : null;
  const holders: Holder[] = (page.items || []).map((it) => {
    const balance = Number(it.value) / 10 ** decimals;
    return {
      address: it.address.hash,
      isContract: !!it.address.is_contract,
      balance,
      pctOfSupply: totalSupply && totalSupply > 0 ? (balance / totalSupply) * 100 : null,
    };
  });
  const result = { holders, decimals };
  setCached(key, result);
  return result;
}

// ---------- paper trades (local engine db) ----------

export interface PaperTrade {
  id: number;
  display: string;
  side: "buy" | "sell";
  amountOutDec: number;   // tokens bought (buy) or usd received (sell, in USD)
  usd: number;            // usd in (buy) or usd out (sell)
  execPriceUsd: number;
  realizedPnlUsd: number | null;
  ts: number;
}

export function getPaperTrades(db: DatabaseSync, tokenAddress: string, limit = 50): PaperTrade[] {
  const rows = db.prepare(`
    SELECT t.id, t.side, t.amount_in, t.amount_out, t.exec_price AS execPriceUsd,
           t.realized_pnl AS realizedPnlUsd, t.ts, u.address AS userAddress
    FROM trades t JOIN users u ON u.id = t.user_id
    WHERE t.token_address = ? COLLATE NOCASE
    ORDER BY t.id DESC LIMIT ?
  `).all(tokenAddress.toLowerCase(), limit) as {
    id: number; side: "buy" | "sell"; amount_in: string; amount_out: string;
    execPriceUsd: number; realizedPnlUsd: number | null; ts: number; userAddress: string;
  }[];
  return rows.map((r) => {
    // buys: amount_in is USD spent, amount_out is token qty (raw units).
    // sells: amount_in is token qty (raw units), amount_out is USD received.
    const tokensRaw = r.side === "buy" ? r.amount_out : r.amount_in;
    let tokens = 0;
    try { tokens = Number(BigInt(tokensRaw)) / 1e18; } catch { tokens = Number(tokensRaw) || 0; }
    const usd = r.side === "buy" ? Number(r.amount_in) : Number(r.amount_out);
    return {
      id: r.id,
      display: r.userAddress.slice(0, 6) + "..." + r.userAddress.slice(-4),
      side: r.side,
      amountOutDec: tokens,
      usd: Number.isFinite(usd) ? usd : tokens * r.execPriceUsd,
      execPriceUsd: r.execPriceUsd,
      realizedPnlUsd: r.realizedPnlUsd,
      ts: r.ts,
    };
  });
}
