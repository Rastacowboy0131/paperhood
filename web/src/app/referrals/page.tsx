"use client";

// Referrals page: your link + stats panel, plus the tier table.
import { useEffect, useState } from "react";
import { ReferralsPanel } from "@/components/ReferralsPanel";
import { fetchReferralStats, ReferralTier } from "@/lib/referrals";
import { useAuth } from "@/lib/auth";

const FALLBACK_TIERS: ReferralTier[] = [
  { tier: 1, minQualified: 5, name: "Recruiter", flair: "none", rewardLabel: "Tier 1 reward, paid in supply at season end" },
  { tier: 2, minQualified: 10, name: "Recruiter II", flair: "silver", rewardLabel: "Tier 2 reward, paid in supply at season end" },
  { tier: 3, minQualified: 20, name: "Recruiter III", flair: "gold", rewardLabel: "Tier 3 reward, paid in supply at season end" },
  { tier: 4, minQualified: 50, name: "Recruiter IV", flair: "gold", rewardLabel: "Tier 4 reward (max), paid in supply at season end" },
];

export default function ReferralsPage() {
  const { address } = useAuth();
  const [tiers, setTiers] = useState<ReferralTier[]>(FALLBACK_TIERS);
  const [qualified, setQualified] = useState(0);

  useEffect(() => {
    if (!address) return;
    fetchReferralStats().then((s) => {
      if (s) {
        setTiers(s.tiers);
        setQualified(s.qualified);
      }
    });
  }, [address]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-lg font-bold">Referrals</h1>
      <p className="mb-4 text-sm text-term-dim">
        Invite traders, earn supply rewards at season end. A referral qualifies once the invited trader makes their
        first trade.
      </p>

      <ReferralsPanel />

      <div className="mt-6 rounded-lg border border-term-border bg-term-panel p-4">
        <h2 className="mb-3 text-sm font-semibold">Milestone tiers</h2>
        <ul className="space-y-2">
          {tiers.map((t) => {
            const reached = qualified >= t.minQualified;
            return (
              <li
                key={t.tier}
                className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border px-3 py-2 text-sm ${
                  reached ? "border-term-accent/50 bg-term-raised" : "border-term-border"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                      t.flair === "gold" ? "bg-yellow-500" : t.flair === "silver" ? "bg-slate-400" : "bg-term-accent"
                    }`}
                  />
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="num shrink-0 text-xs text-term-dim">{t.minQualified} qualified</span>
                </div>
                <span className="shrink-0 text-right text-[11px] text-term-dim">{t.rewardLabel}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
