// Live quote sanity tests against real Robinhood chain pools.
// Requires: RH_RPC_HTTP (loaded from .env.local by chain.ts) and a populated
// indexer db with recent snapshots.
import { test } from "node:test";
import assert from "node:assert";
import { openDb } from "../src/db.js";
import { quoteSwap } from "../src/quote.js";

const db = openDb();

function topPool(version: string) {
  return db.prepare(
    `SELECT p.pair_address, p.token_address, p.quote_token, p.symbol FROM pools p
     WHERE p.active=1 AND p.version=? AND EXISTS
       (SELECT 1 FROM snapshots s WHERE s.pair_address = p.pair_address)
     ORDER BY p.liquidity_usd DESC LIMIT 1`
  ).get(version) as { pair_address: string; token_address: string; quote_token: string; symbol: string } | undefined;
}

test("v3 live quote: non-zero out, impact grows with size", async () => {
  const pool = topPool("v3");
  assert.ok(pool, "no v3 pool with snapshots; run the indexer first");
  const small = await quoteSwap(db, pool.pair_address, pool.quote_token, 10n ** 17n); // 0.1 WETH
  const big = await quoteSwap(db, pool.pair_address, pool.quote_token, 10n * 10n ** 18n); // 10 WETH

  console.log(`v3 ${pool.symbol} small:`, fmt(small), "big:", fmt(big));
  assert.ok(small.amountOut > 0n, "small quote zero out");
  assert.ok(big.amountOut > 0n, "big quote zero out");
  assert.ok(small.execPrice > 0 && small.spotPrice > 0);
  assert.ok(big.priceImpactPct > small.priceImpactPct, "impact should grow with size");
  assert.ok(small.priceImpactPct < 50, "small trade impact implausibly high");
  assert.ok(small.feePaid > 0n);
});

test("v2 live quote: non-zero out, impact grows with size", async () => {
  const pool = topPool("v2");
  assert.ok(pool, "no v2 pool with snapshots; run the indexer first");
  const small = await quoteSwap(db, pool.pair_address, pool.quote_token, 10n ** 16n); // 0.01 WETH
  const big = await quoteSwap(db, pool.pair_address, pool.quote_token, 5n * 10n ** 18n); // 5 WETH

  console.log(`v2 ${pool.symbol} small:`, fmt(small), "big:", fmt(big));
  assert.equal(small.path, "v2-reserves");
  assert.ok(small.amountOut > 0n && big.amountOut > 0n);
  assert.ok(big.priceImpactPct > small.priceImpactPct, "impact should grow with size");
});

test("v3 round trip loses money (fees + impact)", async () => {
  const pool = topPool("v3");
  assert.ok(pool);
  const inAmt = 10n ** 18n;
  const q1 = await quoteSwap(db, pool.pair_address, pool.quote_token, inAmt);
  const q2 = await quoteSwap(db, pool.pair_address, pool.token_address, q1.amountOut);
  assert.ok(q2.amountOut < inAmt, "round trip should lose to fees and impact");
});

function fmt(q: { amountOut: bigint; execPrice: number; priceImpactPct: number; path: string }) {
  return { out: q.amountOut.toString(), exec: q.execPrice, impactPct: +q.priceImpactPct.toFixed(4), path: q.path };
}
