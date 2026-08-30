import { AlignHorizontalJustifyCenter, ChartNoAxesCombined, FileCode2, Image, Keyboard, Languages, MousePointerClick, Palette, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { EditorContentAlignment, ShortcutSettings } from "@/lib/app-helpers";
import {
  EDITOR_LINK_OPEN_MODE_CHANGED_EVENT,
  getStoredEditorLinkOpenMode,
  writeEditorLinkOpenMode,
  type EditorLinkOpenMode,
} from "@/lib/editor-link-click";
import {
  AI_SELECTION_MENU_CHANGED_EVENT,
  readAiSelectionMenuPreference,
  writeAiSelectionMenuPreference,
} from "@/lib/ai-selection-menu-preference";
import {
  AI_SPACE_SHORTCUT_CHANGED_EVENT,
  readAiSpaceShortcutPreference,
  writeAiSpaceShortcutPreference,
} from "@/lib/ai-space-shortcut-preference";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  changeAppLocalePreference,
  getAppLocalePreference,
  localeLabels,
  supportedLocales,
  type AppLocalePreference,
} from "@/i18n";
import { ShortcutSettingsItem } from "./ShortcutSettingsItem";
import { CustomEditorThemeDialog } from "./CustomEditorThemeDialog";
import {
  MARKDOWN_THEME_PREFERENCES,
  MERMAID_THEME_PREFERENCES,
  useEditorTheme,
  useMarkdownTheme,
  useMermaidTheme,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  DEFAULT_CUSTOM_DARK_COLORS,
  type CustomEditorTheme,
} from "../ThemeProvider";

interface PreferenceCardProps {
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
  editorContentAlignment: EditorContentAlignment;
  onEditorContentAlignmentChange: (alignment: EditorContentAlignment) => void;
}

