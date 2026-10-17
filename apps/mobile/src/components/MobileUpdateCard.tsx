import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, RefreshCw } from "./icons";
import { Pressable, Text } from "./LocalizedText";
import { useMobileLocale, getMobileCatalog } from "../lib/mobile-locale";
import { useMobileUpdate } from "../lib/mobile-update";
import { useMobileTheme, resolveMobileThemeStyles } from "../lib/mobile-theme";

export const MobileUpdateCard = () => {
  const { resolvedLocale } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  const { checkForUpdate, hasUpdate, isSupported, openUpdate, status, updateKind } = useMobileUpdate();
  const busy = status === "checking" || status === "downloading";
  const styles = resolveMobileThemeStyles(baseStyles, resolvedTheme);
  const checkLabel = status === "checking"
    ? getMobileCatalog(resolvedLocale).mobile.update.checking
    : getMobileCatalog(resolvedLocale).mobile.update.checkForUpdates;
  const openLabel = status === "downloading"
    ? getMobileCatalog(resolvedLocale).mobile.update.downloadingUpdate
    : status === "ready"
      ? getMobileCatalog(resolvedLocale).mobile.update.restartToApply
      : updateKind === "ota"
        ? getMobileCatalog(resolvedLocale).mobile.update.downloadUpdate
        : getMobileCatalog(resolvedLocale).mobile.update.chooseSource;

  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.title}>{getMobileCatalog(resolvedLocale).mobile.update.title}</Text>
        <Text style={styles.description}>
          {getMobileCatalog(resolvedLocale).mobile.update.description}
        </Text>
        <Text style={styles.version}>
          {getMobileCatalog(resolvedLocale).mobile.update.currentVersion}: v{Updates.runtimeVersion ?? Constants.expoConfig?.version ?? "unknown"}
        </Text>
      </View>
      {hasUpdate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={() => void openUpdate()}
          style={[styles.button, busy && styles.buttonDisabled]}
        >
          {status === "downloading" ? <ActivityIndicator color="#047857" size="small" /> : <RefreshCw color="#047857" size={16} />}
          <Text style={styles.buttonText}>{openLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={() => void checkForUpdate()}
        style={[styles.button, busy && styles.buttonDisabled]}
      >
        {status === "checking" ? <ActivityIndicator color="#047857" size="small" /> : <RefreshCw color="#047857" size={16} />}
        <Text style={styles.buttonText}>{checkLabel}</Text>
      </Pressable>
      {!isSupported ? (
        <Text style={styles.hint}>
          {getMobileCatalog(resolvedLocale).mobile.update.releaseBuildsOnly}
        </Text>
      ) : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  card: {
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
    gap: 12,
    padding: 16,
  },
  copy: {
    gap: 4,
  },
  title: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700",
  },
  description: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 17,
  },
  version: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: "#047857",
    fontSize: 13,
    fontWeight: "700",
  },
  hint: {
    color: "#94a3b8",
    fontSize: 11,
    lineHeight: 16,
  },
});
