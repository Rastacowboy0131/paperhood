// PaperHood API server. Fastify + shared SQLite (indexer + engine).
import Fastify, { FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../engine/src/db.js";
import { quoteSwap, getTokenMeta } from "../../engine/src/quote.js";
import { buy, sell, getPortfolio, getEthUsd, getSeasonId, cashBalanceUsd } from "../../engine/src/ledger.js";
import { dailyLeaderboard, weeklyLeaderboard } from "../../engine/src/leaderboard.js";
import { registerAuthRoutes, requireAuth, SessionUser } from "./auth.js";
import { listTokens, getCandles, poolForToken, latestPrice, price24hAgo } from "./market.js";
import { getPoolTrades, aggregateTopTraders, getHolders, getPaperTrades, EXPLORER_URL } from "./tokeninfo.js";
import { WsHub } from "./ws.js";

export interface BuildOpts {
  db?: DatabaseSync;
  dbPath?: string;
}

type AuthedRequest = FastifyRequest & { user: SessionUser };

export async function buildServer(opts: BuildOpts = {}) {
  const jwtSecret = process.env.JWT_SECRET || (process.env.DEV_AUTH === "1" ? "dev-secret-do-not-use" : "");
  if (!jwtSecret) throw new Error("JWT_SECRET is required (or set DEV_AUTH=1 for local dev)");

  const db = opts.db ?? openDb(opts.dbPath);
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  await app.register(cookie);
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(",") : true,
    credentials: true,
  });
  await app.register(rateLimit, { global: false });
  await app.register(websocket);

  const auth = requireAuth(jwtSecret);
  registerAuthRoutes(app, db, jwtSecret);

  // Per-user (fall back to per-IP) key for rate limiting.
  const rlKey = (req: FastifyRequest) => {
    const u = (req as AuthedRequest).user;
    return u ? `u:${u.userId}` : req.ip;
  };
  const quoteLimit = { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: rlKey } };
  const tradeLimit = { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: rlKey } };

  async function ethUsdOrNull(): Promise<number | null> {
    try { return await getEthUsd(db); } catch { return null; }
  }

  // ---------- market data ----------

  app.get("/tokens", async () => {
    const ethUsd = await ethUsdOrNull();
    return { ethUsd, tokens: listTokens(db, ethUsd) };
  });

  app.get("/tokens/:address", async (req, reply) => {
    const { address } = req.params as { address: string };
    const pool = poolForToken(db, address);
    if (!pool) return reply.code(404).send({ error: "token not in universe" });
    const ethUsd = await ethUsdOrNull();
    const snap = latestPrice(db, pool.pair_address);
    const prev = price24hAgo(db, pool.pair_address);
    let meta = null;
    try { meta = await getTokenMeta(db, address); } catch { /* chain unreachable */ }
    const price = snap?.price ?? null;
    const priceUsd = price != null && ethUsd != null && pool.quote_symbol === "WETH" ? price * ethUsd : null;
    const totalSupply = (pool as { total_supply?: number | null }).total_supply ?? null;
    return {
      address: pool.token_address,
      symbol: pool.symbol,
      name: pool.name,
      decimals: meta?.decimals ?? null,
      pool: {
        pair: pool.pair_address,
        dex: pool.dex_id,
        version: pool.version,
        quoteToken: pool.quote_token,
        quoteSymbol: pool.quote_symbol,
        liquidityUsd: pool.liquidity_usd,
        volume24hUsd: pool.volume24h,
      },
      priceQuote: price,
      priceUsd,
      priceTs: snap?.ts ?? null,
      change24hPct: price != null && prev != null && prev > 0 ? ((price - prev) / prev) * 100 : null,
      totalSupply,
      mcapUsd: priceUsd != null && totalSupply != null ? priceUsd * totalSupply : null,
    };
  });

  app.get("/tokens/:address/candles", async (req, reply) => {
    const { address } = req.params as { address: string };
    const q = req.query as { tf?: string; limit?: string };
    const tf = q.tf || "1m";
    if (!["1m", "5m", "1h", "1d"].includes(tf)) return reply.code(400).send({ error: "tf must be 1m, 5m, 1h, or 1d" });
    const limit = Math.min(Math.max(parseInt(q.limit || "300", 10) || 300, 1), 1000);
    const pool = poolForToken(db, address);
    if (!pool) return reply.code(404).send({ error: "token not in universe" });
    return { pair: pool.pair_address, tf, candles: getCandles(db, pool.pair_address, tf, limit) };
  });

  // ---------- token info panel (proxied + cached upstream data) ----------

  app.get("/tokens/:address/trades", async (req, reply) => {
    const { address } = req.params as { address: string };
    const pool = poolForToken(db, address);
    if (!pool) return reply.code(404).send({ error: "token not in universe" });
    try {
      const trades = await getPoolTrades(pool.pair_address, pool.token_address);
      return { pair: pool.pair_address, explorer: EXPLORER_URL, trades, topTraders: aggregateTopTraders(trades), windowTrades: trades.length };
    } catch (e) {
      return reply.code(502).send({ error: `trades unavailable: ${(e as Error).message}` });
    }
  });

  app.get("/tokens/:address/holders", async (req, reply) => {
    const { address } = req.params as { address: string };
    const pool = poolForToken(db, address);
    if (!pool) return reply.code(404).send({ error: "token not in universe" });
    try {
      const { holders } = await getHolders(pool.token_address);
      return { explorer: EXPLORER_URL, holders };
    } catch (e) {
      return reply.code(502).send({ error: `holders unavailable: ${(e as Error).message}` });
    }
  });

  app.get("/tokens/:address/paper-trades", async (req, reply) => {
    const { address } = req.params as { address: string };
    const pool = poolForToken(db, address);
    if (!pool) return reply.code(404).send({ error: "token not in universe" });
    return { trades: getPaperTrades(db, pool.token_address) };
  });

  // ---------- quoting ----------

  app.post("/quote", quoteLimit, async (req, reply) => {
    const body = req.body as { tokenIn?: string; tokenOut?: string; amountIn?: string };
    if (!body?.tokenIn || !body?.tokenOut || !body?.amountIn) {
      return reply.code(400).send({ error: "tokenIn, tokenOut, amountIn required" });
    }
    // One side must be the token in our universe; the pool is its canonical pool.
    const pool = poolForToken(db, body.tokenIn) ?? poolForToken(db, body.tokenOut);
    if (!pool) return reply.code(404).send({ error: "no pool for this token pair" });

    let amountIn: bigint;
    try { amountIn = BigInt(body.amountIn); } catch { return reply.code(400).send({ error: "amountIn must be an integer string (raw units)" }); }
    if (amountIn <= 0n) return reply.code(400).send({ error: "amountIn must be positive" });

    try {
      const q = await quoteSwap(db, pool.pair_address, body.tokenIn, amountIn);
      return {
        pair: q.pair,
        tokenIn: q.tokenIn,
        tokenOut: q.tokenOut,
        amountIn: q.amountIn.toString(),
        amountOut: q.amountOut.toString(),
        spotPrice: q.spotPrice,
        execPrice: q.execPrice,
        priceImpactPct: q.priceImpactPct,
        feePaid: q.feePaid.toString(),
        feeTier: q.feeTier,
        path: q.path,
      };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---------- trading (authed) ----------

  app.post("/trade", { ...tradeLimit, preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const body = req.body as { token?: string; side?: string; amount?: string };
    if (!body?.token || !body?.side || !body?.amount) {
      return reply.code(400).send({ error: "token, side, amount required" });
    }
    if (body.side !== "buy" && body.side !== "sell") {
      return reply.code(400).send({ error: "side must be buy or sell" });
    }
    const pool = poolForToken(db, body.token);
    if (!pool) return reply.code(404).send({ error: "token not in universe" });

    try {
      if (body.side === "buy") {
        // amount = USD to spend
        const usd = Number(body.amount);
        if (!(usd > 0)) return reply.code(400).send({ error: "amount must be a positive USD number for buys" });
        const r = await buy(db, user.userId, pool.pair_address, body.token, usd);
        return {
          tradeId: r.tradeId,
          side: "buy",
          token: body.token,
          usdIn: usd,
          tokensOut: r.tokensOut.toString(),
          execPriceUsd: r.execPriceUsd,
          priceImpactPct: r.quote.priceImpactPct,
          path: r.quote.path,
        };
      } else {
        // amount = token quantity, raw units (integer string)
        let qty: bigint;
        try { qty = BigInt(body.amount); } catch { return reply.code(400).send({ error: "amount must be an integer string (raw token units) for sells" }); }
        const r = await sell(db, user.userId, pool.pair_address, body.token, qty);
        return {
          tradeId: r.tradeId,
          side: "sell",
          token: body.token,
          tokensIn: qty.toString(),
          usdOut: r.usdOut,
          realizedPnlUsd: r.realizedPnlUsd,
          priceImpactPct: r.quote.priceImpactPct,
          path: r.quote.path,
        };
      }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/portfolio", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    const seasonId = getSeasonId(db);
    const p = await getPortfolio(db, user.userId, seasonId);
    const history = db.prepare(
      `SELECT t.id, t.pair_address AS pair, t.token_address AS token,
              COALESCE(tok.symbol, po.symbol, '?') AS symbol,
              COALESCE(po.name, tok.symbol, '?') AS name,
              t.side, t.amount_in AS amountIn, t.amount_out AS amountOut,
              t.exec_price AS execPriceUsd, t.impact AS priceImpactPct, t.fee AS feeUsd,
              t.realized_pnl AS realizedPnlUsd, t.ts
       FROM trades t
       LEFT JOIN tokens tok ON tok.address = t.token_address
       LEFT JOIN pools po ON po.pair_address = t.pair_address
       WHERE t.user_id = ? AND t.season_id = ? ORDER BY t.id DESC LIMIT 200`
    ).all(user.userId, seasonId);
    const nameStmt = db.prepare(
      "SELECT name FROM pools WHERE token_address = ? COLLATE NOCASE ORDER BY liquidity_usd DESC LIMIT 1"
    );
    const tokenName = (token: string, fallback: string) =>
      (nameStmt.get(token) as { name: string | null } | undefined)?.name || fallback;
    return {
      user: { address: user.address, display: user.address.slice(0, 6) + "..." + user.address.slice(-4) },
      cashUsd: p.cashUsd,
      cashEth: p.cashEth,
      equityUsd: p.equityUsd,
      equityEth: p.equityEth,
      realizedPnlUsd: p.realizedPnlUsd,
      unrealizedPnlUsd: p.positions.reduce((s, x) => s + x.unrealizedPnlUsd, 0),
      positions: p.positions.map((x) => ({
        token: x.token, symbol: x.symbol, name: tokenName(x.token, x.symbol), pair: x.pair,
        qty: x.qty.toString(), qtyDec: x.qtyDec,
        costBasisUsd: x.costBasisUsd, markUsd: x.markUsd, unrealizedPnlUsd: x.unrealizedPnlUsd,
      })),
      history,
    };
  });

  // ---------- leaderboard ----------

  app.get("/leaderboard", async (req, reply) => {
    const period = (req.query as { period?: string }).period || "weekly";
    if (period !== "daily" && period !== "weekly") {
      return reply.code(400).send({ error: "period must be daily or weekly" });
    }
    const entries = period === "daily" ? dailyLeaderboard(db) : weeklyLeaderboard(db);
    return { period, entries };
  });

  // ---------- websocket ----------

  const hub = new WsHub(db, Number(process.env.WS_PUSH_INTERVAL_MS || 5000));
  app.register(async (scope) => {
    scope.get("/ws", { websocket: true }, (socket) => {
      hub.add(socket as never);
    });
  });

  app.get("/health", async () => {
    const pools = (db.prepare("SELECT COUNT(*) AS c FROM pools WHERE active=1").get() as { c: number }).c;
    const snap = db.prepare("SELECT MAX(ts) AS ts FROM snapshots").get() as { ts: number | null };
    return { ok: true, activePools: pools, latestSnapshotTs: snap.ts, snapshotAgeS: snap.ts ? Math.floor(Date.now() / 1000) - snap.ts : null };
  });

  app.addHook("onClose", async () => hub.stop());
  return { app, db };
}

// Direct run: start the server.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  buildServer().then(({ app }) =>
    app.listen({ port, host: process.env.HOST || "0.0.0.0" })
  ).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
