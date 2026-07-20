// Price normalization: convert raw pool state into "quote tokens per 1
// tracked token", decimal adjusted, regardless of whether the tracked token
// is token0 or token1 in the pool.

export interface PoolOrientation {
  trackedIsToken0: boolean;
  decimals0: number;
  decimals1: number;
}

// token1 per token0 in human units, from raw v2 reserves.
function v2Token1PerToken0(r0: bigint, r1: bigint, d0: number, d1: number): number {
  if (r0 === 0n) return 0;
  return (Number(r1) / Number(r0)) * 10 ** (d0 - d1);
}

// token1 per token0 in human units, from v3 sqrtPriceX96.
// (sqrtPriceX96 / 2^96)^2 = token1 per token0 in raw units.
function v3Token1PerToken0(sqrtPriceX96: bigint, d0: number, d1: number): number {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  return s * s * 10 ** (d0 - d1);
}

function orient(token1PerToken0: number, o: PoolOrientation): number {
  if (o.trackedIsToken0) return token1PerToken0;
  return token1PerToken0 > 0 ? 1 / token1PerToken0 : 0;
}

// Quote tokens per 1 tracked token from v2 reserves.
export function v2QuotePerTracked(r0: bigint, r1: bigint, o: PoolOrientation): number {
  return orient(v2Token1PerToken0(r0, r1, o.decimals0, o.decimals1), o);
}

// Quote tokens per 1 tracked token from v3 sqrtPriceX96.
export function v3QuotePerTracked(sqrtPriceX96: bigint, o: PoolOrientation): number {
  return orient(v3Token1PerToken0(sqrtPriceX96, o.decimals0, o.decimals1), o);
}
