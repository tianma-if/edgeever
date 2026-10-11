import { AlignVerticalSpaceAround, AppWindow, BookOpenText, ChartNoAxesCombined, Code2, Image, Keyboard, Languages, ListTree, MousePointerClick, Palette, Sparkles, SpellCheck, SunMoon, Type } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { NoteProsePatch, NoteProsePaletteChoice, ResolvedNoteProse } from "@edgeever/shared";
import { DEFAULT_NOTE_PROSE_CSS, MAX_NOTE_PROSE_CSS_BYTES, NOTE_PROSE_FONT_SIZES, NOTE_PROSE_PALETTE_CHOICES, NOTE_PROSE_PALETTES, noteProseCssDropsDeclarations } from "@edgeever/shared";
import {
  EDITOR_SPELLCHECK_CHANGED_EVENT,
  readEditorSpellcheckPreference,
  writeEditorSpellcheckPreference,
} from "@/lib/editor-spellcheck-preference";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SETTINGS_ITEM_DESCRIPTION_CLASSNAME, SETTINGS_ITEM_ICON_CLASSNAME, SETTINGS_ITEM_TITLE_CLASSNAME } from "./settings-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  changeAppLocalePreference,
  getAppLocalePreference,
  localeLabels,
  supportedLocales,
  type AppLocalePreference,
} from "@/i18n";
import {
  applyEditorBodyFontPreference,
  getFontChoicePreviewStack,
  readEditorBodyFontPreference,
  writeEditorBodyFontPreference,
  type EditorBodyFontChoice,
  type EditorBodyFontPreference,
} from "@/lib/editor-body-font";
import { applyUiFontPreference, readUiFontPreference, writeUiFontPreference } from "@/lib/ui-font";
import { syncPublishedNoteBodyFont } from "@/lib/published-note-body-font";
import { useShowDescendantNotesPreference, writeShowDescendantNotesPreference } from "@/lib/descendant-notes-preference";
import { NoteProseCssEditor } from "./NoteProseCssEditor";
import { NoteProseCssPreview } from "./NoteProseCssPreview";

const PreferenceSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="grid gap-2">
    <h2 className="px-1 text-xs font-normal leading-5 text-slate-500">{title}</h2>
    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-card">
      {children}
    </div>
  </section>
);
import {
  MERMAID_THEME_PREFERENCES,
  useAppearanceTheme,
  useMermaidTheme,
  type ThemePreference,
} from "../ThemeProvider";

const CUSTOM_FONT_SUGGESTIONS = [
  { label: "苹方 (PingFang SC)", family: "PingFang SC" },
  { label: "微软雅黑 (Microsoft YaHei)", family: "Microsoft YaHei" },
  { label: "鸿蒙黑体 (HarmonyOS)", family: "HarmonyOS Sans SC" },
  { label: "冬青黑体 (Hiragino)", family: "Hiragino Sans GB" },
] as const;

