// Sign-In with Ethereum (EIP-4361) session auth: HS256 JWT, httpOnly cookie.
// Flow: GET /auth/nonce -> frontend builds a SIWE message, wallet signs it ->
// POST /auth/verify checks the message + signature and issues the cookie.
// DEV_AUTH=1 keeps a fake wallet login for local dev.
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DatabaseSync } from "node:sqlite";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { recoverMessageAddress } from "viem";
import { getOrCreateUser } from "../../engine/src/ledger.js";

const COOKIE = "ph_session";
const SESSION_TTL_S = 7 * 86400;
const NONCE_TTL_S = 5 * 60;
export const ALLOWED_CHAIN_IDS = [1, 4663]; // mainnet, Robinhood chain

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface SessionUser {
  userId: number;
  address: string; // lowercase 0x wallet address
}

export function getSession(req: FastifyRequest, secret: string): SessionUser | null {
  const token = (req.cookies as Record<string, string | undefined>)?.[COOKIE];
  if (!token) return null;
  const p = verifyJwt(token, secret);
  if (!p || typeof p.userId !== "number") return null;
  return { userId: p.userId as number, address: String(p.address ?? "") };
}

export function requireAuth(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const session = getSession(req, secret);
    if (!session) {
      reply.code(401).send({ error: "not authenticated" });
      return reply;
    }
    (req as FastifyRequest & { user: SessionUser }).user = session;
  };
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  // Web and API live on different sites (vercel.app vs railway.app), so the
  // session cookie must be SameSite=None (with Secure) or browsers drop it
  // on cross-site fetches and every page load looks signed out.
  const crossSite = process.env.NODE_ENV === "production";
  reply.setCookie(COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: crossSite ? "none" : "lax",
    secure: crossSite,
    maxAge: SESSION_TTL_S,
  });
}

function issueSession(reply: FastifyReply, db: DatabaseSync, secret: string, address: string): SessionUser {
  const addr = address.toLowerCase();
  const userId = getOrCreateUser(db, addr);
  const token = signJwt(
    { userId, address: addr, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S },
    secret,
  );
  setSessionCookie(reply, token);
  return { userId, address: addr };
}

// ---------- nonce storage ----------

function ensureNonceTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`);
}

function issueNonce(db: DatabaseSync): string {
  ensureNonceTable(db);
  // 96 bits of randomness, alphanumeric (EIP-4361 requires >= 8 alphanumeric chars).
  const nonce = crypto.randomBytes(12).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM auth_nonces WHERE expires_at < ?").run(now);
  db.prepare("INSERT INTO auth_nonces (nonce, expires_at) VALUES (?, ?)").run(nonce, now + NONCE_TTL_S);
  return nonce;
}

// Returns true and consumes the nonce if it exists and has not expired.
function consumeNonce(db: DatabaseSync, nonce: string): boolean {
  ensureNonceTable(db);
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare("SELECT expires_at FROM auth_nonces WHERE nonce = ?").get(nonce) as { expires_at: number } | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM auth_nonces WHERE nonce = ?").run(nonce);
  return row.expires_at >= now;
}

// ---------- routes ----------

export function registerAuthRoutes(app: FastifyInstance, db: DatabaseSync, secret: string): void {
  const expectedDomain = process.env.SIWE_DOMAIN || null; // e.g. "app.paperhood.xyz"; unset = accept the message's own domain

  // Dev login: DEV_AUTH=1 lets you log in as a fake wallet without signing anything.
  if (process.env.DEV_AUTH === "1") {
    app.get("/auth/dev", async (req, reply) => {
      const q = req.query as { address?: string };
      const address = (q.address || "0x000000000000000000000000000000000000dEaD").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address)) return reply.code(400).send({ error: "invalid address" });
      const user = issueSession(reply, db, secret, address);
      return { ok: true, user };
    });
  }

  app.get("/auth/nonce", async () => {
    return { nonce: issueNonce(db), expiresInS: NONCE_TTL_S };
  });

  app.post("/auth/verify", async (req, reply) => {
    const body = req.body as { message?: string; signature?: string };
    if (!body?.message || !body?.signature) {
      return reply.code(400).send({ error: "message and signature required" });
    }

    const fields = parseSiweMessage(body.message);
    if (!fields.address || !fields.nonce || !fields.chainId || !fields.domain) {
      return reply.code(400).send({ error: "invalid SIWE message" });
    }
    if (!ALLOWED_CHAIN_IDS.includes(fields.chainId)) {
      return reply.code(400).send({ error: `chainId must be one of ${ALLOWED_CHAIN_IDS.join(", ")}` });
    }
    // Checks address format, domain (when configured), notBefore/expirationTime windows.
    const valid = validateSiweMessage({
      message: fields,
      ...(expectedDomain ? { domain: expectedDomain } : {}),
    });
    if (!valid) return reply.code(401).send({ error: "SIWE message failed validation (domain or time window)" });

    if (!consumeNonce(db, fields.nonce)) {
      return reply.code(401).send({ error: "unknown or expired nonce" });
    }

    let recovered: string;
    try {
      recovered = await recoverMessageAddress({
        message: body.message,
        signature: body.signature as `0x${string}`,
      });
    } catch {
      return reply.code(401).send({ error: "invalid signature" });
    }
    if (recovered.toLowerCase() !== fields.address.toLowerCase()) {
      return reply.code(401).send({ error: "signature does not match address" });
    }

    const user = issueSession(reply, db, secret, fields.address);
    return { ok: true, user };
  });

  app.get("/auth/me", async (req, reply) => {
    const session = getSession(req, secret);
    if (!session) return reply.code(401).send({ error: "not authenticated" });
    const row = db.prepare("SELECT created_at FROM users WHERE id = ?").get(session.userId) as { created_at: number } | undefined;
    return { user: { ...session, createdAt: row?.created_at ?? null } };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
}
