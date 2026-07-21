// Paper-trading stats per token: how many users hold an open paper position,
// their average entry, and total paper volume traded. Positions are derived
// from the trades table (current season) with FIFO cost basis, same rules as
// ledger.ts getPortfolio.
import { DatabaseSync } from "node:sqlite";
import { getSeasonId } from "./ledger.js";

export interface TokenPaperStats {
  token: string;
  holders: number;               // users with an open position in this token
  avgEntryPriceUsd: number | null; // cost-weighted average entry across open positions
  avgEntryMcapUsd: number | null;  // avg entry price * total supply, when known
  totalVolumeUsd: number;        // buys + sells, USD, current season
  buys: number;
  sells: number;
}

interface TradeRow { user_id: number; side: string; amount_in: string; amount_out: string; exec_price: number }

// Replay one user's season trades in a token FIFO to get remaining qty + cost.
function openLot(trades: TradeRow[], scale: number): { qty: bigint; costUsd: number } {
  const lots: { qty: bigint; price: number }[] = [];
  for (const t of trades) {
    if (t.side === "buy") {
      lots.push({ qty: BigInt(t.amount_out), price: t.exec_price });
    } else {
      let toConsume = BigInt(t.amount_in);
      while (toConsume > 0n && lots.length > 0) {
        const lot = lots[0];
        const take = lot.qty < toConsume ? lot.qty : toConsume;
        lot.qty -= take;
        toConsume -= take;
        if (lot.qty === 0n) lots.shift();
      }
    }
  }
  let qty = 0n;
  let costUsd = 0;
  for (const l of lots) {
    qty += l.qty;
    costUsd += (Number(l.qty) / scale) * l.price;
  }
  return { qty, costUsd };
}

export function tokenPaperStats(db: DatabaseSync, token: string, totalSupply: number | null): TokenPaperStats {
  const seasonId = getSeasonId(db);
  const decRow = db.prepare("SELECT decimals FROM tokens WHERE address = ? COLLATE NOCASE").get(token) as { decimals: number } | undefined;
  const scale = 10 ** (decRow?.decimals ?? 18);

  const rows = db.prepare(
    `SELECT user_id, side, amount_in, amount_out, exec_price FROM trades
     WHERE token_address = ? COLLATE NOCASE AND season_id = ? ORDER BY id`
  ).all(token, seasonId) as unknown as TradeRow[];

  const byUser = new Map<number, TradeRow[]>();
  let totalVolumeUsd = 0;
  let buys = 0;
  let sells = 0;
  for (const t of rows) {
    // Buys: amount_in is USD spent. Sells: amount_out is USD received.
    if (t.side === "buy") { totalVolumeUsd += Number(t.amount_in); buys++; }
    else { totalVolumeUsd += Number(t.amount_out); sells++; }
    const list = byUser.get(t.user_id);
    if (list) list.push(t);
    else byUser.set(t.user_id, [t]);
  }

  let holders = 0;
  let openQtyDec = 0;
  let openCostUsd = 0;
  for (const trades of byUser.values()) {
    const { qty, costUsd } = openLot(trades, scale);
    if (qty > 0n) {
      holders++;
      openQtyDec += Number(qty) / scale;
      openCostUsd += costUsd;
    }
  }
  const avgEntryPriceUsd = openQtyDec > 0 ? openCostUsd / openQtyDec : null;
  return {
    token,
    holders,
    avgEntryPriceUsd,
    avgEntryMcapUsd:
      avgEntryPriceUsd != null && totalSupply != null && totalSupply > 0
        ? avgEntryPriceUsd * totalSupply
        : null,
    totalVolumeUsd,
    buys,
    sells,
  };
}

// Bulk holder counts + paper volume per token, current season. Powers the
// screener "paper" column so the most papered token is visible at a glance.
export function paperHolderCounts(db: DatabaseSync): Record<string, { holders: number; volumeUsd: number }> {
  const seasonId = getSeasonId(db);
  const tokens = db.prepare(
    "SELECT DISTINCT token_address FROM trades WHERE season_id = ?"
  ).all(seasonId) as { token_address: string }[];
  const out: Record<string, { holders: number; volumeUsd: number }> = {};
  for (const t of tokens) {
    const s = tokenPaperStats(db, t.token_address, null);
    out[t.token_address.toLowerCase()] = { holders: s.holders, volumeUsd: s.totalVolumeUsd };
  }
  return out;
}
