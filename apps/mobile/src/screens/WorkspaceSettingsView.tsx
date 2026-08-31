import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import type { InstanceHealth } from "@edgeever/client";
import { buildGitHubFeedbackUrl, type AuthUser } from "@edgeever/shared";
import { useQuery } from "@tanstack/react-query";
import { BackHandler, Linking, Modal, Platform, ScrollView, Switch, View } from "react-native";
import { Activity, ActivityIndicator, Check, ChevronDown, ChevronLeft, ChevronRight, Cloud, Copy, ExternalLink, Image as ImageIcon, Info, LogOut, MessageSquare, MonitorSmartphone, Moon, RefreshCw, ShieldCheck, SlidersHorizontal, Sun, UserRound } from "../components/icons";
import { Pressable, Text } from "../components/LocalizedText";
import { useMobileLocale } from "../lib/mobile-locale";
import { useMobileTheme } from "../lib/mobile-theme";
import { useMobileUpdate } from "../lib/mobile-update";
import type { MobileLocalePreference } from "../lib/preferences";
import { useSession } from "../lib/session";
import { loadMobileSyncQueueSummary } from "../lib/sync-queue";
import { AccountSecurityPanel } from "./AccountSecurityModal";
import { getResolvedMobileLocale, isEnglishMobileLocale } from "./workspace-utils";
import { styles } from "./workspace-styles";

const useMobileLocalePreference = () => useMobileLocale().preference;

const MOBILE_APP_VERSION = Constants.expoConfig?.version ?? "0.1.2";

const formatExecutionEnvironment = (environment: string | null | undefined, localePreference: MobileLocaleMode = "system") => {
  const english = isEnglishMobileLocale(localePreference);

  switch (environment) {
    case "standalone":
      return english ? "Standalone app" : "独立安装包";
    case "storeClient":
      return english ? "Expo Go / development client" : "Expo Go / 开发客户端";
    case "bare":
      return "Bare React Native";
    default:
      return environment || getMobileSystemInfoText(localePreference).unknown;
  }
};
const MOBILE_LOCALE_OPTIONS: Array<{ label: string; value: MobileLocalePreference }> = [
  { label: "跟随系统", value: "system" },
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" },
];
type SettingsTab = "general" | "account" | "system";
export type MobileLocaleMode = MobileLocalePreference;

type MobileInstanceDiagnostics = {
  health: InstanceHealth;
  latencyMs: number;
  version: string;
};

type MobileSystemInfoGroup = {
  description: string;
  id: "cloud" | "client" | "connection";
  items: Array<{ label: string; value: string }>;
  title: string;
};

type MobileSyncDiagnostics = Awaited<ReturnType<typeof loadMobileSyncQueueSummary>>;

