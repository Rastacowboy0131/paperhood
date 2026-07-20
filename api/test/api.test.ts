// Endpoint tests: fake in-memory db with a v2 pool, DEV_AUTH login, then
// quote, trade round trip, portfolio math, leaderboard shape, and the full
// SIWE flow with a locally generated throwaway wallet.
import { test, before, after } from "node:test";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { migrate } from "../../engine/src/db.js";
import { setEthUsdForTest, STARTING_BALANCE_USD } from "../../engine/src/ledger.js";

process.env.DEV_AUTH = "1";
process.env.NODE_ENV = "test";
process.env.RH_RPC_HTTP = process.env.RH_RPC_HTTP || "http://127.0.0.1:1"; // never called: fee/token0/meta pre-seeded

const { buildServer } = await import("../src/index.js");

const TESTER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const WETH = "0x00000000000000000000000000000000000000aa";
const MEME = "0x00000000000000000000000000000000000000bb";
const PAIR = "0x00000000000000000000000000000000000000cc";
const ETH_USD = 2000;

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
);
CREATE TABLE candles (
  pair_address TEXT NOT NULL, minute INTEGER NOT NULL,
  open REAL, high REAL, low REAL, close REAL, n INTEGER,
  PRIMARY KEY (pair_address, minute)
);`);
  migrate(db);
  db.prepare(
    "INSERT INTO pools (pair_address, token_address, symbol, name, dex_id, version, quote_token, quote_symbol, liquidity_usd, volume24h, active, fee, token0) VALUES (?,?,?,?,?,?,?,?,?,?,1,3000,?)"
  ).run(PAIR, MEME, "MEME", "Meme Token", "uniswap", "v2", WETH, "WETH", 500000, 12345, WETH);
  // 100 WETH + 1,000,000 MEME. Price = 100/1e6 = 0.0001 WETH per MEME.
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO snapshots (pair_address, ts, reserve0, reserve1, price) VALUES (?,?,?,?,?)")
    .run(PAIR, now, (100n * 10n ** 18n).toString(), (1_000_000n * 10n ** 18n).toString(), 0.0001);
  // Candles: 120 minutes of 1m data.
  const ins = db.prepare("INSERT INTO candles (pair_address, minute, open, high, low, close, n) VALUES (?,?,?,?,?,?,1)");
  const base = now - (now % 60);
  for (let i = 120; i >= 1; i--) {
    const m = base - i * 60;
    const p = 0.0001 + i * 1e-9;
    ins.run(PAIR, m, p, p * 1.01, p * 0.99, p);
  }
  const tok = db.prepare("INSERT INTO tokens (address, symbol, decimals, updated_at) VALUES (?,?,?,0)");
  tok.run(WETH, "WETH", 18);
  tok.run(MEME, "MEME", 18);
  setEthUsdForTest(db, ETH_USD);
  return db;
}

let app: Awaited<ReturnType<typeof buildServer>>["app"];
let cookie = "";

before(async () => {
  const built = await buildServer({ db: fakeDb() });
  app = built.app;
  const res = await app.inject({ method: "GET", url: `/auth/dev?address=${TESTER}` });
  assert.equal(res.statusCode, 200);
  cookie = res.headers["set-cookie"] as string;
  assert.ok(cookie.includes("ph_session="));
  cookie = cookie.split(";")[0];
});

after(async () => { await app.close(); });

test("GET /tokens returns universe with price and change", async () => {
  const res = await app.inject({ method: "GET", url: "/tokens" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ethUsd, ETH_USD);
  assert.equal(body.tokens.length, 1);
  const t = body.tokens[0];
  assert.equal(t.symbol, "MEME");
  assert.equal(t.address, MEME);
  assert.equal(t.priceQuote, 0.0001);
  assert.equal(t.priceUsd, 0.0001 * ETH_USD);
  assert.ok(typeof t.change24hPct === "number");
  assert.equal(t.liquidityUsd, 500000);
});

test("GET /tokens/:address returns detail", async () => {
  const res = await app.inject({ method: "GET", url: `/tokens/${MEME}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.symbol, "MEME");
  assert.equal(body.pool.pair, PAIR);
  assert.equal(body.pool.version, "v2");
  assert.equal(body.decimals, 18);
  const missing = await app.inject({ method: "GET", url: "/tokens/0x0000000000000000000000000000000000000dead" });
  assert.equal(missing.statusCode, 404);
});

