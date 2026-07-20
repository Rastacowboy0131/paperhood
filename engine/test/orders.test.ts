// Order triggering tests: in-memory db, fake v2 pool, no network calls.
import { test } from "node:test";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/db.js";
import { getOrCreateUser, getSeasonId, buy, positionQty, setEthUsdForTest, cashBalanceUsd } from "../src/ledger.js";
import { createOrder, listOrders, cancelOrder, checkOpenOrders, shouldTrigger, getOrder } from "../src/orders.js";

const WETH = "0x00000000000000000000000000000000000000aa";
const MEME = "0x00000000000000000000000000000000000000bb";
const PAIR = "0x00000000000000000000000000000000000000cc";

function fakeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
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
  db.prepare(
    "INSERT INTO pools (pair_address, token_address, symbol, version, quote_token, quote_symbol, liquidity_usd, active, fee, token0) VALUES (?,?,?,?,?,?,?,1,3000,?)"
  ).run(PAIR, MEME, "MEME", "v2", WETH, "WETH", 500000, WETH);
  setSnapshot(db, 100n, 1_000_000n, 0); // price = 100/1e6 = 0.0001 WETH per MEME
  const ins = db.prepare("INSERT INTO tokens (address, symbol, decimals, updated_at) VALUES (?,?,?,0)");
  ins.run(WETH, "WETH", 18);
  ins.run(MEME, "MEME", 18);
  setEthUsdForTest(db, 2500);
  return db;
}

function setSnapshot(db: DatabaseSync, weth: bigint, meme: bigint, tsOffset: number): void {
  const price = Number(weth) / Number(meme);
  db.prepare("INSERT INTO snapshots (pair_address, ts, reserve0, reserve1, price) VALUES (?,?,?,?,?)")
    .run(PAIR, Math.floor(Date.now() / 1000) + tsOffset, (weth * 10n ** 18n).toString(), (meme * 10n ** 18n).toString(), price);
}

test("shouldTrigger rules", () => {
  // limit buy: price at or below trigger
  assert.equal(shouldTrigger("buy", "limit", 0.0001, 0.00009), true);
  assert.equal(shouldTrigger("buy", "limit", 0.0001, 0.00011), false);
  // limit sell (take profit): price at or above trigger
  assert.equal(shouldTrigger("sell", "limit", 0.0002, 0.00021), true);
  assert.equal(shouldTrigger("sell", "limit", 0.0002, 0.00019), false);
  // stop loss: price at or below trigger
  assert.equal(shouldTrigger("sell", "stop", 0.00008, 0.00007), true);
  assert.equal(shouldTrigger("sell", "stop", 0.00008, 0.00009), false);
});

test("limit buy fills when price drops to trigger", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000011");
  const season = getSeasonId(db);
  createOrder(db, uid, { token: MEME, pair: PAIR, side: "buy", type: "limit", triggerPrice: 0.00008, amount: 500 });

  // Price still 0.0001: no fill.
  assert.equal(await checkOpenOrders(db), 0);
  assert.equal(listOrders(db, uid)[0].status, "open");

  // Price drops to 0.00005 (50 WETH / 1M MEME): fills.
  setSnapshot(db, 50n, 1_000_000n, 10);
  assert.equal(await checkOpenOrders(db), 1);
  const o = listOrders(db, uid)[0];
  assert.equal(o.status, "filled");
  assert.ok(o.filled_price_usd! > 0);
  assert.ok(positionQty(db, uid, season, MEME) > 0n);
  assert.ok(cashBalanceUsd(db, uid, season) < 10000);
});

test("take profit (limit sell) fills on price rise; stop loss fills on drop", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000012");
  const season = getSeasonId(db);
  await buy(db, uid, PAIR, MEME, 1000);
  const held = positionQty(db, uid, season, MEME);

  // TP at 0.0002, SL at 0.00005, each for 50% of position.
  createOrder(db, uid, { token: MEME, pair: PAIR, side: "sell", type: "limit", triggerPrice: 0.0002, amount: 50 });
  createOrder(db, uid, { token: MEME, pair: PAIR, side: "sell", type: "stop", triggerPrice: 0.00005, amount: 50 });
  assert.equal(await checkOpenOrders(db), 0); // price 0.0001, neither triggers

  // Pump: price quadruples. TP fills, SL stays open.
  setSnapshot(db, 200n, 500_000n, 10);
  assert.equal(await checkOpenOrders(db), 1);
  const orders = listOrders(db, uid, MEME);
  const tp = orders.find((o) => o.type === "limit")!;
  const sl = orders.find((o) => o.type === "stop")!;
  assert.equal(tp.status, "filled");
  assert.equal(sl.status, "open");
  assert.ok(positionQty(db, uid, season, MEME) < held);

  // Dump below SL: fills the stop.
  setSnapshot(db, 20n, 1_000_000n, 20);
  assert.equal(await checkOpenOrders(db), 1);
  assert.equal(getOrder(db, sl.id)!.status, "filled");
});

test("order fails with reason when ledger rejects", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000013");
  // Buy order for more cash than the user has.
  createOrder(db, uid, { token: MEME, pair: PAIR, side: "buy", type: "limit", triggerPrice: 0.0002, amount: 999999 });
  // Sell order with no position.
  createOrder(db, uid, { token: MEME, pair: PAIR, side: "sell", type: "stop", triggerPrice: 0.0002, amount: 100 });
  assert.equal(await checkOpenOrders(db), 2); // both trigger at price 0.0001
  const orders = listOrders(db, uid);
  assert.ok(orders.every((o) => o.status === "failed"));
  assert.match(orders.find((o) => o.side === "buy")!.fail_reason!, /insufficient balance/);
  assert.ok(orders.find((o) => o.side === "sell")!.fail_reason);
});

test("cancel only works on own open orders; validation rejects bad input", async () => {
  const db = fakeDb();
  const uid = getOrCreateUser(db, "0x0000000000000000000000000000000000000014");
  const other = getOrCreateUser(db, "0x0000000000000000000000000000000000000015");
  const o = createOrder(db, uid, { token: MEME, pair: PAIR, side: "buy", type: "limit", triggerPrice: 0.00005, amount: 100 });

  assert.equal(cancelOrder(db, other, o.id), false); // not the owner
  assert.equal(cancelOrder(db, uid, o.id), true);
  assert.equal(getOrder(db, o.id)!.status, "cancelled");
  assert.equal(cancelOrder(db, uid, o.id), false);    // no longer open
  assert.equal(await checkOpenOrders(db), 0);         // cancelled orders never fill

  assert.throws(() => createOrder(db, uid, { token: MEME, pair: PAIR, side: "buy", type: "stop", triggerPrice: 1, amount: 1 }), /sell-only/);
  assert.throws(() => createOrder(db, uid, { token: MEME, pair: PAIR, side: "sell", type: "limit", triggerPrice: 1, amount: 150 }), /percent/);
  assert.throws(() => createOrder(db, uid, { token: MEME, pair: PAIR, side: "buy", type: "limit", triggerPrice: 0, amount: 1 }), /positive/);
});
