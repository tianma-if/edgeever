import { Image } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ShortcutSettings } from "@/lib/app-helpers";
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
import { useTheme, type ThemePreference } from "../ThemeProvider";

interface PreferenceCardProps {
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
}

export const PreferenceCard = ({
  imageCompressionEnabled,
  onImageCompressionChange,
  shortcutSettings,
  onShortcutSettingsChange,
}: PreferenceCardProps) => {
  const { t } = useTranslation();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [activeLocalePreference, setActiveLocalePreference] = useState<AppLocalePreference>(() => getAppLocalePreference());

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
      <CardContent className="grid gap-3 p-4 pt-0">
        <div className="flex min-h-14 flex-col items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{t("settings.languageTitle")}</div>
            <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.languageDescription")}</div>
          </div>
          <div className="w-full shrink-0 sm:w-44">
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

        <div className="flex min-h-14 flex-col items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{t("settings.imageCompressionTitle")}</div>
            <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.imageCompressionDescription")}</div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-32">
            <Switch
              checked={imageCompressionEnabled}
              onCheckedChange={onImageCompressionChange}
              aria-label={t("settings.imageCompressionAria")}
            />
          </div>
        </div>

        <div className="hidden min-h-14 flex-col items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-3 lg:flex lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{t("settings.themeTitle")}</div>
            <div className="mt-0.5 text-xs leading-4 text-slate-500">{t("settings.themeDescription")}</div>
          </div>
          <div className="w-full shrink-0 sm:w-44">
            <Select
              value={themePreference}
              onValueChange={(preference) => setThemePreference(preference as ThemePreference)}
            >
              <SelectTrigger aria-label={t("settings.themeTitle")} className="h-9 bg-white">
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
        <div className="hidden lg:block">
          <ShortcutSettingsItem
            shortcutSettings={shortcutSettings}
            onShortcutSettingsChange={onShortcutSettingsChange}
          />
        </div>
      </CardContent>
    </Card>
  );
};
