"use client";

// Subtle silver/gold dot next to trader names for tier 2+/tier 3+ referrers.
export function ReferralFlair({ flair }: { flair?: "silver" | "gold" | null }) {
  if (!flair) return null;
  const color = flair === "gold" ? "#eab308" : "#94a3b8";
  const title = flair === "gold" ? "Gold recruiter (referral tier 3+)" : "Silver recruiter (referral tier 2+)";
  return (
    <svg
      viewBox="0 0 12 12"
      className="ml-1 inline-block h-3 w-3 align-middle"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
