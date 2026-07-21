// PaperHood API server. Fastify + shared SQLite (indexer + engine).
import Fastify, { FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../engine/src/db.js";
import { quoteSwap, getTokenMeta } from "../../engine/src/quote.js";
import { buy, sell, getPortfolio, getEthUsd, getSeasonId, cashBalanceUsd, seasonInfo, listSeasons } from "../../engine/src/ledger.js";
import { createOrder, listOrders, cancelOrder, updateOrderTrigger, checkOpenOrders, OrderSide, OrderType } from "../../engine/src/orders.js";
import { dailyLeaderboard, weeklyLeaderboard, windowLeaderboard, seasonLeaderboard, seasonArchive, LeaderboardWindow, LeaderboardMetric } from "../../engine/src/leaderboard.js";
import { checkBadges, getUserBadges, badgesForUsers, BADGE_DEFS } from "../../engine/src/badges.js";
import { getWatchlist, addWatch, removeWatch, createNote, updateNote, deleteNote, listNotes, NOTE_MAX_CHARS } from "../../engine/src/social.js";
import { snapshotUser, snapshotActiveUsers, getEquityCurve } from "../../engine/src/equity.js";
import { registerAuthRoutes, requireAuth, SessionUser } from "./auth.js";
import { listTokens, getCandles, poolForToken, latestPrice, price24hAgo } from "./market.js";
import { getPoolTrades, aggregateTopTraders, getHolders, getPaperTrades, RateLimitedError, EXPLORER_URL } from "./tokeninfo.js";
import { importToken, ImportError, THIN_LIQ_USD } from "../../engine/src/import.js";
import { backfillPairHistory } from "../../engine/src/backfill.js";
import { ponsGraduation } from "../../engine/src/pons.js";
import { buildRecap, RecapWindow } from "../../engine/src/recap.js";
import { WsHub } from "./ws.js";

export interface BuildOpts {
  db?: DatabaseSync;
  dbPath?: string;
}

type AuthedRequest = FastifyRequest & { user: SessionUser };

function serializeOrder(o: import("../../engine/src/orders.js").OrderRow) {
  return {
    id: o.id,
    token: o.token_address,
    pair: o.pair_address,
    side: o.side,
    type: o.type,
    triggerPrice: o.trigger_price,
    amount: o.amount,
    status: o.status,
    failReason: o.fail_reason,
    createdAt: o.created_at,
    filledAt: o.filled_at,
    filledPriceUsd: o.filled_price_usd,
  };
}

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
  const importLimit = { rateLimit: { max: 6, timeWindow: "1 minute", keyGenerator: rlKey } };

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
    const px = pool as unknown as { image_url?: string | null; header_url?: string | null; website?: string | null; twitter?: string | null; telegram?: string | null; source?: string | null };
    // Launchpad tokens get graduation progress (fee milestone on the locked
    // v3 position, cheap single read; failures just hide the progress bar).
    const source = px.source ?? null;
    const grad = source === "pons" ? await ponsGraduation(pool.token_address).catch(() => null) : null;
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
      imageUrl: px.image_url ?? null,
      headerUrl: px.header_url ?? null,
      website: px.website ?? null,
      twitter: px.twitter ?? null,
      telegram: px.telegram ?? null,
      imported: !!(pool as unknown as { imported?: number | null }).imported,
      source,
      launchpad: grad ? { progressPct: grad.progressPct, graduated: grad.graduated } : null,
      thinLiquidity: (pool.liquidity_usd ?? 0) < THIN_LIQ_USD,
    };
  });

  // Trade-any-CA: import a robinhood-chain token by contract address.
  // Idempotent (already-tracked tokens return alreadyTracked=true) and
  // rate-limited per user/IP. Rejects addresses with no priced pair.
  app.post("/tokens/import", importLimit, async (req, reply) => {
    const body = req.body as { address?: string };
    if (!body?.address) return reply.code(400).send({ error: "address required" });
    try {
      const r = await importToken(db, body.address);
      // Backfill chart history asynchronously so the import response is not
      // blocked on GeckoTerminal (2-3 rate-limited requests, several seconds).
      if (!r.alreadyTracked) {
        void backfillPairHistory(db, r.pair, r.address)
          .then(({ minutes, hours }) =>
            app.log.info(`import backfill ${r.symbol}: +${minutes} 1m, +${hours} 1h candles`)
          )
          .catch((e) => app.log.warn(`import backfill failed for ${r.symbol}: ${(e as Error).message}`));
      }
      return r;
    } catch (e) {
      if (e instanceof ImportError) return reply.code(e.status).send({ error: e.message });
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.get("/tokens/:address/candles", async (req, reply) => {
    const { address } = req.params as { address: string };
    const q = req.query as { tf?: string; limit?: string };
    const tf = q.tf || "1m";
    if (!["5s", "15s", "30s", "1m", "5m", "1h", "1d"].includes(tf)) return reply.code(400).send({ error: "tf must be 5s, 15s, 30s, 1m, 5m, 1h, or 1d" });
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
      if (e instanceof RateLimitedError) {
        return reply.code(429).send({ error: "rate limited by trades provider, retrying shortly" });
      }
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
    const body = req.body as { token?: string; side?: string; amount?: string; note?: string };
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
        afterTrade(user.userId);
        if (body.note && body.note.trim()) {
          try { createNote(db, user.userId, pool.token_address, body.note, r.tradeId); } catch { /* note is best effort */ }
        }
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
        afterTrade(user.userId);
        if (body.note && body.note.trim()) {
          try { createNote(db, user.userId, pool.token_address, body.note, r.tradeId); } catch { /* note is best effort */ }
        }
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

  // Post-trade bookkeeping: recompute badges and snapshot equity. Fire and
  // forget so trades stay fast.
  function afterTrade(userId: number): void {
    try { checkBadges(db, userId); } catch (e) { app.log.error(e, "badge check failed"); }
    snapshotUser(db, userId, true).catch((e) => app.log.error(e, "equity snapshot failed"));
  }

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
    const imgStmt = db.prepare(
      "SELECT image_url FROM pools WHERE token_address = ? COLLATE NOCASE AND image_url IS NOT NULL ORDER BY liquidity_usd DESC LIMIT 1"
    );
    const tokenImage = (token: string) =>
      (imgStmt.get(token) as { image_url: string | null } | undefined)?.image_url ?? null;
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
        imageUrl: tokenImage(x.token),
        qty: x.qty.toString(), qtyDec: x.qtyDec,
        costBasisUsd: x.costBasisUsd, markUsd: x.markUsd, unrealizedPnlUsd: x.unrealizedPnlUsd,
      })),
      history,
    };
  });

  // Paginated closed-trade history (sells with realized PnL), all seasons.
  app.get("/portfolio/closed", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    const q = req.query as { page?: string; pageSize?: string };
    const pageSize = Math.min(Math.max(parseInt(q.pageSize || "20", 10) || 20, 1), 100);
    const page = Math.max(parseInt(q.page || "1", 10) || 1, 1);
    const total = (db.prepare(
      "SELECT COUNT(*) AS c FROM trades WHERE user_id = ? AND side = 'sell'"
    ).get(user.userId) as { c: number }).c;
    const rows = db.prepare(
      `SELECT t.id, t.token_address AS token,
              COALESCE(tok.symbol, po.symbol, '?') AS symbol,
              t.amount_in AS amountIn, t.amount_out AS amountOut,
              t.exec_price AS exitPriceUsd, t.realized_pnl AS realizedPnlUsd, t.ts
       FROM trades t
       LEFT JOIN tokens tok ON tok.address = t.token_address
       LEFT JOIN pools po ON po.pair_address = t.pair_address
       WHERE t.user_id = ? AND t.side = 'sell'
       ORDER BY t.id DESC LIMIT ? OFFSET ?`
    ).all(user.userId, pageSize, (page - 1) * pageSize) as {
      id: number; token: string; symbol: string; amountIn: string; amountOut: string;
      exitPriceUsd: number; realizedPnlUsd: number | null; ts: number;
    }[];
    // Entry price is derivable: cost basis = proceeds - realized pnl, over qty.
    const decStmt = db.prepare("SELECT decimals FROM tokens WHERE address = ?");
    const trades = rows.map((r) => {
      const dec = (decStmt.get(r.token) as { decimals: number } | undefined)?.decimals ?? 18;
      const qtyDec = Number(r.amountIn) / 10 ** dec;
      const proceeds = Number(r.amountOut);
      const pnl = r.realizedPnlUsd ?? 0;
      const cost = proceeds - pnl;
      const entryPriceUsd = qtyDec > 0 ? cost / qtyDec : null;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : null;
      return {
        id: r.id, token: r.token, symbol: r.symbol, qtyDec,
        entryPriceUsd, exitPriceUsd: r.exitPriceUsd,
        proceedsUsd: proceeds, realizedPnlUsd: r.realizedPnlUsd, pnlPct, ts: r.ts,
      };
    });
    return { page, pageSize, total, trades };
  });

  // Equity curve for the profile chart (current season by default).
  app.get("/portfolio/equity", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    const q = req.query as { season?: string };
    const seasonId = q.season ? Number(q.season) : getSeasonId(db);
    if (!Number.isInteger(seasonId) || seasonId <= 0) return { seasonId: null, points: [] };
    // Make sure there is a fresh point when the page loads.
    await snapshotUser(db, user.userId);
    return { seasonId, points: getEquityCurve(db, user.userId, seasonId) };
  });

  // Badges for the signed-in user.
  app.get("/badges/me", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    checkBadges(db, user.userId);
    return { defs: BADGE_DEFS, badges: getUserBadges(db, user.userId) };
  });

  // ---------- limit / stop orders (authed) ----------

  app.post("/orders", { ...tradeLimit, preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const body = req.body as { token?: string; side?: string; type?: string; triggerPrice?: number; amount?: number };
    if (!body?.token || !body?.side || !body?.type || body.triggerPrice == null || body.amount == null) {
      return reply.code(400).send({ error: "token, side, type, triggerPrice, amount required" });
    }
    if (body.side !== "buy" && body.side !== "sell") return reply.code(400).send({ error: "side must be buy or sell" });
    if (body.type !== "limit" && body.type !== "stop") return reply.code(400).send({ error: "type must be limit or stop" });
    const trigger = Number(body.triggerPrice);
    const amount = Number(body.amount);
    if (!Number.isFinite(trigger) || trigger <= 0) return reply.code(400).send({ error: "triggerPrice must be a positive number" });
    if (!Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ error: "amount must be a positive number" });
    const pool = poolForToken(db, body.token);
    if (!pool) return reply.code(404).send({ error: "token not in universe" });
    try {
      const o = createOrder(db, user.userId, {
        token: pool.token_address,
        pair: pool.pair_address,
        side: body.side as OrderSide,
        type: body.type as OrderType,
        triggerPrice: trigger,
        amount,
      });
      return { order: serializeOrder(o) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/orders", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    const token = (req.query as { token?: string }).token;
    return { orders: listOrders(db, user.userId, token).map(serializeOrder) };
  });

  app.delete("/orders/:id", { preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid order id" });
    const ok = cancelOrder(db, user.userId, id);
    if (!ok) return reply.code(404).send({ error: "order not found or not open" });
    return { ok: true };
  });

  // Adjust the trigger price of an open order (chart line drag).
  app.patch("/orders/:id", { ...tradeLimit, preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid order id" });
    const body = req.body as { triggerPrice?: number };
    const trigger = Number(body?.triggerPrice);
    if (!Number.isFinite(trigger) || trigger <= 0) return reply.code(400).send({ error: "triggerPrice must be a positive number" });
    try {
      const o = updateOrderTrigger(db, user.userId, id, trigger);
      if (!o) return reply.code(404).send({ error: "order not found or not open" });
      return { order: serializeOrder(o) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Order execution loop: check open orders against fresh snapshot prices.
  // Skipped in tests (call checkOpenOrders directly there).
  let orderTimer: NodeJS.Timeout | null = null;
  let equityTimer: NodeJS.Timeout | null = null;
  if (process.env.NODE_ENV !== "test") {
    const iv = Number(process.env.ORDER_CHECK_INTERVAL_MS || 10000);
    orderTimer = setInterval(() => {
      checkOpenOrders(db).catch((e) => app.log.error(e, "order check failed"));
    }, iv);
    orderTimer.unref();
    // Periodic equity sampler for the profile curve.
    // 60s default: leaderboards rank by equity change, so marks need to be
    // reasonably fresh. Per-user snapshot writes are still throttled inside
    // recordEquitySnapshot (MIN_GAP_S) unless forced by a trade.
    const eiv = Number(process.env.EQUITY_SNAPSHOT_INTERVAL_MS || 60 * 1000);
    equityTimer = setInterval(() => {
      snapshotActiveUsers(db).catch((e) => app.log.error(e, "equity sampler failed"));
    }, eiv);
    equityTimer.unref();
    // One-time badge backfill: existing trade history earns badges without
    // waiting for a user's next trade.
    setImmediate(() => {
      try {
        const all = db.prepare("SELECT id FROM users").all() as { id: number }[];
        for (const u of all) checkBadges(db, u.id);
      } catch (e) {
        app.log.error(e, "badge backfill failed");
      }
    });
  }

  // ---------- watchlist (authed) ----------

  app.get("/watchlist", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    return { watchlist: getWatchlist(db, user.userId) };
  });

  app.put("/watchlist/:token", { preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const { token } = req.params as { token: string };
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return reply.code(400).send({ error: "invalid token address" });
    addWatch(db, user.userId, token);
    return { ok: true };
  });

  app.delete("/watchlist/:token", { preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const { token } = req.params as { token: string };
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return reply.code(400).send({ error: "invalid token address" });
    removeWatch(db, user.userId, token);
    return { ok: true };
  });

  // ---------- trade journal (authed) ----------

  function serializeNote(n: import("../../engine/src/social.js").NoteRow & { symbol?: string }) {
    return {
      id: n.id,
      token: n.token_address,
      symbol: n.symbol ?? "?",
      tradeId: n.trade_id,
      text: n.text,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    };
  }

  app.get("/notes", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    const q = req.query as { token?: string };
    return { notes: listNotes(db, user.userId, q.token).map(serializeNote), maxChars: NOTE_MAX_CHARS };
  });

  app.post("/notes", { ...tradeLimit, preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const body = req.body as { token?: string; text?: string; tradeId?: number };
    if (!body?.token || !body?.text) return reply.code(400).send({ error: "token and text required" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.token)) return reply.code(400).send({ error: "invalid token address" });
    if (body.text.trim().length === 0) return reply.code(400).send({ error: "note text required" });
    if (body.text.length > NOTE_MAX_CHARS) return reply.code(400).send({ error: `note too long (max ${NOTE_MAX_CHARS} chars)` });
    let tradeId: number | null = null;
    if (body.tradeId != null) {
      const t = db.prepare("SELECT id FROM trades WHERE id = ? AND user_id = ?").get(Number(body.tradeId), user.userId) as { id: number } | undefined;
      if (!t) return reply.code(404).send({ error: "trade not found" });
      tradeId = t.id;
    }
    try {
      const n = createNote(db, user.userId, body.token, body.text, tradeId);
      return { note: serializeNote(n) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.patch("/notes/:id", { ...tradeLimit, preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { text?: string };
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid note id" });
    if (!body?.text || body.text.trim().length === 0) return reply.code(400).send({ error: "note text required" });
    if (body.text.length > NOTE_MAX_CHARS) return reply.code(400).send({ error: `note too long (max ${NOTE_MAX_CHARS} chars)` });
    const n = updateNote(db, user.userId, id, body.text);
    if (!n) return reply.code(404).send({ error: "note not found" });
    return { note: serializeNote(n) };
  });

  app.delete("/notes/:id", { preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid note id" });
    if (!deleteNote(db, user.userId, id)) return reply.code(404).send({ error: "note not found" });
    return { ok: true };
  });

  // ---------- public trader profile (read-only copy-trade view) ----------

  app.get("/traders/:address", async (req, reply) => {
    const { address } = req.params as { address: string };
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return reply.code(400).send({ error: "invalid address" });
    const u = db.prepare("SELECT id, address, created_at FROM users WHERE address = ?").get(address.toLowerCase()) as { id: number; address: string; created_at: number } | undefined;
    if (!u) return reply.code(404).send({ error: "trader not found" });
    const seasonId = getSeasonId(db);
    const p = await getPortfolio(db, u.id, seasonId);
    const imgStmt = db.prepare(
      "SELECT image_url FROM pools WHERE token_address = ? COLLATE NOCASE AND image_url IS NOT NULL ORDER BY liquidity_usd DESC LIMIT 1"
    );
    const closed = db.prepare(
      `SELECT t.id, t.token_address AS token,
              COALESCE(tok.symbol, po.symbol, '?') AS symbol,
              t.amount_in AS amountIn, t.amount_out AS amountOut,
              t.exec_price AS exitPriceUsd, t.realized_pnl AS realizedPnlUsd, t.ts
       FROM trades t
       LEFT JOIN tokens tok ON tok.address = t.token_address
       LEFT JOIN pools po ON po.pair_address = t.pair_address
       WHERE t.user_id = ? AND t.side = 'sell'
       ORDER BY t.id DESC LIMIT 20`
    ).all(u.id) as {
      id: number; token: string; symbol: string; amountIn: string; amountOut: string;
      exitPriceUsd: number; realizedPnlUsd: number | null; ts: number;
    }[];
    const decStmt = db.prepare("SELECT decimals FROM tokens WHERE address = ?");
    const closedTrades = closed.map((r) => {
      const dec = (decStmt.get(r.token) as { decimals: number } | undefined)?.decimals ?? 18;
      const qtyDec = Number(r.amountIn) / 10 ** dec;
      const proceeds = Number(r.amountOut);
      const pnl = r.realizedPnlUsd ?? 0;
      const cost = proceeds - pnl;
      return {
        id: r.id, token: r.token, symbol: r.symbol, qtyDec,
        entryPriceUsd: qtyDec > 0 ? cost / qtyDec : null,
        exitPriceUsd: r.exitPriceUsd,
        proceedsUsd: proceeds,
        realizedPnlUsd: r.realizedPnlUsd,
        pnlPct: cost > 0 ? (pnl / cost) * 100 : null,
        ts: r.ts,
      };
    });
    return {
      address: u.address,
      display: u.address.slice(0, 6) + "..." + u.address.slice(-4),
      joinedAt: u.created_at,
      badges: getUserBadges(db, u.id),
      badgeDefs: BADGE_DEFS,
      equityUsd: p.equityUsd,
      realizedPnlUsd: p.realizedPnlUsd,
      unrealizedPnlUsd: p.positions.reduce((s, x) => s + x.unrealizedPnlUsd, 0),
      equityCurve: getEquityCurve(db, u.id, seasonId),
      positions: p.positions.map((x) => ({
        token: x.token, symbol: x.symbol, pair: x.pair,
        imageUrl: (imgStmt.get(x.token) as { image_url: string | null } | undefined)?.image_url ?? null,
        qtyDec: x.qtyDec,
        entryPriceUsd: x.qtyDec > 0 ? x.costBasisUsd / x.qtyDec : null,
        sizeUsd: x.markUsd,
        costBasisUsd: x.costBasisUsd,
        unrealizedPnlUsd: x.unrealizedPnlUsd,
      })),
      closedTrades,
    };
  });

  // ---------- leaderboard ----------

  app.get("/leaderboard", async (req, reply) => {
    const q = req.query as { period?: string; window?: string; season?: string; metric?: string };
    // Metric: equity (default, mark-to-market) or realized (closed sells only).
    const metric: LeaderboardMetric = q.metric === "realized" ? "realized" : "equity";
    // Season-scoped: ?season=current or ?season=<id> (monthly seasons, fresh 10k).
    if (q.season != null) {
      const seasonId = q.season === "current" ? getSeasonId(db) : Number(q.season);
      const info = Number.isInteger(seasonId) && seasonId > 0 ? seasonInfo(db, seasonId) : null;
      if (!info) return reply.code(404).send({ error: "unknown season" });
      const entries = seasonLeaderboard(db, info.id, metric);
      const badgeMap = badgesForUsers(db, entries.map((e) => e.userId));
      return {
        season: info,
        metric,
        entries: entries.map((e) => ({ ...e, badges: badgeMap.get(e.userId) ?? [] })),
      };
    }
    // New windowed API: ?window=1d|7d|all (rolling windows, all seasons).
    if (q.window != null) {
      if (q.window !== "1d" && q.window !== "7d" && q.window !== "all") {
        return reply.code(400).send({ error: "window must be 1d, 7d, or all" });
      }
      const entries = windowLeaderboard(db, q.window as LeaderboardWindow, undefined, metric);
      const badgeMap = badgesForUsers(db, entries.map((e) => e.userId));
      return {
        window: q.window,
        metric,
        entries: entries.map((e) => ({ ...e, badges: badgeMap.get(e.userId) ?? [] })),
      };
    }
    // Backward compat: ?period=daily|weekly (season-scoped, UTC day / season start).
    const period = q.period || "weekly";
    if (period !== "daily" && period !== "weekly") {
      return reply.code(400).send({ error: "period must be daily or weekly" });
    }
    const entries = period === "daily" ? dailyLeaderboard(db) : weeklyLeaderboard(db);
    return { period, entries };
  });

  // ---------- seasons ----------

  // Current season plus the archive of past winners (top 3 per season).
  app.get("/seasons", async () => {
    const current = seasonInfo(db, getSeasonId(db));
    return {
      current,
      badgeDefs: BADGE_DEFS,
      archive: seasonArchive(db).map((a) => ({ season: a.season, winners: a.winners })),
      all: listSeasons(db),
    };
  });

  // ---------- prize pool ----------
  // Fee-funded prize pools, display only (no payout logic here).
  // Window semantics:
  //   daily pool  = 0.5 * SUM(fee) of trades since 00:00 UTC today; resets at the next UTC midnight.
  //   weekly pool = 0.5 * SUM(fee) of trades since Monday 00:00 UTC of the current week;
  //                 accrues all week and resets at the next Monday 00:00 UTC.
  // Cached in memory for ~30s to keep it a cheap endpoint.
  let prizeCache: { at: number; body: { dailyUsd: number; weeklyUsd: number; dayEndsAt: number; weekEndsAt: number } } | null = null;
  app.get("/prizepool", async () => {
    const now = Date.now();
    if (prizeCache && now - prizeCache.at < 30000) return prizeCache.body;
    const nowS = Math.floor(now / 1000);
    const d = new Date(now);
    const dayStartS = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
    const dayEndsAt = dayStartS + 86400;
    // Monday 00:00 UTC: getUTCDay() is 0=Sun..6=Sat, so Monday offset = (day + 6) % 7 days back.
    const weekStartS = dayStartS - ((d.getUTCDay() + 6) % 7) * 86400;
    const weekEndsAt = weekStartS + 7 * 86400;
    const sumFees = (sinceS: number) =>
      (db.prepare("SELECT COALESCE(SUM(fee), 0) AS f FROM trades WHERE ts >= ? AND ts < ?").get(sinceS, nowS + 1) as { f: number }).f;
    const body = {
      dailyUsd: 0.5 * sumFees(dayStartS),
      weeklyUsd: 0.5 * sumFees(weekStartS),
      dayEndsAt,
      weekEndsAt,
    };
    prizeCache = { at: now, body };
    return body;
  });

  // ---------- recap ----------
  // Shareable text recap for a window. Cached briefly; public endpoint.
  const recapCache = new Map<string, { at: number; body: unknown }>();
  app.get("/recap", async (req, reply) => {
    const q = req.query as { window?: string };
    const w = q.window || "daily";
    if (w !== "daily" && w !== "weekly" && w !== "season") {
      return reply.code(400).send({ error: "window must be daily, weekly, or season" });
    }
    const hit = recapCache.get(w);
    if (hit && Date.now() - hit.at < 30000) return hit.body;
    const body = buildRecap(db, w as RecapWindow);
    recapCache.set(w, { at: Date.now(), body });
    return body;
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

  app.addHook("onClose", async () => {
    hub.stop();
    if (orderTimer) clearInterval(orderTimer);
  });
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
