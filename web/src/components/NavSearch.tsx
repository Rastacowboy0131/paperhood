"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, TokenRow } from "@/lib/api";

const CA_RE = /^0x[0-9a-fA-F]{40}$/;

// Global CA / token search box that lives in the nav on every page.
// Paste a contract address: goes to the token page, importing it first if unknown.
// Type a name/ticker: quick dropdown of matching tracked tokens.
export function NavSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Lazy-load the token list the first time the box is focused.
  async function ensureTokens() {
    if (tokens) return tokens;
    try {
      const r = await api.tokens();
      setTokens(r.tokens);
      return r.tokens;
    } catch {
      return [];
    }
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const query = q.trim();
  const isCa = CA_RE.test(query);
  const matches =
    !isCa && query.length >= 1 && tokens
      ? tokens
          .filter(
            (t) =>
              t.symbol.toLowerCase().includes(query.toLowerCase()) ||
              t.name.toLowerCase().includes(query.toLowerCase())
          )
          .slice(0, 6)
      : [];

  function goTo(address: string) {
    setOpen(false);
    setQ("");
    setErr(null);
    router.push(`/t/${address}`);
  }

  async function submit() {
    if (!query || busy) return;
    setErr(null);
    if (isCa) {
      const list = await ensureTokens();
      const known = list.find((t) => t.address.toLowerCase() === query.toLowerCase());
      if (known) return goTo(known.address);
      setBusy(true);
      try {
        const r = await api.importToken(query);
        goTo(r.address);
      } catch (e) {
        setErr((e as Error).message || "Import failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (matches.length > 0) goTo(matches[0].address);
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 md:max-w-xs">
      <input
        type="text"
        inputMode="text"
        value={q}
        placeholder="Search CA or ticker"
        aria-label="Search contract address or ticker"
        onFocus={() => {
          setOpen(true);
          void ensureTokens();
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") setOpen(false);
        }}
        className="h-8 w-full rounded-md border border-term-border bg-term-raised px-2.5 text-[16px] text-term-text placeholder:text-term-dim focus:border-term-accent focus:outline-none md:text-xs"
      />
      {open && (query.length > 0 || err) && (
        <div className="absolute left-0 right-0 top-9 z-30 overflow-hidden rounded-md border border-term-border bg-term-panel shadow-lg">
          {err && <div className="px-3 py-2 text-xs text-term-red">{err}</div>}
          {busy && <div className="px-3 py-2 text-xs text-term-dim">Importing token...</div>}
          {!busy && isCa && !err && (
            <button
              onClick={() => void submit()}
              className="block w-full px-3 py-2 text-left text-xs text-term-text hover:bg-term-raised"
            >
              Open <span className="num">{query.slice(0, 6)}...{query.slice(-4)}</span> (import if new)
            </button>
          )}
          {!busy &&
            !isCa &&
            matches.map((t) => (
              <button
                key={t.address}
                onClick={() => goTo(t.address)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-term-raised"
              >
                <span className="font-semibold text-term-text">{t.symbol}</span>
                <span className="truncate text-term-dim">{t.name}</span>
              </button>
            ))}
          {!busy && !isCa && query.length >= 2 && tokens && matches.length === 0 && !err && (
            <div className="px-3 py-2 text-xs text-term-dim">No match. Paste a full CA to import.</div>
          )}
        </div>
      )}
    </div>
  );
}
