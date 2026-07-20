import test from "node:test";
import assert from "node:assert/strict";
import { v2QuotePerTracked, v3QuotePerTracked } from "../src/price.js";

// Helper: sqrtPriceX96 for a given token1-per-token0 raw price.
function sqrtX96(rawPrice: number): bigint {
  return BigInt(Math.round(Math.sqrt(rawPrice) * 2 ** 96));
}

test("v2: tracked token is token0, equal decimals", () => {
  // Pool: 1000 TOK (18d) vs 10 WETH (18d) -> 0.01 WETH per TOK
  const o = { trackedIsToken0: true, decimals0: 18, decimals1: 18 };
  const p = v2QuotePerTracked(1000n * 10n ** 18n, 10n * 10n ** 18n, o);
  assert.ok(Math.abs(p - 0.01) < 1e-12);
});

test("v2: tracked token is token1, equal decimals", () => {
  // Pool: token0 = 10 WETH, token1 = 1000 TOK, tracked is token1
  // raw token1/token0 = 100 TOK per WETH -> inverted: 0.01 WETH per TOK
  const o = { trackedIsToken0: false, decimals0: 18, decimals1: 18 };
  const p = v2QuotePerTracked(10n * 10n ** 18n, 1000n * 10n ** 18n, o);
  assert.ok(Math.abs(p - 0.01) < 1e-12);
});

test("v2: tracked token0 with 6 decimals vs WETH 18 decimals", () => {
  // 1,000,000 USDC (6d) vs 500 WETH (18d) -> 0.0005 WETH per USDC
  const o = { trackedIsToken0: true, decimals0: 6, decimals1: 18 };
  const p = v2QuotePerTracked(1_000_000n * 10n ** 6n, 500n * 10n ** 18n, o);
  assert.ok(Math.abs(p - 0.0005) < 1e-15);
});

test("v2: tracked token1 with 6 decimals, quote token0 18 decimals", () => {
  // token0 = 500 WETH (18d), token1 = 1,000,000 USDC (6d), tracked token1
  // want 0.0005 WETH per USDC
  const o = { trackedIsToken0: false, decimals0: 18, decimals1: 6 };
  const p = v2QuotePerTracked(500n * 10n ** 18n, 1_000_000n * 10n ** 6n, o);
  assert.ok(Math.abs(p - 0.0005) / 0.0005 < 1e-9);
});

test("v3: tracked token is token0, equal decimals", () => {
  // raw price 0.05 token1 per token0, both 18d -> 0.05 quote per tracked
  const o = { trackedIsToken0: true, decimals0: 18, decimals1: 18 };
  const p = v3QuotePerTracked(sqrtX96(0.05), o);
  assert.ok(Math.abs(p - 0.05) / 0.05 < 1e-6);
});

test("v3: tracked token is token1, equal decimals (HOOD case)", () => {
  // Pool token0 = HOOD (tracked? no) ... simulate the live bug: raw
  // token1/token0 = 18.57 with tracked as token1 -> price = 1/18.57
  const o = { trackedIsToken0: false, decimals0: 18, decimals1: 18 };
  const p = v3QuotePerTracked(sqrtX96(18.57), o);
  assert.ok(Math.abs(p - 1 / 18.57) / (1 / 18.57) < 1e-6);
});

test("v3: tracked token0 with 6 decimals vs 18 decimal quote", () => {
  // Want 0.0005 WETH per USDC. token1/token0 human = 0.0005, raw = human * 10^(d1-d0) = 0.0005 * 1e12
  const o = { trackedIsToken0: true, decimals0: 6, decimals1: 18 };
  const p = v3QuotePerTracked(sqrtX96(0.0005 * 1e12), o);
  assert.ok(Math.abs(p - 0.0005) / 0.0005 < 1e-6);
});

test("v3: tracked token1 with 8 decimals, quote token0 18 decimals", () => {
  // Human price target: 2 WETH per TOK (8d). token1PerToken0 human = 0.5 TOK per WETH.
  // raw = human * 10^(d1-d0) = 0.5 * 10^(8-18) = 0.5e-10
  const o = { trackedIsToken0: false, decimals0: 18, decimals1: 8 };
  const p = v3QuotePerTracked(sqrtX96(0.5e-10), o);
  assert.ok(Math.abs(p - 2) / 2 < 1e-6);
});

test("v2: zero reserves yields 0, not Infinity", () => {
  const o = { trackedIsToken0: false, decimals0: 18, decimals1: 18 };
  assert.equal(v2QuotePerTracked(0n, 0n, o), 0);
});
