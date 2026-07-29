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

interface MermaidThemePalette {
  bg: string;
  fg: string;
  line?: string;
  accent?: string;
  muted?: string;
  surface?: string;
  border?: string;
}

export const MERMAID_THEME_PALETTES: Record<MermaidThemeName, MermaidThemePalette> = {
  "zinc-light": { bg: "#FFFFFF", fg: "#27272A" },
  "zinc-dark": { bg: "#18181B", fg: "#FAFAFA" },
  "tokyo-night": { bg: "#1a1b26", fg: "#a9b1d6", line: "#3d59a1", accent: "#7aa2f7", muted: "#565f89" },
  "tokyo-night-storm": { bg: "#24283b", fg: "#a9b1d6", line: "#3d59a1", accent: "#7aa2f7", muted: "#565f89" },
  "tokyo-night-light": { bg: "#d5d6db", fg: "#343b58", line: "#34548a", accent: "#34548a", muted: "#9699a3" },
  "catppuccin-mocha": { bg: "#1e1e2e", fg: "#cdd6f4", line: "#585b70", accent: "#cba6f7", muted: "#6c7086" },
  "catppuccin-latte": { bg: "#eff1f5", fg: "#4c4f69", line: "#9ca0b0", accent: "#8839ef", muted: "#9ca0b0" },
  nord: { bg: "#2e3440", fg: "#d8dee9", line: "#4c566a", accent: "#88c0d0", muted: "#616e88" },
  "nord-light": { bg: "#eceff4", fg: "#2e3440", line: "#aab1c0", accent: "#5e81ac", muted: "#7b88a1" },
  dracula: { bg: "#282a36", fg: "#f8f8f2", line: "#6272a4", accent: "#bd93f9", muted: "#6272a4" },
  "github-light": { bg: "#ffffff", fg: "#1f2328", line: "#d1d9e0", accent: "#0969da", muted: "#59636e" },
  "github-dark": { bg: "#0d1117", fg: "#e6edf3", line: "#3d444d", accent: "#4493f8", muted: "#9198a1" },
  "solarized-light": { bg: "#fdf6e3", fg: "#657b83", line: "#93a1a1", accent: "#268bd2", muted: "#93a1a1" },
  "solarized-dark": { bg: "#002b36", fg: "#839496", line: "#586e75", accent: "#268bd2", muted: "#586e75" },
  "one-dark": { bg: "#282c34", fg: "#abb2bf", line: "#4b5263", accent: "#c678dd", muted: "#5c6370" },
};

export const MERMAID_RENDERERS = ["mermaid", "beautiful"] as const;
export type MermaidRenderer = (typeof MERMAID_RENDERERS)[number];

export const EDITOR_THEME_NAMES = [
  "default",
  "minimal-emerald",
  "outline-emerald",
  "custom",
] as const;
export type EditorThemeName = string;

export interface ThemeColors {
  background: string;
  text: string;
  heading: string;
  accent: string;
  soft: string;
  border: string;
}

export interface CustomEditorTheme {
  id: string;
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
  customCss?: string;
}

export const DEFAULT_CUSTOM_LIGHT_COLORS: ThemeColors = {
  background: "#fffdf7",
  text: "#292524",
  heading: "#1c1917",
  accent: "#0f766e",
  soft: "#f0fdfa",
  border: "#99f6e4",
};

export const DEFAULT_CUSTOM_DARK_COLORS: ThemeColors = {
  background: "#1c1917",
  text: "#fafaf9",
  heading: "#fafaf9",
  accent: "#0d9488",
  soft: "#292524",
  border: "#44403c",
};

export const DEFAULT_CUSTOM_EDITOR_THEME: CustomEditorTheme = {
  id: "custom-default",
  name: "My custom theme",
  light: DEFAULT_CUSTOM_LIGHT_COLORS,
  dark: DEFAULT_CUSTOM_DARK_COLORS,
  customCss: "",
};

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  mermaidTheme: MermaidThemeName;
  setMermaidTheme: (theme: MermaidThemeName) => void;
  mermaidRenderer: MermaidRenderer;
  setMermaidRenderer: (renderer: MermaidRenderer) => void;
  editorTheme: EditorThemeName;
  setEditorTheme: (theme: EditorThemeName) => void;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: (themes: CustomEditorTheme[]) => void;
  customEditorTheme: CustomEditorTheme;
  setCustomEditorTheme: (theme: CustomEditorTheme) => void;
}

interface ThemeProviderProps {
  children: ReactNode;
}

const THEME_STORAGE_KEY = "edgeever.theme";
const MERMAID_THEME_STORAGE_KEY = "edgeever.mermaid-theme";
const MERMAID_RENDERER_STORAGE_KEY = "edgeever.mermaid-renderer";
const EDITOR_THEME_STORAGE_KEY = "edgeever.editor-theme";
const CUSTOM_EDITOR_THEME_STORAGE_KEY = "edgeever.custom-editor-theme";
const CUSTOM_EDITOR_THEMES_STORAGE_KEY = "edgeever.custom-editor-themes";
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

