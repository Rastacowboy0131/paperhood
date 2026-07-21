// Referral API routes. Auth-gated stats for the signed-in user, a public
// claim endpoint (used right after first sign-in), and a public read-only
// season-end summary for payouts.
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DatabaseSync } from "node:sqlite";
import { getReferralStats, claimReferral, referralSummary, REFERRAL_TIERS } from "../../engine/src/referrals.js";
import type { SessionUser } from "./auth.js";

type AuthedRequest = FastifyRequest & { user: SessionUser };

export function registerReferralRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  auth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
): void {
  // Signed-in user's referral stats: code, counts, tier progress.
  app.get("/referrals/me", { preHandler: auth }, async (req) => {
    const user = (req as AuthedRequest).user;
    return getReferralStats(db, user.userId);
  });

  // Attribute the signed-in user to a referrer code (stored client-side from
  // a /r/[code] visit). Safe to call repeatedly; rejects self-referral,
  // existing accounts, and accounts that already traded.
  app.post("/referrals/claim", { preHandler: auth }, async (req, reply) => {
    const user = (req as AuthedRequest).user;
    const body = req.body as { code?: string } | undefined;
    const code = String(body?.code ?? "").trim();
    if (!code || code.length > 32) return reply.code(400).send({ error: "code required" });
    const result = claimReferral(db, user.userId, code);
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true };
  });

  // Public read-only aggregate for season-end payouts. Addresses are public
  // anyway; no reward amounts are exposed, only tier labels.
  app.get("/referrals/summary", async () => {
    return { tiers: REFERRAL_TIERS, referrers: referralSummary(db) };
  });
}
