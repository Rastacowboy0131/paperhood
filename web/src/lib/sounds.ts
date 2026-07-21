"use client";

// Fill sounds: short WebAudio-generated tones on order fills. No audio
// assets, everything synthesized. Buy and sell differ (buy rises, sell
// falls); limit-order triggers get a subtle two-note ping.
// Mute state persists in localStorage (default ON). Browsers block audio
// until the first user gesture, so the AudioContext is created lazily and
// resumed on first interaction.

const MUTE_KEY = "ph_sounds_muted";

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

// Called on any user gesture (pointerdown/keydown listeners below): resume
// the context so later programmatic plays are allowed.
function unlock(): void {
  if (unlocked) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  unlocked = true;
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function soundsMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function setSoundsMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
}

function tone(c: AudioContext, freq: number, startAt: number, dur: number, gainPeak: number, type: OscillatorType = "sine"): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  g.gain.setValueAtTime(0, startAt);
  g.gain.linearRampToValueAtTime(gainPeak, startAt + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(g).connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

function play(fn: (c: AudioContext, t: number) => void): void {
  if (soundsMuted()) return;
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") { void c.resume(); }
  fn(c, c.currentTime);
}

// Buy: rising major third, bright and quick.
export function playBuyFill(): void {
  play((c, t) => {
    tone(c, 523.25, t, 0.12, 0.16);        // C5
    tone(c, 659.25, t + 0.07, 0.16, 0.16); // E5
  });
}

// Sell: falling interval, slightly softer.
export function playSellFill(): void {
  play((c, t) => {
    tone(c, 659.25, t, 0.12, 0.15);        // E5
    tone(c, 493.88, t + 0.07, 0.18, 0.15); // B4
  });
}

// Limit/stop trigger while the page is open: subtle two-note ping, quieter.
export function playOrderTriggered(): void {
  play((c, t) => {
    tone(c, 880, t, 0.09, 0.08, "triangle");        // A5
    tone(c, 1174.66, t + 0.09, 0.14, 0.08, "triangle"); // D6
  });
}
