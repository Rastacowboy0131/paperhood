// Trade-any-CA: import a robinhood-chain token by contract address.
// Looks up the token's pairs on dexscreener, verifies the deepest usable pair
// on-chain (does it answer slot0 = v3 or getReserves = v2), and inserts it
// into the shared pools table fully enriched (token0/token1/decimals/fee)
// with imported=1 so discovery never stales it out. An initial snapshot and
// candle are written from the on-chain read so quoting and the chart work
// immediately, without waiting for the indexer's next poll cycle.
import { DatabaseSync } from "node:sqlite";
import { client, v2PoolAbi, v3PoolAbi, erc20Abi } from "./chain.js";
import { lookupPonsToken } from "./pons.js";

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
    header?: string;
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
  source?: string; // "pons" when imported via the launchpad factory
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

// ---------- on-chain verification ----------

interface VerifiedPool {
  version: "v2" | "v3";
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
  fee: number;
  // v2 state
  reserve0?: bigint;
  reserve1?: bigint;
  // v3 state
  sqrtPriceX96?: bigint;
  tick?: number;
  liquidity?: bigint;
}

// Verify the pair contract on-chain and read its current state. A pool that
// answers slot0() is v3; one that answers getReserves() is v2. Dexscreener
// labels are used only as a hint for which to try first; the chain is the
// source of truth. Throws ImportError if the contract answers neither.
async function verifyPoolOnChain(pair: string, labelHint: string): Promise<VerifiedPool> {
  const addr = pair as `0x${string}`;

  let token0: string;
  let token1: string;
  try {
    [token0, token1] = (await Promise.all([
      client.readContract({ address: addr, abi: v2PoolAbi, functionName: "token0" }),
      client.readContract({ address: addr, abi: v2PoolAbi, functionName: "token1" }),
    ])).map((a) => a.toLowerCase());
  } catch {
    throw new ImportError("pair contract does not respond on-chain (not a v2/v3 pool?)", 502);
  }

  const [decimals0, decimals1] = await Promise.all([
    client.readContract({ address: token0 as `0x${string}`, abi: erc20Abi, functionName: "decimals" }).then(Number),
    client.readContract({ address: token1 as `0x${string}`, abi: erc20Abi, functionName: "decimals" }).then(Number),
  ]).catch(() => {
    throw new ImportError("pool token decimals unreadable on-chain", 502);
  });

  const tryV3 = async (): Promise<VerifiedPool | null> => {
    try {
      const [slot0, liquidity, fee] = await Promise.all([
        client.readContract({ address: addr, abi: v3PoolAbi, functionName: "slot0" }),
        client.readContract({ address: addr, abi: v3PoolAbi, functionName: "liquidity" }),
        client.readContract({ address: addr, abi: v3PoolAbi, functionName: "fee" }),
      ]);
      return {
        version: "v3", token0, token1, decimals0, decimals1,
        fee: Number(fee), sqrtPriceX96: slot0[0], tick: Number(slot0[1]), liquidity,
      };
    } catch { return null; }
  };
  const tryV2 = async (): Promise<VerifiedPool | null> => {
    try {
      const [r0, r1] = await client.readContract({ address: addr, abi: v2PoolAbi, functionName: "getReserves" });
      return { version: "v2", token0, token1, decimals0, decimals1, fee: 3000, reserve0: r0, reserve1: r1 };
    } catch { return null; }
  };

  const order = labelHint === "v2" ? [tryV2, tryV3] : [tryV3, tryV2];
  for (const attempt of order) {
    const v = await attempt();
    if (v) return v;
  }
  throw new ImportError("pool contract answers neither slot0 (v3) nor getReserves (v2); cannot import", 502);
}

