"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Candle, Portfolio, Position, QuoteResponse, fmtUsd, fmtCompact, fmtMcap, truncAddr } from "@/lib/api";
import { useLivePrices } from "@/lib/ws";
import { CandleChart } from "@/components/CandleChart";
import { useAuth } from "@/lib/auth";
import { useDenom, fmtEth } from "@/lib/denom";

interface TokenDetail {
  address: string;
  symbol: string;
  name: string;
  decimals: number | null;
  pool: {
    pair: string;
    dex: string;
    version: string;
    quoteToken: string;
    quoteSymbol: string;
    liquidityUsd: number;
    volume24hUsd: number;
  };
  priceQuote: number | null;
  priceUsd: number | null;
  change24hPct: number | null;
  totalSupply: number | null;
  mcapUsd: number | null;
}

const TFS = ["1m", "5m", "1h", "1d"] as const;

// Quick-buy preset amounts per denomination.
const BUY_PRESETS: Record<"usd" | "eth", number[]> = {
  usd: [25, 50, 100, 500],
  eth: [0.01, 0.05, 0.1, 0.5],
};

// Max single-buy cap: min(3.5% of total supply, 35,000,000 tokens).
// Mirrors the server-side enforcement in engine/src/ledger.ts.
const MAX_BUY_SUPPLY_PCT = 3.5;
const MAX_BUY_ABS_TOKENS = 35_000_000;
function maxBuyTokens(totalSupply: number | null): number {
  if (totalSupply != null && totalSupply > 0) {
    return Math.min((totalSupply * MAX_BUY_SUPPLY_PCT) / 100, MAX_BUY_ABS_TOKENS);
  }
  return MAX_BUY_ABS_TOKENS;
}

