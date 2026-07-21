"use client";

// Referrals panel: your link with a copy button, signup/qualified counts,
// tier progress. Rewards are paid manually in supply at season end; only
// tier labels are shown, never token amounts.
import { useEffect, useState } from "react";
import { fetchReferralStats, referralLink, ReferralStats } from "@/lib/referrals";
import { useAuth } from "@/lib/auth";

export function ReferralsPanel() {
  const { address } = useAuth();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) {
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchReferralStats().then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, [address]);

  if (!address) {
    return (
      <div className="rounded-lg border border-term-border bg-term-panel p-4 text-sm text-term-dim">
        Sign in to get your referral link.
      </div>
    );
  }
  if (loading) return <div className="skeleton h-40 rounded-lg" />;
  if (!stats) {
    return (
      <div className="rounded-lg border border-term-border bg-term-panel p-4 text-sm text-term-dim">
        Could not load referral stats.
      </div>
    );
  }

  const link = referralLink(stats.code);
  const target = stats.next?.minQualified ?? stats.tier?.minQualified ?? 5;
  const pct = Math.min(100, Math.round((stats.qualified / target) * 100));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="rounded-lg border border-term-border bg-term-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Referrals</h2>
        {stats.tier && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              stats.tier.flair === "gold"
                ? "border-yellow-500/60 text-yellow-500"
                : stats.tier.flair === "silver"
                  ? "border-slate-400/60 text-slate-400"
                  : "border-term-border text-term-dim"
            }`}
          >
            {stats.tier.name}
          </span>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="num min-w-0 flex-1 rounded border border-term-border bg-term-raised px-2 py-1.5 text-xs text-term-text"
        />
        <button onClick={copy} className="btn btn-primary shrink-0 text-xs">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded border border-term-border bg-term-raised px-2 py-2">
          <div className="num text-lg font-semibold">{stats.signups}</div>
          <div className="text-[11px] text-term-dim">Signups</div>
        </div>
        <div className="rounded border border-term-border bg-term-raised px-2 py-2">
          <div className="num text-lg font-semibold">{stats.qualified}</div>
          <div className="text-[11px] text-term-dim">Qualified (traded)</div>
        </div>
      </div>

      {stats.next ? (
        <div className="mb-1">
          <div className="mb-1 flex justify-between text-[11px] text-term-dim">
            <span>
              Next: {stats.next.name} at {stats.next.minQualified} qualified
            </span>
            <span className="num">
              {stats.qualified}/{stats.next.minQualified}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-term-raised">
            <div className="h-full rounded-full bg-term-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <div className="mb-1 text-[11px] text-term-dim">Max tier reached.</div>
      )}

      {stats.tier && <div className="mt-2 text-[11px] text-term-dim">{stats.tier.rewardLabel}</div>}
      <div className="mt-2 text-[11px] text-term-dim">
        A referral counts once the referred trader makes their first trade. Rewards are paid in supply at season end.
      </div>
    </div>
  );
}
