import { db } from "./db.js";

const MIN_LIQ_USD = Number(process.env.MIN_LIQ_USD ?? 3000);
const CHAIN_SLUG = "robinhood";

// Dexscreener has no "list all pairs for a chain" endpoint, so we fan out
// search queries and keep anything on the robinhood chain. Seed queries were
// picked empirically; add more as the ecosystem grows.
const SEED_QUERIES = [
  "robinhood", "uniswap", "stock", "hood", "eth", "weth", "pons",
  "coin", "token", "cat", "dog", "pepe", "moon", "inu", "ai",
  "usd", "wolf", "bow", "arrow", "sherwood", "meme", "baby",
];

type DsPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
};

async function search(q: string): Promise<DsPair[]> {
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`dexscreener ${res.status} for q=${q}`);
    return [];
  }
  const json = (await res.json()) as { pairs?: DsPair[] };
  return (json.pairs ?? []).filter((p) => p.chainId === CHAIN_SLUG);
}

const upsert = db.prepare(`
INSERT INTO pools (pair_address, token_address, symbol, name, dex_id, version,
  quote_token, quote_symbol, liquidity_usd, volume24h, active, first_seen, last_seen)
VALUES (@pair, @token, @symbol, @name, @dex, @version, @quote, @quoteSymbol,
  @liq, @vol, 1, @now, @now)
ON CONFLICT(pair_address) DO UPDATE SET
  symbol=@symbol, name=@name, liquidity_usd=@liq, volume24h=@vol,
  active=1, last_seen=@now
`);

const deactivateStale = db.prepare(
  `UPDATE pools SET active=0 WHERE last_seen < ? OR liquidity_usd < ?`
);

export async function runDiscovery(): Promise<number> {
  const seen = new Map<string, DsPair>();
  for (const q of SEED_QUERIES) {
    try {
      for (const p of await search(q)) seen.set(p.pairAddress.toLowerCase(), p);
    } catch (e) {
      console.warn(`search failed for ${q}:`, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 350)); // stay polite with the API
  }

  const now = Math.floor(Date.now() / 1000);
  let count = 0;
  db.exec("BEGIN");
  try {
    for (const p of seen.values()) {
      const liq = p.liquidity?.usd ?? 0;
      if (liq < MIN_LIQ_USD) continue;
      const version = p.labels?.find((l) => /^v[234]$/.test(l)) ?? "v2";
      if (version === "v4") continue; // v4 quoting path comes later
      upsert.run({
        pair: p.pairAddress,
        token: p.baseToken.address,
        symbol: p.baseToken.symbol,
        name: p.baseToken.name,
        dex: p.dexId,
        version,
        quote: p.quoteToken.address,
        quoteSymbol: p.quoteToken.symbol,
        liq,
        vol: p.volume?.h24 ?? 0,
        now,
      });
      count++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  // Pools not seen for 24h or that fell below the floor get deactivated.
  deactivateStale.run(now - 24 * 3600, MIN_LIQ_USD);
  console.log(`discovery: ${seen.size} chain pairs seen, ${count} active >= $${MIN_LIQ_USD} liq`);
  return count;
}
