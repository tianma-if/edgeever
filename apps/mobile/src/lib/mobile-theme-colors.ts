export type MobileResolvedTheme = "light" | "dark";
export type MobileThemeColorUsage = "foreground" | "background" | "border";

const foregroundDarkMap: Record<string, string> = {
  "#020617": "#f8fafc",
  "#0f172a": "#f8fafc",
  "#1e293b": "#f1f5f9",
  "#17211a": "#f8fafc",
  "#334155": "#e2e8f0",
  "#475569": "#e2e8f0",
  "#64748b": "#cbd5e1",
  "#94a3b8": "#94a3b8",
  "#047857": "#6ee7b7",
  "#059669": "#6ee7b7",
  "#10b981": "#34d399",
  "#15803d": "#86efac",
  "#0f766e": "#5eead4",
  "#134e4a": "#99f6e4",
  "#92400e": "#fde68a",
  "#78350f": "#fde68a",
  "#c2410c": "#fdba74",
  "#1d4ed8": "#93c5fd",
  "#1e3a8a": "#bfdbfe",
  "#991b1b": "#fca5a5",
  "#dc2626": "#fca5a5",
  "#b91c1c": "#fca5a5",
  "#be123c": "#fda4af",
  "#e11d48": "#fb7185",
};

const backgroundDarkMap: Record<string, string> = {
  "#ffffff": "#0f172a",
  "#f8fafc": "#020617",
  "#f7faf7": "#020617",
  "#f1f5f9": "#1e293b",
  "#ecfdf5": "#064e3b",
  "#ecfdf3": "#064e3b",
  "#d1fae5": "#065f46",
  "#f0fdf4": "#052e16",
  "#fef2f2": "#450a0a",
  "#fff1f2": "#4c0519",
  "#fffbeb": "#451a03",
  "#fef3c7": "#78350f",
  "#fff7ed": "#431407",
  "#eff6ff": "#172554",
  "#ccfbf1": "#134e4a",
  "#f3f4f6": "#1f2937",
  "#f0f0f0": "#1e293b",
  "#f8f8f8": "#0f172a",
};

const borderDarkMap: Record<string, string> = {
  "#f1f5f9": "#1e293b",
  "#e2e8f0": "#334155",
  "#cbd5e1": "#475569",
  "#a7f3d0": "#047857",
  "#fecaca": "#7f1d1d",
  "#fda4af": "#9f1239",
  "#dce7dd": "#334155",
  "#cad8cc": "#475569",
  "#bbf7d0": "#047857",
  "#fde68a": "#92400e",
  "#bfdbfe": "#1e3a8a",
  "#fecdd3": "#9f1239",
};

const palettes: Record<MobileThemeColorUsage, Record<string, string>> = {
  foreground: foregroundDarkMap,
  background: backgroundDarkMap,
  border: borderDarkMap,
};

export const resolveMobileThemeColor = (
  value: string | undefined,
  theme: MobileResolvedTheme,
  usage: MobileThemeColorUsage = "foreground"
) => {
  if (theme !== "dark" || typeof value !== "string") {
    return value;
  }
  return palettes[usage][value.toLowerCase()] ?? value;
};

export const resolveMobileThemeStyles = <T extends Record<string, unknown>>(styleSheet: T, theme: MobileResolvedTheme): T => {
  if (theme === "light") {
    return styleSheet;
  }
  return Object.fromEntries(
    Object.entries(styleSheet).map(([styleName, styleValue]) => {
      if (!styleValue || typeof styleValue !== "object") {
        return [styleName, styleValue];
      }
      const resolvedStyle = Object.fromEntries(
        Object.entries(styleValue).map(([property, value]) => {
          if (property === "color" || property === "tintColor") {
            return [property, typeof value === "string" ? resolveMobileThemeColor(value, theme, "foreground") : value];
          }
          if (property === "backgroundColor") {
            return [property, typeof value === "string" ? resolveMobileThemeColor(value, theme, "background") : value];
          }
          if (property.startsWith("border") && property.endsWith("Color")) {
            return [property, typeof value === "string" ? resolveMobileThemeColor(value, theme, "border") : value];
          }
          return [property, value];
        })
      );
      return [styleName, resolvedStyle];
    })
  ) as T;
};
