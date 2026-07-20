import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        term: {
          bg: "#0a0e12",
          panel: "#10161d",
          border: "#1e2a36",
          text: "#c9d7e3",
          dim: "#5f7387",
          accent: "#31c48d",
          green: "#22c55e",
          red: "#ef4444",
          amber: "#f59e0b",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
