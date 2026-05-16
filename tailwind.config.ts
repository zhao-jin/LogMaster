import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Eye-care dark palette — warm, low blue-light, easy on the eyes
        // for long log-viewing sessions. Slight green/grey tint reduces
        // contrast fatigue without losing readability.
        bg: {
          DEFAULT: "#1b201c",   // main editor bg — warm dark olive-grey
          panel: "#222824",     // side panels
          elevated: "#2a302c",  // popovers, inputs
          hover: "#323a35",     // row hover
        },
        border: {
          DEFAULT: "#2f3833",
          strong: "#475048",
        },
        fg: {
          DEFAULT: "#d6d2c7",   // warm off-white — easy on eyes
          muted: "#9aa39c",
          subtle: "#6b746e",
        },
        accent: {
          DEFAULT: "#7cb342",   // softer leaf-green
          hover: "#689f38",
        },
        brand: {
          DEFAULT: "#5b9bd5",   // softer steel-blue (less harsh than pure blue)
          hover: "#4a8bc4",
        },
        danger: "#e57373",
        warn: "#e0b85c",
        info: "#7fb3d5",
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
