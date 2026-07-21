// Ledger unit tests using an in-memory db and a fake v2 pool.
// No network calls: pool fee/token0, token metadata, and the ETH/USD rate are
// all pre-seeded so quoteSwap runs purely from the snapshot.
import { test } from "node:test";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/db.js";
import {
  getOrCreateUser, getSeasonId, seasonStart, buy, sell, cashBalanceUsd,
  positionQty, getPortfolio, setEthUsdForTest, STARTING_BALANCE_USD, realizedPnl, maxBuyTokens,
} from "../src/ledger.js";
import { weeklyLeaderboard, dailyLeaderboard, windowLeaderboard } from "../src/leaderboard.js";

const WETH = "0x00000000000000000000000000000000000000aa";
const MEME = "0x00000000000000000000000000000000000000bb";
const PAIR = "0x00000000000000000000000000000000000000cc";

function fakeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  // Minimal pools/snapshots schema matching the indexer.
  db.exec(`
CREATE TABLE pools (
  pair_address TEXT PRIMARY KEY, token_address TEXT, symbol TEXT, name TEXT,
  dex_id TEXT, version TEXT, quote_token TEXT, quote_symbol TEXT,
  liquidity_usd REAL, volume24h REAL, active INTEGER DEFAULT 1,
  first_seen INTEGER, last_seen INTEGER
);
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, pair_address TEXT, ts INTEGER,
  reserve0 TEXT, reserve1 TEXT, sqrt_price_x96 TEXT, tick INTEGER, liquidity TEXT, price REAL
);`);
  migrate(db);
  // Fake pool: MEME/WETH v2, token0 = WETH. 100 WETH + 1,000,000 MEME.
  db.prepare(
    "INSERT INTO pools (pair_address, token_address, symbol, version, quote_token, quote_symbol, liquidity_usd, active, fee, token0) VALUES (?,?,?,?,?,?,?,1,3000,?)"
  ).run(PAIR, MEME, "MEME", "v2", WETH, "WETH", 500000, WETH);
  db.prepare("INSERT INTO snapshots (pair_address, ts, reserve0, reserve1) VALUES (?,?,?,?)")
    .run(PAIR, Math.floor(Date.now() / 1000), (100n * 10n ** 18n).toString(), (1_000_000n * 10n ** 18n).toString());
  // Token metadata cache (skip chain fetch).
  const ins = db.prepare("INSERT INTO tokens (address, symbol, decimals, updated_at) VALUES (?,?,?,0)");
  ins.run(WETH, "WETH", 18);
  ins.run(MEME, "MEME", 18);
  setEthUsdForTest(db, 2500); // 1 ETH = $2500
  return db;
}

test("user starts with 10k and buys reduce cash", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000001");
  const season = getSeasonId(db);
  assert.equal(cashBalanceUsd(db, uid, season), STARTING_BALANCE_USD);

  const r = await buy(db, uid, PAIR, MEME, 1000);
  assert.ok(r.tokensOut > 0n);
  assert.ok(Math.abs(cashBalanceUsd(db, uid, season) - 9000) < 1e-6);
  assert.equal(positionQty(db, uid, season, MEME), r.tokensOut);
});

test("cannot overspend or oversell", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000002");
  await assert.rejects(() => buy(db, uid, PAIR, MEME, 10001), /insufficient balance/);
  await assert.rejects(() => sell(db, uid, PAIR, MEME, 1n), /insufficient position/);
});

test("sell realizes PnL with FIFO cost basis", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000003");
  const season = getSeasonId(db);
  const b = await buy(db, uid, PAIR, MEME, 1000);

  // Immediate round trip should realize a small loss (2x fee + impact).
  const s = await sell(db, uid, PAIR, MEME, b.tokensOut);
  assert.ok(s.realizedPnlUsd < 0, `expected loss, got ${s.realizedPnlUsd}`);
  assert.ok(s.realizedPnlUsd > -100, "loss implausibly large for $1000 trade");
  assert.equal(positionQty(db, uid, season, MEME), 0n);
  const cash = cashBalanceUsd(db, uid, season);
  assert.ok(Math.abs(cash - (STARTING_BALANCE_USD + s.realizedPnlUsd)) < 1e-6);
  assert.ok(Math.abs(realizedPnl(db, uid, season) - s.realizedPnlUsd) < 1e-6);
});