export const getStoredMermaidRenderer = (): MermaidRenderer => {
  if (typeof window === "undefined") return "mermaid";
  const stored = window.localStorage.getItem(MERMAID_RENDERER_STORAGE_KEY);
  return MERMAID_RENDERERS.includes(stored as MermaidRenderer) ? stored as MermaidRenderer : "mermaid";
};

export const getStoredEditorTheme = (): string => {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(EDITOR_THEME_STORAGE_KEY);
  return stored || "default";
};

const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export const getStoredCustomEditorThemes = (): CustomEditorTheme[] => {
  if (typeof window === "undefined") return [DEFAULT_CUSTOM_EDITOR_THEME];

  try {
    const storedThemesStr = window.localStorage.getItem(CUSTOM_EDITOR_THEMES_STORAGE_KEY);
    if (storedThemesStr) {
      const parsed = JSON.parse(storedThemesStr) as CustomEditorTheme[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore error
  }

  // Migrate legacy single custom theme
  try {
    const oldThemeStr = window.localStorage.getItem(CUSTOM_EDITOR_THEME_STORAGE_KEY);
    if (oldThemeStr) {
      const oldTheme = JSON.parse(oldThemeStr) as any;
      if (oldTheme && typeof oldTheme.name === "string") {
        const migratedTheme: CustomEditorTheme = {
          id: "custom-migrated",
          name: oldTheme.name || "My custom theme",
          light: {
            background: oldTheme.background || DEFAULT_CUSTOM_LIGHT_COLORS.background,
            text: oldTheme.text || DEFAULT_CUSTOM_LIGHT_COLORS.text,
            heading: oldTheme.heading || DEFAULT_CUSTOM_LIGHT_COLORS.heading,
            accent: oldTheme.accent || DEFAULT_CUSTOM_LIGHT_COLORS.accent,
            soft: oldTheme.soft || DEFAULT_CUSTOM_LIGHT_COLORS.soft,
            border: oldTheme.border || DEFAULT_CUSTOM_LIGHT_COLORS.border,
          },
          dark: DEFAULT_CUSTOM_DARK_COLORS,
          customCss: "",
        };
        window.localStorage.setItem(CUSTOM_EDITOR_THEMES_STORAGE_KEY, JSON.stringify([migratedTheme]));
        return [migratedTheme];
      }
    }
  } catch {
    // Ignore error
  }

  return [DEFAULT_CUSTOM_EDITOR_THEME];
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
  const [mermaidRenderer, setMermaidRendererState] = useState<MermaidRenderer>(getStoredMermaidRenderer);
  const [editorTheme, setEditorThemeState] = useState<string>(getStoredEditorTheme);
  const [customEditorThemes, setCustomEditorThemesState] = useState<CustomEditorTheme[]>(getStoredCustomEditorThemes);

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

  const customEditorTheme = useMemo(() => {
    const active = customEditorThemes.find((t) => t.id === editorTheme);
    if (active) return active;
    return customEditorThemes[0] || DEFAULT_CUSTOM_EDITOR_THEME;
  }, [customEditorThemes, editorTheme]);

  const setCustomEditorTheme = (updatedTheme: CustomEditorTheme) => {
    const nextThemes = customEditorThemes.map((t) =>
      t.id === updatedTheme.id ? updatedTheme : t
    );
    if (!customEditorThemes.some((t) => t.id === updatedTheme.id)) {
      if (customEditorThemes.length > 0) {
        nextThemes[0] = { ...customEditorThemes[0], ...updatedTheme };
      } else {
        nextThemes.push(updatedTheme);
      }
    }
    setCustomEditorThemesState(nextThemes);
    window.localStorage.setItem(CUSTOM_EDITOR_THEMES_STORAGE_KEY, JSON.stringify(nextThemes));
  };

  const setCustomEditorThemes = (nextThemes: CustomEditorTheme[]) => {
    setCustomEditorThemesState(nextThemes);
    window.localStorage.setItem(CUSTOM_EDITOR_THEMES_STORAGE_KEY, JSON.stringify(nextThemes));
  };

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
      mermaidRenderer,
      setMermaidRenderer: (nextRenderer: MermaidRenderer) => {
        setMermaidRendererState(nextRenderer);
        window.localStorage.setItem(MERMAID_RENDERER_STORAGE_KEY, nextRenderer);
      },
      editorTheme,
      setEditorTheme: (nextTheme: string) => {
        setEditorThemeState(nextTheme);
        window.localStorage.setItem(EDITOR_THEME_STORAGE_KEY, nextTheme);
      },
      customEditorThemes,
      setCustomEditorThemes,
      customEditorTheme,
      setCustomEditorTheme,
    }),
    [customEditorThemes, customEditorTheme, editorTheme, mermaidRenderer, mermaidTheme, preference, resolvedTheme]
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
