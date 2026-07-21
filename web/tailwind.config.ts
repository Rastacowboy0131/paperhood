import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        term: {
          bg: "#0b0e11",
          panel: "#11161c",
          raised: "#161d24",
          hover: "#151b22",
          border: "#1e2730",
          text: "#cdd6df",
          dim: "#5f6f7f",
          accent: "#2fbf9a",
          green: "#1fc47a",
          red: "#ee5566",
          amber: "#f0b429",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        flashUp: {
          "0%": { backgroundColor: "rgba(31, 196, 122, 0.14)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashDown: {
          "0%": { backgroundColor: "rgba(238, 85, 102, 0.14)" },
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
