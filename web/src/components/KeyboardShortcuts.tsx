"use client";

// Global desktop keyboard shortcuts, dependency-free.
//   /        focus the screener search (navigates home first if needed)
//   g then l leaderboard
//   g then p portfolio
//   g then s seasons
//   ?        toggle the shortcut cheat sheet
// Trade page keys (b, s) are dispatched as custom events; the trade page
// listens and focuses its own inputs. Keystrokes inside inputs, textareas,
// selects, and contenteditable regions are ignored.

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const G_TIMEOUT_MS = 900;

export const TRADE_KEY_EVENT = "ph:trade-key";

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "/", desc: "Focus token search (screener)" },
  { keys: "g l", desc: "Go to leaderboard" },
  { keys: "g p", desc: "Go to portfolio" },
  { keys: "g s", desc: "Go to seasons" },
  { keys: "g h", desc: "Go to screener (home)" },
  { keys: "b", desc: "Trade page: focus buy amount" },
  { keys: "s", desc: "Trade page: focus sell percent" },
  { keys: "?", desc: "Show this cheat sheet" },
  { keys: "Esc", desc: "Close dialogs" },
];

export function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <h3 className="text-sm font-bold">Keyboard shortcuts</h3>
          <button onClick={onClose} className="ml-auto text-term-dim hover:text-term-text" aria-label="Close">
            {"\u2715"}
          </button>
        </div>
        <div className="space-y-1.5 text-[13px]">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center gap-3">
              <span className="flex w-16 shrink-0 gap-1">
                {s.keys.split(" ").map((k, i) => (
                  <kbd key={i} className="num rounded border border-term-border bg-term-raised px-1.5 py-0.5 text-[11px]">
                    {k}
                  </kbd>
                ))}
              </span>
              <span className="text-term-dim">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [help, setHelp] = useState(false);
  const [gAt, setGAt] = useState(0);

  const focusSearch = useCallback(() => {
    const el = document.getElementById("screener-search") as HTMLInputElement | null;
    if (el) {
      el.focus();
      el.select();
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    // Retry the search focus after navigating home from another page.
    if (pathname === "/") {
      const pending = sessionStorage.getItem("ph.focusSearch");
      if (pending) {
        sessionStorage.removeItem("ph.focusSearch");
        // Give the screener a tick to mount its input.
        setTimeout(focusSearch, 50);
      }
    }
  }, [pathname, focusSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      const now = Date.now();
      const gPending = now - gAt < G_TIMEOUT_MS;

      if (gPending) {
        setGAt(0);
        const nav: Record<string, string> = { l: "/leaderboard", p: "/portfolio", s: "/seasons", h: "/" };
        const dest = nav[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          router.push(dest);
          return;
        }
      }

      switch (e.key) {
        case "g":
          setGAt(now);
          return;
        case "/":
          e.preventDefault();
          if (!focusSearch()) {
            sessionStorage.setItem("ph.focusSearch", "1");
            router.push("/");
          }
          return;
        case "?":
          e.preventDefault();
          setHelp((h) => !h);
          return;
        case "b":
        case "s":
          // Trade page focus keys; only meaningful on /t/*.
          if (pathname?.startsWith("/t/")) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent(TRADE_KEY_EVENT, { detail: e.key }));
          }
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname, gAt, focusSearch]);

  return help ? <ShortcutHelpModal onClose={() => setHelp(false)} /> : null;
}

// Small "?" trigger for menus/help areas.
export function ShortcutHelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts (?)"
        className="hidden h-7 w-7 items-center justify-center rounded-full border border-term-border text-xs text-term-dim transition-colors hover:bg-term-hover hover:text-term-text md:flex"
      >
        <kbd className="num">?</kbd>
      </button>
      {open && <ShortcutHelpModal onClose={() => setOpen(false)} />}
    </>
  );
}
