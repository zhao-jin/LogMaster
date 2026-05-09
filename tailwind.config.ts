import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Modern dark IDE palette
        bg: {
          DEFAULT: "#0b1220",
          panel: "#0f172a",
          elevated: "#111c2e",
          hover: "#1a2436",
        },
        border: {
          DEFAULT: "#1e293b",
          strong: "#334155",
        },
        fg: {
          DEFAULT: "#e2e8f0",
          muted: "#94a3b8",
          subtle: "#64748b",
        },
        accent: {
          DEFAULT: "#22c55e",   // run green
          hover: "#16a34a",
        },
        brand: {
          DEFAULT: "#3b82f6",
          hover: "#2563eb",
        },
        danger: "#ef4444",
        warn: "#f59e0b",
        info: "#38bdf8",
      },
      fontFamily: {
        sans: ["Inter", "Poppins", "system-ui", "sans-serif"],
        mono: [
          "JetBrains Mono",
          "Cascadia Code",
          "Consolas",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        xs: ["11px", "16px"],
        sm: ["12px", "18px"],
        base: ["13px", "20px"],
        lg: ["15px", "22px"],
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,.03) inset, 0 0 0 1px #1e293b",
      },
    },
  },
  plugins: [],
} satisfies Config;
