"use client";

// Candlestick chart on lightweight-charts fed from /tokens/:address/candles.

import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, ColorType, IPriceLine } from "lightweight-charts";
import { Candle, fmtMcap } from "@/lib/api";

// Horizontal reference line (avg entry, order triggers). Price is in the
// candles' native unit (quote terms); the chart applies the same multiplier
// as the candle data.
export interface ChartLine {
  price: number;
  color: string;
  title: string;
}

export function CandleChart({
  candles,
  multiplier,
  compact = false,
  lines = [],
}: {
  candles: Candle[];
  multiplier: number;
  // Compact mode formats axis/crosshair values as $12.5K / $3.4M / $1.2B (used for mcap).
  compact?: boolean;
  lines?: ChartLine[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0e12" },
        textColor: "#5f7387",
      },
      grid: {
        vertLines: { color: "#141c24" },
        horzLines: { color: "#141c24" },
      },
      width: containerRef.current.clientWidth,
      height: 420,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#1e2a36" },
      rightPriceScale: { borderColor: "#1e2a36" },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      priceFormat: compact
        ? { type: "custom", formatter: (p: number) => fmtMcap(p), minMove: 0.01 }
        : { type: "price", precision: 6, minMove: 0.000001 },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [compact]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const data = candles.map((c) => ({
      time: c.t as any,
      open: c.o * multiplier,
      high: c.h * multiplier,
      low: c.l * multiplier,
      close: c.c * multiplier,
    }));
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candles, multiplier, compact]);

  // Reference lines: recreate on any change (cheap, few lines).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const pl of priceLinesRef.current) {
      try { series.removePriceLine(pl); } catch {}
    }
    priceLinesRef.current = lines
      .filter((l) => Number.isFinite(l.price) && l.price > 0)
      .map((l) =>
        series.createPriceLine({
          price: l.price * multiplier,
          color: l.color,
          lineWidth: 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: l.title,
        })
      );
  }, [lines, multiplier, compact]);

  return <div ref={containerRef} className="w-full" />;
}
