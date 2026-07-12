import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

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
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        panel: "0 1px 2px rgb(15 23 42 / 0.07), 0 14px 34px rgb(36 56 39 / 0.08)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