export const PreferenceCard = ({
  imageCompressionEnabled,
  onImageCompressionChange,
  shortcutSettings,
  onShortcutSettingsChange,
  editorContentAlignment,
  onEditorContentAlignmentChange,
}: PreferenceCardProps) => {
  const { t } = useTranslation();
  const {
    editorTheme,
    customEditorThemes,
    setCustomEditorThemes,
    setEditorTheme,
  } = useEditorTheme();
  const { mermaidThemePreference, setMermaidTheme } = useMermaidTheme();
  const { markdownThemePreference, setMarkdownTheme } = useMarkdownTheme();
  const [customThemeDialogOpen, setCustomThemeDialogOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<CustomEditorTheme | null>(null);
  const [activeLocalePreference, setActiveLocalePreference] = useState<AppLocalePreference>(() => getAppLocalePreference());
  const [isMobile, setIsMobile] = useState(false);
  const [linkOpenMode, setLinkOpenMode] = useState<EditorLinkOpenMode>(() => getStoredEditorLinkOpenMode());
  const [aiSelectionMenuEnabled, setAiSelectionMenuEnabled] = useState(readAiSelectionMenuPreference);
  const [aiSpaceShortcutEnabled, setAiSpaceShortcutEnabled] = useState(readAiSpaceShortcutPreference);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    setIsMobile(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const syncPreference = () => setAiSpaceShortcutEnabled(readAiSpaceShortcutPreference());
    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") {
        setAiSpaceShortcutEnabled(detail);
        return;
      }
      syncPreference();
    };
    window.addEventListener(AI_SPACE_SHORTCUT_CHANGED_EVENT, onPreferenceChanged);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(AI_SPACE_SHORTCUT_CHANGED_EVENT, onPreferenceChanged);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  useEffect(() => {
    const syncPreference = () => setAiSelectionMenuEnabled(readAiSelectionMenuPreference());
    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") {
        setAiSelectionMenuEnabled(detail);
        return;
      }
      syncPreference();
    };
    window.addEventListener(AI_SELECTION_MENU_CHANGED_EVENT, onPreferenceChanged);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(AI_SELECTION_MENU_CHANGED_EVENT, onPreferenceChanged);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  useEffect(() => {
    const syncMode = () => setLinkOpenMode(getStoredEditorLinkOpenMode());
    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<EditorLinkOpenMode>).detail;
      if (detail === "click" || detail === "modifier") {
        setLinkOpenMode(detail);
        return;
      }
      syncMode();
    };
    window.addEventListener(EDITOR_LINK_OPEN_MODE_CHANGED_EVENT, onPreferenceChanged);
    window.addEventListener("storage", syncMode);
    return () => {
      window.removeEventListener(EDITOR_LINK_OPEN_MODE_CHANGED_EVENT, onPreferenceChanged);
      window.removeEventListener("storage", syncMode);
    };
  }, []);

  const activeCustom = customEditorThemes.find((t) => t.id === editorTheme);
  const isPreset = editorTheme === "default" || editorTheme === "minimal-emerald" || editorTheme === "outline-emerald" || editorTheme === "wechat-green" || editorTheme === "modern-mint" || editorTheme === "marxico";

  const handleEditClick = () => {
    if (activeCustom) {
      setEditingTheme(activeCustom);
    } else {
      const newTheme: CustomEditorTheme = {
        id: `custom-${Date.now()}`,
        name: `New theme ${customEditorThemes.length + 1}`,
        light: DEFAULT_CUSTOM_LIGHT_COLORS,
        dark: DEFAULT_CUSTOM_DARK_COLORS,
      };
      setEditingTheme(newTheme);
    }
    setCustomThemeDialogOpen(true);
  };

  const handleSaveTheme = (saved: CustomEditorTheme) => {
    const exists = customEditorThemes.some((t) => t.id === saved.id);
    let nextThemes: CustomEditorTheme[];
    if (exists) {
      nextThemes = customEditorThemes.map((t) => (t.id === saved.id ? saved : t));
    } else {
      nextThemes = [...customEditorThemes, saved];
    }
    setCustomEditorThemes(nextThemes);
    setEditorTheme(saved.id);
  };

  const handleDeleteTheme = (idToDelete: string) => {
    const nextThemes = customEditorThemes.filter((t) => t.id !== idToDelete);
    setCustomEditorThemes(nextThemes);
    if (editorTheme === idToDelete) {
      setEditorTheme("default");
    }
  };

  const handleLocalePreferenceChange = (preference: AppLocalePreference) => {
    setActiveLocalePreference(preference);
    void changeAppLocalePreference(preference);
  };

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Image className="h-4 w-4 text-emerald-700" />
          {t("settings.preferences")}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-slate-100 p-0">
        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Languages className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.languageTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.languageDescription")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select
              value={activeLocalePreference}
              onValueChange={(preference) => handleLocalePreferenceChange(preference as AppLocalePreference)}
            >
              <SelectTrigger aria-label={t("common.language")} className="h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.systemLanguage")}</SelectItem>
                {supportedLocales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {localeLabels[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="hidden min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:flex">
          <div className="flex min-w-0 items-start gap-3">
            <AlignHorizontalJustifyCenter className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.editorContentAlignmentTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.editorContentAlignmentDescription")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-44">
            <Select
              value={editorContentAlignment}
              onValueChange={(value) => onEditorContentAlignmentChange(value as EditorContentAlignment)}
            >
              <SelectTrigger aria-label={t("settings.editorContentAlignmentTitle")} className="h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start">{t("settings.editorContentAlignments.start")}</SelectItem>
                <SelectItem value="center">{t("settings.editorContentAlignments.center")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Palette className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.editorThemeTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.editorThemeDescription")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-80 sm:flex-row">
            <Select
              value={isMobile && !isPreset ? "default" : editorTheme}
              onValueChange={(value) => {
                if (value === "create-new") {
                  const newTheme: CustomEditorTheme = {
                    id: `custom-${Date.now()}`,
                    name: `New theme ${customEditorThemes.length + 1}`,
                    light: DEFAULT_CUSTOM_LIGHT_COLORS,
                    dark: DEFAULT_CUSTOM_DARK_COLORS,
                  };
                  setEditingTheme(newTheme);
                  setCustomThemeDialogOpen(true);
                } else {
                  setEditorTheme(value);
                }
              }}
            >
              <SelectTrigger aria-label={t("settings.editorThemeTitle")} className="h-9 w-full min-w-0 flex-1 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("settings.editorThemes.default")}</SelectItem>
                <SelectItem value="minimal-emerald">{t("settings.editorThemes.minimal-emerald")}</SelectItem>
                <SelectItem value="outline-emerald">{t("settings.editorThemes.outline-emerald")}</SelectItem>
                <SelectItem value="wechat-green">{t("settings.editorThemes.wechat-green")}</SelectItem>
                <SelectItem value="modern-mint">{t("settings.editorThemes.modern-mint")}</SelectItem>
                <SelectItem value="marxico">{t("settings.editorThemes.marxico")}</SelectItem>
                {!isMobile && (
                  <>
                    {customEditorThemes.length > 0 && <div className="my-1 border-t border-slate-100" />}
                    {customEditorThemes.map((theme) => (
                      <SelectItem key={theme.id} value={theme.id}>
                        {theme.name}
                      </SelectItem>
                    ))}
                    <div className="my-1 border-t border-slate-100" />
                    <SelectItem value="create-new" className="text-emerald-700 font-medium">
                      + {t("settings.customEditorTheme.create", "Create New Theme...")}
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            {!isMobile && (
              <Button variant="outline" className="h-9 shrink-0 px-3 text-sm" onClick={handleEditClick}>
                {activeCustom ? t("settings.customEditorTheme.edit") : t("settings.customEditorTheme.customize", "Customize")}
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.markdownThemeTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.markdownThemeDescription")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select value={markdownThemePreference} onValueChange={(value) => setMarkdownTheme(value as typeof markdownThemePreference)}>
              <SelectTrigger aria-label={t("settings.markdownThemeTitle")} className="h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARKDOWN_THEME_PREFERENCES.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {t(`settings.markdownThemes.${theme}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ChartNoAxesCombined className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.mermaidThemeTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.mermaidThemeDescription")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select value={mermaidThemePreference} onValueChange={(value) => setMermaidTheme(value as typeof mermaidThemePreference)}>
              <SelectTrigger aria-label={t("settings.mermaidThemeTitle")} className="h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MERMAID_THEME_PREFERENCES.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {t(`settings.mermaidThemes.${theme}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Image className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.imageCompressionTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.imageCompressionDescription")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
            <Switch
              checked={imageCompressionEnabled}
              onCheckedChange={onImageCompressionChange}
              aria-label={t("settings.imageCompressionAria")}
            />
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.aiSelectionMenuTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.aiSelectionMenuDescription")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
            <Switch
              checked={aiSelectionMenuEnabled}
              onCheckedChange={(enabled) => {
                writeAiSelectionMenuPreference(enabled);
                setAiSelectionMenuEnabled(enabled);
              }}
              aria-label={t("settings.aiSelectionMenuAria")}
            />
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Keyboard className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.aiSpaceShortcutTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.aiSpaceShortcutDescription")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
            <Switch
              checked={aiSpaceShortcutEnabled}
              onCheckedChange={(enabled) => {
                writeAiSpaceShortcutPreference(enabled);
                setAiSpaceShortcutEnabled(enabled);
              }}
              aria-label={t("settings.aiSpaceShortcutAria")}
            />
          </div>
        </div>

        {/* Desktop only: mobile editors always open links on a plain tap. */}
        <div className="hidden min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:flex">
          <div className="flex min-w-0 items-start gap-3">
            <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.linkOpenModifierTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.linkOpenModifierDescription")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
            <Switch
              checked={linkOpenMode === "modifier"}
              onCheckedChange={(enabled) => {
                const next: EditorLinkOpenMode = enabled ? "modifier" : "click";
                writeEditorLinkOpenMode(next);
                setLinkOpenMode(next);
              }}
              aria-label={t("settings.linkOpenModifierAria")}
            />
          </div>
        </div>

        <div className="hidden lg:block">
          <ShortcutSettingsItem
            shortcutSettings={shortcutSettings}
            onShortcutSettingsChange={onShortcutSettingsChange}
          />
        </div>
      </CardContent>
      {!isMobile && editingTheme && (
        <CustomEditorThemeDialog
          open={customThemeDialogOpen}
          theme={editingTheme}
          onOpenChange={setCustomThemeDialogOpen}
          onSave={handleSaveTheme}
          onDelete={handleDeleteTheme}
          isDefaultTheme={editingTheme.id === "custom-default"}
        />
      )}
    </Card>
  );
};
