import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";
import { MOBILE_UI_METRICS } from "@edgeever/shared/mobile-ui";

const brandGreen = (shade: number) => `rgb(var(--brand-green-${shade}-rgb) / <alpha-value>)`;
const slate = (shade: number) => `rgb(var(--slate-${shade}-rgb) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{ts,tsx}"],
  },
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Noto Sans SC",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
      boxShadow: {
        panel: "0 1px 2px rgb(var(--slate-900-rgb) / 0.05), 0 16px 40px rgb(var(--slate-900-rgb) / 0.07)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        "mobile-sheet": `${MOBILE_UI_METRICS.floatingSheetCornerRadius}px`,
        sm: "calc(var(--radius) - 4px)",
      },
      spacing: {
        "mobile-bottom-nav": `${MOBILE_UI_METRICS.bottomNavigationHeight}px`,
        "mobile-control": `${MOBILE_UI_METRICS.compactControlHeight}px`,
        "mobile-fab": `${MOBILE_UI_METRICS.floatingCreateButtonSize}px`,
        "mobile-touch": `${MOBILE_UI_METRICS.minimumTouchTarget}px`,
      },
      colors: {
        slate: {
          50: slate(50),
          100: slate(100),
          200: slate(200),
          300: slate(300),
          400: slate(400),
          500: slate(500),
          600: slate(600),
          700: slate(700),
          800: slate(800),
          900: slate(900),
          950: "#020617",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        emerald: {
          50: brandGreen(50),
          100: brandGreen(100),
          200: brandGreen(200),
          300: brandGreen(300),
          400: brandGreen(400),
          500: brandGreen(500),
          600: brandGreen(600),
          700: brandGreen(700),
          800: brandGreen(800),
          900: brandGreen(900),
          950: brandGreen(950),
        },
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindAnimate],
} satisfies Config;
