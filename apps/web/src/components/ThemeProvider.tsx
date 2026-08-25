import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
export const MERMAID_THEME_PREFERENCES = ["auto", ...MERMAID_THEME_NAMES] as const;
export type MermaidThemePreference = (typeof MERMAID_THEME_PREFERENCES)[number];

export interface MermaidThemePalette {
  bg: string;
  fg: string;
  line?: string;
  accent?: string;
  muted?: string;
  surface?: string;
  border?: string;
}

export const MERMAID_THEME_PALETTES: Record<MermaidThemeName, MermaidThemePalette> = {
  "zinc-light": { bg: "#FFFFFF", fg: "#27272A", line: "#a1a1aa", accent: "#52525b", muted: "#71717a" },
  "zinc-dark": { bg: "#18181B", fg: "#FAFAFA", line: "#52525b", accent: "#a1a1aa", muted: "#a1a1aa" },
  "tokyo-night": { bg: "#1a1b26", fg: "#a9b1d6", line: "#3d59a1", accent: "#7aa2f7", muted: "#7c85ac" },
  "tokyo-night-storm": { bg: "#24283b", fg: "#a9b1d6", line: "#3d59a1", accent: "#7aa2f7", muted: "#8991b8" },
  "tokyo-night-light": { bg: "#d5d6db", fg: "#343b58", line: "#34548a", accent: "#34548a", muted: "#545a71" },
  "catppuccin-mocha": { bg: "#1e1e2e", fg: "#cdd6f4", line: "#585b70", accent: "#cba6f7", muted: "#9399b2" },
  "catppuccin-latte": { bg: "#eff1f5", fg: "#4c4f69", line: "#9ca0b0", accent: "#8839ef", muted: "#666a80" },
  nord: { bg: "#2e3440", fg: "#d8dee9", line: "#4c566a", accent: "#88c0d0", muted: "#97a0b4" },
  "nord-light": { bg: "#eceff4", fg: "#2e3440", line: "#aab1c0", accent: "#5e81ac", muted: "#5f6a7e" },
  dracula: { bg: "#282a36", fg: "#f8f8f2", line: "#6272a4", accent: "#bd93f9", muted: "#8894b8" },
  "github-light": { bg: "#ffffff", fg: "#1f2328", line: "#d1d9e0", accent: "#0969da", muted: "#59636e" },
  "github-dark": { bg: "#0d1117", fg: "#e6edf3", line: "#3d444d", accent: "#4493f8", muted: "#9198a1" },
  "solarized-light": { bg: "#fdf6e3", fg: "#586e75", line: "#93a1a1", accent: "#268bd2", muted: "#5f747b" },
  "solarized-dark": { bg: "#002b36", fg: "#839496", line: "#586e75", accent: "#268bd2", muted: "#93a1a1" },
  "one-dark": { bg: "#282c34", fg: "#abb2bf", line: "#4b5263", accent: "#c678dd", muted: "#8f96a3" },
};

export const EDITOR_THEME_NAMES = [
  "default",
  "minimal-emerald",
  "outline-emerald",
  "wechat-green",
  "modern-mint",
  "marxico",
  "custom",
] as const;
export type EditorThemeName = string;

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
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
  muted: "#57534e",
  heading: "#1c1917",
  accent: "#0f766e",
  soft: "#f0fdfa",
  border: "#99f6e4",
};