export default function TradePage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const { address: user } = useAuth();

  const [detail, setDetail] = useState<TokenDetail | null>(null);
  const [ethUsd, setEthUsd] = useState(0);
  const [tf, setTf] = useState<(typeof TFS)[number]>("5m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [metric, setMetric] = useState<"price" | "mcap">("price");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [denom, setDenom] = useDenom();
  const [amountBuy, setAmountBuy] = useState("100");
  const [sellPct, setSellPct] = useState("100");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [trading, setTrading] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const live = useLivePrices(useMemo(() => (address ? [address] : []), [address]));
  const livePrice = live[address?.toLowerCase()]?.price;
  const priceQuote = livePrice ?? detail?.priceQuote ?? null;
  const priceUsd =
    livePrice !== undefined ? livePrice * ethUsd : detail?.priceUsd ?? null;

  useEffect(() => {
    if (!address) return;
    api.token(address).then((d) => setDetail(d as unknown as TokenDetail)).catch((e) => setErr(e.message));
    api.tokens().then((r) => setEthUsd(r.ethUsd)).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!address) return;
    api.candles(address, tf).then((r) => setCandles(r.candles)).catch(() => setCandles([]));
    const id = setInterval(() => {
      api.candles(address, tf).then((r) => setCandles(r.candles)).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [address, tf]);

  const refreshPosition = useCallback(() => {
    if (!user) return setPosition(null);
    api
      .portfolio()
      .then((p: Portfolio) => {
        setPosition(p.positions.find((x) => x.token.toLowerCase() === address.toLowerCase()) ?? null);
      })
      .catch(() => setPosition(null));
  }, [user, address]);

  useEffect(refreshPosition, [refreshPosition]);

  // Live quote preview, debounced.
  useEffect(() => {
    if (!detail || !ethUsd) return;
    setQuote(null);
    setQuoteErr(null);
    const decimals = detail.decimals ?? 18;
    let amountIn: bigint;
    let tokenIn: string;
    let tokenOut: string;
    if (side === "buy") {
      const n = parseFloat(amountBuy);
      if (!n || n <= 0) return;
      const eth = denom === "eth" ? n : n / ethUsd;
      amountIn = BigInt(Math.round(eth * 1e18));
      tokenIn = detail.pool.quoteToken;
      tokenOut = detail.address;
    } else {
      if (!position) return;
      const pct = Math.min(Math.max(parseFloat(sellPct) || 0, 0), 100);
      if (pct <= 0) return;
      amountIn = (BigInt(position.qty) * BigInt(Math.round(pct * 100))) / 10000n;
      if (amountIn <= 0n) return;
      tokenIn = detail.address;
      tokenOut = detail.pool.quoteToken;
    }
    const t = setTimeout(() => {
      api
        .quote({ tokenIn, tokenOut, amountIn: amountIn.toString() })
        .then(setQuote)
        .catch((e) => setQuoteErr(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [detail, ethUsd, side, amountBuy, denom, sellPct, position]);

  // Entered buy amount converted to USD (what the trade endpoint expects).
  function buyAmountUsd(): number {
    const n = parseFloat(amountBuy);
    if (!n || n <= 0) return 0;
    return denom === "eth" ? n * ethUsd : n;
  }

  async function executeTrade() {
    if (!detail) return;
    setTrading(true);
    setTradeMsg(null);
    try {
      let res;
      if (side === "buy") {
        res = await api.trade({ token: detail.address, side: "buy", amount: buyAmountUsd() });
        setTradeMsg(
          `Bought ${fmtCompact(Number(res.tokensOut) / 10 ** (detail.decimals ?? 18))} ${detail.symbol} for $${fmtUsd(res.usdIn, 2)} (impact ${res.priceImpactPct?.toFixed(2)}%)`
        );
      } else {
        if (!position) throw new Error("no position");
        const pct = Math.min(Math.max(parseFloat(sellPct) || 0, 0), 100);
        const qty = (BigInt(position.qty) * BigInt(Math.round(pct * 100))) / 10000n;
        res = await api.trade({ token: detail.address, side: "sell", amount: qty.toString() });
        setTradeMsg(
          `Sold for $${fmtUsd(res.usdOut, 2)} (realized ${res.realizedPnlUsd! >= 0 ? "+" : ""}$${fmtUsd(res.realizedPnlUsd, 2)})`
        );
      }
      refreshPosition();
    } catch (e: any) {
      setTradeMsg(`Trade failed: ${e.message}`);
    } finally {
      setTrading(false);
    }
  }

  if (err) {
    return (
      <div className="py-12 text-center text-term-red">
        {err} · <Link href="/" className="text-term-accent underline">back to screener</Link>
      </div>
    );
  }
  if (!detail) return <div className="py-12 text-center text-term-dim">Loading...</div>;

  const decimals = detail.decimals ?? 18;
  const quoteOutDec = quote ? Number(quote.amountOut) / 10 ** (side === "buy" ? decimals : 18) : null;
  const impact = quote?.priceImpactPct ?? 0;
  const impactColor = impact > 5 ? "text-term-red" : impact > 2 ? "text-term-amber" : "text-term-green";
  const capTokens = maxBuyTokens(detail.totalSupply);
  const buySupplyPct =
    side === "buy" && quoteOutDec != null && detail.totalSupply != null && detail.totalSupply > 0
      ? (quoteOutDec / detail.totalSupply) * 100
      : null;
  const overCap = side === "buy" && quoteOutDec != null && quoteOutDec > capTokens;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-bold">{detail.symbol}</h1>
          <span className="text-term-dim">{detail.name}</span>
          <span className="num text-lg">
            {denom === "eth"
              ? priceQuote != null
                ? `${fmtEth(priceQuote)} ETH`
                : "-"
              : priceUsd != null
                ? `$${fmtUsd(priceUsd)}`
                : "-"}
          </span>
          {typeof detail.change24hPct === "number" && (
            <span className={`num ${detail.change24hPct >= 0 ? "text-term-green" : "text-term-red"}`}>
              {detail.change24hPct >= 0 ? "+" : ""}
              {detail.change24hPct.toFixed(2)}% 24h
            </span>
          )}
          <span className="ml-auto text-xs text-term-dim">
            {detail.mcapUsd != null && <>mcap {fmtMcap(detail.mcapUsd)} · </>}
            {detail.pool.dex} {detail.pool.version} · liq ${fmtCompact(detail.pool.liquidityUsd)} · vol $
            {fmtCompact(detail.pool.volume24hUsd)} · pool {truncAddr(detail.pool.pair)}
          </span>
        </div>
        <div className="mb-2 flex gap-1">
          {TFS.map((x) => (
            <button
              key={x}
              onClick={() => setTf(x)}
              className={`rounded px-3 py-1 text-xs ${tf === x ? "bg-term-accent text-black" : "border border-term-border text-term-dim hover:text-term-text"}`}
            >
              {x}
            </button>
          ))}
          <span className="mx-1 border-l border-term-border" />
          {(["price", "mcap"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              disabled={m === "mcap" && detail.totalSupply == null}
              className={`rounded px-3 py-1 text-xs disabled:opacity-40 ${metric === m ? "bg-term-accent text-black" : "border border-term-border text-term-dim hover:text-term-text"}`}
            >
              {m === "price" ? "Price" : "MCap"}
            </button>
          ))}
          <button
            onClick={() => setDenom(denom === "usd" ? "eth" : "usd")}
            className="ml-auto rounded border border-term-border px-3 py-1 text-xs text-term-dim hover:text-term-text"
          >
            {denom.toUpperCase()}
          </button>
        </div>
        <div className="rounded border border-term-border">
          {candles.length ? (
            <CandleChart
              candles={candles}
              compact={metric === "mcap"}
              multiplier={
                (denom === "eth" ? 1 : ethUsd || 1) *
                (metric === "mcap" ? detail.totalSupply ?? 1 : 1)
              }
            />
          ) : (
            <div className="flex h-[420px] items-center justify-center text-term-dim">No candle data yet</div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded border border-term-border bg-term-panel p-4">
          <div className="mb-3 flex gap-1">
            <button
              onClick={() => setSide("buy")}
              className={`flex-1 rounded py-1.5 text-sm font-semibold ${side === "buy" ? "bg-term-green text-black" : "border border-term-border text-term-dim"}`}
            >
              Buy
            </button>
            <button
              onClick={() => setSide("sell")}
              className={`flex-1 rounded py-1.5 text-sm font-semibold ${side === "sell" ? "bg-term-red text-black" : "border border-term-border text-term-dim"}`}
            >
              Sell
            </button>
          </div>

          {side === "buy" ? (
            <label className="mb-3 block text-sm">
              <span className="flex items-center justify-between text-term-dim">
                Amount ({denom === "eth" ? "ETH" : "USD"})
                <button
                  type="button"
                  onClick={() => setDenom(denom === "usd" ? "eth" : "usd")}
                  className="rounded border border-term-border px-2 py-0.5 text-[10px] hover:text-term-text"
                >
                  switch to {denom === "usd" ? "ETH" : "USD"}
                </button>
              </span>
              <input
                value={amountBuy}
                onChange={(e) => setAmountBuy(e.target.value)}
                inputMode="decimal"
                className="num mt-1 w-full rounded border border-term-border bg-term-bg px-3 py-2 outline-none focus:border-term-accent"
              />
              <span className="mt-2 flex gap-1">
                {BUY_PRESETS[denom].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmountBuy(String(v))}
                    className={`num flex-1 rounded border px-2 py-1 text-xs ${amountBuy === String(v) ? "border-term-accent text-term-accent" : "border-term-border text-term-dim hover:text-term-text"}`}
                  >
                    {denom === "usd" ? `$${v}` : v}
                  </button>
                ))}
              </span>
            </label>
          ) : (
            <label className="mb-3 block text-sm">
              <span className="text-term-dim">
                Sell % of position{position ? ` (${fmtCompact(position.qtyDec)} ${detail.symbol})` : ""}
              </span>
              <input
                value={sellPct}
                onChange={(e) => setSellPct(e.target.value)}
                inputMode="decimal"
                className="num mt-1 w-full rounded border border-term-border bg-term-bg px-3 py-2 outline-none focus:border-term-accent"
              />
            </label>
          )}

          {quoteErr && <div className="mb-2 text-xs text-term-red">{quoteErr}</div>}
          {quote && quoteOutDec != null && (
            <div className="mb-3 space-y-1 rounded bg-term-bg p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-term-dim">You receive</span>
                <span className="num">
                  {side === "buy"
                    ? `${fmtCompact(quoteOutDec)} ${detail.symbol}`
                    : denom === "eth"
                      ? `${fmtEth(quoteOutDec)} ETH`
                      : `$${fmtUsd(quoteOutDec * ethUsd, 2)}`}
                </span>
              </div>
              {buySupplyPct != null && (
                <div className="flex justify-between">
                  <span className="text-term-dim">% of supply</span>
                  <span className={`num ${overCap ? "text-term-red" : ""}`}>
                    {buySupplyPct < 0.001 ? "<0.001" : buySupplyPct.toFixed(3)}%
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-term-dim">Exec price</span>
                <span className="num">
                  {denom === "eth" ? `${fmtEth(quote.execPrice)} ETH` : `$${fmtUsd(quote.execPrice * ethUsd)}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Price impact</span>
                <span className={`num ${impactColor}`}>
                  {impact.toFixed(2)}%{impact > 5 ? " ⚠ heavy" : impact > 2 ? " ⚠" : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Fee tier</span>
                <span className="num">{(quote.feeTier / 10000).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Route</span>
                <span className="num">{quote.path}{quote.path === "v3-approx" ? " (approx, size down)" : ""}</span>
              </div>
            </div>
          )}

          {side === "buy" && (
            <div className="mb-2 text-[10px] text-term-dim">
              Max per buy: {fmtCompact(capTokens)} {detail.symbol}
              {detail.totalSupply != null ? ` (min of ${MAX_BUY_SUPPLY_PCT}% supply / ${fmtCompact(MAX_BUY_ABS_TOKENS)})` : ""}
            </div>
          )}
          {overCap && (
            <div className="mb-2 text-xs text-term-red">
              Order too large: exceeds the max single-buy cap of {fmtCompact(capTokens)} {detail.symbol}. Reduce the amount.
            </div>
          )}

          {user ? (
            <button
              onClick={executeTrade}
              disabled={trading || !quote || overCap || (side === "sell" && !position)}
              className={`w-full rounded py-2 font-semibold text-black disabled:opacity-40 ${side === "buy" ? "bg-term-green" : "bg-term-red"}`}
            >
              {trading ? "Executing..." : side === "buy" ? `Buy ${detail.symbol}` : `Sell ${detail.symbol}`}
            </button>
          ) : (
            <div className="text-center text-xs text-term-dim">Connect wallet to trade</div>
          )}
          {tradeMsg && <div className="mt-2 text-xs">{tradeMsg}</div>}
        </div>

        {position && (
          <div className="rounded border border-term-border bg-term-panel p-4 text-sm">
            <div className="mb-2 font-semibold">Your position</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-term-dim">Qty</span>
                <span className="num">
                  {fmtCompact(position.qtyDec)} {detail.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Cost basis</span>
                <span className="num">${fmtUsd(position.costBasisUsd, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Mark (exit)</span>
                <span className="num">${fmtUsd(position.markUsd, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Unrealized PnL</span>
                <span className={`num ${position.unrealizedPnlUsd >= 0 ? "text-term-green" : "text-term-red"}`}>
                  {position.unrealizedPnlUsd >= 0 ? "+" : ""}${fmtUsd(position.unrealizedPnlUsd, 2)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
