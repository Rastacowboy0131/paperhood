"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, DEV_AUTH } from "@/lib/auth";
import { truncAddr } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TourHelpButton } from "@/components/Tour";
import { SoundToggle } from "@/components/SoundToggle";

const links = [
  { href: "/", label: "Screener" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/referrals", label: "Referrals" },
];

export function Nav() {
  const path = usePathname();
  const { address, loading, signingIn, error, signIn, devSignIn, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-term-border bg-term-panel/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 px-3 sm:px-4 md:h-14 md:flex-nowrap md:gap-6">
        <Link href="/" className="flex items-baseline gap-1 text-[17px] font-bold tracking-tight">
          <span className="text-term-accent">Paper</span>
          <span>Hood</span>
          <span className="text-xs">🏹</span>
        </Link>
        <nav className="order-last -mx-3 flex h-10 w-[calc(100%+1.5rem)] items-stretch gap-1 overflow-x-auto px-3 text-[13px] sm:-mx-4 sm:w-[calc(100%+2rem)] sm:px-4 md:order-none md:mx-0 md:h-14 md:w-auto md:overflow-visible md:px-0">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center whitespace-nowrap border-b-2 px-2.5 transition-colors ${
                path === l.href
                  ? "border-term-accent font-semibold text-term-text"
                  : "border-transparent text-term-dim hover:text-term-text"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex h-14 items-center gap-1.5 text-sm sm:gap-2">
          <TourHelpButton />
          <SoundToggle />
          <ThemeToggle />
          {error && (
            <span className="max-w-[40vw] break-words text-xs leading-tight text-term-red md:max-w-96" title={error}>
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
