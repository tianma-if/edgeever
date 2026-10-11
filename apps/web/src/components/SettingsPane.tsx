import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Database,
  Info,
  Keyboard,
  KeyRound,
  LayoutTemplate,
  Share2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import * as m from "motion/react-m";
import { Button } from "@/components/ui/button";

import type { ShortcutSettings } from "@/lib/app-helpers";
import type { NoteProsePatch, ResolvedNoteProse } from "@edgeever/shared";
import { BETA_BADGE_CLASSNAME, WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { cn } from "@/lib/utils";
import { AccountInfoCard } from "./settings/AccountInfoCard";
import { DataExportCard } from "./settings/DataExportCard";
import { DesktopLocalDataCard } from "./settings/DesktopLocalDataCard";
import { LoginDevicesCard } from "./settings/LoginDevicesCard";
import { ShareManagementCard } from "./settings/ShareManagementCard";
import { EvernoteImportGuideCard } from "./settings/EvernoteImportGuideCard";
import { FeedbackLink } from "./settings/FeedbackLink";
import { SystemInfoPanel } from "./settings/SystemInfoPanel";
import { McpConfigCard } from "./settings/McpConfigCard";
import { PreferenceCard } from "./settings/PreferenceCard";
import { ShortcutSettingsItem } from "./settings/ShortcutSettingsItem";
import { PasswordCard } from "./settings/PasswordCard";
import { UserManagementCard } from "./settings/UserManagementCard";
import { ObjectStorageCard } from "./settings/ObjectStorageCard";
import { AiModelCard } from "./settings/AiModelCard";
import { SpeechTranscriptionCard } from "./settings/SpeechTranscriptionCard";
import { DesktopAcpAgentCard } from "./settings/DesktopAcpAgentCard";
import { ThemeToggle } from "./ThemeToggle";
import type { AuthUser } from "@edgeever/shared";
import { contentEnterMotion } from "@/lib/motion";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";
import { ExecutionCenterButton } from "@/components/execution/ExecutionCenterButton";

interface SettingsPaneProps {
  onClose: () => void;
  onOpenTemplates: () => void;
  onOpenAiPrompts: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
  noteProse: ResolvedNoteProse;
  onNoteProseChange: (patch: NoteProsePatch) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
  authRequired: boolean;
  demoMode: boolean;
  isOwner: boolean;
  user: AuthUser | null;
  refreshWorkspaceAfterImport: () => Promise<void>;
  onOpenExecutionCenter: () => void;
  onOpenMemo: (memoId: string, notebookId: string) => void;
}

// Slate and brand color variables already switch values with the root theme.
const SettingsGroup = ({ children }: { children: ReactNode }) => (
  <div className="min-w-0 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-card [&>*]:rounded-none [&>*]:border-0 [&>*]:bg-transparent">
    {children}
  </div>
);

type TabKey = "general" | "shortcuts" | "users" | "data" | "ai" | "mcp" | "speech" | "sharing" | "advanced" | "account" | "system";

interface TabItem {
  key: TabKey;
  label: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const SettingsPane = ({
  onClose,
  onOpenTemplates,
  onOpenAiPrompts,
  imageCompressionEnabled,
  onImageCompressionChange,
  shortcutSettings,
  onShortcutSettingsChange,
  noteProse,
  onNoteProseChange,
  onLogout,
  isLoggingOut,
  authRequired,
  demoMode,
  isOwner,
  user,
  refreshWorkspaceAfterImport,
  onOpenExecutionCenter,
  onOpenMemo,
}: SettingsPaneProps) => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const selectTab = (tab: TabKey | null) => setSearchParams(tab ? { tab } : {}, { replace: true });
  const { unseen: deployedUpdateUnseen } = useDeployedUpdateNotice();
  const canClearLocalData = Boolean(window.edgeeverDesktop?.canClearLocalData);

  const tabItems: TabItem[] = [
    {
      key: "general",
      label: t("settings.tabs.general"),
      icon: SlidersHorizontal,
    },
    {
      key: "shortcuts",
      label: t("settings.tabs.shortcuts"),
      icon: Keyboard,
    },
    {
      key: "ai",
      label: t("settings.tabs.ai"),
      icon: Sparkles,
    },
    {
      key: "mcp",
      label: t("settings.tabs.mcp"),
      icon: KeyRound,
    },
    {
      key: "speech",
      label: t("settings.tabs.speech"),
      icon: AudioLines,
    },
    {
      key: "data",
      label: t("settings.tabs.data"),
      icon: Database,
    },
    {
      key: "sharing",
      label: t("sharing.managementTitle"),
      icon: Share2,
    },
    ...(isOwner
      ? [
          {
            key: "users" as const,
            label: t("users.title"),
            icon: Users,
          },
        ]
      : []),
    ...(isOwner || canClearLocalData
      ? [
          {
            key: "advanced" as const,
            label: t("settings.tabs.advanced"),
            icon: Wrench,
          },
        ]
      : []),
    {
      key: "account",
      label: t("settings.tabs.account"),
      icon: Shield,
    },
    {
      key: "system",
      label: t("systemInfo.title"),
      icon: Info,
    },
  ];

  const selectedTab = tabItems.find((item) => item.key === requestedTab)?.key ?? null;
  const activeTab = selectedTab ?? "general";
  const activeMobileTab = selectedTab;

  const mobileTabItems = tabItems.filter((item) => item.key !== "shortcuts");

  const handleBack = () => {
    if (window.matchMedia("(max-width: 1023px)").matches && activeMobileTab !== null) {
      selectTab(null);
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

  const renderTabContent = (key: TabKey) => {
    switch (key) {
      case "general":
        return (
          <div className="grid gap-6">
            <PreferenceCard
              imageCompressionEnabled={imageCompressionEnabled}
              onImageCompressionChange={onImageCompressionChange}
              noteProse={noteProse}
              onNoteProseChange={onNoteProseChange}
            />
            <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-card lg:block">
              <FeedbackLink />
            </div>
          </div>
        );
      case "shortcuts":
        return (
          <ShortcutSettingsItem
            shortcutSettings={shortcutSettings}
            onShortcutSettingsChange={onShortcutSettingsChange}
          />
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
      case "sharing":
        return <ShareManagementCard userId={user?.id ?? null} onOpenMemo={onOpenMemo} />;
      case "ai":
        return (
          <SettingsGroup>
            <DesktopAcpAgentCard />
            <AiModelCard />
          </SettingsGroup>
        );
      case "speech":
        return (
          <SettingsGroup>
            <SpeechTranscriptionCard demoMode={demoMode} />
          </SettingsGroup>
        );
      case "mcp":
        return (
          <SettingsGroup>
            <McpConfigCard />
          </SettingsGroup>
        );
      case "advanced":
        return (
          <SettingsGroup>
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
      case "system":
        return <SystemInfoPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-workspace-canvas">
      <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 bg-card px-4 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:px-6 lg:pb-0 lg:pt-0">
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
              <HeaderIcon className="h-4 w-4 shrink-0 text-slate-900" />
              <span className="truncate text-slate-900">{getHeaderTitle()}</span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ExecutionCenterButton onClick={onOpenExecutionCenter} />
          <ThemeToggle className="inline-flex" showLabel />
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 bg-workspace-canvas">
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
                  onClick={() => selectTab(item.key)}
                  className={cn(
                    "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs leading-5 transition-all duration-150 text-left w-full",
                    isSelected
                      ? "bg-workspace-selection font-normal text-slate-950"
                      : "font-normal text-slate-600 hover:bg-workspace-hover hover:text-slate-900"
                  )}
                >
                  <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                    <Icon className={cn("h-4 w-4 transition-colors", isSelected ? "text-slate-950" : "text-slate-400")} />
                    {item.key === "system" && deployedUpdateUnseen ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-workspace-canvas" /> : null}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none",
                        isSelected
                          ? "bg-slate-200 text-slate-950"
                          : "bg-slate-200/80 text-slate-600"
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
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
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-card">
                <button
                  type="button"
                  onClick={onOpenTemplates}
                  className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-slate-50/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                      <LayoutTemplate className="h-4 w-4 text-slate-700" />
                    </div>
                    <span className="text-xs font-normal leading-5 text-slate-800">{t("nav.templates")}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
                <button
                  type="button"
                  onClick={onOpenAiPrompts}
                  className="flex w-full items-center justify-between gap-4 border-t border-slate-100 p-4 text-left transition-colors hover:bg-slate-50/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                      <Sparkles className="h-4 w-4 text-slate-700" />
                    </div>
                    <span className="text-xs font-normal leading-5 text-slate-800">{t("nav.prompts")}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              </div>
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-card">
                {mobileTabItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => selectTab(item.key)}
                      className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-slate-50/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                          <Icon className="h-4 w-4 text-slate-700" />
                          {item.key === "system" && deployedUpdateUnseen ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-card" /> : null}
                        </div>
                        <span className="text-xs font-normal leading-5 text-slate-800">{item.label}</span>
                        {item.badge ? (
                          <span className={BETA_BADGE_CLASSNAME}>{item.badge}</span>
                        ) : null}
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </button>
                  );
                })}
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-card">
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
    </div>
  );
};