// Quote tokens per 1 tracked token, decimal adjusted (mirrors indexer price.ts).
function poolPrice(v: VerifiedPool, tracked: string): number {
  const trackedIsToken0 = tracked === v.token0;
  let token1PerToken0: number;
  if (v.version === "v2") {
    token1PerToken0 = v.reserve0! === 0n ? 0 : (Number(v.reserve1) / Number(v.reserve0)) * 10 ** (v.decimals0 - v.decimals1);
  } else {
    const s = Number(v.sqrtPriceX96) / 2 ** 96;
    token1PerToken0 = s * s * 10 ** (v.decimals0 - v.decimals1);
  }
  if (trackedIsToken0) return token1PerToken0;
  return token1PerToken0 > 0 ? 1 / token1PerToken0 : 0;
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
    // Dexscreener has no priced pair yet. Fresh Pons launchpad tokens live in
    // a real v3 pool from block one but can take a while to show up on
    // aggregators, so fall back to asking the Pons factory directly.
    const pons = await lookupPonsToken(token);
    if (pons) return importPonsToken(db, pons);
    throw new ImportError("no tradeable pair with pricing found for this address on Robinhood chain", 404);
  }

  const p = usable[0];
  const liq = p.liquidity?.usd ?? 0;
  const labelHint = p.labels?.find((l) => /^v[234]$/.test(l)) ?? "v2";

  // Verify on-chain before touching the db: confirms the pair exists, fixes
  // the version if dexscreener labels were missing or wrong, and gives us
  // everything needed for an instant first snapshot.
  const v = await verifyPoolOnChain(p.pairAddress, labelHint);
  const tracked = token;
  if (tracked !== v.token0 && tracked !== v.token1) {
    throw new ImportError("pair contract does not contain this token on-chain", 502);
  }

  const socials = p.info?.socials ?? [];
  const socialUrl = (type: string) => socials.find((s) => s.type?.toLowerCase() === type)?.url ?? null;
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO pools (pair_address, token_address, symbol, name, dex_id, version,
      quote_token, quote_symbol, token0, token1, decimals0, decimals1, fee,
      liquidity_usd, volume24h, active, imported,
      first_seen, last_seen, image_url, header_url, website, twitter, telegram)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pair_address) DO UPDATE SET
      active = 1, imported = 1, last_seen = excluded.last_seen,
      version = excluded.version, token0 = excluded.token0, token1 = excluded.token1,
      decimals0 = excluded.decimals0, decimals1 = excluded.decimals1, fee = excluded.fee,
      liquidity_usd = excluded.liquidity_usd, volume24h = excluded.volume24h
  `).run(
    p.pairAddress,
    token,
    p.baseToken.symbol,
    p.baseToken.name,
    p.dexId,
    v.version,
    p.quoteToken.address,
    p.quoteToken.symbol,
    v.token0,
    v.token1,
    v.decimals0,
    v.decimals1,
    v.fee,
    liq,
    p.volume?.h24 ?? 0,
    now,
    now,
    p.info?.imageUrl ?? null,
    p.info?.header ?? null,
    p.info?.websites?.[0]?.url ?? null,
    socialUrl("twitter"),
    socialUrl("telegram"),
  );

  // Instant first snapshot + candle from the on-chain read, so quotes and the
  // chart work right away instead of "no snapshot" until the next poll.
  const price = poolPrice(v, tracked);
  db.prepare(`
    INSERT INTO snapshots (pair_address, ts, reserve0, reserve1, sqrt_price_x96, tick, liquidity, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.pairAddress, now,
    v.reserve0?.toString() ?? null, v.reserve1?.toString() ?? null,
    v.sqrtPriceX96?.toString() ?? null, v.tick ?? null, v.liquidity?.toString() ?? null,
    price,
  );
  const minute = now - (now % 60);
  db.prepare(`
    INSERT INTO candles (pair_address, minute, open, high, low, close, n)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(pair_address, minute) DO UPDATE SET
      high = MAX(high, excluded.close), low = MIN(low, excluded.close), close = excluded.close, n = n + 1
  `).run(p.pairAddress, minute, price, price, price, price);

  // Tag Pons launchpad tokens even when the pair came from dexscreener, so
  // the web can badge them and show graduation progress. One cheap RPC read;
  // failures just leave the tag off.
  let source: string | undefined;
  try {
    const pons = await lookupPonsToken(token);
    if (pons) {
      source = "pons";
      db.prepare("UPDATE pools SET source = 'pons' WHERE pair_address = ?").run(p.pairAddress);
    }
  } catch { /* tag only */ }

  return {
    address: token,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    pair: p.pairAddress,
    liquidityUsd: liq,
    thinLiquidity: liq < THIN_LIQ_USD,
    alreadyTracked: false,
    source,
  };
}

// Import a Pons launchpad token straight from its on-chain v3 pool. The pool
// is verified the same way as dex imports (slot0 read), so quoting, polling
// and charts all work through the existing v3 path. liquidity_usd stays 0
// until dexscreener picks the pair up, which keeps the thin-liquidity
// warning on (accurate for fresh launches).
// Exported for tests: dex imports fall into this when dexscreener has no
// pair yet for a fresh Pons launch.
export async function importPonsToken(
  db: DatabaseSync,
  pons: Awaited<ReturnType<typeof lookupPonsToken>> & object
): Promise<ImportResult> {
  const v = await verifyPoolOnChain(pons.pool, "v3");
  if (pons.token !== v.token0 && pons.token !== v.token1) {
    throw new ImportError("pons pool does not contain this token on-chain", 502);
  }
  const quoteToken = pons.token === v.token0 ? v.token1 : v.token0;
  let quoteSymbol = "WETH";
  try {
    quoteSymbol = String(
      await client.readContract({ address: quoteToken as `0x${string}`, abi: erc20Abi, functionName: "symbol" })
    );
  } catch { /* keep default */ }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO pools (pair_address, token_address, symbol, name, dex_id, version,
      quote_token, quote_symbol, token0, token1, decimals0, decimals1, fee,
      liquidity_usd, volume24h, active, imported, source,
      first_seen, last_seen, image_url, website, twitter, telegram)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 1, 'pons', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pair_address) DO UPDATE SET
      active = 1, imported = 1, source = 'pons', last_seen = excluded.last_seen,
      version = excluded.version, token0 = excluded.token0, token1 = excluded.token1,
      decimals0 = excluded.decimals0, decimals1 = excluded.decimals1, fee = excluded.fee
  `).run(
    pons.pool, pons.token, pons.symbol, pons.name, "pons", v.version,
    quoteToken, quoteSymbol, v.token0, v.token1, v.decimals0, v.decimals1, v.fee,
    now, now, pons.imageUrl, pons.website, pons.twitter, pons.telegram,
  );

  const price = poolPrice(v, pons.token);
  db.prepare(`
    INSERT INTO snapshots (pair_address, ts, reserve0, reserve1, sqrt_price_x96, tick, liquidity, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pons.pool, now,
    v.reserve0?.toString() ?? null, v.reserve1?.toString() ?? null,
    v.sqrtPriceX96?.toString() ?? null, v.tick ?? null, v.liquidity?.toString() ?? null,
    price,
  );
  const minute = now - (now % 60);
  db.prepare(`
    INSERT INTO candles (pair_address, minute, open, high, low, close, n)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(pair_address, minute) DO UPDATE SET
      high = MAX(high, excluded.close), low = MIN(low, excluded.close), close = excluded.close, n = n + 1
  `).run(pons.pool, minute, price, price, price, price);

  return {
    address: pons.token,
    symbol: pons.symbol,
    name: pons.name,
    pair: pons.pool,
    liquidityUsd: 0,
    thinLiquidity: true,
    alreadyTracked: false,
    source: "pons",
  };
}
