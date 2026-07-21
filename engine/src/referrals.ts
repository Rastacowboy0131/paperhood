// Referral tracking with milestone supply rewards.
// Each user gets a short code derived from their user id. New users who sign
// in with a stored code get attributed to the referrer. A referral only
// counts as "qualified" once the referred user has made at least one trade.
// Rewards are paid manually by Rasta in token supply at season end; the site
// only displays tier labels, never token amounts.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// ---------- tier config (single tuning spot) ----------
// Rasta: adjust thresholds/labels here. Reward amounts are intentionally not
// stored on-site; payouts happen manually in supply at season end.
export interface ReferralTier {
  tier: number;
  minQualified: number;
  name: string;
  flair: "none" | "silver" | "gold";
  rewardLabel: string;
}

export const REFERRAL_TIERS: ReferralTier[] = [
  { tier: 1, minQualified: 5, name: "Recruiter", flair: "none", rewardLabel: "Tier 1 reward, paid in supply at season end" },
  { tier: 2, minQualified: 10, name: "Recruiter II", flair: "silver", rewardLabel: "Tier 2 reward, paid in supply at season end" },
  { tier: 3, minQualified: 20, name: "Recruiter III", flair: "gold", rewardLabel: "Tier 3 reward, paid in supply at season end" },
  { tier: 4, minQualified: 50, name: "Recruiter IV", flair: "gold", rewardLabel: "Tier 4 reward (max), paid in supply at season end" },
];

// A claim is only accepted while the account is fresh (blocks attributing
// long-existing users to a referrer).
const CLAIM_WINDOW_S = 24 * 3600;

export function tierForCount(qualified: number): ReferralTier | null {
  let best: ReferralTier | null = null;
  for (const t of REFERRAL_TIERS) if (qualified >= t.minQualified) best = t;
  return best;
}

export function nextTier(qualified: number): ReferralTier | null {
  for (const t of REFERRAL_TIERS) if (qualified < t.minQualified) return t;
  return null;
}

// ---------- schema ----------

export function migrateReferrals(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS referrals (
  referred_user_id INTEGER PRIMARY KEY,
  referrer_user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
`);
}

// ---------- codes ----------

// Deterministic short code from the user id: 8 lowercase base36 chars.
// Hash-based so codes are not guessable/enumerable from ids.
function deriveCode(userId: number): string {
  const h = crypto.createHash("sha256").update(`ph-referral-v1:${userId}`).digest();
  let out = "";
  for (let i = 0; out.length < 8 && i < h.length; i++) {
    out += (h[i] % 36).toString(36);
  }
  return out;
}

export function getOrCreateCode(db: DatabaseSync, userId: number): string {
  migrateReferrals(db);
  const row = db.prepare("SELECT code FROM referral_codes WHERE user_id = ?").get(userId) as { code: string } | undefined;
  if (row) return row.code;
  let code = deriveCode(userId);
  // Collision is astronomically unlikely at this scale; salt-and-retry anyway.
  for (let salt = 0; salt < 5; salt++) {
    const clash = db.prepare("SELECT user_id FROM referral_codes WHERE code = ?").get(code) as { user_id: number } | undefined;
    if (!clash) break;
    code = crypto.createHash("sha256").update(`ph-referral-v1:${userId}:${salt + 1}`).digest("hex").slice(0, 8);
  }
  db.prepare("INSERT INTO referral_codes (user_id, code, created_at) VALUES (?, ?, ?)").run(userId, code, Math.floor(Date.now() / 1000));
  return code;
}

export function userForCode(db: DatabaseSync, code: string): number | null {
  migrateReferrals(db);
  const row = db.prepare("SELECT user_id FROM referral_codes WHERE code = ?").get(code.toLowerCase().trim()) as { user_id: number } | undefined;
  return row ? row.user_id : null;
}

// ---------- attribution ----------

export type ClaimResult = { ok: true } | { ok: false; reason: string };

export function claimReferral(db: DatabaseSync, referredUserId: number, code: string): ClaimResult {
  migrateReferrals(db);
  const referrerId = userForCode(db, code);
  if (referrerId == null) return { ok: false, reason: "unknown code" };
  if (referrerId === referredUserId) return { ok: false, reason: "self-referral not allowed" };

  const existing = db.prepare("SELECT referrer_user_id FROM referrals WHERE referred_user_id = ?").get(referredUserId) as { referrer_user_id: number } | undefined;
  if (existing) return { ok: false, reason: "already attributed" };

  const now = Math.floor(Date.now() / 1000);
  const user = db.prepare("SELECT created_at FROM users WHERE id = ?").get(referredUserId) as { created_at: number } | undefined;
  if (!user) return { ok: false, reason: "unknown user" };
  if (now - user.created_at > CLAIM_WINDOW_S) return { ok: false, reason: "account too old for referral attribution" };

  const traded = db.prepare("SELECT COUNT(*) AS c FROM trades WHERE user_id = ?").get(referredUserId) as { c: number };
  if (traded.c > 0) return { ok: false, reason: "account already traded before attribution" };

  db.prepare("INSERT INTO referrals (referred_user_id, referrer_user_id, code, created_at) VALUES (?, ?, ?, ?)").run(referredUserId, referrerId, code.toLowerCase().trim(), now);
  return { ok: true };
}

// ---------- stats ----------

export interface ReferralStats {
  code: string;
  signups: number;
  qualified: number;
  tier: ReferralTier | null;
  next: ReferralTier | null;
  tiers: ReferralTier[];
}

function qualifiedCount(db: DatabaseSync, referrerId: number): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM referrals r
     WHERE r.referrer_user_id = ?
       AND EXISTS (SELECT 1 FROM trades t WHERE t.user_id = r.referred_user_id)`
  ).get(referrerId) as { c: number };
  return row.c;
}

