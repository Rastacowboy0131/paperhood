// Trade-any-CA: import a robinhood-chain token by contract address.
// Looks up the token's pairs on dexscreener, validates a priced pair exists,
// and inserts the deepest usable pool into the shared pools table with
// imported=1 so discovery never stales it out. The indexer's poll loop picks
// up active pools automatically, so pricing starts on its next cycle.
import { DatabaseSync } from "node:sqlite";

const CHAIN_SLUG = "robinhood";
const DS_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";

export const CA_RE = /^0x[0-9a-fA-F]{40}$/;

// Liquidity under this gets a thin-liquidity warning on the web (janky pricing).
export const THIN_LIQ_USD = 10_000;

type DsPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  info?: {
    imageUrl?: string;
    websites?: { label?: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
};

export interface ImportResult {
  address: string;
  symbol: string;
  name: string;
  pair: string;
  liquidityUsd: number;
  thinLiquidity: boolean;
  alreadyTracked: boolean;
}

export class ImportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function existingPool(db: DatabaseSync, token: string) {
  return db.prepare(
    "SELECT token_address, symbol, name, pair_address, liquidity_usd FROM pools WHERE token_address = ? COLLATE NOCASE AND active = 1 ORDER BY liquidity_usd DESC LIMIT 1"
  ).get(token.toLowerCase()) as
    | { token_address: string; symbol: string; name: string; pair_address: string; liquidity_usd: number }
    | undefined;
}

export async function importToken(db: DatabaseSync, address: string): Promise<ImportResult> {
  if (!CA_RE.test(address)) throw new ImportError("invalid contract address (expected 0x + 40 hex chars)");
  const token = address.toLowerCase();

  // Idempotent: already tracked means nothing to do.
  const existing = existingPool(db, token);
  if (existing) {
    return {
      address: existing.token_address,
      symbol: existing.symbol,
      name: existing.name,
      pair: existing.pair_address,
      liquidityUsd: existing.liquidity_usd ?? 0,
      thinLiquidity: (existing.liquidity_usd ?? 0) < THIN_LIQ_USD,
      alreadyTracked: true,
    };
  }

  let pairs: DsPair[];
  try {
    const res = await fetch(`${DS_TOKENS_URL}/${token}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const json = (await res.json()) as { pairs?: DsPair[] | null };
    pairs = (json.pairs ?? []).filter((p) => p.chainId === CHAIN_SLUG);
  } catch (e) {
    throw new ImportError(`token lookup failed: ${(e as Error).message}`, 502);
  }

  // Usable pair: matches the token as base, has a price, v2/v3 only.
  const usable = pairs
    .filter((p) => p.baseToken?.address?.toLowerCase() === token)
    .filter((p) => {
      const v = p.labels?.find((l) => /^v[234]$/.test(l)) ?? "v2";
      return v !== "v4";
    })
    .filter((p) => p.priceUsd != null && Number(p.priceUsd) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

  if (usable.length === 0) {
    throw new ImportError("no tradeable pair with pricing found for this address on Robinhood chain", 404);
  }

  const p = usable[0];
  const liq = p.liquidity?.usd ?? 0;
  const version = p.labels?.find((l) => /^v[234]$/.test(l)) ?? "v2";
  const socials = p.info?.socials ?? [];
  const socialUrl = (type: string) => socials.find((s) => s.type?.toLowerCase() === type)?.url ?? null;
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO pools (pair_address, token_address, symbol, name, dex_id, version,
      quote_token, quote_symbol, liquidity_usd, volume24h, active, imported,
      first_seen, last_seen, image_url, website, twitter, telegram)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pair_address) DO UPDATE SET
      active = 1, imported = 1, last_seen = excluded.last_seen,
      liquidity_usd = excluded.liquidity_usd, volume24h = excluded.volume24h
  `).run(
    p.pairAddress,
    token,
    p.baseToken.symbol,
    p.baseToken.name,
    p.dexId,
    version,
    p.quoteToken.address,
    p.quoteToken.symbol,
    liq,
    p.volume?.h24 ?? 0,
    now,
    now,
    p.info?.imageUrl ?? null,
    p.info?.websites?.[0]?.url ?? null,
    socialUrl("twitter"),
    socialUrl("telegram"),
  );

  return {
    address: token,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    pair: p.pairAddress,
    liquidityUsd: liq,
    thinLiquidity: liq < THIN_LIQ_USD,
    alreadyTracked: false,
  };
}
