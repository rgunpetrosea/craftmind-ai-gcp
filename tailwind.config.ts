import type { Config } from "tailwindcss";

// Loaded from src/app/globals.css via `@config` (Tailwind v4 legacy-config bridge).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        leather: {
          50: "#fbf6f1",
          100: "#f3e7da",
          200: "#e6cdb3",
          300: "#d4ab84",
          400: "#c08657",
          500: "#a8683a",
          600: "#8b522e",
          700: "#6e3f26",
          800: "#553122",
          900: "#3d241a",
        },
        wa: {
          header: "#075e54",
          accent: "#25d366",
          bubble: "#dcf8c6",
          wallpaper: "#ece5dd",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
    },
  },
};

export default config;
