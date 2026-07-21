import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        term: {
          bg: "#fafafa",
          panel: "#ffffff",
          raised: "#f3f4f6",
          hover: "#f9fafb",
          border: "#e5e7eb",
          text: "#1f2937",
          dim: "#6b7280",
          accent: "#00c805",
          green: "#00a305",
          red: "#ff5000",
          amber: "#d97706",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        flashUp: {
          "0%": { backgroundColor: "rgba(0, 200, 5, 0.12)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashDown: {
          "0%": { backgroundColor: "rgba(255, 80, 0, 0.10)" },
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
