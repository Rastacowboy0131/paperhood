"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, DEV_AUTH } from "@/lib/auth";
import { truncAddr } from "@/lib/api";

const links = [
  { href: "/", label: "Screener" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Nav() {
  const path = usePathname();
  const { address, loading, signingIn, error, signIn, devSignIn, signOut } = useAuth();

  return (
    <header className="border-b border-term-border bg-term-panel">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2.5">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="text-term-accent">Paper</span>Hood{" "}
          <span className="text-sm">🏹</span>
        </Link>
        <nav className="flex gap-4 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                path === l.href
                  ? "text-term-accent"
                  : "text-term-dim hover:text-term-text"
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {error && (
            <span className="max-w-96 break-words text-xs leading-tight text-term-red" title={error}>
              {error}
            </span>
          )}
          {loading ? (
            <span className="text-term-dim">...</span>
          ) : address ? (
            <>
              <span className="num text-term-accent">{truncAddr(address)}</span>
              <button
                onClick={signOut}
                className="rounded border border-term-border px-2 py-1 text-term-dim hover:text-term-text"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                onClick={signIn}
                disabled={signingIn}
                className="rounded bg-term-accent px-3 py-1 font-medium text-black hover:opacity-90 disabled:opacity-50"
              >
                {signingIn ? "Signing..." : "Connect wallet"}
              </button>
              {DEV_AUTH && (
                <button
                  onClick={devSignIn}
                  disabled={signingIn}
                  className="rounded border border-term-amber px-2 py-1 text-term-amber hover:bg-term-amber hover:text-black"
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
