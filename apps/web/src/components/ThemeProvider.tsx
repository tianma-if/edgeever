import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DIAGRAM_CANVAS_LIGHT } from "@edgeever/shared/diagram-canvas";
import {
  DEFAULT_CUSTOM_DARK_COLORS,
  DEFAULT_CUSTOM_EDITOR_THEME,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  normalizeThemeColors,
  type CustomEditorTheme,
} from "@/lib/custom-editor-theme";

export {
  DEFAULT_CUSTOM_DARK_COLORS,
  DEFAULT_CUSTOM_EDITOR_THEME,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  localizeStoredCustomThemeName,
} from "@/lib/custom-editor-theme";
export type { CustomEditorTheme, ThemeColors } from "@/lib/custom-editor-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export const MERMAID_THEME_NAMES = ["zinc-light", "zinc-dark"] as const;
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
  "zinc-light": {
    bg: DIAGRAM_CANVAS_LIGHT,
    fg: "#27272A",
    line: "#52525b",
    accent: "#52525b",
    muted: "#3f3f46",
    surface: "#ffffff",
    border: "#d4d4d8",
  },
  "zinc-dark": {
    bg: "#222325",
    fg: "#e4e5e7",
    line: "#85898f",
    accent: "#c4c7cb",
    muted: "#b9bdc1",
    surface: "#2d2f32",
    border: "#46494e",
  },
};

export const MARKDOWN_THEME_NAMES = [
  "github-light",
  "github-dark",
  "one-dark",
  "tokyo-night",
  "tokyo-night-storm",
  "dracula",
  "nord",
  "monokai",
  "solarized-light",
  "solarized-dark",
  "vscode-dark",
  "xcode-light",
  "sublime",
  "duotone-light",
  "duotone-dark",
  "gruvbox-dark",
] as const;
export type MarkdownThemeName = (typeof MARKDOWN_THEME_NAMES)[number];
export const MARKDOWN_THEME_PREFERENCES = ["auto", ...MARKDOWN_THEME_NAMES] as const;
export type MarkdownThemePreference = (typeof MARKDOWN_THEME_PREFERENCES)[number];
export const MARKDOWN_LIGHT_THEME_NAMES = [
  "github-light",
  "solarized-light",
  "xcode-light",
  "duotone-light",
] as const satisfies readonly MarkdownThemeName[];
export const isMarkdownLightTheme = (theme: MarkdownThemeName): boolean =>
  (MARKDOWN_LIGHT_THEME_NAMES as readonly MarkdownThemeName[]).includes(theme);

export const EDITOR_THEME_NAMES = [
  "default",
  "minimal-emerald",
  "outline-emerald",
  "letter",
  "guide",
  "blueprint",
  "journal",
  "stance",
  "stub",
  "brief",
  "outline",
  "zen",
  "grove",
  "wechat-green",
  "modern-mint",
  "custom",
] as const;
export type EditorThemeName = string;

export const isNamedEditorTheme = (theme: string) =>
  (EDITOR_THEME_NAMES as readonly string[]).includes(theme) && theme !== "custom";

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

