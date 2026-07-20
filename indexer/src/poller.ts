import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { db } from "./db.js";

const RPC = process.env.RH_RPC_HTTP;
if (!RPC) throw new Error("RH_RPC_HTTP not set");

const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC, { batch: true }),
});

const v2Abi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);
const v3Abi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

type Pool = {
  pair_address: string;
  version: string;
  token_address: string;
  quote_token: string;
};

const getPools = db.prepare(
  `SELECT pair_address, version, token_address, quote_token FROM pools WHERE active=1`
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

// Raw price proxy. For v2: reserve1/reserve0 (no decimal adjustment yet, the
// sim engine works from raw reserves anyway). For v3: (sqrtPriceX96/2^96)^2.
function v3Price(sqrt: bigint): number {
  const s = Number(sqrt) / 2 ** 96;
  return s * s;
}

export async function pollOnce(): Promise<number> {
  const pools = getPools.all() as Pool[];
  if (pools.length === 0) return 0;

  type Call = { address: `0x${string}`; abi: import("viem").Abi; functionName: string };
  const contracts: Call[] = pools.flatMap((p): Call[] => {
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
    for (const p of pools) {
      if (p.version === "v2") {
        const r = results[i++];
        if (r.status !== "success") continue;
        const [r0, r1] = r.result as readonly [bigint, bigint, number];
        const price = r0 > 0n ? Number(r1) / Number(r0) : 0;
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
        const price = v3Price(sqrt);
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