test("price moves create profit; FIFO uses oldest lots first", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000004");
  const b1 = await buy(db, uid, PAIR, MEME, 1000);

  // Pump the pool: MEME price in WETH quadruples (reserves shift).
  db.prepare("INSERT INTO snapshots (pair_address, ts, reserve0, reserve1) VALUES (?,?,?,?)")
    .run(PAIR, Math.floor(Date.now() / 1000) + 10, (200n * 10n ** 18n).toString(), (500_000n * 10n ** 18n).toString());

  const b2 = await buy(db, uid, PAIR, MEME, 1000); // second lot at higher price
  const s = await sell(db, uid, PAIR, MEME, b1.tokensOut); // sells oldest (cheap) lot first
  assert.ok(s.realizedPnlUsd > 0, `expected profit selling cheap lot, got ${s.realizedPnlUsd}`);
  void b2;

  const pf = await getPortfolio(db, uid);
  assert.ok(pf.positions.length === 1);
  assert.ok(pf.positions[0].markUsd > 0);
  assert.ok(pf.cashEth > 0 && Math.abs(pf.cashEth * 2500 - pf.cashUsd) < 1e-6, "ETH denomination consistent");
});

test("leaderboards rank by realized PnL pct", async () => {
  const db = fakeDb();
  const winner = getOrCreateUser(db, "0x1111111111111111111111111111111111111111");
  const loser = getOrCreateUser(db, "0x2222222222222222222222222222222222222222");

  // Loser: round trip at flat price = small loss.
  const lb = await buy(db, loser, PAIR, MEME, 1000);
  await sell(db, loser, PAIR, MEME, lb.tokensOut);

  // Winner: buy, pump, sell.
  const wb = await buy(db, winner, PAIR, MEME, 1000);
  db.prepare("INSERT INTO snapshots (pair_address, ts, reserve0, reserve1) VALUES (?,?,?,?)")
    .run(PAIR, Math.floor(Date.now() / 1000) + 20, (200n * 10n ** 18n).toString(), (500_000n * 10n ** 18n).toString());
  await sell(db, winner, PAIR, MEME, wb.tokensOut);

  const weekly = weeklyLeaderboard(db);
  assert.equal(weekly.length, 2);
  assert.equal(weekly[0].address, "0x1111111111111111111111111111111111111111");
  assert.ok(weekly[0].pnlPct > 0 && weekly[1].pnlPct < 0);

  const daily = dailyLeaderboard(db);
  assert.equal(daily[0].address, "0x1111111111111111111111111111111111111111");

  // Windowed leaderboard: all three windows include both traders (trades are
  // fresh), winner ranked first by realized PnL USD.
  for (const w of ["1d", "7d", "all"] as const) {
    const lb = windowLeaderboard(db, w);
    assert.equal(lb.length, 2, `window ${w}`);
    assert.equal(lb[0].address, "0x1111111111111111111111111111111111111111");
    assert.ok(lb[0].realizedPnlUsd > 0 && lb[1].realizedPnlUsd < 0);
    assert.ok(lb[0].trades >= 2);
  }
  // A window starting in the future excludes everyone.
  const future = windowLeaderboard(db, "1d", Math.floor(Date.now() / 1000) + 10 * 86400);
  assert.equal(future.length, 0);
});

test("season boundaries are the 1st of the month 00:00 UTC", () => {
  const first = Date.UTC(2026, 6, 1) / 1000; // 2026-07-01
  assert.equal(seasonStart(first), first);
  assert.equal(seasonStart(first + 19 * 86400 + 12345), first); // mid-month
  assert.equal(seasonStart(first - 1), Date.UTC(2026, 5, 1) / 1000); // June 30 23:59:59 is prior season
});

test("max buy cap: min(3.5% of supply, 35M tokens)", async () => {
  assert.equal(maxBuyTokens(null), 35_000_000);
  assert.equal(maxBuyTokens(0), 35_000_000);
  assert.equal(maxBuyTokens(2_000_000_000), 35_000_000);      // 3.5% = 70M, abs cap wins
  assert.equal(maxBuyTokens(100_000_000), 3_500_000);         // 3.5% wins
  assert.equal(maxBuyTokens(1_000_000_000), 35_000_000);      // exactly at the abs cap

  // Enforcement: tiny supply makes the pct cap trip on a normal-size buy.
  const db = fakeDb();
  db.exec("ALTER TABLE pools ADD COLUMN total_supply REAL");
  db.prepare("UPDATE pools SET total_supply = ? WHERE pair_address = ?").run(100_000, PAIR);
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000005");
  // $1000 buys ~3960 MEME, cap is 3.5% of 100k = 3500 -> rejected.
  await assert.rejects(() => buy(db, uid, PAIR, MEME, 1000), /max order size/);
  // A small buy under the cap still works.
  const r = await buy(db, uid, PAIR, MEME, 100);
  assert.ok(r.tokensOut > 0n);
});