interface MarkdownThemeContextValue {
  markdownTheme: MarkdownThemeName;
  markdownThemePreference: MarkdownThemePreference;
  setMarkdownTheme: (theme: MarkdownThemePreference) => void;
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
const MARKDOWN_THEME_STORAGE_KEY = "edgeever.markdown-theme";
const EDITOR_THEME_STORAGE_KEY = "edgeever.editor-theme";
const CUSTOM_EDITOR_THEME_STORAGE_KEY = "edgeever.custom-editor-theme";
const CUSTOM_EDITOR_THEMES_STORAGE_KEY = "edgeever.custom-editor-themes";
const LIGHT_THEME_COLOR = "#eef1f4";
const DARK_THEME_COLOR = "#121315";
const AppearanceThemeContext = createContext<AppearanceThemeContextValue | null>(null);
const MermaidThemeContext = createContext<MermaidThemeContextValue | null>(null);
const MarkdownThemeContext = createContext<MarkdownThemeContextValue | null>(null);
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

const LEGACY_MERMAID_THEMES: Record<string, MermaidThemeName> = {
  "tokyo-night": "zinc-dark",
  "tokyo-night-storm": "zinc-dark",
  "tokyo-night-light": "zinc-light",
  "catppuccin-mocha": "zinc-dark",
  "catppuccin-latte": "zinc-light",
  nord: "zinc-dark",
  "nord-light": "zinc-light",
  dracula: "zinc-dark",
  "github-light": "zinc-light",
  "github-dark": "zinc-dark",
  "solarized-light": "zinc-light",
  "solarized-dark": "zinc-dark",
  "one-dark": "zinc-dark",
};

export const normalizeMermaidThemePreference = (value: string | null): MermaidThemePreference => {
  if (value === "zinc-light" || value === "zinc-dark") return value;
  return value && Object.hasOwn(LEGACY_MERMAID_THEMES, value)
    ? LEGACY_MERMAID_THEMES[value]
    : "auto";
};

export const getStoredMermaidTheme = (): MermaidThemePreference =>
  normalizeMermaidThemePreference(readLocalStorageItem(MERMAID_THEME_STORAGE_KEY));

export const resolveMermaidTheme = (
  preference: MermaidThemePreference,
  appearance: ResolvedTheme,
): MermaidThemeName => preference === "auto"
  ? appearance === "dark" ? "zinc-dark" : "zinc-light"
  : preference;

export const getStoredMarkdownTheme = (): MarkdownThemePreference => {
  const stored = readLocalStorageItem(MARKDOWN_THEME_STORAGE_KEY);
  return MARKDOWN_THEME_PREFERENCES.includes(stored as MarkdownThemePreference)
    ? (stored as MarkdownThemePreference)
    : "auto";
};

export const resolveMarkdownTheme = (
  preference: MarkdownThemePreference,
  appearance: ResolvedTheme,
): MarkdownThemeName =>
  preference === "auto"
    ? appearance === "dark" ? "tokyo-night" : "github-light"
    : preference;

export const getStoredEditorTheme = (): string => {
  const stored = readLocalStorageItem(EDITOR_THEME_STORAGE_KEY) || "default";
  if (stored !== "marxico") return stored;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(EDITOR_THEME_STORAGE_KEY, "default");
    } catch {
      // Private mode / blocked storage — preference stays session-only.
    }
  }
  return "default";
};

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
          name: oldTheme.name || DEFAULT_CUSTOM_EDITOR_THEME.name,
          light: normalizeThemeColors({
            background: oldTheme.background || DEFAULT_CUSTOM_LIGHT_COLORS.background,
            text: oldTheme.text || DEFAULT_CUSTOM_LIGHT_COLORS.text,
            muted: oldTheme.muted || DEFAULT_CUSTOM_LIGHT_COLORS.muted,
            heading: oldTheme.heading || DEFAULT_CUSTOM_LIGHT_COLORS.heading,
            accent: oldTheme.accent || DEFAULT_CUSTOM_LIGHT_COLORS.accent,
            soft: oldTheme.soft || DEFAULT_CUSTOM_LIGHT_COLORS.soft,
            border: oldTheme.border || DEFAULT_CUSTOM_LIGHT_COLORS.border,
          }, DEFAULT_CUSTOM_LIGHT_COLORS),
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
  const [markdownThemePreference, setMarkdownThemePreference] = useState<MarkdownThemePreference>(getStoredMarkdownTheme);
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

  const markdownTheme = resolveMarkdownTheme(markdownThemePreference, resolvedTheme);

  const setMarkdownTheme = useCallback((nextTheme: MarkdownThemePreference) => {
    setMarkdownThemePreference(nextTheme);
    window.localStorage.setItem(MARKDOWN_THEME_STORAGE_KEY, nextTheme);
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

  const markdownValue = useMemo(
    () => ({
      markdownTheme,
      markdownThemePreference,
      setMarkdownTheme,
    }),
    [markdownTheme, markdownThemePreference, setMarkdownTheme]
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
        <MarkdownThemeContext.Provider value={markdownValue}>
          <EditorThemeContext.Provider value={editorValue}>
            {children}
          </EditorThemeContext.Provider>
        </MarkdownThemeContext.Provider>
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

export const useMarkdownTheme = () => {
  const context = useContext(MarkdownThemeContext);

  if (!context) {
    throw new Error("useMarkdownTheme must be used within ThemeProvider");
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
