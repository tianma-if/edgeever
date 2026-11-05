import { useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { getMfaChallenge } from "@edgeever/client";
import { PUBLIC_DEMO_INSTANCE_URL, type MfaChallenge } from "@edgeever/shared";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, GitHub, LockKeyhole } from "../components/icons";
import { Pressable, Text, TextInput } from "../components/LocalizedText";
import {
  TotpCodeInput,
  TotpLinkButton,
  TotpRecoveryCodeInput,
  useTwoFactorCopy,
} from "../components/TotpFlowParts";
import { formatMobileLoginError } from "../lib/login-error";
import { formatMobileCopy, useMobileLocale } from "../lib/mobile-locale";
import { classifyMfaLoginError, isCompleteTotpCode, isPlausibleRecoveryCode } from "../lib/mobile-totp";
import { resolveMobileThemeStyles, useMobileTheme, type MobileResolvedTheme } from "../lib/mobile-theme";
import { useSession } from "../lib/session";

const GITHUB_REPOSITORY_URL = "https://github.com/tianma-if/edgeever";

export const LoginScreen = () => {
  const { resolvedTheme } = useMobileTheme();
  const { resolvedLocale } = useMobileLocale();
  refreshLoginThemeStyles(resolvedTheme);
  const { t: twoFactor } = useTwoFactorCopy();
  const { completeMfaSignIn, signIn } = useSession();
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Second step after the password was accepted for an account with TOTP.
  const [mfa, setMfa] = useState<{ challenge: MfaChallenge; baseUrl: string; username: string; method: "totp" | "recovery" } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const canSubmit = baseUrl.trim() && username.trim() && password;
  const canSubmitMfa = mfa
    ? mfa.method === "totp" ? isCompleteTotpCode(mfaCode) : isPlausibleRecoveryCode(recoveryCode)
    : false;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await signIn({ baseUrl, username, password, locale: resolvedLocale });
    } catch (signInError) {
      const challenge = getMfaChallenge(signInError);
      if (challenge) {
        setPassword("");
        setMfaCode("");
        setRecoveryCode("");
        setMfa({ challenge, baseUrl, username: username.trim(), method: "totp" });
      } else {
        setError(formatMobileLoginError(signInError, resolvedLocale));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const backToPassword = (message: string | null) => {
    setMfa(null);
    setMfaCode("");
    setRecoveryCode("");
    setError(message);
  };

  const switchMfaMethod = (method: "totp" | "recovery") => {
    setError(null);
    setMfaCode("");
    setRecoveryCode("");
    setMfa((current) => (current ? { ...current, method } : current));
  };

  const handleMfaSubmit = async () => {
    if (!mfa || !canSubmitMfa || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await completeMfaSignIn({
        baseUrl: mfa.baseUrl,
        challengeToken: mfa.challenge.challengeToken,
        ...(mfa.method === "recovery" ? { recoveryCode } : { code: mfaCode }),
        locale: resolvedLocale,
      });
    } catch (mfaError) {
      const outcome = classifyMfaLoginError(mfaError);
      if (outcome.kind === "expired") {
        backToPassword(twoFactor.loginExpired);
      } else if (outcome.kind === "retry") {
        if (mfa.method === "totp") setMfaCode("");
        setError(twoFactor[outcome.key]);
      } else {
        setError(formatMobileLoginError(mfaError, resolvedLocale));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Pressable accessibilityLabel="GitHub 仓库" accessibilityRole="link" onPress={() => Linking.openURL(GITHUB_REPOSITORY_URL)} style={styles.githubButton}>
        <GitHub color="#475569" size={20} />
      </Pressable>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.keyboard}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.form}>
            <View style={styles.header}>
              <View style={styles.logo}>
                <LockKeyhole color={styles.logoIcon.color} size={22} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>EdgeEver</Text>
                <Text style={styles.subtitle}>连接你的自托管笔记空间</Text>
              </View>
            </View>
            {mfa ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.stepTitle}>
                    {mfa.method === "totp" ? twoFactor.loginTitle : twoFactor.loginRecoveryTitle}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {mfa.method === "totp"
                      ? formatMobileCopy(twoFactor.loginDescription, { username: mfa.username })
                      : twoFactor.loginRecoveryDescription}
                  </Text>
                </View>
                {mfa.method === "totp" ? (
                  <TotpCodeInput
                    inputStyle={styles.verificationInput}
                    autoFocus
                    label={twoFactor.loginCode}
                    onChangeText={setMfaCode}
                    onSubmit={() => void handleMfaSubmit()}
                    value={mfaCode}
                  />
                ) : (
                  <TotpRecoveryCodeInput
                    inputStyle={styles.verificationInput}
                    autoFocus
                    hint={twoFactor.recoveryCodeHint}
                    label={twoFactor.recoveryCode}
                    onChangeText={setRecoveryCode}
                    onSubmit={() => void handleMfaSubmit()}
                    value={recoveryCode}
                  />
                )}

                {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={!canSubmitMfa || submitting}
                  onPress={() => void handleMfaSubmit()}
                  style={({ pressed }) => [
                    styles.button,
                    (!canSubmitMfa || submitting) && styles.buttonDisabled,
                    pressed && canSubmitMfa ? styles.buttonPressed : null,
                  ]}
                >
                  {submitting ? <ActivityIndicator color="#ffffff" /> : (
                    <Text style={styles.buttonText}>
                      {mfa.method === "totp" ? twoFactor.loginVerify : twoFactor.loginRecoverySubmit}
                    </Text>
                  )}
                </Pressable>
                <View style={styles.links}>
                  {mfa.method === "totp" ? (
                    <TotpLinkButton textStyle={styles.linkText} label={twoFactor.useRecoveryCode} onPress={() => switchMfaMethod("recovery")} />
                  ) : (
                    <TotpLinkButton textStyle={styles.linkText} label={twoFactor.useCode} onPress={() => switchMfaMethod("totp")} />
                  )}
                  <TotpLinkButton textStyle={styles.linkText} label={twoFactor.loginBackToPassword} onPress={() => backToPassword(null)} />
                </View>
              </>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>实例地址</Text>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    onChangeText={setBaseUrl}
                    placeholder={PUBLIC_DEMO_INSTANCE_URL}
                    placeholderTextColor="#94a3b8"
                    style={styles.input}
                    value={baseUrl}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>用户名</Text>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setUsername}
                    style={styles.input}
                    value={username}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>密码</Text>
                  <TextInput
                    onChangeText={setPassword}
                    placeholder="首次登录密码"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry
                    style={styles.input}
                    value={password}
                  />
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={!canSubmit || submitting}
                  onPress={handleSubmit}
                  style={({ pressed }) => [
                    styles.button,
                    (!canSubmit || submitting) && styles.buttonDisabled,
                    pressed && canSubmit ? styles.buttonPressed : null,
                  ]}
                >
                  {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>登录</Text>}
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const baseLoginStyles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#f8fafc",
    flex: 1,
  },
  githubButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    top: 18,
    width: 42,
    zIndex: 2,
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    marginBottom: 10,
  },
  headerText: {
    flex: 1,
  },
  logo: {
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  logoIcon: { color: "#475569" },
  title: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 3,
  },
  form: {
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 18,
    borderWidth: 1,
    gap: 16,
    maxWidth: 420,
    padding: 24,
    width: "100%",
  },
  field: {
    gap: 8,
  },
  label: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0f172a",
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  verificationInput: { borderColor: "#e2e8f0" },
  stepTitle: {
    color: "#0f172a",
    fontSize: 17,
    fontWeight: "800",
  },
  stepDescription: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 19,
  },
  linkText: { color: "#475569" },
  links: {
    gap: 4,
  },
  error: {
    color: "#dc2626",
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#047857",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 50,
  },
  buttonDisabled: {
    backgroundColor: "#475569",
  },
  buttonPressed: {
    backgroundColor: "#065f46",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
});

let styles = baseLoginStyles;
let loginStylesTheme: MobileResolvedTheme = "light";

const refreshLoginThemeStyles = (theme: MobileResolvedTheme) => {
  if (loginStylesTheme !== theme) {
    styles = resolveMobileThemeStyles(baseLoginStyles, theme);
    loginStylesTheme = theme;
  }
};
