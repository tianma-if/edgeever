import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUpCircle, X } from "./icons";
import { Text } from "./LocalizedText";
import { useMobileLocale } from "../lib/mobile-locale";
import {
  readMobileUpdateToastDismissedVersion,
  shouldShowMobileUpdateToastForVersion,
  writeMobileUpdateToastDismissedVersion,
} from "../lib/preferences";
import { resolveMobileThemeStyles, useMobileTheme } from "../lib/mobile-theme";
import { useMobileUpdate } from "../lib/mobile-update";
import { getMobileUpdateToastBottomOffset } from "../lib/mobile-update-toast-layout";

const AUTO_DISMISS_MS = 3_000;
const FADE_MS = 180;

/**
 * Subtle one-shot toast when an app update is detected.
 * Auto-hides after 3s, and is remembered per installed version until the user upgrades.
 */
export const MobileUpdateToast = () => {
  const insets = useSafeAreaInsets();
  const { resolvedLocale } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  const { hasUpdate, installedVersion, openUpdate, status, updateKind } = useMobileUpdate();
  const english = resolvedLocale === "en-US";
  const styles = resolveMobileThemeStyles(baseStyles, resolvedTheme);
  const [storageReady, setStorageReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const dismissedForVersionRef = useRef<string | null>(null);
  const showingRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    void readMobileUpdateToastDismissedVersion().then((value) => {
      if (!active) return;
      dismissedForVersionRef.current = value;
      setStorageReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady || !hasUpdate || status === "downloading") {
      return;
    }
    if (!shouldShowMobileUpdateToastForVersion(installedVersion, dismissedForVersionRef.current)) {
      return;
    }
    if (!installedVersion || showingRef.current) {
      return;
    }

    showingRef.current = true;
    dismissedForVersionRef.current = installedVersion;
    void writeMobileUpdateToastDismissedVersion(installedVersion);

    setVisible(true);
    Animated.timing(opacity, {
      duration: FADE_MS,
      toValue: 1,
      useNativeDriver: true,
    }).start();

    const hideTimer = setTimeout(() => {
      Animated.timing(opacity, {
        duration: FADE_MS,
        toValue: 0,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setVisible(false);
          showingRef.current = false;
        }
      });
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(hideTimer);
  }, [hasUpdate, installedVersion, opacity, status, storageReady]);

  if (!visible || !hasUpdate) {
    return null;
  }

  const title = english ? "Update available" : "发现新版本";
  const detail = status === "ready"
    ? (english ? "Restart in System info" : "可在系统信息中重启")
    : updateKind === "ota"
      ? (english ? "Optional in-app update" : "可选的应用内更新")
      : (english ? "See System info to update" : "可在系统信息中更新");

  const dismiss = () => {
    Animated.timing(opacity, {
      duration: FADE_MS,
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setVisible(false);
        showingRef.current = false;
      }
    });
  };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
      style={[
        styles.anchor,
        {
          bottom: getMobileUpdateToastBottomOffset(insets.bottom),
          opacity,
        },
      ]}
    >
      <View style={styles.toast}>
        <Pressable
          accessibilityHint={english ? "Opens the update action" : "打开更新操作"}
          accessibilityLabel={`${title}. ${detail}`}
          accessibilityRole="button"
          onPress={() => {
            dismiss();
            void openUpdate();
          }}
          style={styles.toastBody}
        >
          <View style={styles.iconWrap}>
            <ArrowUpCircle color="#059669" size={14} />
          </View>
          <View style={styles.copy}>
            <Text numberOfLines={1} style={styles.title}>{title}</Text>
            <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityLabel={english ? "Dismiss" : "关闭"}
          accessibilityRole="button"
          hitSlop={8}
          onPress={dismiss}
          style={styles.close}
        >
          <X color="#94a3b8" size={14} />
        </Pressable>
      </View>
    </Animated.View>
  );
};

const baseStyles = StyleSheet.create({
  anchor: {
    alignItems: "center",
    left: 16,
    position: "absolute",
    right: 16,
    zIndex: 40,
  },
  toast: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d1fae5",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    flexDirection: "row",
    gap: 2,
    maxWidth: 320,
    minHeight: 40,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 6,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  toastBody: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 8,
    minWidth: 0,
    paddingVertical: 2,
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: "#ecfdf5",
    borderRadius: 999,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  copy: {
    flexShrink: 1,
    gap: 0,
    minWidth: 0,
    paddingRight: 2,
  },
  title: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
  },
  detail: {
    color: "#64748b",
    fontSize: 11,
    lineHeight: 14,
  },
  close: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
});
