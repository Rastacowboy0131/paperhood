// Total supply reader for tracked tokens. Reads totalSupply (and decimals)
// via multicall, stores the decimal-adjusted value on every pool row for the
// token, and refreshes periodically. Failures leave the old value in place.
import type { Abi } from "viem";
import { db } from "./db.js";
import { client, erc20Abi } from "./chain.js";

const REFRESH_S = Number(process.env.SUPPLY_REFRESH_S ?? 6 * 3600);

const getStale = db.prepare(`
  SELECT DISTINCT token_address FROM pools
  WHERE active = 1 AND (supply_ts IS NULL OR supply_ts < ?)
`);

const setSupply = db.prepare(
  `UPDATE pools SET total_supply = @supply, supply_ts = @ts WHERE token_address = @token COLLATE NOCASE`
);

export async function refreshSupplies(): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const stale = (getStale.all(now - REFRESH_S) as { token_address: string }[])
    .map((r) => r.token_address);
  if (stale.length === 0) return 0;

  const contracts = stale.flatMap((token) => {
    const address = token as `0x${string}`;
    return [
      { address, abi: erc20Abi as Abi, functionName: "totalSupply" },
      { address, abi: erc20Abi as Abi, functionName: "decimals" },
    ];
  });
  const results = await client.multicall({ contracts, allowFailure: true });

  let ok = 0;
  db.exec("BEGIN");
  try {
    for (let i = 0; i < stale.length; i++) {
      const sup = results[i * 2];
      const dec = results[i * 2 + 1];
      if (sup.status !== "success" || dec.status !== "success") continue;
      const supply = Number(sup.result as bigint) / 10 ** Number(dec.result);
      if (!Number.isFinite(supply)) continue;
      setSupply.run({ token: stale[i], supply, ts: now });
      ok++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  console.log(`supply: refreshed ${ok}/${stale.length} tokens`);
  return ok;
}
