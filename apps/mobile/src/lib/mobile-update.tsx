import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Constants from "expo-constants";
import { AppState, Linking, Platform, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";
import { Alert } from "../components/LocalizedText";
import { openGooglePlayDetails } from "../../modules/edgeever-app-store";
import { useMobileLocale, getMobileCatalog, formatMobileCopy } from "./mobile-locale";
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
  const installedVersion = Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null;

  const showLinkError = useCallback(() => {
    Alert.alert(
      getMobileCatalog(resolvedLocale).mobile.update.linkOpenFailed,
      getMobileCatalog(resolvedLocale).mobile.update.linkOpenFailedHint
    );
  }, [resolvedLocale]);

  const openManualUpdateSource = useCallback((source: MobileInstallUpdateSource) => {
    void openMobileInstallUpdateSource(source, {
      linking: Linking,
      openGooglePlayDetails,
    }).then((result) => {
      if (result.status !== "google-play-unavailable") {
        return;
      }
      if (result.reason === "not-installed") {
        Alert.alert(
          getMobileCatalog(resolvedLocale).mobile.update.playNotInstalled,
          getMobileCatalog(resolvedLocale).mobile.update.playNotInstalledHint
        );
        return;
      }
      const { fallbackUrl, reason } = result;
      const copy = reason === "disabled"
        ? {
          message: getMobileCatalog(resolvedLocale).mobile.update.playDisabledHint,
          title: getMobileCatalog(resolvedLocale).mobile.update.playDisabled,
        }
        : {
          message: getMobileCatalog(resolvedLocale).mobile.update.playUnavailableHint,
          title: getMobileCatalog(resolvedLocale).mobile.update.playUnavailable,
        };
      Alert.alert(copy.title, copy.message, [
        {
          text: getMobileCatalog(resolvedLocale).common.cancel,
          style: "cancel",
        },
        {
          text: getMobileCatalog(resolvedLocale).mobile.update.openWebListing,
          onPress: () => {
            void Linking.openURL(fallbackUrl).catch(showLinkError);
          },
        },
      ]);
    }).catch(() => {
      showLinkError();
    });
  }, [resolvedLocale, showLinkError]);

  const openInstallUpdateOptions = useCallback((release: MobileRelease) => {
    const googlePlay = ANDROID_INSTALL_UPDATE_SOURCES.find((source) => source.id === "google-play");
    const github = ANDROID_INSTALL_UPDATE_SOURCES.find((source) => source.id === "github");
    if (!googlePlay || !github) {
      return;
    }
    Alert.alert(
      getMobileCatalog(resolvedLocale).mobile.update.available,
      formatMobileCopy(getMobileCatalog(resolvedLocale).mobile.update.releaseAvailable, { version: release.version }),
      [
        {
          text: getMobileCatalog(resolvedLocale).mobile.update.later,
          style: "cancel",
        },
        {
          icon: "github",
          text: getMobileCatalog(resolvedLocale).mobile.update.sources[github.id],
          onPress: () => openManualUpdateSource(github),
        },
        {
          icon: "google-play",
          text: getMobileCatalog(resolvedLocale).mobile.update.sources[googlePlay.id],
          onPress: () => openManualUpdateSource(googlePlay),
        },
      ]
    );
  }, [resolvedLocale, openManualUpdateSource]);

  const runCheck = useCallback((userInitiated: boolean) => {
    if (activeCheckRef.current) {
      return activeCheckRef.current;
    }

    if (!isSupported) {
      if (userInitiated) {
        Alert.alert(
          getMobileCatalog(resolvedLocale).mobile.update.unsupported,
          getMobileCatalog(resolvedLocale).mobile.update.unsupportedHint
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
  }, [resolvedLocale, installedVersion, isSupported]);

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
        Alert.alert(
          getMobileCatalog(resolvedLocale).mobile.update.none,
          getMobileCatalog(resolvedLocale).mobile.update.noneHint,
        );
        return;
      }

      setStatus("ready");
      Alert.alert(
        getMobileCatalog(resolvedLocale).mobile.update.ready,
        getMobileCatalog(resolvedLocale).mobile.update.readyHint,
        [
          {
            text: getMobileCatalog(resolvedLocale).mobile.update.later,
            style: "cancel",
          },
          {
            text: getMobileCatalog(resolvedLocale).mobile.update.restart,
            onPress: () => {
              void Updates.reloadAsync();
            },
          },
        ]
      );
    } catch {
      setStatus("available");
      Alert.alert(
        getMobileCatalog(resolvedLocale).mobile.update.failed,
        getMobileCatalog(resolvedLocale).mobile.update.failedHint
      );
    }
  }, [resolvedLocale, installRelease, isSupported, openInstallUpdateOptions, status, updateKind]);

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
