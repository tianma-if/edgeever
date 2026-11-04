import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, AlertTriangle, LogOut, ShieldCheck } from "../components/icons";
import { Pressable, Text } from "../components/LocalizedText";
import {
  TotpBindStep,
  TotpButtonToneProvider,
  TotpPrimaryButton,
  TotpRecoveryCodesStep,
  TotpSecondaryButton,
  TotpStepProgress,
  TOTP_PRIMARY_COLOR,
  useTwoFactorCopy,
} from "../components/TotpFlowParts";
import { formatMobileCopy } from "../lib/mobile-locale";
import { resolveMobileThemeStyles, useMobileTheme, type MobileResolvedTheme } from "../lib/mobile-theme";
import { getTotpErrorKey, isCompleteTotpCode, type TwoFactorCopyKey } from "../lib/mobile-totp";
import { useSession } from "../lib/session";

/**
 * The only screen a recovery-code session may see: bind a new authenticator,
 * save new recovery codes, then continue with the rotated normal session.
 */
export const MfaRebindScreen = () => {
  const { resolvedTheme } = useMobileTheme();
  refreshRebindThemeStyles(resolvedTheme);
  const { t } = useTwoFactorCopy();
  const { client, finishMfaRebind, session, signOut } = useSession();
  const [bindCode, setBindCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  // Batch of the codes on screen; confirm names it so a flow replaced elsewhere is refused.
  const [batchId, setBatchId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [errorKey, setErrorKey] = useState<TwoFactorCopyKey | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const scope = [session?.baseUrl, session?.user?.id] as const;

  const statusQuery = useQuery({
    enabled: Boolean(client),
    gcTime: 0,
    queryKey: ["auth", "totp-status", "rebind", ...scope],
    queryFn: () => client!.getTotpStatus(),
  });

  const setupQuery = useQuery({
    enabled: Boolean(client),
    gcTime: 0,
    queryKey: ["auth", "totp-setup", "rebind", ...scope],
    // A restricted session starts the rebind without re-authentication.
    queryFn: () => client!.startTotpSetup({}),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });

  const restart = () => {
    setBindCode("");
    setRecoveryCodes(null);
    setBatchId(null);
    setSaved(false);
    void setupQuery.refetch();
  };

  const fail = (error: unknown) => {
    const key = getTotpErrorKey(error);
    if (key === "errorSetupExpired") restart();
    setErrorKey(key);
  };

  const verifyMutation = useMutation({
    mutationFn: () => {
      const setup = setupQuery.data;
      if (!setup) throw new Error("Setup is not ready");
      return client!.verifyTotpSetup({ setupId: setup.setupId, code: bindCode });
    },
    onMutate: () => setErrorKey(null),
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setBatchId(result.batchId);
      setSaved(false);
    },
    onError: fail,
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!batchId) throw new Error("Recovery codes are not ready");
      const result = await client!.confirmTotpSetup({ batchId });
      await finishMfaRebind(result.sessionToken);
    },
    onMutate: () => setErrorKey(null),
    onError: fail,
  });

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const busy = verifyMutation.isPending || confirmMutation.isPending;
  const remaining = statusQuery.data?.recoveryCodesRemaining;
  const errorView = errorKey ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t[errorKey]}</Text> : null;

  return (
    <TotpButtonToneProvider value="login">
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            <View style={styles.banner}>
              <AlertTriangle color="#92400e" size={18} />
              <Text style={[styles.bannerText, styles.flex]}>
                {formatMobileCopy(t.rebindBanner, { count: remaining ?? "—" })}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={signingOut}
                onPress={() => void handleSignOut()}
                style={({ pressed }) => [styles.signOutButton, (pressed || signingOut) && styles.pressed]}
              >
                <LogOut color="#92400e" size={14} />
                <Text style={styles.signOutText}>{t.signOut}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.hero}>
                <ShieldCheck color="#15803d" size={22} />
                <View style={styles.flex}>
                  <Text style={styles.title}>{t.rebindRequiredTitle}</Text>
                  <Text style={styles.help}>{t.rebindRequiredDescription}</Text>
                </View>
              </View>
              <TotpStepProgress current={recoveryCodes ? 1 : 0} steps={[t.stepBindNew, t.stepNewCodes]} />

              {recoveryCodes ? (
                <View style={styles.stack}>
                  <TotpRecoveryCodesStep codes={recoveryCodes} note={t.deleteOldEntry} onSavedChange={setSaved} saved={saved} />
                  {errorView}
                  <TotpPrimaryButton disabled={!saved} label={t.rebindFinish} loading={confirmMutation.isPending} onPress={() => confirmMutation.mutate()} />
                </View>
              ) : setupQuery.data ? (
                <View style={styles.stack}>
                  <TotpBindStep
                    code={bindCode}
                    onCodeChange={setBindCode}
                    onSubmit={() => { if (isCompleteTotpCode(bindCode) && !busy) verifyMutation.mutate(); }}
                    setup={setupQuery.data}
                  />
                  {errorView}
                  <TotpPrimaryButton disabled={!isCompleteTotpCode(bindCode)} label={t.verifyAndContinue} loading={verifyMutation.isPending} onPress={() => verifyMutation.mutate()} />
                </View>
              ) : setupQuery.isError ? (
                <View style={styles.stack}>
                  <Text style={styles.error}>{t[getTotpErrorKey(setupQuery.error)]}</Text>
                  <TotpSecondaryButton label={t.continue} onPress={restart} />
                </View>
              ) : (
                <ActivityIndicator color={TOTP_PRIMARY_COLOR} />
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </TotpButtonToneProvider>
  );
};

const baseRebindStyles = StyleSheet.create({
  safeArea: { backgroundColor: "#ecfdf5", flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 20 },
  column: { alignSelf: "center", gap: 14, maxWidth: 460, width: "100%" },
  banner: { alignItems: "flex-start", backgroundColor: "#fffbeb", borderColor: "#fde68a", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, padding: 14 },
  bannerText: { color: "#92400e", fontSize: 13, lineHeight: 19 },
  signOutButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#fde68a", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 5, minHeight: 34, paddingHorizontal: 10 },
  signOutText: { color: "#92400e", fontSize: 12, fontWeight: "800" },
  card: { backgroundColor: "#ffffff", borderColor: "#a7f3d0", borderRadius: 18, borderWidth: 1, gap: 16, padding: 20 },
  hero: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  title: { color: "#17211a", fontSize: 18, fontWeight: "800" },
  help: { color: "#64748b", fontSize: 12, lineHeight: 18, marginTop: 3 },
  stack: { gap: 12 },
  error: { color: "#be123c", fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.7 },
});

let styles = baseRebindStyles;
let rebindStylesTheme: MobileResolvedTheme = "light";

const refreshRebindThemeStyles = (theme: MobileResolvedTheme) => {
  if (rebindStylesTheme !== theme) {
    styles = resolveMobileThemeStyles(baseRebindStyles, theme);
    rebindStylesTheme = theme;
  }
};
