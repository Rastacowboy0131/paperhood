"use client";

// Equity-over-time line chart for the portfolio page (lightweight-charts).
// Theme-aware via the same html.dark observer approach as CandleChart.

import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, ColorType, UTCTimestamp } from "lightweight-charts";
import { EquityPoint } from "@/lib/api";

const THEMES = {
  light: { bg: "#ffffff", text: "#6b7280", grid: "#f3f4f6", border: "#e5e7eb" },
  dark: { bg: "#16181d", text: "#5f6f7f", grid: "#1f2229", border: "#24282f" },
};

function currentTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

export function EquityChart({ points, height = 220 }: { points: EquityPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const t = THEMES[currentTheme()];
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: t.bg }, textColor: t.text },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      width: containerRef.current.clientWidth,
      height,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: t.border },
      rightPriceScale: { borderColor: t.border },
    });
    const series = chart.addAreaSeries({
      lineColor: "#22c55e",
      lineWidth: 2,
      topColor: "rgba(34,197,94,0.25)",
      bottomColor: "rgba(0,0,0,0)",
      priceFormat: { type: "custom", formatter: (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    const observer = new MutationObserver(() => {
      const nt = THEMES[currentTheme()];
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: nt.bg }, textColor: nt.text },
        grid: { vertLines: { color: nt.grid }, horzLines: { color: nt.grid } },
        timeScale: { borderColor: nt.border },
        rightPriceScale: { borderColor: nt.border },
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // Chart lifecycle only; data is set in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const up = points.length < 2 || points[points.length - 1].equityUsd >= points[0].equityUsd;
    seriesRef.current.applyOptions({
      lineColor: up ? "#22c55e" : "#ef4444",
      topColor: up ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)",
    });
    seriesRef.current.setData(
      points.map((p) => ({ time: p.ts as UTCTimestamp, value: p.equityUsd }))
    );
    chartRef.current.timeScale().fitContent();
  }, [points]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
