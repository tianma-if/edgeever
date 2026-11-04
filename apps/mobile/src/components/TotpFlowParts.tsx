import type { TotpSetupResponse } from "@edgeever/shared";
import * as Clipboard from "expo-clipboard";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Keyboard, Linking, Share, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { getMobileCatalog, formatMobileCopy, useMobileLocale } from "../lib/mobile-locale";
import { resolveMobileThemeStyles, useMobileTheme, type MobileResolvedTheme } from "../lib/mobile-theme";
import {
  formatRecoveryCodesText,
  formatTotpManualKey,
  normalizeRecoveryCodeInput,
  normalizeTotpCodeInput,
  TOTP_CODE_LENGTH,
} from "../lib/mobile-totp";
import { ActivityIndicator, AlertTriangle, Check, CheckSquare, Copy, ExternalLink, Share2, Square } from "./icons";
import { Pressable, Text, TextInput } from "./LocalizedText";

export const TOTP_PRIMARY_COLOR = "#10b981";

/**
 * Primary buttons follow the surrounding flow: the sign-in flow (including the
 * forced rebind after a recovery-code sign-in) matches the login button, and
 * the settings flow matches the other buttons on the sign-in settings page.
 */
export type TotpButtonTone = "login" | "settings";
const TotpButtonToneContext = createContext<TotpButtonTone>("settings");
export const TotpButtonToneProvider = TotpButtonToneContext.Provider;
const usePrimaryButtonStyle = () =>
  useContext(TotpButtonToneContext) === "login" ? totpStyles.primaryButtonLogin : totpStyles.primaryButton;

export const useTwoFactorCopy = () => {
  const { resolvedLocale } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  refreshTotpFlowThemeStyles(resolvedTheme);
  return { locale: resolvedLocale, t: getMobileCatalog(resolvedLocale).twoFactor };
};

/** Shows "Copied" briefly after a successful copy so the tap feels acknowledged. */
const useCopiedFlag = () => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async (value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };
  return { copied, copy };
};

export const TotpStepProgress = ({ current, steps }: { current: number; steps: readonly string[] }) => (
  <View accessibilityRole="progressbar" style={totpStyles.progress}>
    {steps.map((label, index) => {
      const done = index < current;
      const active = index === current;
      return (
        <View key={label} style={totpStyles.progressItem}>
          <View style={[totpStyles.progressBar, (done || active) && totpStyles.progressBarActive]} />
          <View style={totpStyles.progressLabelRow}>
            <View style={[totpStyles.progressDot, (done || active) && totpStyles.progressDotActive]}>
              {done ? <Check color="#ffffff" size={10} /> : <Text style={[totpStyles.progressDotText, active && totpStyles.progressDotTextActive]}>{index + 1}</Text>}
            </View>
            <Text numberOfLines={2} style={[totpStyles.progressLabel, active && totpStyles.progressLabelActive]}>{label}</Text>
          </View>
        </View>
      );
    })}
  </View>
);

