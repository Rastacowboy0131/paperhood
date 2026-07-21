"use client";

// Referral client helpers: store a visited code, claim it after sign-in,
// and fetch the signed-in user's referral stats.
import { API_URL } from "./api";

const LS_REF_KEY = "ph-ref-code";

export interface ReferralTier {
  tier: number;
  minQualified: number;
  name: string;
  flair: "none" | "silver" | "gold";
  rewardLabel: string;
}

export interface ReferralStats {
  code: string;
  signups: number;
  qualified: number;
  tier: ReferralTier | null;
  next: ReferralTier | null;
  tiers: ReferralTier[];
}

export function storeRefCode(code: string): void {
  try {
    const c = code.trim().toLowerCase();
    if (/^[a-z0-9]{4,32}$/.test(c)) localStorage.setItem(LS_REF_KEY, c);
  } catch {}
}

export function getStoredRefCode(): string | null {
  try {
    return localStorage.getItem(LS_REF_KEY);
  } catch {
    return null;
  }
}

export function clearRefCode(): void {
  try {
    localStorage.removeItem(LS_REF_KEY);
  } catch {}
}

// Called after sign-in. Claims the stored code if there is one; the server
// rejects self-referral, existing accounts, and already-attributed users.
// Clears the stored code on any definitive answer so we do not retry forever.
export async function claimStoredReferral(): Promise<void> {
  const code = getStoredRefCode();
  if (!code) return;
  try {
    const res = await fetch(`${API_URL}/referrals/claim`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok || res.status === 400) clearRefCode();
  } catch {
    // Network hiccup: keep the code, retry on the next sign-in.
  }
}

export async function fetchReferralStats(): Promise<ReferralStats | null> {
  try {
    const res = await fetch(`${API_URL}/referrals/me`, { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as ReferralStats;
  } catch {
    return null;
  }
}

export function referralLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/r/${code}`;
}
