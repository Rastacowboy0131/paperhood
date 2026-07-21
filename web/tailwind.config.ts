import type { Config } from "tailwindcss";

// term-* colors resolve through CSS variables so light/dark themes swap at
// runtime via the .dark class on <html>. Variables live in globals.css.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        term: {
          bg: v("term-bg"),
          panel: v("term-panel"),
          raised: v("term-raised"),
          hover: v("term-hover"),
          border: v("term-border"),
          line: v("term-line"),
          text: v("term-text"),
          dim: v("term-dim"),
          faint: v("term-faint"),
          skeleton: v("term-skeleton"),
          accent: v("term-accent"),
          green: v("term-green"),
          red: v("term-red"),
          amber: v("term-amber"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        flashUp: {
          "0%": { backgroundColor: "rgb(var(--term-green) / 0.12)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashDown: {
          "0%": { backgroundColor: "rgb(var(--term-red) / 0.10)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "flash-up": "flashUp 0.8s ease-out",
        "flash-down": "flashDown 0.8s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