export const DEFAULT_CUSTOM_DARK_COLORS: ThemeColors = {
  background: "#1c1917",
  text: "#fafaf9",
  muted: "#d6d3d1",
  heading: "#fafaf9",
  accent: "#2dd4bf",
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

interface AppearanceThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

interface MermaidThemeContextValue {
  mermaidTheme: MermaidThemeName;
  mermaidThemePreference: MermaidThemePreference;
  setMermaidTheme: (theme: MermaidThemePreference) => void;
}

interface EditorThemeContextValue {
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
const EDITOR_THEME_STORAGE_KEY = "edgeever.editor-theme";
const CUSTOM_EDITOR_THEME_STORAGE_KEY = "edgeever.custom-editor-theme";
const CUSTOM_EDITOR_THEMES_STORAGE_KEY = "edgeever.custom-editor-themes";
const LIGHT_THEME_COLOR = "#f3f5f7";
const DARK_THEME_COLOR = "#101311";
const AppearanceThemeContext = createContext<AppearanceThemeContextValue | null>(null);
const MermaidThemeContext = createContext<MermaidThemeContextValue | null>(null);
const EditorThemeContext = createContext<EditorThemeContextValue | null>(null);

const getSystemTheme = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const resolveTheme = (preference: ThemePreference): ResolvedTheme =>
  preference === "system" ? getSystemTheme() : preference;

// localStorage can be missing or blocked in restricted browsers, private mode,
// and unit tests that stub `window` without a storage implementation.
const readLocalStorageItem = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const getStoredThemePreference = (): ThemePreference => {
  const stored = readLocalStorageItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
};

export const getStoredMermaidTheme = (): MermaidThemePreference => {
  const stored = readLocalStorageItem(MERMAID_THEME_STORAGE_KEY);
  return MERMAID_THEME_PREFERENCES.includes(stored as MermaidThemePreference)
    ? stored as MermaidThemePreference
    : "auto";
};

export const resolveMermaidTheme = (
  preference: MermaidThemePreference,
  appearance: ResolvedTheme,
): MermaidThemeName => preference === "auto"
  ? appearance === "dark" ? "zinc-dark" : "zinc-light"
  : preference;

export const getStoredEditorTheme = (): string => {
  return readLocalStorageItem(EDITOR_THEME_STORAGE_KEY) || "default";
};

const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

const normalizeThemeColors = (value: Partial<ThemeColors> | undefined, fallback: ThemeColors): ThemeColors => ({
  background: isHexColor(value?.background) ? value.background : fallback.background,
  text: isHexColor(value?.text) ? value.text : fallback.text,
  muted: isHexColor(value?.muted) ? value.muted : fallback.muted,
  heading: isHexColor(value?.heading) ? value.heading : fallback.heading,
  accent: isHexColor(value?.accent) ? value.accent : fallback.accent,
  soft: isHexColor(value?.soft) ? value.soft : fallback.soft,
  border: isHexColor(value?.border) ? value.border : fallback.border,
});

const normalizeCustomEditorTheme = (theme: CustomEditorTheme): CustomEditorTheme => ({
  ...theme,
  light: normalizeThemeColors(theme.light, DEFAULT_CUSTOM_LIGHT_COLORS),
  dark: normalizeThemeColors(theme.dark, DEFAULT_CUSTOM_DARK_COLORS),
});

export const getStoredCustomEditorThemes = (): CustomEditorTheme[] => {
  if (typeof window === "undefined") return [DEFAULT_CUSTOM_EDITOR_THEME];

  try {
    const storedThemesStr = window.localStorage.getItem(CUSTOM_EDITOR_THEMES_STORAGE_KEY);
    if (storedThemesStr) {
      const parsed = JSON.parse(storedThemesStr) as CustomEditorTheme[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(normalizeCustomEditorTheme);
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
            muted: oldTheme.muted || DEFAULT_CUSTOM_LIGHT_COLORS.muted,
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
  const [mermaidThemePreference, setMermaidThemePreference] = useState<MermaidThemePreference>(getStoredMermaidTheme);
  const [editorTheme, setEditorThemeState] = useState<string>(getStoredEditorTheme);
  const [customEditorThemes, setCustomEditorThemesState] = useState<CustomEditorTheme[]>(getStoredCustomEditorThemes);

  useEffect(() => {
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

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    // Apply the class before scheduling React work so a theme toggle can paint
    // without waiting for the workspace and editor tree to render.
    setResolvedTheme(applyThemeToDocument(nextPreference));
    setPreferenceState(nextPreference);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
  }, []);

  const setCustomEditorTheme = useCallback((updatedTheme: CustomEditorTheme) => {
    setCustomEditorThemesState((currentThemes) => {
      const nextThemes = currentThemes.map((theme) =>
        theme.id === updatedTheme.id ? updatedTheme : theme
      );
      if (!currentThemes.some((theme) => theme.id === updatedTheme.id)) {
        if (currentThemes.length > 0) {
          nextThemes[0] = { ...currentThemes[0], ...updatedTheme };
        } else {
          nextThemes.push(updatedTheme);
        }
      }
      window.localStorage.setItem(CUSTOM_EDITOR_THEMES_STORAGE_KEY, JSON.stringify(nextThemes));
      return nextThemes;
    });
  }, []);

  const setCustomEditorThemes = useCallback((nextThemes: CustomEditorTheme[]) => {
    setCustomEditorThemesState(nextThemes);
    window.localStorage.setItem(CUSTOM_EDITOR_THEMES_STORAGE_KEY, JSON.stringify(nextThemes));
  }, []);

  const mermaidTheme = resolveMermaidTheme(mermaidThemePreference, resolvedTheme);

  const setMermaidTheme = useCallback((nextTheme: MermaidThemePreference) => {
    setMermaidThemePreference(nextTheme);
    window.localStorage.setItem(MERMAID_THEME_STORAGE_KEY, nextTheme);
  }, []);

  const setEditorTheme = useCallback((nextTheme: string) => {
    setEditorThemeState(nextTheme);
    window.localStorage.setItem(EDITOR_THEME_STORAGE_KEY, nextTheme);
  }, []);

  const appearanceValue = useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
    }),
    [preference, resolvedTheme, setPreference]
  );

  const mermaidValue = useMemo(
    () => ({
      mermaidTheme,
      mermaidThemePreference,
      setMermaidTheme,
    }),
    [mermaidTheme, mermaidThemePreference, setMermaidTheme]
  );

  const editorValue = useMemo(
    () => ({
      editorTheme,
      setEditorTheme,
      customEditorThemes,
      setCustomEditorThemes,
      customEditorTheme,
      setCustomEditorTheme,
    }),
    [customEditorThemes, customEditorTheme, editorTheme, setCustomEditorTheme, setCustomEditorThemes, setEditorTheme]
  );

  return (
    <AppearanceThemeContext.Provider value={appearanceValue}>
      <MermaidThemeContext.Provider value={mermaidValue}>
        <EditorThemeContext.Provider value={editorValue}>
          {children}
        </EditorThemeContext.Provider>
      </MermaidThemeContext.Provider>
    </AppearanceThemeContext.Provider>
  );
};

export const useAppearanceTheme = () => {
  const context = useContext(AppearanceThemeContext);

  if (!context) {
    throw new Error("useAppearanceTheme must be used within ThemeProvider");
  }

  return context;
};

export const useMermaidTheme = () => {
  const context = useContext(MermaidThemeContext);

  if (!context) {
    throw new Error("useMermaidTheme must be used within ThemeProvider");
  }

  return context;
};

export const useEditorTheme = () => {
  const context = useContext(EditorThemeContext);

  if (!context) {
    throw new Error("useEditorTheme must be used within ThemeProvider");
  }

  return context;
};
