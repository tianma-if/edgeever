import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Constants from "expo-constants";
import { AppState, Platform, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";
import { Alert } from "../components/LocalizedText";
import { useMobileLocale } from "./mobile-locale";
import { downloadAndroidApk, installDownloadedAndroidApk } from "./android-apk-update";
import { findNewerMobileRelease, type MobileRelease } from "./mobile-release";

const FOREGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type MobileUpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "installing";
export type MobileUpdateKind = "install" | "ota";

type MobileUpdateContextValue = {
  checkForUpdate: () => Promise<void>;
  downloadProgress: number | null;
  hasUpdate: boolean;
  installedVersion: string | null;
  isSupported: boolean;
  openUpdate: () => Promise<void>;
  status: MobileUpdateStatus;
  updateKind: MobileUpdateKind | null;
};

const MobileUpdateContext = createContext<MobileUpdateContextValue>({
  checkForUpdate: async () => undefined,
  downloadProgress: null,
  hasUpdate: false,
  installedVersion: null,
  isSupported: false,
  openUpdate: async () => undefined,
  status: "idle",
  updateKind: null,
});

export const MobileUpdateProvider = ({ children }: { children: ReactNode }) => {
  const { resolvedLocale } = useMobileLocale();
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedInstallFileUri, setDownloadedInstallFileUri] = useState<string | null>(null);
  const [installRelease, setInstallRelease] = useState<MobileRelease | null>(null);
  const [status, setStatus] = useState<MobileUpdateStatus>("idle");
  const [updateKind, setUpdateKind] = useState<MobileUpdateKind | null>(null);
  const activeCheckRef = useRef<Promise<void> | null>(null);
  const activeDownloadRef = useRef<Promise<string> | null>(null);
  const lastAutomaticCheckRef = useRef(0);
  const pendingInstallPromptRef = useRef<{ fileUri: string; release: MobileRelease } | null>(null);
  const promptedInstallVersionRef = useRef<string | null>(null);
  const isSupported = !__DEV__ && Updates.isEnabled;
  const english = resolvedLocale === "en-US";
  const installedVersion = Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null;

  const openPreparedInstaller = useCallback((release: MobileRelease, fileUri: string) => {
    Alert.alert(
      english ? "Update ready" : "更新已就绪",
      english
        ? `EdgeEver ${release.version} has been downloaded and is ready to install.`
        : `EdgeEver ${release.version} 安装包已下载完成，可以立即安装。`,
      [
        {
          text: english ? "Later" : "稍后",
          style: "cancel",
        },
        {
          text: english ? "Install now" : "立即安装",
          onPress: () => {
            setStatus("installing");
            void installDownloadedAndroidApk(fileUri).then(() => {
              setStatus("ready");
            }).catch(() => {
              setStatus("ready");
              Alert.alert(
                english ? "Could not open installer" : "无法打开安装器",
                english
                  ? "Allow EdgeEver to install apps when prompted, then try again."
                  : "请在系统提示时允许 EdgeEver 安装应用，然后重试。"
              );
            });
          },
        },
      ]
    );
  }, [english]);

  const promptPreparedInstallerWhenActive = useCallback((release: MobileRelease, fileUri: string) => {
    if (promptedInstallVersionRef.current === release.version) {
      return;
    }
    if (AppState.currentState !== "active") {
      pendingInstallPromptRef.current = { fileUri, release };
      return;
    }
    pendingInstallPromptRef.current = null;
    promptedInstallVersionRef.current = release.version;
    openPreparedInstaller(release, fileUri);
  }, [openPreparedInstaller]);

  const prepareInstallRelease = useCallback(async (release: MobileRelease, promptWhenReady: boolean) => {
    setInstallRelease(release);
    setUpdateKind("install");

    let download = activeDownloadRef.current;
    if (!download) {
      setDownloadProgress(0);
      setStatus("downloading");
      download = downloadAndroidApk(release, ({ progress }) => setDownloadProgress(progress));
      activeDownloadRef.current = download;
    }

    try {
      const fileUri = await download;
      setDownloadedInstallFileUri(fileUri);
      setDownloadProgress(null);
      setStatus("ready");
      if (promptWhenReady) {
        promptPreparedInstallerWhenActive(release, fileUri);
      }
      return fileUri;
    } catch (error) {
      setDownloadedInstallFileUri(null);
      setDownloadProgress(null);
      setStatus("available");
      throw error;
    } finally {
      if (activeDownloadRef.current === download) {
        activeDownloadRef.current = null;
      }
    }
  }, [promptPreparedInstallerWhenActive]);

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
              try {
                await prepareInstallRelease(release, true);
              } catch {
                if (userInitiated) {
                  Alert.alert(
                    english ? "Download failed" : "下载失败",
                    english
                      ? "Could not prepare the update package. Check your connection and try again."
                      : "无法准备更新安装包，请检查网络后重试。"
                  );
                }
              }
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
  }, [english, installedVersion, isSupported, prepareInstallRelease]);

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
        const pendingPrompt = pendingInstallPromptRef.current;
        if (pendingPrompt) {
          promptPreparedInstallerWhenActive(pendingPrompt.release, pendingPrompt.fileUri);
        }
        attemptAutomaticCheck();
      }
    });

    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [promptPreparedInstallerWhenActive, runCheck]);

  const openUpdate = useCallback(async () => {
    if (updateKind === "install") {
      if (Platform.OS !== "android" || !installRelease || status === "downloading" || status === "installing") {
        return;
      }
      if (downloadedInstallFileUri) {
        openPreparedInstaller(installRelease, downloadedInstallFileUri);
        return;
      }
      void prepareInstallRelease(installRelease, true).catch(() => {
        Alert.alert(
          english ? "Download failed" : "下载失败",
          english
            ? "Could not prepare the update package. Check your connection and try again."
            : "无法准备更新安装包，请检查网络后重试。"
        );
      });
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
  }, [downloadedInstallFileUri, english, installRelease, isSupported, openPreparedInstaller, prepareInstallRelease, status, updateKind]);

  const value = useMemo<MobileUpdateContextValue>(
    () => ({
      checkForUpdate: () => {
        return runCheck(true);
      },
      downloadProgress,
      hasUpdate: status === "available" || status === "ready" || status === "downloading" || status === "installing",
      installedVersion,
      isSupported,
      openUpdate,
      status,
      updateKind,
    }),
    [downloadProgress, installedVersion, isSupported, openUpdate, runCheck, status, updateKind]
  );

  return <MobileUpdateContext.Provider value={value}>{children}</MobileUpdateContext.Provider>;
};

export const useMobileUpdate = () => useContext(MobileUpdateContext);
