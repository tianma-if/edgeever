import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Constants from "expo-constants";
import { AppState, Linking, Platform, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";
import { Alert } from "../components/LocalizedText";
import { openGooglePlayDetails } from "../../modules/edgeever-app-store";
import { useMobileLocale } from "./mobile-locale";
import {
  ANDROID_INSTALL_UPDATE_SOURCES,
  findNewerMobileRelease,
  type MobileInstallUpdateSource,
  type MobileRelease,
} from "./mobile-release";
import { openMobileInstallUpdateSource } from "./mobile-update-destination";

const FOREGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type MobileUpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready";
export type MobileUpdateKind = "install" | "ota";

type MobileUpdateContextValue = {
  checkForUpdate: () => Promise<void>;
  hasUpdate: boolean;
  installedVersion: string | null;
  isSupported: boolean;
  openUpdate: () => Promise<void>;
  status: MobileUpdateStatus;
  updateKind: MobileUpdateKind | null;
};

const MobileUpdateContext = createContext<MobileUpdateContextValue>({
  checkForUpdate: async () => undefined,
  hasUpdate: false,
  installedVersion: null,
  isSupported: false,
  openUpdate: async () => undefined,
  status: "idle",
  updateKind: null,
});
const MobileUpdateAvailableContext = createContext(false);

export const MobileUpdateProvider = ({ children }: { children: ReactNode }) => {
  const { resolvedLocale } = useMobileLocale();
  const [installRelease, setInstallRelease] = useState<MobileRelease | null>(null);
  const [status, setStatus] = useState<MobileUpdateStatus>("idle");
  const [updateKind, setUpdateKind] = useState<MobileUpdateKind | null>(null);
  const activeCheckRef = useRef<Promise<void> | null>(null);
  const lastAutomaticCheckRef = useRef(0);
  const isSupported = !__DEV__ && Updates.isEnabled;
  const english = resolvedLocale === "en-US";
  const installedVersion = Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null;

  const showLinkError = useCallback(() => {
    Alert.alert(
      english ? "Could not open link" : "无法打开链接",
      english ? "Check your browser settings and try again." : "请检查浏览器设置后重试。"
    );
  }, [english]);

  const openManualUpdateSource = useCallback((source: MobileInstallUpdateSource) => {
    void openMobileInstallUpdateSource(source, {
      openGooglePlayDetails,
      openUrl: Linking.openURL,
    }).then((result) => {
      if (result.status !== "google-play-unavailable") {
        return;
      }
      if (result.reason === "not-installed") {
        Alert.alert(
          english ? "Google Play is not installed" : "未安装 Google Play",
          english
            ? "Google Play Store is not installed on this device, so this update channel is unavailable."
            : "这台设备未安装 Google Play 商店，无法通过该渠道更新。"
        );
        return;
      }
      const { fallbackUrl, reason } = result;
      const copy = reason === "disabled"
        ? {
          message: english
            ? "Google Play Store is disabled. Enable it in system settings, or open the web listing instead."
            : "Google Play 商店已被停用，请先在系统设置中启用，或改用网页版。",
          title: english ? "Google Play is disabled" : "Google Play 已停用",
        }
        : {
          message: english
            ? "Google Play Store could not handle this update link. Try again later, or open the web listing instead."
            : "Google Play 商店无法处理这个更新链接，请稍后重试，或改用网页版。",
          title: english ? "Could not open Google Play" : "无法打开 Google Play",
        };
      Alert.alert(copy.title, copy.message, [
        {
          text: english ? "Cancel" : "取消",
          style: "cancel",
        },
        {
          text: english ? "Open web listing" : "打开网页版",
          onPress: () => {
            void Linking.openURL(fallbackUrl).catch(showLinkError);
          },
        },
      ]);
    }).catch(() => {
      showLinkError();
    });
  }, [english, showLinkError]);

  const openInstallUpdateOptions = useCallback((release: MobileRelease) => {
    const googlePlay = ANDROID_INSTALL_UPDATE_SOURCES.find((source) => source.id === "google-play");
    const github = ANDROID_INSTALL_UPDATE_SOURCES.find((source) => source.id === "github");
    if (!googlePlay || !github) {
      return;
    }
    Alert.alert(
      english ? "Update available" : "发现新版本",
      english
        ? `EdgeEver ${release.version} is available. Choose where to update.`
        : `EdgeEver ${release.version} 已发布，请选择更新渠道。`,
      [
        {
          text: english ? "Later" : "稍后",
          style: "cancel",
        },
        {
          icon: "github",
          text: english ? github.labelEn : github.labelZh,
          onPress: () => openManualUpdateSource(github),
        },
        {
          icon: "google-play",
          text: english ? googlePlay.labelEn : googlePlay.labelZh,
          onPress: () => openManualUpdateSource(googlePlay),
        },
      ]
    );
  }, [english, openManualUpdateSource]);

  const runCheck = useCallback((userInitiated: boolean) => {
    if (activeCheckRef.current) {
      return activeCheckRef.current;
    }

    if (!isSupported) {
      if (userInitiated) {
        Alert.alert(
          english ? "Updates unavailable" : "暂无法检查更新",
          english
            ? "Update checks are available in installed release builds, not Expo Go or development builds."
            : "检查更新仅适用于已安装的正式版，Expo Go 和开发版暂不支持。"
        );
      }
      return Promise.resolve();
    }

    const check = (async () => {
      try {
        setStatus("checking");

        if (Platform.OS === "android") {
          try {
            if (!installedVersion) {
              throw new Error("Installed app version is unavailable");
            }
            const release = await findNewerMobileRelease(installedVersion);
            if (release) {
              setInstallRelease(release);
              setUpdateKind("install");
              setStatus("available");
              return;
            }
          } catch {
            // Fall back to Expo's in-app update check when the release API is unavailable.
          }
        }

        const result = await Updates.checkForUpdateAsync();

        if (!result.isAvailable) {
          setInstallRelease(null);
          setUpdateKind(null);
          setStatus("idle");
          return;
        }

        setUpdateKind("ota");
        setStatus("available");
      } catch {
        setInstallRelease(null);
        setUpdateKind(null);
        setStatus("idle");
      }
    })();

    activeCheckRef.current = check;
    void check.finally(() => {
      activeCheckRef.current = null;
    });
    return check;
  }, [english, installedVersion, isSupported]);

  useEffect(() => {
    const attemptAutomaticCheck = () => {
      if (Date.now() - lastAutomaticCheckRef.current < FOREGROUND_CHECK_INTERVAL_MS) {
        return;
      }
      lastAutomaticCheckRef.current = Date.now();
      void runCheck(false);
    };
    const timer = setTimeout(attemptAutomaticCheck, 1_500);
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        attemptAutomaticCheck();
      }
    });

    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [runCheck]);

  const openUpdate = useCallback(async () => {
    if (updateKind === "install") {
      if (Platform.OS !== "android" || !installRelease) {
        return;
      }
      openInstallUpdateOptions(installRelease);
      return;
    }

    if (updateKind !== "ota" || !isSupported) {
      return;
    }

    try {
      if (status === "ready") {
        await Updates.reloadAsync();
        return;
      }

      setStatus("downloading");
      const result = await Updates.fetchUpdateAsync();
      if (!result.isNew) {
        setUpdateKind(null);
        setStatus("idle");
        if (english) {
          Alert.alert("No update", "No downloadable in-app update was found.");
        } else {
          Alert.alert("暂无更新", "没有可下载的应用内更新。");
        }
        return;
      }

      setStatus("ready");
      Alert.alert(
        english ? "Update ready" : "更新已就绪",
        english ? "Restart now to apply the update." : "重启后即可应用更新。",
        [
          {
            text: english ? "Later" : "稍后",
            style: "cancel",
          },
          {
            text: english ? "Restart" : "立即重启",
            onPress: () => {
              void Updates.reloadAsync();
            },
          },
        ]
      );
    } catch {
      setStatus("available");
      Alert.alert(
        english ? "Update failed" : "更新失败",
        english
          ? "Could not download the in-app update. Try again later."
          : "无法下载应用内更新，请稍后再试。"
      );
    }
  }, [english, installRelease, isSupported, openInstallUpdateOptions, status, updateKind]);

  const hasUpdate = status === "available" || status === "ready" || status === "downloading";
  const value = useMemo<MobileUpdateContextValue>(
    () => ({
      checkForUpdate: () => {
        return runCheck(true);
      },
      hasUpdate,
      installedVersion,
      isSupported,
      openUpdate,
      status,
      updateKind,
    }),
    [hasUpdate, installedVersion, isSupported, openUpdate, runCheck, status, updateKind]
  );

  return (
    <MobileUpdateAvailableContext.Provider value={hasUpdate}>
      <MobileUpdateContext.Provider value={value}>{children}</MobileUpdateContext.Provider>
    </MobileUpdateAvailableContext.Provider>
  );
};

export const useMobileUpdate = () => useContext(MobileUpdateContext);
export const useMobileUpdateAvailable = () => useContext(MobileUpdateAvailableContext);