export const SettingsView = ({
  currentUser,
  imageCompressionEnabled,
  localePreference,
  onClose,
  onImageCompressionChange,
  onLocalePreferenceChange,
  onSignOut,
}: {
  currentUser: AuthUser | null;
  imageCompressionEnabled: boolean;
  localePreference: MobileLocaleMode;
  onClose: () => void;
  onImageCompressionChange: (enabled: boolean) => void;
  onLocalePreferenceChange: (locale: MobileLocaleMode) => void;
  onSignOut: () => void;
}) => {
  const { resolvedTheme, toggleTheme } = useMobileTheme();
  const { translate } = useMobileLocale();
  const { hasUpdate } = useMobileUpdate();
  const { client, session } = useSession();
  const [activeTab, setActiveTab] = useState<SettingsTab | null>(null);
  const [localePickerOpen, setLocalePickerOpen] = useState(false);
  const [localePickerAnchor, setLocalePickerAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const localeSelectRef = useRef<ComponentRef<typeof Pressable>>(null);
  const syncQueueScope = session?.baseUrl ?? "";
  const instanceDiagnosticsQuery = useQuery({
    queryKey: ["mobile", "system-info", "instance", session?.baseUrl],
    queryFn: async (): Promise<MobileInstanceDiagnostics> => {
      const startedAt = Date.now();
      const [health, release] = await Promise.all([
        client!.getInstanceHealth(),
        client!.getInstanceRelease(),
      ]);
      return {
        health,
        latencyMs: Math.max(0, Date.now() - startedAt),
        version: release.version,
      };
    },
    enabled: activeTab === "system" && Boolean(client),
    staleTime: 60 * 1000,
    retry: 1,
  });
  const syncDiagnosticsQuery = useQuery({
    queryKey: ["mobile", "system-info", "sync", syncQueueScope],
    queryFn: () => loadMobileSyncQueueSummary(syncQueueScope),
    enabled: activeTab === "system" && Boolean(session),
    refetchInterval: activeTab === "system" ? 10_000 : false,
  });
  const tabs: Array<{ key: SettingsTab; label: string; icon: ReactNode }> = [
    { key: "general", label: "常规设置", icon: <SlidersHorizontal color="#059669" size={17} /> },
    { key: "account", label: "登录设置", icon: <ShieldCheck color="#059669" size={17} /> },
  ];
  const systemInfoCopy = getMobileSystemInfoText(localePreference);
  const systemInfoDescription = hasUpdate ? systemInfoCopy.updateAvailableDescription : systemInfoCopy.description;
  const activeTabItem = activeTab === "system"
    ? { label: systemInfoCopy.title, icon: <Info color="#059669" size={17} /> }
    : tabs.find((tab) => tab.key === activeTab);
  const title = activeTabItem?.label ?? "我的";
  const activeLocaleLabel = MOBILE_LOCALE_OPTIONS.find((option) => option.value === localePreference)?.label ?? "跟随系统";
  const openLocalePicker = () => {
    localeSelectRef.current?.measureInWindow((left, top, width, height) => {
      setLocalePickerAnchor({ left, top: top + height + 4, width });
      setLocalePickerOpen(true);
    });
  };
  const openFeedback = async () => {
    const [instanceResult, syncResult] = await Promise.all([
      instanceDiagnosticsQuery.data || !client
        ? Promise.resolve(instanceDiagnosticsQuery.data)
        : instanceDiagnosticsQuery.refetch().then((result) => result.data),
      syncDiagnosticsQuery.data || !session
        ? Promise.resolve(syncDiagnosticsQuery.data)
        : syncDiagnosticsQuery.refetch().then((result) => result.data),
    ]);
    void Linking.openURL(buildMobileFeedbackUrl(localePreference, {
      connectionState: instanceResult ? "connected" : instanceDiagnosticsQuery.isError ? "failed" : "checking",
      instance: instanceResult,
      sync: syncResult,
    }));
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (activeTab) {
        setActiveTab(null);
      } else {
        onClose();
      }
      return true;
    });

    return () => subscription.remove();
  }, [activeTab, onClose]);

  const renderContent = () => {
    if (activeTab === "system") {
      return (
        <View style={styles.settingsDetailList}>
          <SystemInfoCard
            connectionState={instanceDiagnosticsQuery.data ? "connected" : instanceDiagnosticsQuery.isError ? "failed" : "checking"}
            defaultExpanded
            instance={instanceDiagnosticsQuery.data}
            sync={syncDiagnosticsQuery.data}
          />
        </View>
      );
    }
    if (activeTab === "general") {
      return (
        <View style={styles.settingsDetailList}>
          <SettingsGroup title="偏好设置" icon={<ImageIcon color="#047857" size={16} />}>
            <View style={styles.settingsContentRow}>
              <View style={styles.preferenceStack}>
                <View style={styles.preferenceText}>
                  <Text style={styles.settingsRowTitle}>界面语言</Text>
                  <Text style={styles.settingsRowDescription}>切换产品界面的显示语言。</Text>
                </View>
                <Pressable accessibilityLabel="界面语言" accessibilityRole="button" onPress={openLocalePicker} ref={localeSelectRef} style={styles.settingsSelect}>
                  <Text style={styles.settingsSelectText}>{activeLocaleLabel}</Text>
                  <ChevronDown color="#64748b" size={18} />
                </Pressable>
              </View>
            </View>
            <View style={styles.settingsContentRow}>
              <View style={styles.preferenceStack}>
                <View style={styles.preferenceText}>
                  <Text style={styles.settingsRowTitle}>压缩笔记内图片</Text>
                  <Text style={styles.settingsRowDescription}>上传大图时在本地压缩，节省资源占用。</Text>
                </View>
                <View style={styles.settingsSwitchStart}>
                  <Switch accessibilityLabel={translate("是否压缩笔记内图片")} onValueChange={onImageCompressionChange} value={imageCompressionEnabled} />
                </View>
              </View>
            </View>
          </SettingsGroup>
        </View>
      );
    }
    return (
      <View style={styles.settingsDetailList}>
        <View style={styles.accountSummaryCard}>
          <View style={styles.accountSummaryIcon}>
            <UserRound color="#047857" size={19} />
          </View>
      <View style={styles.accountSummaryContent}>
            <Text style={styles.accountSummaryTitle}>{translate("当前账户")}</Text>
            <Text style={styles.accountSummaryName}>{currentUser?.displayName || currentUser?.username || "—"}</Text>
        <Text style={styles.accountSummaryHelp}>
              @{currentUser?.username ?? "—"} · {currentUser?.role === "owner" ? translate("实例管理员") : translate("成员")}
            </Text>
          </View>
        </View>
        <View style={styles.settingsGroup}>
          <AccountSecurityPanel active />
        </View>
        <View style={styles.settingsLogoutCard}>
          <Pressable onPress={onSignOut} style={styles.settingsLogoutButton}>
            <LogOut color="#ffffff" size={17} />
            <Text style={styles.settingsLogoutText}>退出登录</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.settingsScreen}>
      <View style={styles.settingsHeader}>
        <Pressable accessibilityLabel="返回" onPress={() => activeTab ? setActiveTab(null) : onClose()} style={styles.settingsBackButton}>
          <ChevronLeft color="#64748b" size={21} />
        </Pressable>
        <View style={styles.settingsHeaderTitle}>
          {activeTab ? activeTabItem?.icon : <UserRound color="#047857" size={17} />}
          <Text numberOfLines={1} style={styles.settingsTitle}>{title}</Text>
        </View>
        <Pressable
          accessibilityLabel={resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          accessibilityRole="button"
          onPress={toggleTheme}
          style={styles.settingsThemeButton}
        >
          {resolvedTheme === "dark" ? <Sun color="#64748b" size={19} /> : <Moon color="#64748b" size={19} />}
          <Text numberOfLines={1} style={styles.settingsThemeText}>{resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.settingsScrollContent} style={styles.viewBody}>
        {activeTab === null ? (
          <View style={styles.settingsDetailList}>
            <View style={styles.settingsMenu}>
              {tabs.map((tab, index) => (
                <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={[styles.settingsMenuRow, index > 0 && styles.settingsMenuRowBorder]}>
                  <View style={styles.settingsMenuLabel}>
                    <View style={styles.settingsMenuIcon}>{tab.icon}</View>
                    <Text style={styles.settingsMenuText}>{tab.label}</Text>
                  </View>
                  <ChevronRight color="#94a3b8" size={17} />
                </Pressable>
              ))}
            </View>
            <View style={styles.settingsMenu}>
              <Pressable
                accessibilityHint={hasUpdate ? systemInfoCopy.updateAvailableDescription : undefined}
                accessibilityLabel={hasUpdate ? `${systemInfoCopy.title}，${systemInfoCopy.updateAvailableTitle}` : systemInfoCopy.title}
                accessibilityRole="button"
                onPress={() => setActiveTab("system")}
                style={styles.settingsMenuRow}
              >
                <View style={styles.settingsMenuLabel}>
                  <View style={styles.settingsMenuIcon}><Info color="#059669" size={17} /></View>
                  <View style={styles.settingsFeedbackCopy}>
                    <View style={styles.settingsMenuTitleRow}>
                      <Text style={styles.settingsMenuText}>{systemInfoCopy.title}</Text>
                      {hasUpdate ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.updateDot} /> : null}
                    </View>
                    <Text style={[styles.settingsFeedbackDescription, hasUpdate && styles.settingsUpdateDescription]}>
                      {systemInfoDescription}
                    </Text>
                  </View>
                </View>
                <ChevronRight color="#94a3b8" size={17} />
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void openFeedback()} style={[styles.settingsMenuRow, styles.settingsMenuRowBorder]}>
                <View style={styles.settingsMenuLabel}>
                  <View style={[styles.settingsMenuIcon, styles.settingsFeedbackIcon]}><MessageSquare color="#64748b" size={17} /></View>
                  <View style={styles.settingsFeedbackCopy}>
                    <Text style={styles.settingsMenuText}>意见反馈</Text>
                    <Text style={styles.settingsFeedbackDescription}>报告问题或提出功能建议</Text>
                  </View>
                </View>
                <ExternalLink color="#94a3b8" size={17} />
              </Pressable>
            </View>
          </View>
        ) : renderContent()}
      </ScrollView>
      <Modal animationType="fade" onRequestClose={() => setLocalePickerOpen(false)} statusBarTranslucent transparent visible={localePickerOpen && Boolean(localePickerAnchor)}>
        <Pressable onPress={() => setLocalePickerOpen(false)} style={styles.localePickerBackdrop}>
          {localePickerAnchor ? (
            <View style={[styles.localePickerMenu, localePickerAnchor]}>
              {MOBILE_LOCALE_OPTIONS.map((option) => {
                const active = localePreference === option.value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    key={option.value}
                    onPress={() => {
                      onLocalePreferenceChange(option.value);
                      setLocalePickerOpen(false);
                    }}
                    style={[styles.localePickerOption, active && styles.localePickerOptionActive]}
                  >
                    <Text style={[styles.localePickerOptionText, active && styles.localePickerOptionTextActive]}>{option.label}</Text>
                    {active ? <Check color="#047857" size={16} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
};

const SettingsGroup = ({ children, icon, title }: { children: ReactNode; icon?: ReactNode; title?: string }) => (
  <View style={styles.settingsGroup}>
    {title ? <View style={styles.settingsGroupHeader}>{icon}<Text style={styles.settingsGroupTitle}>{title}</Text></View> : null}
    {children}
  </View>
);


const SettingsActionButton = ({
  children,
  disabled = false,
  label,
  onPress,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) => (
  <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionButton, disabled && styles.buttonDisabled]}>
    {children}
    <Text style={styles.actionButtonText}>{label}</Text>
  </Pressable>
);

const SystemInfoCard = ({
  connectionState,
  defaultExpanded = false,
  instance,
  sync,
}: {
  connectionState: "checking" | "connected" | "failed";
  defaultExpanded?: boolean;
  instance?: MobileInstanceDiagnostics;
  sync?: MobileSyncDiagnostics;
}) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { checkForUpdate, hasUpdate, openUpdate, status, updateKind } = useMobileUpdate();
  const localePreference = useMobileLocalePreference();
  const english = isEnglishMobileLocale(localePreference);
  const copy = getMobileSystemInfoText(localePreference);
  const infoGroups = getMobileSystemInfoGroups(localePreference, { connectionState, instance, sync });
  const description = hasUpdate ? copy.updateAvailableDescription : copy.description;
  const checking = status === "checking";
  const downloading = status === "downloading";
  const checkLabel = checking
    ? (english ? "Checking…" : "正在检查…")
    : (english ? "Check for updates" : "检查更新");
  const openUpdateLabel = downloading
    ? (english ? "Downloading…" : "正在下载…")
    : status === "ready"
      ? (english ? "Restart to apply" : "重启以应用")
      : updateKind === "ota"
        ? (english ? "Download update" : "下载更新")
        : copy.openUpdate;

  const copySystemInfo = async () => {
    await Clipboard.setStringAsync(infoGroups
      .map((group) => [group.title, ...group.items.map((item) => `${item.label}: ${item.value}`)].join("\n"))
      .join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={styles.settingsGroup}>
      <Pressable accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.settingsAccordionHeader}>
        <View style={styles.settingsLinkCopy}>
          <View style={styles.settingsGroupHeader}>
            <Info color="#047857" size={16} />
            <Text style={styles.settingsGroupTitle}>{copy.title}</Text>
            {hasUpdate ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.updateDot} /> : null}
          </View>
          <Text style={[styles.settingsLinkDescription, hasUpdate && styles.settingsUpdateDescription]}>{description}</Text>
        </View>
        {expanded ? <ChevronDown color="#94a3b8" size={17} /> : <ChevronRight color="#94a3b8" size={17} />}
      </Pressable>
      {expanded ? (
        <View style={styles.settingsAccordionContent}>
          <SettingsActionButton label={copied ? (english ? "Copied" : "已复制") : (english ? "Copy info" : "复制信息")} onPress={copySystemInfo}>
            {copied ? <ShieldCheck color="#047857" size={16} /> : <Copy color="#0f172a" size={16} />}
          </SettingsActionButton>
          {hasUpdate ? (
            <SettingsActionButton
              disabled={downloading}
              label={openUpdateLabel}
              onPress={() => void openUpdate()}
            >
              {downloading
                ? <ActivityIndicator color="#047857" size="small" />
                : updateKind === "install"
                  ? <ExternalLink color="#047857" size={16} />
                  : <RefreshCw color="#047857" size={16} />}
            </SettingsActionButton>
          ) : null}
          <SettingsActionButton
            disabled={checking || downloading}
            label={checkLabel}
            onPress={() => void checkForUpdate()}
          >
            {checking ? <ActivityIndicator color="#047857" size="small" /> : <RefreshCw color="#047857" size={16} />}
          </SettingsActionButton>
          {infoGroups.map((group) => <MobileSystemInfoSection group={group} key={group.id} />)}
        </View>
      ) : null}
    </View>
  );
};

const MobileSystemInfoSection = ({ group }: { group: MobileSystemInfoGroup }) => (
  <View style={styles.systemInfoSection}>
    <View style={styles.systemInfoSectionHeader}>
      {group.id === "cloud"
        ? <Cloud color="#047857" size={16} />
        : group.id === "client"
          ? <MonitorSmartphone color="#047857" size={16} />
          : <Activity color="#047857" size={16} />}
      <View style={styles.systemInfoSectionCopy}>
        <Text style={styles.systemInfoSectionTitle}>{group.title}</Text>
        <Text style={styles.systemInfoSectionDescription}>{group.description}</Text>
      </View>
    </View>
    <View style={styles.systemInfoRows}>
      {Array.from({ length: Math.ceil(group.items.length / 3) }, (_, rowIndex) => {
        const rowItems = group.items.slice(rowIndex * 3, rowIndex * 3 + 3);

        return (
          <View
            key={`${group.id}-row-${rowIndex}`}
            style={[styles.systemInfoRow, rowIndex === Math.ceil(group.items.length / 3) - 1 && styles.systemInfoRowLast]}
          >
            {rowItems.map((item, itemIndex) => (
              <View
                key={item.label}
                style={[styles.systemInfoCell, itemIndex < rowItems.length - 1 && styles.systemInfoCellDivider]}
              >
                <Text numberOfLines={1} style={styles.panelLabel}>{item.label}</Text>
                <Text numberOfLines={1} selectable style={styles.systemInfoListValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  </View>
);


const getMobileSystemInfoText = (localePreference: MobileLocaleMode) =>
  isEnglishMobileLocale(localePreference)
    ? {
        build: "Build",
        client: "Client",
        clientDescription: "The EdgeEver app and runtime environment on this device.",
        clientSection: "Current client",
        cloudDescription: "Version and deployment environment for the connected instance.",
        cloudSection: "Cloud instance",
        connected: "Connected",
        connectionChecking: "Checking",
        connectionDescription: "Connection and local sync queue status.",
        connectionFailed: "Connection failed",
        connectionSection: "Connection and sync",
        containerImageSource: "Container image source",
        databaseBackend: "Database backend",
        databaseVersion: "Database version",
        description: "View cloud instance and current client diagnostics.",
        deploymentPlatform: "Deployment platform",
        existingAttachments: "Existing attachments",
        existingAttachmentsOriginalStorage: "Read from original storage",
        failedSync: "Failed or conflicted",
        followSystem: "Follow system",
        installMode: "Mode",
        instanceBuild: "Instance build",
        instanceConnection: "Instance connection",
        instanceVersion: "Instance version",
        language: "Language",
        newUploadObjectStorage: "New upload object storage",
        pendingSync: "Pending sync",
        platform: "System",
        mobileApp: "Mobile app",
        platformVersion: "System version",
        requestLatency: "Request latency",
        timeZone: "Time zone",
        openUpdate: "Get update",
        title: "System info",
        unknown: "Unknown",
        updateAvailableDescription: "A new version is available. Tap for details.",
        updateAvailableTitle: "Update available",
        version: "Version",
      }
    : {
        build: "构建",
        client: "客户端",
        clientDescription: "这台设备上的 EdgeEver 应用与运行环境。",
        clientSection: "当前客户端",
        cloudDescription: "当前连接实例的版本与部署环境。",
        cloudSection: "云端实例",
        connected: "连接正常",
        connectionChecking: "正在检查",
        connectionDescription: "实例连接与本地同步队列状态。",
        connectionFailed: "连接失败",
        connectionSection: "连接与同步",
        containerImageSource: "容器镜像来源",
        databaseBackend: "数据库后端",
        databaseVersion: "数据库版本",
        description: "查看云端实例与当前客户端的诊断信息。",
        deploymentPlatform: "部署平台",
        existingAttachments: "已有附件",
        existingAttachmentsOriginalStorage: "继续从原存储读取",
        failedSync: "失败或冲突",
        followSystem: "跟随系统",
        installMode: "安装形态",
        instanceBuild: "实例构建",
        instanceConnection: "实例连接",
        instanceVersion: "实例版本",
        language: "语言",
        newUploadObjectStorage: "新上传对象存储",
        pendingSync: "待同步",
        platform: "系统",
        mobileApp: "移动应用",
        platformVersion: "系统版本",
        requestLatency: "请求耗时",
        timeZone: "时区",
        openUpdate: "前往更新",
        title: "系统信息",
        unknown: "未知",
        updateAvailableDescription: "发现新版本，点按查看详情。",
        updateAvailableTitle: "发现新版本",
        version: "版本",
      };

const getMobileDeploymentPlatform = (runtime: string | null | undefined, english: boolean) => {
  if (runtime === "cloudflare-workers") return "Cloudflare";
  if (runtime === "self-hosted-bun") return "Docker";
  return english ? "Unknown" : "未知";
};

const getMobileContainerImageSource = (source: string | null | undefined, english: boolean) => {
  switch (source) {
    case "official-ghcr": return "GitHub Container Registry (GHCR)";
    case "official-cn-mirror": return english ? "Official mainland China mirror" : "中国大陆官方镜像";
    case "custom": return english ? "Custom image" : "自定义镜像";
    default: return english ? "Unknown" : "未知";
  }
};

const getMobileDatabaseBackend = (backend: string | null | undefined, unknown: string) => {
  if (backend === "d1") return "D1";
  if (backend === "sqlite") return "SQLite";
  return backend || unknown;
};

const getMobileObjectStorage = (health: InstanceHealth | undefined, english: boolean, unknown: string) => {
  if (health?.objectStorageProvider === "s3") return english ? "Third-party S3-compatible OSS" : "第三方 S3 兼容 OSS";
  if (health?.objectStorageProvider !== "builtin") return unknown;
  switch (health.storage?.resources) {
    case "r2": return english ? "Built-in R2" : "内置 R2";
    case "filesystem": return english ? "Local filesystem" : "本地文件系统";
    case "s3": return english ? "Instance-provided S3-compatible storage" : "实例内置 S3 兼容存储";
    default: return unknown;
  }
};

const getMobileSystemInfoGroups = (
  localePreference: MobileLocaleMode,
  diagnostics: {
    connectionState?: "checking" | "connected" | "failed";
    instance?: MobileInstanceDiagnostics;
    sync?: MobileSyncDiagnostics;
  } = {},
): MobileSystemInfoGroup[] => {
  const copy = getMobileSystemInfoText(localePreference);
  const english = isEnglishMobileLocale(localePreference);
  const resolvedLocale = getResolvedMobileLocale(localePreference);
  const platformName =
    Platform.OS === "android"
      ? "Android"
      : Platform.OS === "ios"
        ? "iOS"
        : Platform.OS === "macos"
          ? "macOS"
          : Platform.OS === "windows"
            ? "Windows"
            : Platform.OS;

  const instance = diagnostics.instance;
  const connectionValue = diagnostics.connectionState === "connected"
    ? copy.connected
    : diagnostics.connectionState === "failed"
      ? copy.connectionFailed
      : copy.connectionChecking;
  const pendingSync = diagnostics.sync
    ? diagnostics.sync.pending + diagnostics.sync.syncing
    : null;
  const failedSync = diagnostics.sync
    ? diagnostics.sync.error + diagnostics.sync.conflict
    : null;

  return [
    {
      description: copy.cloudDescription,
      id: "cloud",
      items: [
        { label: copy.instanceVersion, value: instance?.version ? `v${instance.version.replace(/^v/, "")}` : copy.unknown },
        { label: copy.instanceBuild, value: instance?.health.build || copy.unknown },
        { label: copy.databaseVersion, value: instance?.health.migration || copy.unknown },
        { label: copy.databaseBackend, value: getMobileDatabaseBackend(instance?.health.storage?.database, copy.unknown) },
        { label: copy.newUploadObjectStorage, value: getMobileObjectStorage(instance?.health, english, copy.unknown) },
        ...(instance?.health.objectStorageProvider === "s3"
          ? [{ label: copy.existingAttachments, value: copy.existingAttachmentsOriginalStorage }]
          : []),
        { label: copy.deploymentPlatform, value: getMobileDeploymentPlatform(instance?.health.runtime, english) },
        ...(instance?.health.runtime === "self-hosted-bun"
          ? [{ label: copy.containerImageSource, value: getMobileContainerImageSource(instance.health.containerImageSource, english) }]
          : []),
      ],
      title: copy.cloudSection,
    },
    {
      description: copy.clientDescription,
      id: "client",
      items: [
        { label: copy.version, value: `v${MOBILE_APP_VERSION}` },
        { label: copy.build, value: __DEV__ ? "development" : "production" },
        { label: copy.client, value: copy.mobileApp },
        { label: copy.platform, value: platformName },
        { label: copy.platformVersion, value: String(Platform.Version) },
        { label: copy.language, value: localePreference === "system" ? `${resolvedLocale} (${copy.followSystem})` : resolvedLocale },
        { label: copy.timeZone, value: Intl.DateTimeFormat().resolvedOptions().timeZone || copy.unknown },
        { label: copy.installMode, value: formatExecutionEnvironment(Constants.executionEnvironment, localePreference) },
      ],
      title: copy.clientSection,
    },
    {
      description: copy.connectionDescription,
      id: "connection",
      items: [
        { label: copy.instanceConnection, value: connectionValue },
        { label: copy.requestLatency, value: instance ? `${instance.latencyMs} ms` : copy.unknown },
        { label: copy.pendingSync, value: pendingSync === null ? copy.unknown : String(pendingSync) },
        { label: copy.failedSync, value: failedSync === null ? copy.unknown : String(failedSync) },
      ],
      title: copy.connectionSection,
    },
  ];
};

const buildMobileFeedbackUrl = (
  localePreference: MobileLocaleMode,
  diagnostics: Parameters<typeof getMobileSystemInfoGroups>[1] = {},
) => {
  const english = isEnglishMobileLocale(localePreference);
  const infoGroups = getMobileSystemInfoGroups(localePreference, diagnostics);

  return buildGitHubFeedbackUrl({
    contentHeading: english ? "Feedback" : "反馈内容",
    contentPrompt: english
      ? "Describe the problem, steps to reproduce it, or the feature you would like to see."
      : "请描述遇到的问题、复现步骤，或你希望增加的功能。",
    privacyNotice: english
      ? "GitHub Issues are public. Do not include passwords, tokens, instance URLs, or private note content."
      : "GitHub Issue 公开可见，请勿提交密码、Token、实例地址或私人笔记内容。",
    systemInfo: infoGroups.flatMap((group) => group.items.map((item) => ({
      label: `${group.title} / ${item.label}`,
      value: item.value,
    }))),
    systemInfoHeading: english ? "System information" : "系统信息",
    systemInfoNotice: english
      ? "The following information was generated by EdgeEver to help diagnose the issue."
      : "以下信息由 EdgeEver 自动生成，可帮助定位问题。",
    titlePrefix: english ? "[Feedback] " : "[反馈] ",
  });
};
