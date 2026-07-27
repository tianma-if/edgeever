import { ChartNoAxesCombined, Image, Languages, Palette, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { writeAutoSaveIntervalPreference, type AutoSaveIntervalPreference, type ShortcutSettings } from "@/lib/app-helpers";
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
import { EDITOR_THEME_NAMES, MERMAID_THEME_NAMES, useTheme } from "../ThemeProvider";

interface PreferenceCardProps {
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  autoSaveIntervalMs: number | null;
  onAutoSaveIntervalChange: (intervalMs: number | null) => void;
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
}

export const PreferenceCard = ({
  imageCompressionEnabled,
  onImageCompressionChange,
  autoSaveIntervalMs,
  onAutoSaveIntervalChange,
  shortcutSettings,
  onShortcutSettingsChange,
}: PreferenceCardProps) => {
  const { t } = useTranslation();
  const { editorTheme, mermaidTheme, customEditorTheme, setCustomEditorTheme, setEditorTheme, setMermaidTheme } = useTheme();
  const [customThemeDialogOpen, setCustomThemeDialogOpen] = useState(false);
  const [activeLocalePreference, setActiveLocalePreference] = useState<AppLocalePreference>(() => getAppLocalePreference());

  const handleLocalePreferenceChange = (preference: AppLocalePreference) => {
    setActiveLocalePreference(preference);
    void changeAppLocalePreference(preference);
  };

  const autoSaveIntervalPreference: AutoSaveIntervalPreference =
    autoSaveIntervalMs === 300_000 ? "5m" : autoSaveIntervalMs === 900_000 ? "15m" : autoSaveIntervalMs === 1_800_000 ? "30m" : autoSaveIntervalMs === 3_600_000 ? "1h" : autoSaveIntervalMs === 7_200_000 ? "2h" : "1m";

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

        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Palette className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.editorThemeTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.editorThemeDescription")}</div>
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-80 sm:flex-row">
            <Select value={editorTheme} onValueChange={(value) => setEditorTheme(value as typeof editorTheme)}>
              <SelectTrigger aria-label={t("settings.editorThemeTitle")} className="h-9 w-full min-w-0 flex-1 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITOR_THEME_NAMES.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {theme === "custom" ? customEditorTheme.name : t(`settings.editorThemes.${theme}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="h-9 shrink-0 px-3 text-sm" onClick={() => setCustomThemeDialogOpen(true)}>
              {t("settings.customEditorTheme.edit")}
            </Button>
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
            <Select value={mermaidTheme} onValueChange={(value) => setMermaidTheme(value as typeof mermaidTheme)}>
              <SelectTrigger aria-label={t("settings.mermaidThemeTitle")} className="h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MERMAID_THEME_NAMES.map((theme) => (
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
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{t("settings.autoSaveIntervalTitle")}</div>
              <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.autoSaveIntervalDescription")}</div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-44">
            <Select
              value={autoSaveIntervalPreference}
              onValueChange={(value) => {
                const preference = value as AutoSaveIntervalPreference;
                writeAutoSaveIntervalPreference(preference);
                onAutoSaveIntervalChange(
                  preference === "5m" ? 300_000 : preference === "15m" ? 900_000 : preference === "30m" ? 1_800_000 : preference === "1h" ? 3_600_000 : preference === "2h" ? 7_200_000 : 60_000
                );
              }}
            >
              <SelectTrigger aria-label={t("settings.autoSaveIntervalTitle")} className="h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1m">{t("settings.autoSaveIntervals.1m")}</SelectItem>
                <SelectItem value="5m">{t("settings.autoSaveIntervals.5m")}</SelectItem>
                <SelectItem value="15m">{t("settings.autoSaveIntervals.15m")}</SelectItem>
                <SelectItem value="30m">{t("settings.autoSaveIntervals.30m")}</SelectItem>
                <SelectItem value="1h">{t("settings.autoSaveIntervals.1h")}</SelectItem>
                <SelectItem value="2h">{t("settings.autoSaveIntervals.2h")}</SelectItem>
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

        <div className="hidden lg:block">
          <ShortcutSettingsItem
            shortcutSettings={shortcutSettings}
            onShortcutSettingsChange={onShortcutSettingsChange}
          />
        </div>
      </CardContent>
      <CustomEditorThemeDialog
        open={customThemeDialogOpen}
        theme={customEditorTheme}
        onOpenChange={setCustomThemeDialogOpen}
        onSave={(theme) => { setCustomEditorTheme(theme); setEditorTheme("custom"); }}
      />
    </Card>
  );
};