export const TotpCodeInput = ({
  autoFocus,
  label,
  onChangeText,
  onSubmit,
  value,
}: {
  autoFocus?: boolean;
  label: string;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  value: string;
}) => (
  <View style={totpStyles.field}>
    <Text style={totpStyles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      importantForAutofill="yes"
      keyboardType="number-pad"
      maxLength={TOTP_CODE_LENGTH}
      onChangeText={(next) => {
        const normalized = normalizeTotpCodeInput(next);
        onChangeText(normalized);
        // The number pad can cover the button below; put it away once the code is complete.
        if (normalized.length === TOTP_CODE_LENGTH) Keyboard.dismiss();
      }}
      onSubmitEditing={onSubmit}
      placeholder="000000"
      placeholderTextColor="#94a3b8"
      returnKeyType="done"
      style={[totpStyles.input, totpStyles.codeInput]}
      textContentType="oneTimeCode"
      value={value}
    />
  </View>
);

export const TotpRecoveryCodeInput = ({
  autoFocus,
  hint,
  label,
  onChangeText,
  onSubmit,
  value,
}: {
  autoFocus?: boolean;
  hint?: string;
  label: string;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  value: string;
}) => (
  <View style={totpStyles.field}>
    <Text style={totpStyles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      autoCapitalize="characters"
      autoComplete="off"
      autoCorrect={false}
      autoFocus={autoFocus}
      onChangeText={(next) => onChangeText(normalizeRecoveryCodeInput(next))}
      onSubmitEditing={onSubmit}
      placeholder="XXXX-XXXX-XXXX"
      placeholderTextColor="#94a3b8"
      returnKeyType="done"
      style={[totpStyles.input, totpStyles.monoInput]}
      value={value}
    />
    {hint ? <Text style={totpStyles.help}>{hint}</Text> : null}
  </View>
);

export const TotpPasswordInput = ({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) => (
  <View style={totpStyles.field}>
    <Text style={totpStyles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      autoCapitalize="none"
      autoComplete="current-password"
      autoCorrect={false}
      onChangeText={onChangeText}
      placeholderTextColor="#94a3b8"
      secureTextEntry
      style={totpStyles.input}
      textContentType="password"
      value={value}
    />
  </View>
);

/** Step "bind authenticator": setup key, open-in-app and the first code. */
export const TotpBindStep = ({
  code,
  onCodeChange,
  onSubmit,
  setup,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit?: () => void;
  setup: TotpSetupResponse;
}) => {
  const { t } = useTwoFactorCopy();
  const { copied, copy } = useCopiedFlag();
  const primaryButtonStyle = usePrimaryButtonStyle();
  const [openFailed, setOpenFailed] = useState(false);
  const manualKey = formatTotpManualKey(setup.secret);

  const openInAuthenticator = async () => {
    setOpenFailed(false);
    try {
      await Linking.openURL(setup.otpauthUri);
    } catch {
      // No installed app handles otpauth://; the manual key still works.
      setOpenFailed(true);
    }
  };

  return (
    <View style={totpStyles.stack}>
      <View style={totpStyles.qrRow}>
        <View accessibilityLabel={t.scanQr} accessible style={totpStyles.qrCard}>
          <QRCode backgroundColor="#ffffff" color="#07130b" quietZone={0} size={148} value={setup.otpauthUri} />
        </View>
        <Text style={[totpStyles.help, totpStyles.flex]}>{t.scanQr}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => void openInAuthenticator()} style={({ pressed }) => [primaryButtonStyle, pressed && totpStyles.pressed]}>
        <ExternalLink color="#ffffff" size={16} />
        <Text style={totpStyles.primaryButtonText}>{t.openInApp}</Text>
      </Pressable>
      <View style={totpStyles.keyCard}>
        <Text style={totpStyles.help}>{t.manualKey}</Text>
        <Text selectable style={totpStyles.manualKey}>{manualKey}</Text>
        <View style={totpStyles.keyFooter}>
          <Text style={[totpStyles.help, totpStyles.flex]}>
            {formatMobileCopy(t.accountInfo, { issuer: setup.issuer, account: setup.accountName })}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void copy(setup.secret.replace(/\s+/g, ""))} style={({ pressed }) => [totpStyles.secondaryButtonSmall, pressed && totpStyles.pressed]}>
            {copied ? <Check color={TOTP_PRIMARY_COLOR} size={14} /> : <Copy color="#334155" size={14} />}
            <Text style={totpStyles.secondaryButtonText}>{copied ? t.copied : t.copy}</Text>
          </Pressable>
        </View>
      </View>
      {openFailed ? <Text style={totpStyles.help}>{t.openInAppFailed}</Text> : null}
      <TotpCodeInput label={t.code} onChangeText={onCodeChange} onSubmit={onSubmit} value={code} />
      <Text style={totpStyles.help}>{t.verifyHint}</Text>
    </View>
  );
};

/** Step "save recovery codes": shown once, copy/share, and the saved checkbox. */
export const TotpRecoveryCodesStep = ({
  codes,
  note,
  onSavedChange,
  saved,
}: {
  codes: readonly string[];
  note?: string;
  onSavedChange: (saved: boolean) => void;
  saved: boolean;
}) => {
  const { t } = useTwoFactorCopy();
  const { copied, copy } = useCopiedFlag();
  const text = formatRecoveryCodesText(codes);

  return (
    <View style={totpStyles.stack}>
      <View style={totpStyles.warning}>
        <AlertTriangle color="#92400e" size={16} />
        <Text style={[totpStyles.warningText, totpStyles.flex]}>{t.codesWarning}</Text>
      </View>
      <View style={totpStyles.codesGrid}>
        {codes.map((code) => (
          <Text key={code} selectable style={totpStyles.codeCell}>{code}</Text>
        ))}
      </View>
      <View style={totpStyles.row}>
        <Pressable accessibilityRole="button" onPress={() => void copy(text)} style={({ pressed }) => [totpStyles.secondaryButton, totpStyles.flex, pressed && totpStyles.pressed]}>
          {copied ? <Check color={TOTP_PRIMARY_COLOR} size={15} /> : <Copy color="#334155" size={15} />}
          <Text style={totpStyles.secondaryButtonText}>{copied ? t.copied : t.copyAll}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void Share.share({ message: text }).catch(() => undefined)}
          style={({ pressed }) => [totpStyles.secondaryButton, totpStyles.flex, pressed && totpStyles.pressed]}
        >
          <Share2 color="#334155" size={15} />
          <Text style={totpStyles.secondaryButtonText}>{t.share}</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saved }}
        onPress={() => onSavedChange(!saved)}
        style={totpStyles.checkboxRow}
      >
        {saved ? <CheckSquare color={TOTP_PRIMARY_COLOR} size={20} /> : <Square color="#64748b" size={20} />}
        <Text style={[totpStyles.checkboxLabel, totpStyles.flex]}>{t.savedConfirm}</Text>
      </Pressable>
      {note ? <Text style={totpStyles.help}>{note}</Text> : null}
    </View>
  );
};

