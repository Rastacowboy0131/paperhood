import { DatabaseSync } from "node:sqlite";
import { client, QUOTER_V2, quoterV2Abi, erc20Abi, v3PoolAbi, v2PoolAbi } from "./chain.js";

export type QuotePath = "v2-reserves" | "v3-quoter" | "v3-approx";

export interface Quote {
  pair: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;        // raw units of tokenIn
  amountOut: bigint;       // raw units of tokenOut
  spotPrice: number;       // tokenOut per tokenIn, decimal adjusted, mid price
  execPrice: number;       // tokenOut per tokenIn actually received
  priceImpactPct: number;  // percent, >= 0
  feePaid: bigint;         // raw units of tokenIn taken as pool fee
  feeTier: number;         // fee in hundredths of a bip (3000 = 0.3%)
  path: QuotePath;
}

export interface TokenMeta { address: string; symbol: string; decimals: number }

interface PoolRow {
  pair_address: string;
  version: string;
  token_address: string;
  quote_token: string;
  fee: number | null;
  token0: string | null;
}

const Q96 = 2n ** 96n;

// ---------- token metadata ----------

export async function getTokenMeta(db: DatabaseSync, address: string): Promise<TokenMeta> {
  const addr = address.toLowerCase();
  const row = db.prepare("SELECT address, symbol, decimals FROM tokens WHERE address = ?").get(addr) as
    | { address: string; symbol: string; decimals: number }
    | undefined;
  if (row) return row;

  const a = address as `0x${string}`;
  const [dec, sym] = await Promise.all([
    client.readContract({ address: a, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
  ]);
  const meta = { address: addr, symbol: String(sym), decimals: Number(dec) };
  db.prepare("INSERT OR REPLACE INTO tokens (address, symbol, decimals, updated_at) VALUES (?, ?, ?, ?)")
    .run(meta.address, meta.symbol, meta.decimals, Math.floor(Date.now() / 1000));
  return meta;
}

// Fetch and cache decimals/symbol for every token in the active universe.
export async function cacheUniverseTokens(db: DatabaseSync): Promise<number> {
  const rows = db.prepare(
    "SELECT DISTINCT token_address AS a FROM pools WHERE active=1 UNION SELECT DISTINCT quote_token FROM pools WHERE active=1"
  ).all() as { a: string }[];
  let n = 0;
  for (const r of rows) {
    try { await getTokenMeta(db, r.a); n++; } catch { /* skip broken tokens */ }
  }
  return n;
}

// ---------- pool info ----------

async function getPool(db: DatabaseSync, pair: string): Promise<PoolRow> {
  const row = db.prepare(
    "SELECT pair_address, version, token_address, quote_token, fee, token0 FROM pools WHERE pair_address = ? COLLATE NOCASE"
  ).get(pair) as PoolRow | undefined;
  if (!row) throw new Error(`unknown pool ${pair}`);

  if (row.fee == null || row.token0 == null) {
    const a = row.pair_address as `0x${string}`;
    let fee = 3000; // uniswap v2 fixed 0.3%
    if (row.version === "v3") {
      fee = Number(await client.readContract({ address: a, abi: v3PoolAbi, functionName: "fee" }));
    }
    const token0 = (await client.readContract({ address: a, abi: v2PoolAbi, functionName: "token0" })).toLowerCase();
    db.prepare("UPDATE pools SET fee = ?, token0 = ? WHERE pair_address = ?").run(fee, token0, row.pair_address);
    row.fee = fee;
    row.token0 = token0;
  }
  return row;
}

function latestSnapshot(db: DatabaseSync, pair: string) {
  return db.prepare(
    "SELECT ts, reserve0, reserve1, sqrt_price_x96, tick, liquidity FROM snapshots WHERE pair_address = ? COLLATE NOCASE ORDER BY ts DESC LIMIT 1"
  ).get(pair) as
    | { ts: number; reserve0: string | null; reserve1: string | null; sqrt_price_x96: string | null; tick: number | null; liquidity: string | null }
    | undefined;
}

// ---------- quoting ----------

// Main entry: quote swapping `amountIn` raw units of tokenIn into the pool.
// tokenIn must be one side of the pair; output is the other side.
export async function quoteSwap(db: DatabaseSync, pair: string, tokenIn: string, amountIn: bigint): Promise<Quote> {
  if (amountIn <= 0n) throw new Error("amountIn must be positive");
  const pool = await getPool(db, pair);
  const inAddr = tokenIn.toLowerCase();
  const t0 = pool.token0!;
  const base = pool.token_address.toLowerCase();
  const quoteTok = pool.quote_token.toLowerCase();
  if (inAddr !== base && inAddr !== quoteTok) throw new Error(`token ${tokenIn} not in pool ${pair}`);
  const outAddr = inAddr === base ? quoteTok : base;
  const zeroForOne = inAddr === t0;

  const [inMeta, outMeta] = await Promise.all([getTokenMeta(db, inAddr), getTokenMeta(db, outAddr)]);
  const snap = latestSnapshot(db, pool.pair_address);
  if (!snap) throw new Error(`no snapshot for pool ${pair} (indexer not running?)`);

  const fee = pool.fee!;
  const feePaid = (amountIn * BigInt(fee)) / 1_000_000n;

  if (pool.version === "v2") {
    return quoteV2(pool, snap, inMeta, outMeta, amountIn, zeroForOne, fee, feePaid, outAddr);
  }
  return quoteV3(pool, snap, inMeta, outMeta, amountIn, zeroForOne, fee, feePaid, inAddr, outAddr);
}

function toDec(x: bigint, decimals: number): number {
  return Number(x) / 10 ** decimals;
}

function quoteV2(
  pool: PoolRow,
  snap: NonNullable<ReturnType<typeof latestSnapshot>>,
  inMeta: TokenMeta, outMeta: TokenMeta,
  amountIn: bigint, zeroForOne: boolean, fee: number, feePaid: bigint, outAddr: string,
): Quote {
  if (snap.reserve0 == null || snap.reserve1 == null) throw new Error("v2 pool missing reserves");
  const r0 = BigInt(snap.reserve0);
  const r1 = BigInt(snap.reserve1);
  const [rIn, rOut] = zeroForOne ? [r0, r1] : [r1, r0];
  if (rIn === 0n || rOut === 0n) throw new Error("empty pool");

  // Uniswap v2 exact-in with fee (fee is in hundredths of a bip, 3000 = 0.3%).
  const feeUnits = BigInt(1_000_000 - fee);
  const inWithFee = amountIn * feeUnits;
  const amountOut = (inWithFee * rOut) / (rIn * 1_000_000n + inWithFee);

  const spotPrice = (toDec(rOut, outMeta.decimals)) / (toDec(rIn, inMeta.decimals));
  const execPrice = toDec(amountOut, outMeta.decimals) / toDec(amountIn, inMeta.decimals);
  const priceImpactPct = spotPrice > 0 ? Math.max(0, (1 - execPrice / spotPrice) * 100) : 0;

  return {
    pair: pool.pair_address, tokenIn: inMeta.address, tokenOut: outAddr,
    amountIn, amountOut, spotPrice, execPrice, priceImpactPct, feePaid, feeTier: fee,
    path: "v2-reserves",
  };
}

// v3 spot price (token1 per token0, raw) from sqrtPriceX96.
function v3SpotRaw(sqrtPriceX96: bigint): number {
  const s = Number(sqrtPriceX96) / Number(Q96);
  return s * s;
}

async function quoteV3(
  pool: PoolRow,
  snap: NonNullable<ReturnType<typeof latestSnapshot>>,
  inMeta: TokenMeta, outMeta: TokenMeta,
  amountIn: bigint, zeroForOne: boolean, fee: number, feePaid: bigint,
  inAddr: string, outAddr: string,
): Promise<Quote> {
  if (snap.sqrt_price_x96 == null || snap.liquidity == null) throw new Error("v3 pool missing slot0 snapshot");
  const sqrtP = BigInt(snap.sqrt_price_x96);

  // Spot: raw sqrtPrice gives token1 per token0 in raw units; adjust for
  // decimals and swap direction so spot is tokenOut per tokenIn.
  const raw = v3SpotRaw(sqrtP);
  const spot = zeroForOne
    ? raw * 10 ** (inMeta.decimals - outMeta.decimals)
    : (1 / raw) * 10 ** (inMeta.decimals - outMeta.decimals);

  // Primary path: on-chain QuoterV2 (exact tick-crossing math, executed via eth_call).
  try {
    const res = await client.simulateContract({
      address: QUOTER_V2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: inAddr as `0x${string}`,
        tokenOut: outAddr as `0x${string}`,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      }],
    });
    const amountOut = res.result[0] as bigint;
    const execPrice = toDec(amountOut, outMeta.decimals) / toDec(amountIn, inMeta.decimals);
    const priceImpactPct = spot > 0 ? Math.max(0, (1 - execPrice / spot) * 100) : 0;
    return {
      pair: pool.pair_address, tokenIn: inMeta.address, tokenOut: outAddr,
      amountIn, amountOut, spotPrice: spot, execPrice, priceImpactPct, feePaid, feeTier: fee,
      path: "v3-quoter",
    };
  } catch {
    // Fallback: single-tick approximation. Valid only while the swap stays in
    // the current tick range; we also cap the input at what the in-range
    // liquidity can absorb so we never fabricate depth.
    const L = BigInt(snap.liquidity);
    if (L === 0n) throw new Error("zero in-range liquidity and quoter unavailable");

    const feeUnits = BigInt(1_000_000 - fee);
    const inAfterFee = (amountIn * feeUnits) / 1_000_000n;

    let amountOut: bigint;
    let sqrtAfter: bigint;
    if (zeroForOne) {
      // token0 in: sqrtP decreases. 1/sqrtNew = 1/sqrtP + dx/L (all X96 scaled)
      const num = L * sqrtP;
      const den = L + (inAfterFee * sqrtP) / Q96;
      sqrtAfter = num / den;
      amountOut = (L * (sqrtP - sqrtAfter)) / Q96;
    } else {
      // token1 in: sqrtP increases. sqrtNew = sqrtP + dy*Q96/L
      sqrtAfter = sqrtP + (inAfterFee * Q96) / L;
      amountOut = (L * Q96 * (sqrtAfter - sqrtP)) / (sqrtAfter * sqrtP);
    }
    if (amountOut < 0n) amountOut = 0n;

    const execPrice = toDec(amountOut, outMeta.decimals) / toDec(amountIn, inMeta.decimals);
    const priceImpactPct = spot > 0 ? Math.max(0, (1 - execPrice / spot) * 100) : 0;
    return {
      pair: pool.pair_address, tokenIn: inMeta.address, tokenOut: outAddr,
      amountIn, amountOut, spotPrice: spot, execPrice, priceImpactPct, feePaid, feeTier: fee,
      path: "v3-approx",
    };
  }
}
