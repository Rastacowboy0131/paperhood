// Platform fee totals shown on the leaderboard page.
// Current source: env vars set manually by Rasta (FEES_SUPPLY_TOTAL and
// FEES_ETH_TOTAL). This module is the single seam for the data source, so an
// on-chain reader (fee wallet + token CA) can replace envFeeSource() later
// without touching the API route or the web client.

export interface FeeTotals {
  supplyCollected: number; // SUPPLY tokens collected in fees
  ethCollected: number; // ETH collected in fees
  source: "manual" | "onchain";
  updatedAt: number | null; // unix seconds, null when never set
}

export type FeeSource = () => FeeTotals;

function parseNum(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Manual env-based source. FEES_UPDATED_AT is optional (unix seconds).
export function envFeeSource(): FeeTotals {
  const updated = Number(process.env.FEES_UPDATED_AT);
  return {
    supplyCollected: parseNum(process.env.FEES_SUPPLY_TOTAL),
    ethCollected: parseNum(process.env.FEES_ETH_TOTAL),
    source: "manual",
    updatedAt: Number.isFinite(updated) && updated > 0 ? updated : null,
  };
}

// Active source. Swap this for an on-chain reader when available.
export const getFeeTotals: FeeSource = envFeeSource;
