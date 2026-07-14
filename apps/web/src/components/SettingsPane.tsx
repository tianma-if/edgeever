import { ChevronLeft, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ShortcutSettings } from "@/lib/app-helpers";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { AdvancedPlayCard } from "./settings/AdvancedPlayCard";
import { EvernoteImportGuideCard } from "./settings/EvernoteImportGuideCard";
import { McpConfigCard } from "./settings/McpConfigCard";
import { PreferenceCard } from "./settings/PreferenceCard";
import { PwaInstallCard } from "./settings/PwaInstallCard";
import { PasswordCard } from "./settings/PasswordCard";
import { SessionCard } from "./settings/SessionCard";
import { SystemInfoCard } from "./settings/SystemInfoCard";
import { ThemeToggle } from "./ThemeToggle";

interface SettingsPaneProps {
  onClose: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
  authRequired: boolean;
  onShowGuide?: () => void;
}

export const SettingsPane = ({
  onClose,
  imageCompressionEnabled,
  onImageCompressionChange,
  shortcutSettings,
  onShortcutSettingsChange,
  onLogout,
  isLoggingOut,
  authRequired,
  onShowGuide,
}: SettingsPaneProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-slate-50">
      <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:px-6 lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            title={t("common.back")}
            aria-label={t("common.back")}
            onClick={onClose}
            className="h-9 w-9 rounded-lg hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
              <User className="h-4 w-4 text-emerald-700" />
              {t("settings.title")}
            </h1>
          </div>
        </div>
        <ThemeToggle className="inline-flex" showLabel />
      </header>

      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 lg:px-6 lg:py-6">
        <div className="mx-auto grid w-full min-w-0 max-w-4xl gap-4">
          <PreferenceCard
            imageCompressionEnabled={imageCompressionEnabled}
            onImageCompressionChange={onImageCompressionChange}
            shortcutSettings={shortcutSettings}
            onShortcutSettingsChange={onShortcutSettingsChange}
          />
          <PasswordCard authRequired={authRequired} />
          <PwaInstallCard />
          <AdvancedPlayCard />
          <EvernoteImportGuideCard onShowGuide={onShowGuide} />
          <McpConfigCard />
          <SystemInfoCard />
          <SessionCard authRequired={authRequired} isLoggingOut={isLoggingOut} onLogout={onLogout} />
        </div>
      </div>
    </div>
  );
};