const FontChoiceFields = ({
  label,
  preference,
  onChange,
}: {
  label: string;
  preference: EditorBodyFontPreference;
  onChange: (preference: EditorBodyFontPreference) => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-80">
      <Select
        value={preference.choice}
        onValueChange={(value) => onChange({ choice: value as EditorBodyFontChoice, customFamily: preference.customFamily })}
      >
        <SelectTrigger aria-label={label} className="h-9 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">{t("settings.editorBodyFonts.system")}</SelectItem>
          <SelectItem
            value="wenkai"
            style={{ fontFamily: getFontChoicePreviewStack("wenkai") }}
          >
            <span style={{ fontFamily: getFontChoicePreviewStack("wenkai") }}>
              {t("settings.editorBodyFonts.wenkai")}
            </span>
          </SelectItem>
          <SelectItem
            value="wenkai-screen"
            style={{ fontFamily: getFontChoicePreviewStack("wenkai-screen") }}
          >
            <span style={{ fontFamily: getFontChoicePreviewStack("wenkai-screen") }}>
              {t("settings.editorBodyFonts.wenkaiScreen")}
            </span>
          </SelectItem>
          <SelectItem
            value="zhuque"
            style={{ fontFamily: getFontChoicePreviewStack("zhuque") }}
          >
            <span style={{ fontFamily: getFontChoicePreviewStack("zhuque") }}>
              {t("settings.editorBodyFonts.zhuque")}
            </span>
          </SelectItem>
          <SelectItem
            value="source-han-serif"
            style={{ fontFamily: getFontChoicePreviewStack("source-han-serif") }}
          >
            <span style={{ fontFamily: getFontChoicePreviewStack("source-han-serif") }}>
              {t("settings.editorBodyFonts.sourceHanSerif")}
            </span>
          </SelectItem>
          <SelectItem
            value="neo-zhi-song"
            style={{ fontFamily: getFontChoicePreviewStack("neo-zhi-song") }}
          >
            <span style={{ fontFamily: getFontChoicePreviewStack("neo-zhi-song") }}>
              {t("settings.editorBodyFonts.neoZhiSong")}
            </span>
          </SelectItem>
          <SelectItem
            value="source-han-sans"
            style={{ fontFamily: getFontChoicePreviewStack("source-han-sans") }}
          >
            <span style={{ fontFamily: getFontChoicePreviewStack("source-han-sans") }}>
              {t("settings.editorBodyFonts.sourceHanSans")}
            </span>
          </SelectItem>
          <SelectItem
            value="source-serif"
            style={{ fontFamily: getFontChoicePreviewStack("source-serif") }}
          >
            <span style={{ fontFamily: getFontChoicePreviewStack("source-serif") }}>
              {t("settings.editorBodyFonts.sourceSerif")}
            </span>
          </SelectItem>
          <SelectItem value="custom">{t("settings.editorBodyFonts.custom")}</SelectItem>
        </SelectContent>
      </Select>
      {preference.choice === "custom" ? (
        <div className="flex flex-col gap-1.5">
          <Input
            value={preference.customFamily}
            aria-label={t("settings.editorBodyFontCustomLabel")}
            placeholder={t("settings.editorBodyFontCustomPlaceholder")}
            className="h-9"
            maxLength={200}
            onChange={(event) => onChange({ choice: "custom", customFamily: event.target.value })}
          />
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            <span className="shrink-0 text-slate-400">{t("settings.editorBodyFontSuggestions")}:</span>
            {CUSTOM_FONT_SUGGESTIONS.map((item) => (
              <button
                key={item.family}
                type="button"
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => onChange({ choice: "custom", customFamily: item.family })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const NoteProsePaletteSwatch = ({ paletteId }: { paletteId: NoteProsePaletteChoice }) => (
  <span
    aria-hidden
    className={`h-3 w-6 shrink-0 rounded-[2px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)] ${paletteId === "native" ? "bg-foreground" : ""}`}
    style={paletteId === "native" ? undefined : { backgroundColor: NOTE_PROSE_PALETTES[paletteId].accent }}
  />
);

const NOTE_PROSE_LINE_HEIGHT_OPTIONS = [
  { value: "1.5", labelKey: "settings.editorBodyLineHeights.compact" },
  { value: "1.65", labelKey: "settings.editorBodyLineHeights.standard" },
  { value: "2", labelKey: "settings.editorBodyLineHeights.relaxed" },
] as const;

interface PreferenceCardProps {
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  noteProse: ResolvedNoteProse;
  onNoteProseChange: (patch: NoteProsePatch) => void;
}

export const PreferenceCard = ({
  imageCompressionEnabled,
  onImageCompressionChange,
  noteProse,
  onNoteProseChange,
}: PreferenceCardProps) => {
  const { t } = useTranslation();
  const showDescendantNotes = useShowDescendantNotesPreference();
  const { preference: appearancePreference, resolvedTheme, setPreference: setAppearancePreference } = useAppearanceTheme();
  const { mermaidThemePreference, setMermaidTheme } = useMermaidTheme();
  const [cssDialogOpen, setCssDialogOpen] = useState(false);
  const [cssDraft, setCssDraft] = useState(noteProse.customCss);
  const [cssPreviewTheme, setCssPreviewTheme] = useState<"light" | "dark">("light");
  const [activeLocalePreference, setActiveLocalePreference] = useState<AppLocalePreference>(() => getAppLocalePreference());
  const [linkOpenMode, setLinkOpenMode] = useState<EditorLinkOpenMode>(() => getStoredEditorLinkOpenMode());
  const [aiSelectionMenuEnabled, setAiSelectionMenuEnabled] = useState(readAiSelectionMenuPreference);
  const [aiSpaceShortcutEnabled, setAiSpaceShortcutEnabled] = useState(readAiSpaceShortcutPreference);
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(readEditorSpellcheckPreference);
  const [editorBodyFont, setEditorBodyFont] = useState(readEditorBodyFontPreference);
  const [uiFont, setUiFont] = useState(readUiFontPreference);

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
    const syncPreference = () => setSpellcheckEnabled(readEditorSpellcheckPreference());
    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") {
        setSpellcheckEnabled(detail);
        return;
      }
      syncPreference();
    };
    window.addEventListener(EDITOR_SPELLCHECK_CHANGED_EVENT, onPreferenceChanged);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(EDITOR_SPELLCHECK_CHANGED_EVENT, onPreferenceChanged);
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

  const cssDraftBytes = new TextEncoder().encode(cssDraft).byteLength;

  const openCssDialog = () => {
    setCssDraft(noteProse.customCss.trim() ? noteProse.customCss : DEFAULT_NOTE_PROSE_CSS);
    setCssPreviewTheme("light");
    setCssDialogOpen(true);
  };

  const resetCssDraft = () => {
    setCssDraft(DEFAULT_NOTE_PROSE_CSS);
  };

  const saveCssDraft = () => {
    onNoteProseChange({ customCss: cssDraft });
    setCssDialogOpen(false);
  };

  const handleLocalePreferenceChange = (preference: AppLocalePreference) => {
    setActiveLocalePreference(preference);
    void changeAppLocalePreference(preference);
  };

  const updateEditorBodyFont = (preference: EditorBodyFontPreference) => {
    setEditorBodyFont(preference);
    writeEditorBodyFontPreference(preference);
    applyEditorBodyFontPreference(preference);
    void syncPublishedNoteBodyFont();
  };

  const updateUiFont = (preference: EditorBodyFontPreference) => {
    setUiFont(preference);
    writeUiFontPreference(preference);
    applyUiFontPreference(preference);
  };

  return (
    <div className="grid gap-6">
      <PreferenceSection title={t("settings.groups.interface")}>
        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Languages className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.languageTitle")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select
              value={activeLocalePreference}
              onValueChange={(preference) => handleLocalePreferenceChange(preference as AppLocalePreference)}
            >
              <SelectTrigger aria-label={t("common.language")} className="h-9 bg-card">
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

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <SunMoon className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.themeTitle")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select
              value={appearancePreference}
              onValueChange={(value) => setAppearancePreference(value as ThemePreference)}
            >
              <SelectTrigger aria-label={t("settings.themeTitle")} className="h-9 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.themeSystem")}</SelectItem>
                <SelectItem value="light">{t("settings.themeLight")}</SelectItem>
                <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <AppWindow className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.uiFontTitle")}</div>
            </div>
          </div>
          <FontChoiceFields
            label={t("settings.uiFontTitle")}
            preference={uiFont}
            onChange={updateUiFont}
          />
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ListTree className={SETTINGS_ITEM_ICON_CLASSNAME} />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.showDescendantNotesTitle")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
            <Switch
              checked={showDescendantNotes}
              onCheckedChange={writeShowDescendantNotesPreference}
              aria-label={t("settings.showDescendantNotesAria")}
            />
          </div>
        </div>
      </PreferenceSection>

      <PreferenceSection title={t("settings.groups.reading")}>
        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <BookOpenText className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.editorBodyFontTitle")}</div>
            </div>
          </div>
          <FontChoiceFields
            label={t("settings.editorBodyFontTitle")}
            preference={editorBodyFont}
            onChange={updateEditorBodyFont}
          />
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Type className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.editorBodyFontSizeTitle")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select
              value={String(noteProse.fontSize)}
              onValueChange={(value) => onNoteProseChange({ fontSize: Number(value) as ResolvedNoteProse["fontSize"] })}
            >
              <SelectTrigger aria-label={t("settings.editorBodyFontSizeTitle")} className="h-9 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTE_PROSE_FONT_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <AlignVerticalSpaceAround className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.editorBodyLineHeightTitle")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select
              value={String(noteProse.lineHeight)}
              onValueChange={(value) => onNoteProseChange({ lineHeight: Number(value) as ResolvedNoteProse["lineHeight"] })}
            >
              <SelectTrigger aria-label={t("settings.editorBodyLineHeightTitle")} className="h-9 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTE_PROSE_LINE_HEIGHT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Palette className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.editorBodyPaletteTitle")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-80">
            <Select
              value={noteProse.palette}
              onValueChange={(value) => onNoteProseChange({ palette: value as NoteProsePaletteChoice })}
            >
              <SelectTrigger aria-label={t("settings.editorBodyPaletteTitle")} className="h-9 bg-card">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <NoteProsePaletteSwatch paletteId={noteProse.palette} />
                    <span>{t(`settings.editorBodyPalettes.${noteProse.palette}`)}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {NOTE_PROSE_PALETTE_CHOICES.map((paletteId) => (
                  <SelectItem
                    key={paletteId}
                    value={paletteId}
                    className="pr-2.5 [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
                  >
                    <span className="flex w-full items-center justify-between gap-3">
                      <span>{t(`settings.editorBodyPalettes.${paletteId}`)}</span>
                      <NoteProsePaletteSwatch paletteId={paletteId} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="hidden min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:flex">
          <div className="flex min-w-0 items-center gap-3">
            <Code2 className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.editorBodyCssTitle")}</div>
              <p className="text-xs leading-5 text-slate-500">{t("settings.accountSyncDescription")}</p>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-auto">
            <Button variant="outline" className="h-9 px-3 text-xs" onClick={openCssDialog}>
              {t("settings.editorBodyCssEdit")}
            </Button>
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ChartNoAxesCombined className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.mermaidThemeTitle")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select value={mermaidThemePreference} onValueChange={(value) => setMermaidTheme(value as typeof mermaidThemePreference)}>
              <SelectTrigger aria-label={t("settings.mermaidThemeTitle")} className="h-9 bg-card">
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
      </PreferenceSection>

      <PreferenceSection title={t("settings.groups.editing")}>
        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Image className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.imageCompressionTitle")}</div>
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
          <div className="flex min-w-0 items-center gap-3">
            <SpellCheck className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.spellcheckTitle")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
            <Switch
              checked={spellcheckEnabled}
              onCheckedChange={(enabled) => {
                writeEditorSpellcheckPreference(enabled);
                setSpellcheckEnabled(enabled);
              }}
              aria-label={t("settings.spellcheckAria")}
            />
          </div>
        </div>

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Sparkles className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.aiSelectionMenuTitle")}</div>
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
          <div className="flex min-w-0 items-center gap-3">
            <Keyboard className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.aiSpaceShortcutTitle")}</div>
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
          <div className="flex min-w-0 items-center gap-3">
            <MousePointerClick className="h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.linkOpenModifierTitle")}</div>
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
      </PreferenceSection>
      <Dialog open={cssDialogOpen} onOpenChange={setCssDialogOpen}>
        <DialogContent className="flex h-[min(44rem,calc(100dvh-2rem))] max-w-2xl flex-col gap-4 overflow-hidden">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{t("settings.editorBodyCssTitle")}</DialogTitle>
            <DialogDescription className="leading-5">{t("settings.editorBodyCssDescription")}</DialogDescription>
          </DialogHeader>
          <div className="shrink-0 overflow-hidden rounded-md border border-slate-200">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-1.5">
              <span className="text-xs text-slate-500">{t("settings.editorBodyCssPreviewLabel")}</span>
              <ToggleGroup
                type="single"
                value={cssPreviewTheme}
                onValueChange={(value) => {
                  if (value === "light" || value === "dark") setCssPreviewTheme(value);
                }}
                aria-label={t("settings.editorBodyCssPreviewLabel")}
                className="rounded-md bg-muted p-0.5"
              >
                <ToggleGroupItem value="light" size="sm" className="h-7 rounded px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm">
                  {t("settings.editorBodyCssPreviewLight")}
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" size="sm" className="h-7 rounded px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm">
                  {t("settings.editorBodyCssPreviewDark")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <NoteProseCssPreview
              css={cssDraft}
              dark={cssPreviewTheme === "dark"}
              fontSize={noteProse.fontSize}
              lineHeight={noteProse.lineHeight}
            />
          </div>
          {noteProseCssDropsDeclarations(cssDraft) ? (
            <p className="shrink-0 text-xs text-amber-700 dark:text-amber-400">{t("settings.editorBodyCssDropped")}</p>
          ) : null}
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <NoteProseCssEditor
                value={cssDraft}
                dark={resolvedTheme === "dark"}
                ariaLabel={t("settings.editorBodyCssTitle")}
                placeholder={t("settings.editorBodyCssPlaceholder")}
                onChange={setCssDraft}
              />
            </div>
          </div>
          <p className={cssDraftBytes > MAX_NOTE_PROSE_CSS_BYTES ? "shrink-0 text-xs text-rose-600" : "shrink-0 text-xs text-slate-500"}>
            {cssDraftBytes} / {MAX_NOTE_PROSE_CSS_BYTES}
          </p>
          <DialogFooter className="shrink-0 sm:justify-between">
            <Button type="button" variant="outline" onClick={resetCssDraft}>
              {t("settings.editorBodyCssReset")}
            </Button>
            <Button type="button" onClick={saveCssDraft} disabled={cssDraftBytes > MAX_NOTE_PROSE_CSS_BYTES}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
