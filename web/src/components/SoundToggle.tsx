"use client";

// Nav mute toggle for fill sounds. Persisted in localStorage, default ON.
import { useEffect, useState } from "react";
import { setSoundsMuted, soundsMuted } from "@/lib/sounds";

export function SoundToggle() {
  const [muted, setMuted] = useState(false);
  useEffect(() => setMuted(soundsMuted()), []);

  function toggle() {
    const next = !muted;
    setMuted(next);
    setSoundsMuted(next);
  }

  return (
    <button
      onClick={toggle}
      title={muted ? "Unmute fill sounds" : "Mute fill sounds"}
      aria-label={muted ? "Unmute fill sounds" : "Mute fill sounds"}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-term-border text-term-dim transition-colors hover:text-term-text"
    >
      {muted ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
    </button>
  );
}