export const TotpPrimaryButton = ({
  danger = false,
  disabled,
  label,
  loading = false,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) => {
  const primaryButtonStyle = usePrimaryButtonStyle();
  return (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled: Boolean(disabled || loading), busy: loading }}
    disabled={disabled || loading}
    onPress={onPress}
    style={({ pressed }) => [
      danger ? totpStyles.dangerButton : primaryButtonStyle,
      (disabled || loading) && totpStyles.disabled,
      pressed && !disabled ? totpStyles.pressed : null,
    ]}
  >
    {loading ? <ActivityIndicator color={danger ? "#be123c" : "#ffffff"} /> : (
      <Text style={danger ? totpStyles.dangerButtonText : totpStyles.primaryButtonText}>{label}</Text>
    )}
  </Pressable>
  );
};

export const TotpSecondaryButton = ({ danger = false, disabled, label, onPress }: { danger?: boolean; disabled?: boolean; label: string; onPress: () => void }) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [danger ? totpStyles.dangerButton : totpStyles.secondaryButton, disabled && totpStyles.disabled, pressed && totpStyles.pressed]}
  >
    <Text style={danger ? totpStyles.dangerButtonText : totpStyles.secondaryButtonText}>{label}</Text>
  </Pressable>
);

export const TotpLinkButton = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" hitSlop={8} onPress={onPress} style={({ pressed }) => [totpStyles.linkButton, pressed && totpStyles.pressed]}>
    <Text style={totpStyles.linkText}>{label}</Text>
  </Pressable>
);

