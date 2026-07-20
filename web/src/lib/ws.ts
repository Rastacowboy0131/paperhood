"use client";

// Shared WS price feed. One socket, token subscriptions ref-counted per hook user.

import { useEffect, useRef, useState } from "react";
import { API_ORIGIN } from "./api";

type PriceUpdate = { token: string; pair: string; price: number; ts: number };
type Listener = (u: PriceUpdate) => void;

let ws: WebSocket | null = null;
let openPromise: Promise<WebSocket> | null = null;
const listeners = new Set<Listener>();
const subCounts = new Map<string, number>();

function wsUrl(): string {
  // WebSockets connect straight to the backend; Vercel rewrites do not proxy WS.
  return API_ORIGIN.replace(/^http/, "ws") + "/ws";
}

function ensureSocket(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve) => {
    const sock = new WebSocket(wsUrl());
    sock.onopen = () => {
      ws = sock;
      openPromise = null;
      const tokens = [...subCounts.keys()];
      if (tokens.length) sock.send(JSON.stringify({ op: "subscribe", tokens }));
      resolve(sock);
    };
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "prices" && Array.isArray(msg.updates)) {
          for (const u of msg.updates) listeners.forEach((fn) => fn(u));
        }
      } catch {}
    };
    sock.onclose = () => {
      ws = null;
      openPromise = null;
      // Reconnect after a beat if anyone still cares.
      setTimeout(() => {
        if (subCounts.size > 0) ensureSocket();
      }, 3000);
    };
  });
  return openPromise;
}

function subscribe(tokens: string[]) {
  const fresh: string[] = [];
  for (const t of tokens) {
    const n = subCounts.get(t) || 0;
    subCounts.set(t, n + 1);
    if (n === 0) fresh.push(t);
  }
  ensureSocket().then((sock) => {
    if (fresh.length) sock.send(JSON.stringify({ op: "subscribe", tokens: fresh }));
  });
}

function unsubscribe(tokens: string[]) {
  const gone: string[] = [];
  for (const t of tokens) {
    const n = subCounts.get(t) || 0;
    if (n <= 1) {
      subCounts.delete(t);
      gone.push(t);
    } else subCounts.set(t, n - 1);
  }
  if (ws && ws.readyState === WebSocket.OPEN && gone.length) {
    ws.send(JSON.stringify({ op: "unsubscribe", tokens: gone }));
  }
}

// Live quote-ratio prices for a list of token addresses.
// The API pushes lowercase addresses; keys here are lowercased to match.
export function useLivePrices(tokens: string[]): Record<string, PriceUpdate> {
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const key = tokens.map((t) => t.toLowerCase()).sort().join(",");
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!tokens.length) return;
    const mine = key.split(",").filter(Boolean);
    const onUpdate: Listener = (u) => {
      const t = u.token.toLowerCase();
      if (!mine.includes(t)) return;
      setPrices((p) => ({ ...p, [t]: { ...u, token: t } }));
    };
    listeners.add(onUpdate);
    subscribe(mine);
    return () => {
      listeners.delete(onUpdate);
      unsubscribe(mine);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return prices;
}
