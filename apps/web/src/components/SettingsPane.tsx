import {
  ChevronLeft,
  ChevronRight,
  Database,
  Info,
  LayoutTemplate,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import { SystemInfoDialog } from "@/components/SystemInfoDialog";
import { Button } from "@/components/ui/button";
import type { EditorContentAlignment, ShortcutSettings } from "@/lib/app-helpers";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { cn } from "@/lib/utils";
import { AdvancedPlayCard } from "./settings/AdvancedPlayCard";
import { AccountInfoCard } from "./settings/AccountInfoCard";
import { DataExportCard } from "./settings/DataExportCard";
import { DesktopLocalDataCard } from "./settings/DesktopLocalDataCard";
import { LoginDevicesCard } from "./settings/LoginDevicesCard";
import { EvernoteImportGuideCard } from "./settings/EvernoteImportGuideCard";
import { FeedbackLink } from "./settings/FeedbackLink";
import { McpConfigCard } from "./settings/McpConfigCard";
import { PreferenceCard } from "./settings/PreferenceCard";
import { PasswordCard } from "./settings/PasswordCard";
import { UserManagementCard } from "./settings/UserManagementCard";
import { ObjectStorageCard } from "./settings/ObjectStorageCard";
import { AiModelCard } from "./settings/AiModelCard";
import { AiPromptsCard } from "./settings/AiPromptsCard";
import { AiTagSuggestionPromptCard } from "./settings/AiTagSuggestionPromptCard";
import { ThemeToggle } from "./ThemeToggle";
import type { AuthUser } from "@edgeever/shared";
import { contentEnterMotion } from "@/lib/motion";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";

interface SettingsPaneProps {
  onClose: () => void;
  onOpenTemplates: () => void;
  onOpenAiPrompts: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
  editorContentAlignment: EditorContentAlignment;
  onEditorContentAlignmentChange: (alignment: EditorContentAlignment) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
  authRequired: boolean;
  demoMode: boolean;
  isOwner: boolean;
  user: AuthUser | null;
  refreshWorkspaceAfterImport: () => Promise<void>;
}

// Slate and brand color variables already switch values with the root theme.
// Keep this pane on the base utilities so dark variants do not invert them twice.
const SettingsGroup = ({ children }: { children: ReactNode }) => (
  <div className="min-w-0 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*]:rounded-none [&>*]:border-0 [&>*]:bg-transparent">
    {children}
  </div>
);

type TabKey = "general" | "users" | "data" | "ai" | "advanced" | "account";

interface TabItem {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  bgColorClass: string;
  hoverColorClass: string;
  iconColorClass: string;
}

export const SettingsPane = ({
  onClose,
  onOpenTemplates,
  onOpenAiPrompts,
  imageCompressionEnabled,
  onImageCompressionChange,
  shortcutSettings,
  onShortcutSettingsChange,
  editorContentAlignment,
  onEditorContentAlignmentChange,
  onLogout,
  isLoggingOut,
  authRequired,
  demoMode,
  isOwner,
  user,
  refreshWorkspaceAfterImport,
}: SettingsPaneProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [activeMobileTab, setActiveMobileTab] = useState<TabKey | null>(null);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const { unseen: deployedUpdateUnseen } = useDeployedUpdateNotice();
  const canClearLocalData = Boolean(window.edgeeverDesktop?.canClearLocalData);

  const tabItems: TabItem[] = [
    {
      key: "general",
      label: t("settings.tabs.general"),
      icon: SlidersHorizontal,
      colorClass: "text-emerald-700",
      bgColorClass: "bg-emerald-50/80",
      hoverColorClass: "hover:bg-emerald-50/40",
      iconColorClass: "text-emerald-600",
    },
    {
      key: "ai",
      label: t("settings.tabs.ai"),
      icon: Sparkles,
      colorClass: "text-emerald-700",
      bgColorClass: "bg-emerald-50/80",
      hoverColorClass: "hover:bg-emerald-50/40",
      iconColorClass: "text-emerald-600",
    },
    {
      key: "data",
      label: t("settings.tabs.data"),
      icon: Database,
      colorClass: "text-emerald-700",
      bgColorClass: "bg-emerald-50/80",
      hoverColorClass: "hover:bg-emerald-50/40",
      iconColorClass: "text-emerald-600",
    },
    ...(isOwner
      ? [
          {
            key: "users" as const,
            label: t("users.title"),
            icon: Users,
            colorClass: "text-emerald-700",
            bgColorClass: "bg-emerald-50/80",
            hoverColorClass: "hover:bg-emerald-50/40",
            iconColorClass: "text-emerald-600",
          },
        ]
      : []),
    {
      key: "advanced",
      label: t("settings.tabs.advanced"),
      icon: Wrench,
      colorClass: "text-emerald-700",
      bgColorClass: "bg-emerald-50/80",
      hoverColorClass: "hover:bg-emerald-50/40",
      iconColorClass: "text-emerald-600",
    },
    {
      key: "account",
      label: t("settings.tabs.account"),
      icon: Shield,
      colorClass: "text-emerald-700",
      bgColorClass: "bg-emerald-50/80",
      hoverColorClass: "hover:bg-emerald-50/40",
      iconColorClass: "text-emerald-600",
    },
  ];

  const handleBack = () => {
    if (activeMobileTab !== null) {
      setActiveMobileTab(null);
    } else {
      onClose();
    }
  };

  const getHeaderTitle = () => {
    if (activeMobileTab !== null) {
      const activeItem = tabItems.find((item) => item.key === activeMobileTab);
      return activeItem ? activeItem.label : t("settings.title");
    }
    return t("settings.title");
  };

  const HeaderIcon = (() => {
    if (activeMobileTab !== null) {
      const activeItem = tabItems.find((item) => item.key === activeMobileTab);
      return activeItem ? activeItem.icon : User;
    }
    return User;
  })();

  const HeaderIconColorClass = (() => {
    if (activeMobileTab !== null) {
      const activeItem = tabItems.find((item) => item.key === activeMobileTab);
      return activeItem ? activeItem.iconColorClass : "text-emerald-700";
    }
    return "text-emerald-700";
  })();

  const renderTabContent = (key: TabKey) => {
    switch (key) {
      case "general":
        return (
          <SettingsGroup>
            <PreferenceCard
              imageCompressionEnabled={imageCompressionEnabled}
              onImageCompressionChange={onImageCompressionChange}
              shortcutSettings={shortcutSettings}
              onShortcutSettingsChange={onShortcutSettingsChange}
              editorContentAlignment={editorContentAlignment}
              onEditorContentAlignmentChange={onEditorContentAlignmentChange}
            />
            <FeedbackLink className="hidden lg:flex" />
          </SettingsGroup>
        );
      case "users":
        return isOwner ? (
          <SettingsGroup>
            <UserManagementCard demoMode={demoMode} />
          </SettingsGroup>
        ) : null;
      case "data":
        return (
          <SettingsGroup>
            <DataExportCard refreshWorkspaceAfterImport={refreshWorkspaceAfterImport} />
            <EvernoteImportGuideCard />
          </SettingsGroup>
        );
      case "ai":
        return (
          <SettingsGroup>
            <AiModelCard />
            <McpConfigCard />
            <AiPromptsCard onOpenLibrary={onOpenAiPrompts} />
            <AdvancedPlayCard />
          </SettingsGroup>
        );
      case "advanced":
        return (
          <SettingsGroup>
            <AiTagSuggestionPromptCard />
            {isOwner ? <ObjectStorageCard demoMode={demoMode} /> : null}
            {canClearLocalData ? <DesktopLocalDataCard /> : null}
          </SettingsGroup>
        );
      case "account":
        return (
          <SettingsGroup>
            <AccountInfoCard user={user} />
            <PasswordCard authRequired={authRequired} demoMode={demoMode} />
            {demoMode ? null : (
              <LoginDevicesCard
                authRequired={authRequired}
                isLoggingOut={isLoggingOut}
                onLogout={onLogout}
              />
            )}
          </SettingsGroup>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-slate-50">
      <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:px-6 lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            title={t("common.back")}
            aria-label={t("common.back")}
            onClick={handleBack}
            className="h-9 w-9 rounded-lg hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
              <HeaderIcon className={cn("h-4 w-4 shrink-0 transition-colors", HeaderIconColorClass)} />
              <span className="truncate text-slate-900">{getHeaderTitle()}</span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle className="inline-flex" showLabel />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 min-w-0 bg-slate-50/50">
        {/* 桌面端布局：双栏 */}
        <div className="hidden lg:flex flex-1 min-h-0 min-w-0 mx-auto max-w-5xl px-6 py-6 gap-6">
          {/* 左侧垂直 Tab 栏 */}
          <aside className="w-52 shrink-0 flex flex-col gap-1">
            {tabItems.map((item) => {
              const Icon = item.icon;
              const isSelected = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={cn(
                    "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 text-left w-full",
                    isSelected
                      ? `${item.colorClass} ${item.bgColorClass}`
                      : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isSelected ? item.colorClass : "text-slate-400")} />
                  {item.label}
                </button>
              );
            })}
          </aside>

          {/* 右侧设置内容区 */}
          <main className="flex-1 min-w-0 overflow-y-auto pr-2">
            <m.div key={activeTab} className="grid gap-4" {...contentEnterMotion}>
              {renderTabContent(activeTab)}
            </m.div>
          </main>
        </div>

        {/* 移动端布局 */}
        <div className="flex lg:hidden flex-1 flex-col min-h-0 min-w-0 overflow-y-auto px-4 py-4">
          {activeMobileTab === null ? (
            /* 分类主菜单 */
            <div className="grid gap-2">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={onOpenTemplates}
                  className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-slate-50/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50/80">
                      <LayoutTemplate className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="text-sm font-semibold text-slate-800">{t("nav.templates")}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
                <button
                  type="button"
                  onClick={onOpenAiPrompts}
                  className="flex w-full items-center justify-between gap-4 border-t border-slate-100 p-4 text-left transition-colors hover:bg-slate-50/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50/80">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="text-sm font-semibold text-slate-800">{t("nav.prompts")}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              </div>
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {tabItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveMobileTab(item.key)}
                      className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-slate-50/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", item.bgColorClass)}>
                          <Icon className={cn("h-4 w-4", item.iconColorClass)} />
                        </div>
                        <span className="text-sm font-semibold text-slate-800">{item.label}</span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </button>
                  );
                })}
              </div>
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setSystemInfoOpen(true)}
                  className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-slate-600 transition-colors hover:bg-slate-200/50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50/80">
                      <Info className="h-4 w-4 text-emerald-600" />
                      {deployedUpdateUnseen ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-white" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{t("systemInfo.title")}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{t("systemInfo.description")}</span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
                <FeedbackLink />
              </div>
            </div>
          ) : (
            /* 详情页面 */
            <m.div key={activeMobileTab} className="grid gap-4" {...contentEnterMotion}>
              {renderTabContent(activeMobileTab)}
            </m.div>
          )}
        </div>
      </div>
      <SystemInfoDialog open={systemInfoOpen} onOpenChange={setSystemInfoOpen} />
    </div>
  );
};