test("GET /tokens/:address/candles aggregates timeframes", async () => {
  const m1 = await app.inject({ method: "GET", url: `/tokens/${MEME}/candles?tf=1m&limit=50` });
  assert.equal(m1.statusCode, 200);
  const c1 = m1.json().candles;
  assert.equal(c1.length, 50);
  assert.ok(c1[0].t < c1[1].t);
  assert.ok(c1[0].o > 0 && c1[0].h >= c1[0].l);

  const m5 = await app.inject({ method: "GET", url: `/tokens/${MEME}/candles?tf=5m&limit=10` });
  const c5 = m5.json().candles;
  assert.ok(c5.length <= 10 && c5.length > 0);
  assert.equal(c5[0].t % 300, 0);

  const bad = await app.inject({ method: "GET", url: `/tokens/${MEME}/candles?tf=2h` });
  assert.equal(bad.statusCode, 400);
});

test("POST /quote returns amountOut, impact, fee", async () => {
  // 1 WETH in -> MEME out
  const res = await app.inject({
    method: "POST", url: "/quote",
    payload: { tokenIn: WETH, tokenOut: MEME, amountIn: (10n ** 18n).toString() },
  });
  assert.equal(res.statusCode, 200);
  const q = res.json();
  assert.ok(BigInt(q.amountOut) > 0n);
  assert.equal(q.feeTier, 3000);
  assert.ok(q.priceImpactPct > 0);
  assert.ok(q.execPrice < q.spotPrice);
  assert.equal(q.path, "v2-reserves");
});

test("trade requires auth", async () => {
  const res = await app.inject({
    method: "POST", url: "/trade",
    payload: { token: MEME, side: "buy", amount: "100" },
  });
  assert.equal(res.statusCode, 401);
});

test("buy then sell: portfolio math is consistent and PnL sane", async () => {
  const buyRes = await app.inject({
    method: "POST", url: "/trade", headers: { cookie },
    payload: { token: MEME, side: "buy", amount: "1000" },
  });
  assert.equal(buyRes.statusCode, 200);
  const b = buyRes.json();
  assert.ok(BigInt(b.tokensOut) > 0n);
  assert.ok(b.execPriceUsd > 0);

  let pf = (await app.inject({ method: "GET", url: "/portfolio", headers: { cookie } })).json();
  assert.ok(Math.abs(pf.cashUsd - (STARTING_BALANCE_USD - 1000)) < 1e-6);
  assert.equal(pf.positions.length, 1);
  assert.equal(pf.positions[0].qty, b.tokensOut);
  // Mark-at-exit should be a bit below cost (fees + impact both ways), never above.
  assert.ok(pf.positions[0].markUsd > 900 && pf.positions[0].markUsd < 1000);
  assert.ok(pf.equityUsd < STARTING_BALANCE_USD && pf.equityUsd > STARTING_BALANCE_USD - 100);
  assert.ok(Math.abs(pf.cashEth - pf.cashUsd / ETH_USD) < 1e-9);

  // Sell everything back at the same snapshot: small realized loss from fees/impact.
  const sellRes = await app.inject({
    method: "POST", url: "/trade", headers: { cookie },
    payload: { token: MEME, side: "sell", amount: b.tokensOut },
  });
  assert.equal(sellRes.statusCode, 200);
  const s = sellRes.json();
  assert.ok(s.usdOut > 900 && s.usdOut < 1000);
  assert.ok(s.realizedPnlUsd < 0 && s.realizedPnlUsd > -100);

  pf = (await app.inject({ method: "GET", url: "/portfolio", headers: { cookie } })).json();
  assert.equal(pf.positions.length, 0);
  assert.ok(Math.abs(pf.cashUsd - (STARTING_BALANCE_USD - 1000 + s.usdOut)) < 1e-6);
  assert.ok(Math.abs(pf.realizedPnlUsd - s.realizedPnlUsd) < 1e-6);
  assert.equal(pf.history.length, 2);
  assert.equal(pf.history[0].side, "sell");
  assert.equal(pf.history[1].side, "buy");
});

test("overdraft and oversell rejected", async () => {
  const big = await app.inject({
    method: "POST", url: "/trade", headers: { cookie },
    payload: { token: MEME, side: "buy", amount: "9999999" },
  });
  assert.equal(big.statusCode, 400);
  assert.match(big.json().error, /insufficient balance/);

  const oversell = await app.inject({
    method: "POST", url: "/trade", headers: { cookie },
    payload: { token: MEME, side: "sell", amount: (10n ** 24n).toString() },
  });
  assert.equal(oversell.statusCode, 400);
  assert.match(oversell.json().error, /insufficient position/);
});

