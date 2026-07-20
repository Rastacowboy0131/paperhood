// Minimal signed-token session auth: HS256 JWT, httpOnly cookie.
// Discord OAuth2 code flow issues the token; DEV_AUTH=1 gives a fake login.
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DatabaseSync } from "node:sqlite";
import { getOrCreateUser } from "../../engine/src/ledger.js";

const COOKIE = "ph_session";
const SESSION_TTL_S = 7 * 86400;

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
  discordId: string;
  username: string;
}

export function getSession(req: FastifyRequest, secret: string): SessionUser | null {
  const token = (req.cookies as Record<string, string | undefined>)?.[COOKIE];
  if (!token) return null;
  const p = verifyJwt(token, secret);
  if (!p || typeof p.userId !== "number") return null;
  return { userId: p.userId as number, discordId: String(p.discordId ?? ""), username: String(p.username ?? "") };
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
  reply.setCookie(COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_S,
  });
}

function issueSession(reply: FastifyReply, db: DatabaseSync, secret: string, discordId: string, username: string): SessionUser {
  const userId = getOrCreateUser(db, discordId);
  const token = signJwt(
    { userId, discordId, username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S },
    secret,
  );
  setSessionCookie(reply, token);
  return { userId, discordId, username };
}

export function registerAuthRoutes(app: FastifyInstance, db: DatabaseSync, secret: string): void {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const baseUrl = process.env.BASE_URL || "http://localhost:8787";
  const redirectUri = `${baseUrl}/auth/discord/callback`;

  // Dev login: DEV_AUTH=1 lets you log in as a fake user without Discord creds.
  if (process.env.DEV_AUTH === "1") {
    app.get("/auth/dev", async (req, reply) => {
      const q = req.query as { discordId?: string; username?: string };
      const discordId = q.discordId || "dev-user-1";
      const username = q.username || "DevUser";
      const user = issueSession(reply, db, secret, discordId, username);
      return { ok: true, user };
    });
  }

  app.get("/auth/discord", async (_req, reply) => {
    if (!clientId) return reply.code(500).send({ error: "DISCORD_CLIENT_ID not configured" });
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    return reply.redirect(url.toString());
  });

  app.get("/auth/discord/callback", async (req, reply) => {
    if (!clientId || !clientSecret) return reply.code(500).send({ error: "Discord OAuth not configured" });
    const code = (req.query as { code?: string }).code;
    if (!code) return reply.code(400).send({ error: "missing code" });

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) return reply.code(502).send({ error: "token exchange failed" });
    const tok = (await tokenRes.json()) as { access_token: string };

    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!meRes.ok) return reply.code(502).send({ error: "failed to fetch discord user" });
    const me = (await meRes.json()) as { id: string; username: string };

    issueSession(reply, db, secret, me.id, me.username);
    const webOrigin = process.env.WEB_ORIGIN;
    if (webOrigin) return reply.redirect(webOrigin);
    return { ok: true, user: { discordId: me.id, username: me.username } };
  });

  app.get("/auth/me", async (req, reply) => {
    const session = getSession(req, secret);
    if (!session) return reply.code(401).send({ error: "not authenticated" });
    return { user: session };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
}
