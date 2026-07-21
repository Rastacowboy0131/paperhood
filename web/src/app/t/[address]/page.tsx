"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Candle, Order, Portfolio, Position, QuoteResponse, fmtUsd, fmtCompact, fmtMcap, truncAddr } from "@/lib/api";
import { useLivePrices } from "@/lib/ws";
import { CandleChart, ChartLine } from "@/components/CandleChart";
import { TokenInfoTabs } from "@/components/TokenInfoTabs";
import { TokenLogo } from "@/components/TokenLogo";
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
  imageUrl?: string | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
}

const TFS = ["1m", "5m", "1h", "1d"] as const;

// Mobile chart/trades split. The combined vertical budget is fixed; dragging
// the grip trades chart height against the trades box height.
const MOBILE_SPLIT_TOTAL = 700;
const MOBILE_CHART_MIN = 200;
const MOBILE_CHART_MAX = 500;
const MOBILE_CHART_DEFAULT = 340;
const MOBILE_SPLIT_KEY = "ph.mobileChartH";
const DESKTOP_CHART_H = 560;

function clampChartH(v: number): number {
  return Math.min(Math.max(v, MOBILE_CHART_MIN), MOBILE_CHART_MAX);
}

// Tracks the lg breakpoint so mobile-only sizing never touches desktop.
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

// Quick-buy preset amounts per denomination.
const BUY_PRESETS: Record<"usd" | "eth", number[]> = {
  usd: [25, 50, 100, 500],
  eth: [0.01, 0.05, 0.1, 0.5],
};

