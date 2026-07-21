"use client";

// First-visit onboarding tour: a lightweight modal sequence (no tour lib).
// Shown once (localStorage flag), skippable, replayable from the "?" button
// in the nav. Steps describe the core loop rather than pinning to DOM nodes,
// which keeps it robust across pages and mobile layouts.
import { createContext, useCallback, useContext, useEffect, useState } from "react";

const SEEN_KEY = "ph_tour_seen";

interface TourCtx {
  open: () => void;
}

const Ctx = createContext<TourCtx>({ open: () => {} });

export function useTour() {
  return useContext(Ctx);
}

interface Step {
  emoji: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    emoji: "🏹",
    title: "Welcome to PaperHood",
    body: "Paper trade tokenized stocks and Robinhood Chain tokens with a fake $10,000. Fills run against real on-chain pool state, so slippage and price impact are real. No real money, all the adrenaline.",
  },
  {
    emoji: "🔎",
    title: "The screener",
    body: "The home page lists every tracked token with live prices, 24h change, liquidity and volume. Click any row to open its chart and trade panel. You can also import any Robinhood Chain token by pasting its contract address.",
  },
  {
    emoji: "💸",
    title: "Buy and sell",
    body: "On a token page, use the trade panel to buy with USD (or ETH) from your $10k and sell any percent of a position. You get a live quote with price impact before you confirm. Connect a wallet first, it is just a signature, no funds move.",
  },
  {
    emoji: "🎯",
    title: "Limit and stop orders",
    body: "Place limit or stop orders from the trade panel. Open orders show as a line on the chart, drag the line to adjust the trigger price. Orders fill automatically when price crosses, even while you are away.",
  },
  {
    emoji: "🏆",
    title: "Leaderboard and seasons",
    body: "Everyone starts each monthly season with a fresh $10k. Daily, weekly and season leaderboards rank equity growth, and trading fees fund real prize pools for the top spots.",
  },
  {
    emoji: "⭐",
    title: "Watchlist",
    body: "Star tokens on the screener or a token page to keep them in your watchlist for quick access. That is it, go make (fake) money. Reopen this tour anytime from the ? button in the nav.",
  },
];

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) {
        setStep(0);
        setVisible(true);
      }
    } catch {}
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
  }, []);

  const open = useCallback(() => {
    setStep(0);
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && step < STEPS.length - 1) setStep((s) => s + 1);
      if (e.key === "ArrowLeft" && step > 0) setStep((s) => s - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, step, close]);

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {visible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 motion-safe:animate-[fadeIn_.15s_ease-out]"
          role="dialog"
          aria-modal="true"
          aria-label="Onboarding tour"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="panel max-h-[85vh] w-full max-w-md overflow-y-auto p-5 shadow-xl">
            <div className="text-3xl">{s.emoji}</div>
            <h2 className="mt-2 text-lg font-bold">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-term-dim">{s.body}</p>
            <div className="mt-5 flex items-center justify-between">
              <div className="flex gap-1.5" aria-hidden="true">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    aria-label={`Go to step ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step ? "w-5 bg-term-accent" : "w-1.5 bg-term-border hover:bg-term-dim"
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {!last && (
                  <button onClick={close} className="btn btn-ghost text-xs">
                    Skip
                  </button>
                )}
                {step > 0 && (
                  <button onClick={() => setStep((x) => x - 1)} className="btn btn-ghost text-xs">
                    Back
                  </button>
                )}
                <button
                  onClick={() => (last ? close() : setStep((x) => x + 1))}
                  className="btn btn-primary text-xs"
                >
                  {last ? "Start trading" : "Next"}
                </button>
              </div>
            </div>
            <div className="mt-3 text-center text-[10px] text-term-dim">
              {step + 1} / {STEPS.length}
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

// Small "?" button for the nav: replays the tour.
export function TourHelpButton() {
  const { open } = useTour();
  return (
    <button
      onClick={open}
      title="Show the intro tour"
      aria-label="Show the intro tour"
      className="flex h-7 w-7 items-center justify-center rounded-full border border-term-border text-xs font-semibold text-term-dim transition-colors hover:text-term-text"
    >
      ?
    </button>
  );
}