export function getReferralStats(db: DatabaseSync, userId: number): ReferralStats {
  migrateReferrals(db);
  const code = getOrCreateCode(db, userId);
  const signups = (db.prepare("SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = ?").get(userId) as { c: number }).c;
  const qualified = qualifiedCount(db, userId);
  return { code, signups, qualified, tier: tierForCount(qualified), next: nextTier(qualified), tiers: REFERRAL_TIERS };
}

// Season-end payout summary: every referrer with at least one qualified ref.
export interface ReferralSummaryRow {
  userId: number;
  address: string;
  signups: number;
  qualified: number;
  tier: number | null;
  tierName: string | null;
  rewardLabel: string | null;
}

export function referralSummary(db: DatabaseSync): ReferralSummaryRow[] {
  migrateReferrals(db);
  const rows = db.prepare(
    `SELECT r.referrer_user_id AS userId, u.address,
            COUNT(*) AS signups,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM trades t WHERE t.user_id = r.referred_user_id) THEN 1 ELSE 0 END) AS qualified
     FROM referrals r JOIN users u ON u.id = r.referrer_user_id
     GROUP BY r.referrer_user_id
     ORDER BY qualified DESC, signups DESC`
  ).all() as { userId: number; address: string; signups: number; qualified: number }[];
  return rows.map((r) => {
    const tier = tierForCount(r.qualified);
    return {
      userId: r.userId,
      address: r.address,
      signups: r.signups,
      qualified: r.qualified,
      tier: tier?.tier ?? null,
      tierName: tier?.name ?? null,
      rewardLabel: tier?.rewardLabel ?? null,
    };
  });
}

// Flair for leaderboard rows: silver at tier 2+, gold at tier 3+.
export function referralFlairForUsers(db: DatabaseSync, userIds: number[]): Map<number, "silver" | "gold"> {
  migrateReferrals(db);
  const out = new Map<number, "silver" | "gold">();
  if (!userIds.length) return out;
  const placeholders = userIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT r.referrer_user_id AS userId,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM trades t WHERE t.user_id = r.referred_user_id) THEN 1 ELSE 0 END) AS qualified
     FROM referrals r
     WHERE r.referrer_user_id IN (${placeholders})
     GROUP BY r.referrer_user_id`
  ).all(...userIds) as { userId: number; qualified: number }[];
  for (const r of rows) {
    const tier = tierForCount(r.qualified);
    if (tier && tier.flair !== "none") out.set(r.userId, tier.flair);
  }
  return out;
}