// Quick-sell presets: percent of current position.
const SELL_PRESETS = [25, 50, 75, 100];

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
  const [mode, setMode] = useState<"market" | "limit">("market");
  const [copied, setCopied] = useState(false);
  const [denom, setDenom] = useDenom();
  const [amountBuy, setAmountBuy] = useState("100");
  const [sellPct, setSellPct] = useState("100");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "stop">("limit");
  const [orderTrigger, setOrderTrigger] = useState("");
  const [orderAmount, setOrderAmount] = useState("100");
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [trading, setTrading] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Mobile-only chart/trades split, persisted across visits.
  const isMobile = useIsMobile();
  const [chartH, setChartH] = useState(MOBILE_CHART_DEFAULT);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem(MOBILE_SPLIT_KEY) || "", 10);
      if (Number.isFinite(saved)) setChartH(clampChartH(saved));
    } catch {}
  }, []);

  const onDragStart = useCallback((clientY: number) => {
    dragRef.current = { startY: clientY, startH: chartH };
  }, [chartH]);

  const onDragMove = useCallback((clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    setChartH(clampChartH(d.startH + (clientY - d.startY)));
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setChartH((h) => {
      try { localStorage.setItem(MOBILE_SPLIT_KEY, String(h)); } catch {}
      return h;
    });
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => onDragMove(e.clientY);
    const up = () => onDragEnd();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onDragMove, onDragEnd]);

  const chartHeight = isMobile ? chartH : DESKTOP_CHART_H;
  const tradesBoxH = MOBILE_SPLIT_TOTAL - chartH;

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

  const refreshOrders = useCallback(() => {
    if (!user) return setOrders([]);
    api.orders(address).then((r) => setOrders(r.orders)).catch(() => setOrders([]));
  }, [user, address]);

  useEffect(() => {
    refreshOrders();
    const id = setInterval(refreshOrders, 15000);
    return () => clearInterval(id);
  }, [refreshOrders]);

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

  async function placeOrder() {
    if (!detail) return;
    setPlacing(true);
    setOrderMsg(null);
    try {
      const trigger = parseFloat(orderTrigger);
      const amount = parseFloat(orderAmount);
      // Trigger is entered in the current display denom; convert to quote (ETH) terms.
      const triggerQuote = denom === "eth" ? trigger : ethUsd > 0 ? trigger / ethUsd : NaN;
      await api.createOrder({
        token: detail.address,
        side: orderSide,
        type: orderSide === "buy" ? "limit" : orderType,
        triggerPrice: triggerQuote,
        amount,
      });
      setOrderMsg("Order placed");
      setOrderTrigger("");
      refreshOrders();
    } catch (e: any) {
      setOrderMsg(`Order failed: ${e.message}`);
    } finally {
      setPlacing(false);
    }
  }

  async function cancelOrder(id: number) {
    try {
      await api.cancelOrder(id);
      refreshOrders();
    } catch (e: any) {
      setOrderMsg(`Cancel failed: ${e.message}`);
    }
  }

  if (err) {
    return (
      <div className="py-12 text-center text-term-red">
        {err} · <Link href="/" className="text-term-accent underline">back to screener</Link>
      </div>
    );
  }
  if (!detail)
    return (
      <div className="grid gap-4 py-2 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="skeleton h-6 w-64" />
          <div className="skeleton h-[420px] w-full" />
        </div>
        <div className="space-y-3">
          <div className="skeleton h-48 w-full" />
        </div>
      </div>
    );

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

  // Avg entry in USD per token from FIFO cost basis over the open position.
  const avgEntryUsd = position && position.qtyDec > 0 ? position.costBasisUsd / position.qtyDec : null;
  // Chart lines are in quote (ETH) terms, same unit as candles.
  const avgEntryQuote = avgEntryUsd != null && ethUsd > 0 ? avgEntryUsd / ethUsd : null;
  const chartLines: ChartLine[] =
    metric === "price"
      ? [
          ...(avgEntryQuote != null ? [{ price: avgEntryQuote, color: "#d97706", title: "avg entry" }] : []),
          ...orders
            .filter((o) => o.status === "open")
            .map((o) => ({
              price: o.triggerPrice,
              color: o.side === "buy" || (o.side === "sell" && o.type === "limit") ? "#16a34a" : "#ef4444",
              title: o.side === "buy" ? "limit buy" : o.type === "stop" ? "SL" : "TP",
            })),
        ]
      : [];
  const openOrders = orders.filter((o) => o.status === "open");
  const pastOrders = orders.filter((o) => o.status !== "open").slice(0, 10);

  function copyAddr() {
    navigator.clipboard?.writeText(detail!.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  const statCell = (label: string, value: React.ReactNode, cls = "") => (
    <div className="flex flex-col px-3 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-term-dim">{label}</span>
      <span className={`num text-[13px] font-semibold ${cls}`}>{value}</span>
    </div>
  );

  return (
    <div>
      {/* Token stats strip */}
      <div className="panel mb-3 flex flex-wrap items-center gap-x-1 gap-y-0 divide-x divide-term-line overflow-x-auto px-1 py-1">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <TokenLogo src={detail.imageUrl} symbol={detail.symbol} size={28} />
          <div className="leading-tight">
            <div className="text-sm font-bold">{detail.symbol}</div>
            <div className="max-w-[140px] truncate text-[11px] text-term-dim">{detail.name}</div>
          </div>
          <button
            onClick={copyAddr}
            title="Copy contract address"
            className="num rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-dim hover:text-term-text"
          >
            {copied ? "copied" : truncAddr(detail.address)}
          </button>
          {(detail.website || detail.twitter || detail.telegram) && (
            <span className="flex flex-wrap items-center gap-1">
              {detail.website && (
                <a
                  href={detail.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Website"
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-term-border text-term-dim transition-colors hover:bg-term-hover hover:text-term-text"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
                  </svg>
                </a>
              )}
              {detail.twitter && (
                <a
                  href={detail.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="X / Twitter"
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-term-border text-term-dim transition-colors hover:bg-term-hover hover:text-term-text"
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
              )}
              {detail.telegram && (
                <a
                  href={detail.telegram}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Telegram"
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-term-border text-term-dim transition-colors hover:bg-term-hover hover:text-term-text"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                    <path d="M21.9 4.4c.3-1.2-.9-2.2-2-1.7L2.7 9.9c-1.2.5-1.1 2.2.1 2.6l4.5 1.4 1.7 5.3c.3 1 1.6 1.3 2.3.5l2.4-2.4 4.5 3.3c.9.6 2.1.2 2.4-.9zM8.3 13.1l9.2-5.7c.3-.2.5.2.3.4l-7.4 6.9c-.3.3-.5.6-.5 1l-.2 2.1c0 .3-.4.3-.5 0l-1.1-3.5c-.1-.4 0-.9.2-1.2z" />
                  </svg>
                </a>
              )}
            </span>
          )}
        </div>
        {statCell(
          "Price",
          denom === "eth"
            ? priceQuote != null
              ? `${fmtEth(priceQuote)} ETH`
              : "-"
            : priceUsd != null
              ? `$${fmtUsd(priceUsd)}`
              : "-"
        )}
        {typeof detail.change24hPct === "number" &&
          statCell(
            "24h",
            `${detail.change24hPct >= 0 ? "+" : ""}${detail.change24hPct.toFixed(2)}%`,
            detail.change24hPct >= 0 ? "text-term-green" : "text-term-red"
          )}
        {detail.mcapUsd != null && statCell("MCap", fmtMcap(detail.mcapUsd))}
        {statCell("Liquidity", `$${fmtCompact(detail.pool.liquidityUsd)}`)}
        {statCell("24h Vol", `$${fmtCompact(detail.pool.volume24hUsd)}`)}
        {statCell("Pool", `${detail.pool.dex} ${detail.pool.version}`)}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <div className="tab-track">
          {TFS.map((x) => (
            <button
              key={x}
              onClick={() => setTf(x)}
              className={`tab ${tf === x ? "tab-active" : ""}`}
            >
              {x}
            </button>
          ))}
          </div>
          <div className="tab-track">
          {(["price", "mcap"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              disabled={m === "mcap" && detail.totalSupply == null}
              className={`tab disabled:opacity-40 ${metric === m ? "tab-active" : ""}`}
            >
              {m === "price" ? "Price" : "MCap"}
            </button>
          ))}
          </div>
          <button
            onClick={() => setDenom(denom === "usd" ? "eth" : "usd")}
            className="btn btn-ghost ml-auto"
          >
            {denom.toUpperCase()}
          </button>
        </div>
        <div className="panel overflow-hidden">
          {candles.length ? (
            <CandleChart
              candles={candles}
              compact={metric === "mcap"}
              lines={chartLines}
              height={chartHeight}
              multiplier={
                (denom === "eth" ? 1 : ethUsd || 1) *
                (metric === "mcap" ? detail.totalSupply ?? 1 : 1)
              }
            />
          ) : (
            <div style={{ height: chartHeight }} className="flex items-center justify-center text-term-dim">No candle data yet</div>
          )}
        </div>

        {/* Mobile only: drag grip plus a scrollable trades box under the chart. */}
        {isMobile && (
          <>
            <div
              role="separator"
              aria-label="Resize chart"
              className="my-1 flex cursor-row-resize touch-none items-center justify-center py-2 lg:hidden"
              onMouseDown={(e) => { e.preventDefault(); onDragStart(e.clientY); }}
              onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
              onTouchMove={(e) => onDragMove(e.touches[0].clientY)}
              onTouchEnd={onDragEnd}
            >
              <span className="h-1.5 w-12 rounded-full bg-term-border" />
            </div>
            <div style={{ height: tradesBoxH }} className="overflow-y-auto lg:hidden">
              <TokenInfoTabs address={detail.address} symbol={detail.symbol} />
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 lg:sticky lg:top-14 lg:self-start">
        <div className="panel p-4">
          <div className="mb-2 flex gap-1">
            <button
              onClick={() => setSide("buy")}
              className={`flex-1 rounded-full py-1.5 text-sm font-semibold transition-colors ${side === "buy" ? "bg-term-accent text-white" : "border border-term-border bg-term-panel text-term-dim hover:bg-term-hover hover:text-term-text"}`}
            >
              Buy
            </button>
            <button
              onClick={() => setSide("sell")}
              className={`flex-1 rounded-full py-1.5 text-sm font-semibold transition-colors ${side === "sell" ? "bg-term-red text-white" : "border border-term-border bg-term-panel text-term-dim hover:bg-term-hover hover:text-term-text"}`}
            >
              Sell
            </button>
          </div>

          <div className="mb-3 flex gap-3 border-b border-term-line pb-1 text-xs">
            {(["market", "limit"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`pb-1 font-semibold capitalize ${mode === m ? "border-b-2 border-term-accent text-term-text" : "text-term-dim hover:text-term-text"}`}
              >
                {m === "limit" ? "Limit / SL-TP" : "Market"}
              </button>
            ))}
          </div>

          {mode === "market" ? (<>
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
                className="num input mt-1 py-2"
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
                className="num input mt-1 py-2"
              />
              <span className="mt-2 flex gap-1">
                {SELL_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!position}
                    onClick={() => setSellPct(String(v))}
                    className={`num flex-1 rounded border px-2 py-1 text-xs disabled:opacity-40 ${sellPct === String(v) ? "border-term-accent text-term-accent" : "border-term-border text-term-dim hover:text-term-text"}`}
                  >
                    {v}%
                  </button>
                ))}
              </span>
            </label>
          )}

          {quoteErr && <div className="mb-2 text-xs text-term-red">{quoteErr}</div>}
          {quote && quoteOutDec != null && (
            <div className="mb-3 space-y-1 rounded-lg bg-term-raised p-3 text-xs">
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
              className={`w-full rounded-full py-2.5 text-sm font-semibold text-white transition-[filter] hover:brightness-105 disabled:opacity-40 ${side === "buy" ? "bg-term-accent" : "bg-term-red"}`}
            >
              {trading ? "Executing..." : side === "buy" ? `Buy ${detail.symbol}` : `Sell ${detail.symbol}`}
            </button>
          ) : (
            <div className="text-center text-xs text-term-dim">Connect wallet to trade</div>
          )}
          {tradeMsg && <div className="mt-2 text-xs">{tradeMsg}</div>}
          </>) : (<>
          {user ? (<>
            <div className="mb-2 flex gap-1">
              <button
                onClick={() => setOrderSide("buy")}
                className={`flex-1 rounded-full py-1 text-xs font-semibold transition-colors ${orderSide === "buy" ? "bg-term-accent text-white" : "border border-term-border bg-term-panel text-term-dim hover:bg-term-hover hover:text-term-text"}`}
              >
                Limit buy
              </button>
              <button
                onClick={() => { setOrderSide("sell"); setOrderType("limit"); }}
                className={`flex-1 rounded-full py-1 text-xs font-semibold transition-colors ${orderSide === "sell" && orderType === "limit" ? "bg-term-accent text-white" : "border border-term-border bg-term-panel text-term-dim hover:bg-term-hover hover:text-term-text"}`}
              >
                TP
              </button>
              <button
                onClick={() => { setOrderSide("sell"); setOrderType("stop"); }}
                className={`flex-1 rounded-full py-1 text-xs font-semibold transition-colors ${orderSide === "sell" && orderType === "stop" ? "bg-term-red text-white" : "border border-term-border bg-term-panel text-term-dim hover:bg-term-hover hover:text-term-text"}`}
              >
                SL
              </button>
            </div>
            <label className="mb-2 block text-xs">
              <span className="flex justify-between text-term-dim">
                Trigger price ({denom === "eth" ? "ETH" : "USD"})
                <button
                  type="button"
                  className="text-term-accent hover:underline"
                  onClick={() => {
                    const now = denom === "eth" ? priceQuote : priceUsd;
                    if (now != null) setOrderTrigger(String(now));
                  }}
                >
                  now: {denom === "eth" ? (priceQuote != null ? fmtEth(priceQuote) : "-") : priceUsd != null ? `$${fmtUsd(priceUsd)}` : "-"}
                </button>
              </span>
              <input
                value={orderTrigger}
                onChange={(e) => setOrderTrigger(e.target.value)}
                inputMode="decimal"
                placeholder="trigger price"
                className="num input mt-1"
              />
            </label>
            <label className="mb-2 block text-xs">
              <span className="text-term-dim">{orderSide === "buy" ? "Amount (USD)" : "Sell % of position"}</span>
              <input
                value={orderAmount}
                onChange={(e) => setOrderAmount(e.target.value)}
                inputMode="decimal"
                className="num input mt-1"
              />
              {orderSide === "sell" && (
                <span className="mt-1 flex gap-1">
                  {SELL_PRESETS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setOrderAmount(String(v))}
                      className={`num flex-1 rounded border px-2 py-0.5 text-[10px] ${orderAmount === String(v) ? "border-term-accent text-term-accent" : "border-term-border text-term-dim hover:text-term-text"}`}
                    >
                      {v}%
                    </button>
                  ))}
                </span>
              )}
            </label>
            <button
              onClick={placeOrder}
              disabled={placing || !parseFloat(orderTrigger) || !parseFloat(orderAmount) || (orderSide === "sell" && !position)}
              className="btn btn-primary w-full py-1.5"
            >
              {placing ? "Placing..." : "Place order"}
            </button>
            {orderMsg && <div className="mt-2 text-xs">{orderMsg}</div>}
          </>) : (
            <div className="text-center text-xs text-term-dim">Connect wallet to place orders</div>
          )}
          </>)}
        </div>

        {position && (
          <div className="panel p-4 text-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Your position</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-term-dim">Qty</span>
                <span className="num">
                  {fmtCompact(position.qtyDec)} {detail.symbol}
                </span>
              </div>
              {avgEntryUsd != null && (
                <div className="flex justify-between">
                  <span className="text-term-dim">Avg entry</span>
                  <span className="num">
                    {denom === "eth" && ethUsd > 0 ? `${fmtEth(avgEntryUsd / ethUsd)} ETH` : `$${fmtUsd(avgEntryUsd)}`}
                  </span>
                </div>
              )}
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
                  {position.costBasisUsd > 0 && (
                    <> ({position.unrealizedPnlUsd >= 0 ? "+" : ""}{((position.unrealizedPnlUsd / position.costBasisUsd) * 100).toFixed(2)}%)</>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {user && (
          <div className="panel p-4 text-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-term-dim">Orders</div>
            {openOrders.length > 0 && (
              <div className="mt-3 space-y-1 text-xs">
                <div className="text-[11px] uppercase tracking-wider text-term-dim">Open</div>
                {openOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg bg-term-raised px-2 py-1">
                    <span className={`num ${o.side === "buy" || o.type === "limit" ? "text-term-green" : "text-term-red"}`}>
                      {o.side === "buy" ? "limit buy" : o.type === "stop" ? "SL" : "TP"}
                    </span>
                    <span className="num">
                      @ {denom === "eth" ? `${fmtEth(o.triggerPrice)} ETH` : `$${fmtUsd(o.triggerPrice * ethUsd)}`}
                    </span>
                    <span className="num text-term-dim">{o.side === "buy" ? `$${fmtUsd(o.amount, 2)}` : `${o.amount}%`}</span>
                    <button onClick={() => cancelOrder(o.id)} className="text-term-red hover:underline">
                      cancel
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pastOrders.length > 0 && (
              <div className="mt-3 space-y-1 text-xs">
                <div className="text-[11px] uppercase tracking-wider text-term-dim">Recent</div>
                {pastOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded px-2 py-1 text-term-dim">
                    <span className="num">{o.side === "buy" ? "limit buy" : o.type === "stop" ? "SL" : "TP"}</span>
                    <span className="num">@ {denom === "eth" ? `${fmtEth(o.triggerPrice)} ETH` : `$${fmtUsd(o.triggerPrice * ethUsd)}`}</span>
                    <span
                      className={`num ${o.status === "filled" ? "text-term-green" : o.status === "failed" ? "text-term-red" : ""}`}
                      title={o.failReason ?? undefined}
                    >
                      {o.status}
                      {o.status === "filled" && o.filledPriceUsd != null ? ` $${fmtUsd(o.filledPriceUsd)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {!isMobile && <TokenInfoTabs address={detail.address} symbol={detail.symbol} />}
    </div>
  );
}
