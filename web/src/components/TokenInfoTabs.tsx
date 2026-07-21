"use client";

// Tabbed token info panel shown under the chart on the trade page:
// recent on-chain trades, top traders (aggregated over the trade window),
// holders, and PaperHood paper trades for this token.
import { useEffect, useState } from "react";
import {
  api,
  Holder,
  PaperTrade,
  PoolTrade,
  TopTrader,
  fmtCompact,
  fmtUsd,
  truncAddr,
} from "@/lib/api";

type Tab = "trades" | "traders" | "holders" | "paper";

const TABS: { id: Tab; label: string }[] = [
  { id: "trades", label: "Trades" },
  { id: "traders", label: "Top Traders" },
  { id: "holders", label: "Holders" },
  { id: "paper", label: "Paper Trades" },
];

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function AddrLink({ addr, explorer, path = "address" }: { addr: string; explorer: string | null; path?: string }) {
  const label = truncAddr(addr);
  if (!explorer) return <span className="num">{label}</span>;
  return (
    <a
      href={`${explorer}/${path}/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className="num text-term-dim hover:text-term-accent"
    >
      {label}
    </a>
  );
}

const thCls = "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-term-dim";
const tdCls = "px-2 py-2 whitespace-nowrap";

export function TokenInfoTabs({ address, symbol }: { address: string; symbol: string }) {
  const [tab, setTab] = useState<Tab>("trades");
  const [trades, setTrades] = useState<PoolTrade[] | null>(null);
  const [topTraders, setTopTraders] = useState<TopTrader[] | null>(null);
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [paper, setPaper] = useState<PaperTrade[] | null>(null);
  const [explorer, setExplorer] = useState<string | null>(null);
  const [tradesErr, setTradesErr] = useState<string | null>(null);
  const [holdersErr, setHoldersErr] = useState<string | null>(null);

  // Trades + top traders: fetch immediately, refresh every 15s while mounted.
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = () => {
      api
        .tokenTrades(address)
        .then((r) => {
          if (!alive) return;
          setTrades(r.trades);
          setTopTraders(r.topTraders);
          setExplorer(r.explorer);
          setTradesErr(null);
        })
        .catch((e) => {
          if (!alive) return;
          setTradesErr(e.message);
          if (!trades) setTrades([]);
        });
    };
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Holders and paper trades: lazy fetch on first tab visit.
  useEffect(() => {
    if (!address) return;
    if (tab === "holders" && holders === null) {
      api
        .tokenHolders(address)
        .then((r) => { setHolders(r.holders); setExplorer((x) => x || r.explorer); setHoldersErr(null); })
        .catch((e) => { setHolders([]); setHoldersErr(e.message); });
    }
    if (tab === "paper" && paper === null) {
      api.paperTrades(address).then((r) => setPaper(r.trades)).catch(() => setPaper([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, address]);

  return (
    <div className="panel mt-4">
      <div className="flex gap-1 border-b border-gray-100 p-2">
        <div className="tab-track">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
        </div>
        {tab === "traders" && trades && (
          <span className="ml-auto self-center text-[10px] text-term-dim">last {trades.length} trades</span>
        )}
      </div>

      <div className="overflow-x-auto">
        {tab === "trades" && (
          trades === null ? (
            <Empty text="Loading trades..." />
          ) : trades.length === 0 ? (
            <Empty text={tradesErr ? `On-chain trades unavailable (${tradesErr})` : "No recent trades"} />
          ) : (
            <table className="num w-full min-w-[560px] text-xs">
              <thead>
                <tr className="border-b border-term-border">
                  <th className={thCls}>Time</th>
                  <th className={thCls}>Side</th>
                  <th className={`${thCls} text-right`}>Amount ({symbol})</th>
                  <th className={`${thCls} text-right`}>Price</th>
                  <th className={`${thCls} text-right`}>Value</th>
                  <th className={thCls}>Wallet</th>
                  <th className={thCls}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={`${t.txHash}-${i}`} className="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50">
                    <td className={`${tdCls} text-term-dim`}>{timeAgo(t.ts)}</td>
                    <td className={`${tdCls} ${t.side === "buy" ? "text-term-green" : "text-term-red"}`}>
                      {t.side.toUpperCase()}
                    </td>
                    <td className={`${tdCls} text-right`}>{fmtCompact(t.tokenAmount)}</td>
                    <td className={`${tdCls} text-right`}>${fmtUsd(t.priceUsd)}</td>
                    <td className={`${tdCls} text-right`}>${fmtUsd(t.volumeUsd, 2)}</td>
                    <td className={tdCls}><AddrLink addr={t.wallet} explorer={explorer} /></td>
                    <td className={tdCls}><AddrLink addr={t.txHash} explorer={explorer} path="tx" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "traders" && (
          topTraders === null ? (
            <Empty text="Loading..." />
          ) : topTraders.length === 0 ? (
            <Empty text="No trader data in the recent window" />
          ) : (
            <table className="num w-full min-w-[560px] text-xs">
              <thead>
                <tr className="border-b border-term-border">
                  <th className={thCls}>#</th>
                  <th className={thCls}>Wallet</th>
                  <th className={`${thCls} text-right`}>Buys</th>
                  <th className={`${thCls} text-right`}>Sells</th>
                  <th className={`${thCls} text-right`}>Buy Vol</th>
                  <th className={`${thCls} text-right`}>Sell Vol</th>
                  <th className={`${thCls} text-right`}>Net</th>
                </tr>
              </thead>
              <tbody>
                {topTraders.map((t, i) => (
                  <tr key={t.wallet} className="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50">
                    <td className={`${tdCls} text-term-dim`}>{i + 1}</td>
                    <td className={tdCls}><AddrLink addr={t.wallet} explorer={explorer} /></td>
                    <td className={`${tdCls} text-right text-term-green`}>{t.buys}</td>
                    <td className={`${tdCls} text-right text-term-red`}>{t.sells}</td>
                    <td className={`${tdCls} text-right`}>${fmtUsd(t.buyVolumeUsd, 2)}</td>
                    <td className={`${tdCls} text-right`}>${fmtUsd(t.sellVolumeUsd, 2)}</td>
                    <td className={`${tdCls} text-right ${t.netVolumeUsd >= 0 ? "text-term-green" : "text-term-red"}`}>
                      {t.netVolumeUsd >= 0 ? "+" : ""}${fmtUsd(t.netVolumeUsd, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "holders" && (
          holders === null ? (
            <Empty text="Loading holders..." />
          ) : holders.length === 0 ? (
            <Empty text={holdersErr ? `Holders unavailable (${holdersErr})` : "No holder data"} />
          ) : (
            <table className="num w-full min-w-[480px] text-xs">
              <thead>
                <tr className="border-b border-term-border">
                  <th className={thCls}>#</th>
                  <th className={thCls}>Address</th>
                  <th className={`${thCls} text-right`}>Balance ({symbol})</th>
                  <th className={`${thCls} text-right`}>% Supply</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((h, i) => (
                  <tr key={h.address} className="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50">
                    <td className={`${tdCls} text-term-dim`}>{i + 1}</td>
                    <td className={tdCls}>
                      <AddrLink addr={h.address} explorer={explorer} />
                      {h.isContract && <span className="ml-1 text-[10px] text-term-dim">(contract)</span>}
                    </td>
                    <td className={`${tdCls} text-right`}>{fmtCompact(h.balance)}</td>
                    <td className={`${tdCls} text-right`}>
                      {h.pctOfSupply != null ? `${h.pctOfSupply < 0.01 ? "<0.01" : h.pctOfSupply.toFixed(2)}%` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "paper" && (
          paper === null ? (
            <Empty text="Loading..." />
          ) : paper.length === 0 ? (
            <Empty text="No paper trades on this token yet" />
          ) : (
            <table className="num w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-term-border">
                  <th className={thCls}>Time</th>
                  <th className={thCls}>Trader</th>
                  <th className={thCls}>Side</th>
                  <th className={`${thCls} text-right`}>Amount ({symbol})</th>
                  <th className={`${thCls} text-right`}>Price</th>
                  <th className={`${thCls} text-right`}>Value</th>
                  <th className={`${thCls} text-right`}>PnL</th>
                </tr>
              </thead>
              <tbody>
                {paper.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50">
                    <td className={`${tdCls} text-term-dim`}>{timeAgo(t.ts)}</td>
                    <td className={tdCls}>{t.display}</td>
                    <td className={`${tdCls} ${t.side === "buy" ? "text-term-green" : "text-term-red"}`}>
                      {t.side.toUpperCase()}
                    </td>
                    <td className={`${tdCls} text-right`}>{fmtCompact(t.amountOutDec)}</td>
                    <td className={`${tdCls} text-right`}>${fmtUsd(t.execPriceUsd)}</td>
                    <td className={`${tdCls} text-right`}>${fmtUsd(t.usd, 2)}</td>
                    <td className={`${tdCls} text-right ${t.realizedPnlUsd == null ? "text-term-dim" : t.realizedPnlUsd >= 0 ? "text-term-green" : "text-term-red"}`}>
                      {t.realizedPnlUsd == null ? "-" : `${t.realizedPnlUsd >= 0 ? "+" : ""}$${fmtUsd(t.realizedPnlUsd, 2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-3 py-6 text-center text-xs text-term-dim">{text}</div>;
}
