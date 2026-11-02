import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { SETTINGS_ITEM_TITLE_CLASSNAME } from "./settings-ui";
import {
  AI_SPACE_SHORTCUT_CHANGED_EVENT,
  readAiSpaceShortcutPreference,
  writeAiSpaceShortcutPreference,
} from "@/lib/ai-space-shortcut-preference";

export const AiSpaceShortcutSettingsItem = () => {
  const { t } = useTranslation();
  const [aiSpaceShortcutEnabled, setAiSpaceShortcutEnabled] = useState(readAiSpaceShortcutPreference);

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

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-card">
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
    </div>
  );
};
