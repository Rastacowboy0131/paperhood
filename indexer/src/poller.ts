import type { Abi } from "viem";
import { db } from "./db.js";
import { client, pairAbi, erc20Abi, v2Abi, v3Abi } from "./chain.js";
import { v2QuotePerTracked, v3QuotePerTracked, PoolOrientation } from "./price.js";

type Pool = {
  pair_address: string;
  version: string;
  token_address: string;
  quote_token: string;
  token0: string | null;
  token1: string | null;
  decimals0: number | null;
  decimals1: number | null;
};

const getPools = db.prepare(
  `SELECT pair_address, version, token_address, quote_token, token0, token1, decimals0, decimals1
   FROM pools WHERE active=1`
);

const setPoolMeta = db.prepare(
  `UPDATE pools SET token0=@t0, token1=@t1, decimals0=@d0, decimals1=@d1 WHERE pair_address=@pair`
);

const insertSnap = db.prepare(`
INSERT INTO snapshots (pair_address, ts, reserve0, reserve1, sqrt_price_x96, tick, liquidity, price)
VALUES (@pair, @ts, @r0, @r1, @sqrt, @tick, @liq, @price)
`);

const upsertCandle = db.prepare(`
INSERT INTO candles (pair_address, minute, open, high, low, close, n)
VALUES (@pair, @minute, @p, @p, @p, @p, 1)
ON CONFLICT(pair_address, minute) DO UPDATE SET
  high = MAX(high, @p), low = MIN(low, @p), close = @p, n = n + 1
`);

const pruneSnaps = db.prepare(`DELETE FROM snapshots WHERE ts < ?`);

// Fill token0/token1 addresses and decimals for pools that lack them
// (freshly discovered pools). Fetched once, stored in the universe.
async function enrichPools(pools: Pool[]): Promise<void> {
  const missing = pools.filter((p) => p.token0 == null || p.decimals0 == null || p.decimals1 == null);
  if (missing.length === 0) return;

  const tokenCalls = missing.flatMap((p) => {
    const address = p.pair_address as `0x${string}`;
    return [
      { address, abi: pairAbi as Abi, functionName: "token0" },
      { address, abi: pairAbi as Abi, functionName: "token1" },
    ];
  });
  const tokenResults = await client.multicall({ contracts: tokenCalls, allowFailure: true });

  const resolved: { pool: Pool; t0: string; t1: string }[] = [];
  for (let i = 0; i < missing.length; i++) {
    const r0 = tokenResults[i * 2];
    const r1 = tokenResults[i * 2 + 1];
    if (r0.status !== "success" || r1.status !== "success") continue;
    resolved.push({
      pool: missing[i],
      t0: (r0.result as string).toLowerCase(),
      t1: (r1.result as string).toLowerCase(),
    });
  }
  if (resolved.length === 0) return;

  const decCalls = resolved.flatMap((r) => [
    { address: r.t0 as `0x${string}`, abi: erc20Abi as Abi, functionName: "decimals" },
    { address: r.t1 as `0x${string}`, abi: erc20Abi as Abi, functionName: "decimals" },
  ]);
  const decResults = await client.multicall({ contracts: decCalls, allowFailure: true });

  for (let i = 0; i < resolved.length; i++) {
    const d0r = decResults[i * 2];
    const d1r = decResults[i * 2 + 1];
    if (d0r.status !== "success" || d1r.status !== "success") continue;
    const { pool, t0, t1 } = resolved[i];
    const d0 = Number(d0r.result);
    const d1 = Number(d1r.result);
    setPoolMeta.run({ pair: pool.pair_address, t0, t1, d0, d1 });
    pool.token0 = t0;
    pool.token1 = t1;
    pool.decimals0 = d0;
    pool.decimals1 = d1;
  }
}

function orientation(p: Pool): PoolOrientation | null {
  if (p.token0 == null || p.token1 == null || p.decimals0 == null || p.decimals1 == null) return null;
  const tracked = p.token_address.toLowerCase();
  if (tracked !== p.token0 && tracked !== p.token1) return null;
  return { trackedIsToken0: tracked === p.token0, decimals0: p.decimals0, decimals1: p.decimals1 };
}

export async function pollOnce(): Promise<number> {
  const pools = getPools.all() as Pool[];
  if (pools.length === 0) return 0;

  await enrichPools(pools);
  const ready = pools.filter((p) => orientation(p) != null);
  if (ready.length === 0) return 0;

  type Call = { address: `0x${string}`; abi: Abi; functionName: string };
  const contracts: Call[] = ready.flatMap((p): Call[] => {
    const address = p.pair_address as `0x${string}`;
    return p.version === "v2"
      ? [{ address, abi: v2Abi, functionName: "getReserves" }]
      : [
          { address, abi: v3Abi, functionName: "slot0" },
          { address, abi: v3Abi, functionName: "liquidity" },
        ];
  });

  const results = await client.multicall({ contracts, allowFailure: true });

  const ts = Math.floor(Date.now() / 1000);
  const minute = ts - (ts % 60);
  let ok = 0;
  let i = 0;
  db.exec("BEGIN");
  try {
    for (const p of ready) {
      const o = orientation(p)!;
      if (p.version === "v2") {
        const r = results[i++];
        if (r.status !== "success") continue;
        const [r0, r1] = r.result as readonly [bigint, bigint, number];
        const price = v2QuotePerTracked(r0, r1, o);
        insertSnap.run({ pair: p.pair_address, ts, r0: r0.toString(), r1: r1.toString(), sqrt: null, tick: null, liq: null, price });
        upsertCandle.run({ pair: p.pair_address, minute, p: price });
        ok++;
      } else {
        const s = results[i++];
        const l = results[i++];
        if (s.status !== "success" || l.status !== "success") continue;
        const slot0 = s.result as readonly [bigint, number, ...unknown[]];
        const sqrt = slot0[0];
        const tick = slot0[1];
        const liq = l.result as bigint;
        const price = v3QuotePerTracked(sqrt, o);
        insertSnap.run({ pair: p.pair_address, ts, r0: null, r1: null, sqrt: sqrt.toString(), tick, liq: liq.toString(), price });
        upsertCandle.run({ pair: p.pair_address, minute, p: price });
        ok++;
      }
    }
    pruneSnaps.run(ts - 24 * 3600);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return ok;
}
