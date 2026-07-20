// WebSocket hub: pushes price updates for subscribed tokens and leaderboard
// changes. Reads latest snapshots from SQLite on the indexer's cadence.
import { DatabaseSync } from "node:sqlite";
import type { WebSocket } from "ws";
import { latestPrice, poolForToken } from "./market.js";
import { dailyLeaderboard, weeklyLeaderboard } from "../../engine/src/leaderboard.js";

interface ClientState {
  ws: WebSocket;
  tokens: Set<string>;       // lowercased token addresses
  leaderboard: boolean;
}

export class WsHub {
  private clients = new Set<ClientState>();
  private timer: NodeJS.Timeout | null = null;
  private lastSent = new Map<string, number>();   // token -> last price sent
  private lastBoardJson = "";

  constructor(private db: DatabaseSync, private intervalMs = 5000) {}

  add(ws: WebSocket): void {
    const state: ClientState = { ws, tokens: new Set(), leaderboard: false };
    this.clients.add(state);
    ws.on("message", (raw: Buffer) => {
      let msg: { op?: string; tokens?: string[] };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.op === "subscribe" && Array.isArray(msg.tokens)) {
        for (const t of msg.tokens) state.tokens.add(String(t).toLowerCase());
        this.sendPrices(state, true);
      } else if (msg.op === "unsubscribe" && Array.isArray(msg.tokens)) {
        for (const t of msg.tokens) state.tokens.delete(String(t).toLowerCase());
      } else if (msg.op === "subscribe_leaderboard") {
        state.leaderboard = true;
        this.sendLeaderboard(state);
      } else if (msg.op === "unsubscribe_leaderboard") {
        state.leaderboard = false;
      }
    });
    ws.on("close", () => this.clients.delete(state));
    if (!this.timer) this.start();
  }

  private start(): void {
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    for (const c of this.clients) {
      if (c.ws.readyState !== 1) continue;
      this.sendPrices(c, false);
      if (c.leaderboard) this.sendLeaderboard(c);
    }
  }

  private sendPrices(c: ClientState, force: boolean): void {
    const updates: { token: string; pair: string; price: number; ts: number }[] = [];
    for (const token of c.tokens) {
      const pool = poolForToken(this.db, token);
      if (!pool) continue;
      const snap = latestPrice(this.db, pool.pair_address);
      if (!snap) continue;
      const key = `${token}:${c === null ? "" : ""}`;
      const last = this.lastSent.get(token);
      if (force || last !== snap.price) {
        this.lastSent.set(token, snap.price);
        updates.push({ token, pair: pool.pair_address, price: snap.price, ts: snap.ts });
      }
    }
    if (updates.length > 0) {
      c.ws.send(JSON.stringify({ type: "prices", updates }));
    }
  }

  private sendLeaderboard(c: ClientState): void {
    try {
      const daily = dailyLeaderboard(this.db);
      const weekly = weeklyLeaderboard(this.db);
      const json = JSON.stringify({ type: "leaderboard", daily, weekly });
      if (json !== this.lastBoardJson || c.leaderboard) {
        this.lastBoardJson = json;
        c.ws.send(json);
      }
    } catch { /* leaderboard unavailable, skip */ }
  }
}
