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
  // Set to make the line draggable; reported back through onLineDragEnd.
  dragId?: string;
}

// Chart chrome per theme. Candles stay the same green/red on both.
const CHART_THEMES = {
  light: {
    bg: "#ffffff",
    text: "#6b7280",
    grid: "#f3f4f6",
    border: "#e5e7eb",
  },
  dark: {
    bg: "#16181d",
    text: "#5f6f7f",
    grid: "#1f2229",
    border: "#24282f",
  },
};

function currentTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

export function CandleChart({
  candles,
  multiplier,
  compact = false,
  lines = [],
  height = 420,
  onLineDragEnd,
}: {
  candles: Candle[];
  multiplier: number;
  // Compact mode formats axis/crosshair values as $12.5K / $3.4M / $1.2B (used for mcap).
  compact?: boolean;
  lines?: ChartLine[];
  height?: number;
  // Called when a draggable line is released at a new price (in the candles'
  // native quote unit, i.e. already divided by the multiplier).
  onLineDragEnd?: (dragId: string, price: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<{ pl: IPriceLine; line: ChartLine }[]>([]);
  const dragEndRef = useRef(onLineDragEnd);
  const multRef = useRef(multiplier);
  dragEndRef.current = onLineDragEnd;
  multRef.current = multiplier;

  useEffect(() => {
    if (!containerRef.current) return;
    const t = CHART_THEMES[currentTheme()];
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: t.bg },
        textColor: t.text,
      },
      grid: {
        vertLines: { color: t.grid },
        horzLines: { color: t.grid },
      },
      width: containerRef.current.clientWidth,
      height,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: t.border },
      rightPriceScale: { borderColor: t.border },
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

    // Drag support for order lines. lightweight-charts price lines are not
    // natively draggable, so we hit-test pointer position against each
    // draggable line's y coordinate and move the line while dragging.
    const el = containerRef.current;
    let dragging: { pl: IPriceLine; line: ChartLine } | null = null;

    const hitTest = (y: number) => {
      for (const entry of priceLinesRef.current) {
        if (!entry.line.dragId) continue;
        const coord = series.priceToCoordinate(entry.line.price * multRef.current);
        if (coord != null && Math.abs(coord - y) <= 8) return entry;
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const hit = hitTest(e.clientY - rect.top);
      if (!hit) return;
      dragging = hit;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      chart.applyOptions({ handleScroll: false, handleScale: false });
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (!dragging) {
        el.style.cursor = hitTest(y) ? "ns-resize" : "";
        return;
      }
      const p = series.coordinateToPrice(y);
      if (p != null && p > 0) dragging.pl.applyOptions({ price: p as number });
    };

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      const rect = el.getBoundingClientRect();
      const p = series.coordinateToPrice(e.clientY - rect.top);
      const d = dragging;
      dragging = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (p != null && p > 0 && d.line.dragId && dragEndRef.current) {
        dragEndRef.current(d.line.dragId, (p as number) / multRef.current);
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    // Follow theme switches: watch <html> class and restyle the chart chrome.
    const observer = new MutationObserver(() => {
      const nt = CHART_THEMES[currentTheme()];
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: nt.bg }, textColor: nt.text },
        grid: { vertLines: { color: nt.grid }, horzLines: { color: nt.grid } },
        timeScale: { borderColor: nt.border },
        rightPriceScale: { borderColor: nt.border },
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };
    // Height changes are applied in a separate effect to avoid full re-creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  // Apply height updates in place (cheap, used by the mobile resize handle).
  useEffect(() => {
    chartRef.current?.applyOptions({ height });
  }, [height]);

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
    for (const { pl } of priceLinesRef.current) {
      try { series.removePriceLine(pl); } catch {}
    }
    priceLinesRef.current = lines
      .filter((l) => Number.isFinite(l.price) && l.price > 0)
      .map((l) => ({
        line: l,
        pl: series.createPriceLine({
          price: l.price * multiplier,
          color: l.color,
          lineWidth: l.dragId ? 2 : 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: l.title,
        }),
      }));
  }, [lines, multiplier, compact]);

  return <div ref={containerRef} className="w-full" />;
}