const baseTotpFlowStyles = StyleSheet.create({
  stack: { gap: 12 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  field: { gap: 7 },
  label: { color: "#334155", fontSize: 13, fontWeight: "700" },
  help: { color: "#64748b", fontSize: 12, lineHeight: 18 },
  input: { backgroundColor: "#ffffff", borderColor: "#cad8cc", borderRadius: 10, borderWidth: 1, color: "#17211a", fontSize: 16, minHeight: 48, paddingHorizontal: 13 },
  codeInput: { fontSize: 22, fontVariant: ["tabular-nums"], fontWeight: "700", letterSpacing: 6, textAlign: "center" },
  monoInput: { fontFamily: "monospace", letterSpacing: 1 },
  progress: { flexDirection: "row", gap: 8 },
  progressItem: { flex: 1, gap: 6 },
  progressBar: { backgroundColor: "#e2e8f0", borderRadius: 999, height: 4 },
  progressBarActive: { backgroundColor: TOTP_PRIMARY_COLOR },
  progressLabelRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  progressDot: { alignItems: "center", backgroundColor: "#f1f5f9", borderRadius: 999, height: 18, justifyContent: "center", width: 18 },
  progressDotActive: { backgroundColor: TOTP_PRIMARY_COLOR },
  progressDotText: { color: "#64748b", fontSize: 10, fontWeight: "800" },
  progressDotTextActive: { color: "#ffffff" },
  progressLabel: { color: "#64748b", flex: 1, fontSize: 11, fontWeight: "600" },
  progressLabelActive: { color: "#17211a", fontWeight: "800" },
  keyCard: { backgroundColor: "#f8fafc", borderColor: "#e2e8f0", borderRadius: 10, borderWidth: 1, gap: 8, padding: 12 },
  qrRow: { alignItems: "center", flexDirection: "row", gap: 14 },
  qrCard: { backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderRadius: 12, borderWidth: 1, padding: 10 },
  manualKey: { color: "#17211a", fontFamily: "monospace", fontSize: 17, fontWeight: "700", letterSpacing: 1, lineHeight: 26 },
  keyFooter: { alignItems: "center", flexDirection: "row", gap: 10 },
  warning: { alignItems: "flex-start", backgroundColor: "#fffbeb", borderColor: "#fde68a", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, padding: 12 },
  warningText: { color: "#92400e", fontSize: 12, lineHeight: 18 },
  codesGrid: { backgroundColor: "#f8fafc", borderColor: "#e2e8f0", borderRadius: 10, borderWidth: 1, flexDirection: "row", flexWrap: "wrap", padding: 8 },
  codeCell: { color: "#17211a", fontFamily: "monospace", fontSize: 14, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 7, textAlign: "center", width: "50%" },
  checkboxRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 44 },
  checkboxLabel: { color: "#17211a", fontSize: 13, fontWeight: "600", lineHeight: 19 },
  // Settings flow: same green as the change-password button on the sign-in settings page.
  primaryButton: { alignItems: "center", backgroundColor: "#15803d", borderRadius: 10, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  // Sign-in flow: same green as the login button.
  primaryButtonLogin: { alignItems: "center", backgroundColor: TOTP_PRIMARY_COLOR, borderRadius: 10, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "800" },
  secondaryButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#cad8cc", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  secondaryButtonSmall: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#cad8cc", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 5, minHeight: 34, paddingHorizontal: 10 },
  secondaryButtonText: { color: "#334155", fontSize: 13, fontWeight: "700" },
  dangerButton: { alignItems: "center", backgroundColor: "#fff1f2", borderColor: "#fecdd3", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  dangerButtonText: { color: "#be123c", fontSize: 14, fontWeight: "800" },
  linkButton: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
  linkText: { color: "#047857", fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82 },
});

let totpStyles = baseTotpFlowStyles;
let totpFlowStylesTheme: MobileResolvedTheme = "light";

const refreshTotpFlowThemeStyles = (theme: MobileResolvedTheme) => {
  if (totpFlowStylesTheme !== theme) {
    totpStyles = resolveMobileThemeStyles(baseTotpFlowStyles, theme);
    totpFlowStylesTheme = theme;
  }
};
