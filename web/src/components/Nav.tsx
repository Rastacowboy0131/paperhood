"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, DEV_AUTH } from "@/lib/auth";
import { truncAddr } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TourHelpButton } from "@/components/Tour";

const links = [
  { href: "/", label: "Screener" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Nav() {
  const path = usePathname();
  const { address, loading, signingIn, error, signIn, devSignIn, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-term-border bg-term-panel/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-baseline gap-1 text-[17px] font-bold tracking-tight">
          <span className="text-term-accent">Paper</span>
          <span>Hood</span>
          <span className="text-xs">🏹</span>
        </Link>
        <nav className="flex h-full items-stretch gap-1 text-[13px]">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center border-b-2 px-2.5 transition-colors ${
                path === l.href
                  ? "border-term-accent font-semibold text-term-text"
                  : "border-transparent text-term-dim hover:text-term-text"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <TourHelpButton />
          <ThemeToggle />
          {error && (
            <span className="max-w-96 break-words text-xs leading-tight text-term-red" title={error}>
              {error}
            </span>
          )}
          {loading ? (
            <span className="skeleton h-6 w-24" />
          ) : address ? (
            <>
              <span className="num rounded-full border border-term-border bg-term-raised px-3 py-1 text-xs font-medium text-term-text">
                {truncAddr(address)}
              </span>
              <button onClick={signOut} className="btn btn-ghost">
                Sign out
              </button>
            </>
          ) : (
            <>
              <button onClick={signIn} disabled={signingIn} className="btn btn-primary">
                {signingIn ? "Signing..." : "Connect wallet"}
              </button>
              {DEV_AUTH && (
                <button
                  onClick={devSignIn}
                  disabled={signingIn}
                  className="btn border border-term-amber/60 text-term-amber hover:bg-term-amber hover:text-white"
                >
                  Dev login
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
