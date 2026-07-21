"use client";

import { useState } from "react";

// Token logo with a graceful fallback: if there is no image URL or it fails
// to load, render a neutral circle with the ticker's first letters. Sized via
// the size prop (px); colors follow the CSS variable theme.
export function TokenLogo({
  src,
  symbol,
  size = 28,
  className = "",
}: {
  src?: string | null;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = (symbol || "?").slice(0, 2).toUpperCase();
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={symbol}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full bg-term-raised object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-term-raised font-bold text-term-accent ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {initials}
    </span>
  );
}
