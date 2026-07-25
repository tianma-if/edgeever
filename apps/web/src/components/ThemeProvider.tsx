import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export const MERMAID_THEME_NAMES = [
  "zinc-light",
  "zinc-dark",
  "tokyo-night",
  "tokyo-night-storm",
  "tokyo-night-light",
  "catppuccin-mocha",
  "catppuccin-latte",
  "nord",
  "nord-light",
  "dracula",
  "github-light",
  "github-dark",
  "solarized-light",
  "solarized-dark",
  "one-dark",
] as const;
export type MermaidThemeName = (typeof MERMAID_THEME_NAMES)[number];

export const EDITOR_THEME_NAMES = [
  "default",
  "moyu-green",
  "red-white",
  "graphite-minimal",
  "zen-whitespace",
  "moyu-ticket",
  "olive-journal",
  "mint-breeze",
  "custom",
] as const;
export type EditorThemeName = (typeof EDITOR_THEME_NAMES)[number];

export interface CustomEditorTheme {
  name: string;
  background: string;
  text: string;
  heading: string;
  accent: string;
  soft: string;
  border: string;
}

export const DEFAULT_CUSTOM_EDITOR_THEME: CustomEditorTheme = {
  name: "My custom theme",
  background: "#fffdf7",
  text: "#292524",
  heading: "#1c1917",
  accent: "#0f766e",
  soft: "#f0fdfa",
  border: "#99f6e4",
};

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  mermaidTheme: MermaidThemeName;
  setMermaidTheme: (theme: MermaidThemeName) => void;
  editorTheme: EditorThemeName;
  setEditorTheme: (theme: EditorThemeName) => void;
  customEditorTheme: CustomEditorTheme;
  setCustomEditorTheme: (theme: CustomEditorTheme) => void;
}

interface ThemeProviderProps {
  children: ReactNode;
}

const THEME_STORAGE_KEY = "edgeever.theme";
const MERMAID_THEME_STORAGE_KEY = "edgeever.mermaid-theme";
const EDITOR_THEME_STORAGE_KEY = "edgeever.editor-theme";
const CUSTOM_EDITOR_THEME_STORAGE_KEY = "edgeever.custom-editor-theme";
const LIGHT_THEME_COLOR = "#f8fafc";
const DARK_THEME_COLOR = "#0f172a";
const ThemeContext = createContext<ThemeContextValue | null>(null);

const getSystemTheme = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const resolveTheme = (preference: ThemePreference): ResolvedTheme =>
  preference === "system" ? getSystemTheme() : preference;

export const getStoredThemePreference = (): ThemePreference => {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
};

export const getStoredMermaidTheme = (): MermaidThemeName => {
  if (typeof window === "undefined") return "zinc-light";
  const stored = window.localStorage.getItem(MERMAID_THEME_STORAGE_KEY);
  return MERMAID_THEME_NAMES.includes(stored as MermaidThemeName) ? stored as MermaidThemeName : "zinc-light";
};

export const getStoredEditorTheme = (): EditorThemeName => {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(EDITOR_THEME_STORAGE_KEY);
  if (stored === "mdnice-nenqing") return "mint-breeze";
  return EDITOR_THEME_NAMES.includes(stored as EditorThemeName) ? stored as EditorThemeName : "default";
};

const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export const getStoredCustomEditorTheme = (): CustomEditorTheme => {
  if (typeof window === "undefined") return DEFAULT_CUSTOM_EDITOR_THEME;

  try {
    const stored = JSON.parse(window.localStorage.getItem(CUSTOM_EDITOR_THEME_STORAGE_KEY) || "null") as Partial<CustomEditorTheme> | null;
    if (!stored || typeof stored.name !== "string") return DEFAULT_CUSTOM_EDITOR_THEME;
    const colors = [stored.background, stored.text, stored.heading, stored.accent, stored.soft, stored.border];
    if (!colors.every(isHexColor)) return DEFAULT_CUSTOM_EDITOR_THEME;
    return { ...DEFAULT_CUSTOM_EDITOR_THEME, ...stored } as CustomEditorTheme;
  } catch {
    return DEFAULT_CUSTOM_EDITOR_THEME;
  }
};

const applyThemeToDocument = (preference: ThemePreference) => {
  const resolvedTheme = resolveTheme(preference);
  const root = document.documentElement;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", resolvedTheme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  return resolvedTheme;
};

export const initializeTheme = () => {
  applyThemeToDocument(getStoredThemePreference());
};

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(preference));
  const [mermaidTheme, setMermaidThemeState] = useState<MermaidThemeName>(getStoredMermaidTheme);
  const [editorTheme, setEditorThemeState] = useState<EditorThemeName>(getStoredEditorTheme);
  const [customEditorTheme, setCustomEditorThemeState] = useState<CustomEditorTheme>(getStoredCustomEditorTheme);

  useEffect(() => {
    setResolvedTheme(applyThemeToDocument(preference));
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);

    if (preference !== "system") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => setResolvedTheme(applyThemeToDocument("system"));
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [preference]);

  const value = useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference: (nextPreference: ThemePreference) => setPreferenceState(nextPreference),
      mermaidTheme,
      setMermaidTheme: (nextTheme: MermaidThemeName) => {
        setMermaidThemeState(nextTheme);
        window.localStorage.setItem(MERMAID_THEME_STORAGE_KEY, nextTheme);
      },
      editorTheme,
      setEditorTheme: (nextTheme: EditorThemeName) => {
        setEditorThemeState(nextTheme);
        window.localStorage.setItem(EDITOR_THEME_STORAGE_KEY, nextTheme);
      },
      customEditorTheme,
      setCustomEditorTheme: (nextTheme: CustomEditorTheme) => {
        setCustomEditorThemeState(nextTheme);
        window.localStorage.setItem(CUSTOM_EDITOR_THEME_STORAGE_KEY, JSON.stringify(nextTheme));
      },
    }),
    [customEditorTheme, editorTheme, mermaidTheme, preference, resolvedTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
};
