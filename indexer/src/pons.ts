// Pons launchpad tagging: mark pools whose tracked token was launched via
// the PonsLaunchFactory (0xA5aA..1feB) with source="pons". Pons launches are
// real Uniswap v3 pools from block one (no bonding curve; graduation is a
// fee milestone on the locked position), so pricing and polling already work
// through the normal v3 path. This pass only adds the tag, checked once per
// pool via multicall against getLaunchedToken().
import type { Abi } from "viem";
import { parseAbi } from "viem";
import { db } from "./db.js";
import { client } from "./chain.js";

const PONS_FACTORY = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB" as const;

const ponsFactoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount) launched)",
]);

// Pools not yet checked (source is NULL). Once checked, source is either
// "pons" or "dex" so we never re-read.
const getUnchecked = db.prepare(
  `SELECT pair_address, token_address FROM pools WHERE active = 1 AND source IS NULL LIMIT 200`
);
const setSource = db.prepare(`UPDATE pools SET source = ? WHERE pair_address = ?`);

export async function tagPonsPools(): Promise<number> {
  const rows = getUnchecked.all() as { pair_address: string; token_address: string }[];
  if (rows.length === 0) return 0;

  const contracts = rows.map((r) => ({
    address: PONS_FACTORY as `0x${string}`,
    abi: ponsFactoryAbi as Abi,
    functionName: "getLaunchedToken",
    args: [r.token_address as `0x${string}`],
  }));
  const results = await client.multicall({ contracts, allowFailure: true });

  let tagged = 0;
  db.exec("BEGIN");
  try {
    for (let i = 0; i < rows.length; i++) {
      const res = results[i];
      if (res.status !== "success") continue; // retry next pass
      const launched = res.result as { exists: boolean };
      const src = launched.exists ? "pons" : "dex";
      setSource.run(src, rows[i].pair_address);
      if (src === "pons") tagged++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (tagged > 0) console.log(`pons: tagged ${tagged} launchpad pools`);
  return tagged;
}