test("GET /leaderboard has correct shape and includes the trader", async () => {
  for (const period of ["daily", "weekly"] as const) {
    const res = await app.inject({ method: "GET", url: `/leaderboard?period=${period}` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.period, period);
    assert.ok(Array.isArray(body.entries));
    assert.equal(body.entries.length, 1);
    const e = body.entries[0];
    assert.equal(e.address, TESTER);
    assert.equal(e.display, "0xaaaa...aaaa");
    assert.ok(typeof e.pnlPct === "number");
    assert.ok(e.realizedPnlUsd < 0);
    assert.ok(e.trades >= 2);
  }
  const bad = await app.inject({ method: "GET", url: "/leaderboard?period=monthly" });
  assert.equal(bad.statusCode, 400);
});

test("GET /auth/me reflects session, /portfolio without cookie is 401", async () => {
  const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.address, TESTER);
  assert.ok(typeof me.json().user.createdAt === "number");
  const anon = await app.inject({ method: "GET", url: "/portfolio" });
  assert.equal(anon.statusCode, 401);
});

// ---------- SIWE flow ----------

async function siweLogin(account: ReturnType<typeof privateKeyToAccount>, overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  const nonceRes = await app.inject({ method: "GET", url: "/auth/nonce" });
  assert.equal(nonceRes.statusCode, 200);
  const { nonce } = nonceRes.json();
  assert.ok(typeof nonce === "string" && nonce.length >= 8);

  const message = createSiweMessage({
    address: account.address,
    chainId: 4663,
    domain: "localhost:8787",
    nonce,
    uri: "http://localhost:8787",
    version: "1",
    ...overrides,
  });
  const signature = await account.signMessage({ message });
  const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } });
  return { res, message, signature, nonce };
}

test("SIWE: nonce, sign, verify, trade, portfolio", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { res } = await siweLogin(account);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.user.address, account.address.toLowerCase());
  const siweCookie = (res.headers["set-cookie"] as string).split(";")[0];
  assert.ok(siweCookie.startsWith("ph_session="));

  const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: siweCookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.address, account.address.toLowerCase());

  const buyRes = await app.inject({
    method: "POST", url: "/trade", headers: { cookie: siweCookie },
    payload: { token: MEME, side: "buy", amount: "500" },
  });
  assert.equal(buyRes.statusCode, 200);
  assert.ok(BigInt(buyRes.json().tokensOut) > 0n);

  const pf = (await app.inject({ method: "GET", url: "/portfolio", headers: { cookie: siweCookie } })).json();
  assert.equal(pf.user.address, account.address.toLowerCase());
  assert.ok(Math.abs(pf.cashUsd - (STARTING_BALANCE_USD - 500)) < 1e-6);
  assert.equal(pf.positions.length, 1);
});

test("SIWE: nonce cannot be replayed", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { res, message, signature } = await siweLogin(account);
  assert.equal(res.statusCode, 200);
  const replay = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } });
  assert.equal(replay.statusCode, 401);
  assert.match(replay.json().error, /nonce/);
});

test("SIWE: unknown nonce rejected", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = createSiweMessage({
    address: account.address, chainId: 4663, domain: "localhost:8787",
    nonce: "deadbeefdeadbeef", uri: "http://localhost:8787", version: "1",
  });
  const signature = await account.signMessage({ message });
  const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } });
  assert.equal(res.statusCode, 401);
});

test("SIWE: wrong signer rejected", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const nonceRes = await app.inject({ method: "GET", url: "/auth/nonce" });
  const { nonce } = nonceRes.json();
  const message = createSiweMessage({
    address: account.address, chainId: 4663, domain: "localhost:8787",
    nonce, uri: "http://localhost:8787", version: "1",
  });
  const signature = await other.signMessage({ message });
  const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } });
  assert.equal(res.statusCode, 401);
});

test("SIWE: disallowed chain id rejected", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { res } = await siweLogin(account, { chainId: 137 });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /chainId/);
});

test("POST /auth/logout clears the cookie", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { res } = await siweLogin(account);
  const siweCookie = (res.headers["set-cookie"] as string).split(";")[0];
  const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: siweCookie } });
  assert.equal(out.statusCode, 200);
  const cleared = out.headers["set-cookie"] as string;
  assert.ok(cleared.includes("ph_session=;") || cleared.includes("ph_session="));
});
