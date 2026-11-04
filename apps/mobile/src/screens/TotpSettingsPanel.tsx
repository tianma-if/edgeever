import type { TotpReauthInput, TotpSetupResponse } from "@edgeever/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, ShieldCheck } from "../components/icons";
import { Text } from "../components/LocalizedText";
import {
  TotpBindStep,
  TotpCodeInput,
  TotpLinkButton,
  TotpPasswordInput,
  TotpPrimaryButton,
  TotpRecoveryCodeInput,
  TotpRecoveryCodesStep,
  TotpSecondaryButton,
  TotpStepProgress,
  TOTP_PRIMARY_COLOR,
  useTwoFactorCopy,
} from "../components/TotpFlowParts";
import { formatMobileCopy } from "../lib/mobile-locale";
import { resolveMobileThemeStyles, useMobileTheme, type MobileResolvedTheme } from "../lib/mobile-theme";
import {
  getTotpErrorKey,
  getTotpUnavailableKey,
  isCompleteTotpCode,
  isPlausibleRecoveryCode,
  type TwoFactorCopyKey,
} from "../lib/mobile-totp";
import { useSession } from "../lib/session";

export const TOTP_STATUS_QUERY_KEY = ["auth", "totp-status"] as const;

type FlowKind = "enable" | "rebind" | "regenerate" | "disable";
type FlowStep = "identity" | "bind" | "codes";
type Flow = {
  kind: FlowKind;
  step: FlowStep;
  setup?: TotpSetupResponse;
  recoveryCodes?: string[];
  /** Batch of the codes on screen; confirm names it so a flow replaced elsewhere is refused. */
  batchId?: string;
};

const stepIndex = (flow: Flow) => (flow.step === "identity" ? 0 : flow.step === "bind" ? 1 : flow.kind === "regenerate" ? 1 : 2);

export const TotpSettingsPanel = ({ active }: { active: boolean }) => {
  const { resolvedTheme } = useMobileTheme();
  refreshTotpSettingsThemeStyles(resolvedTheme);
  const { locale, t } = useTwoFactorCopy();
  const { client, finishMfaRebind } = useSession();
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [bindCode, setBindCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [errorKey, setErrorKey] = useState<TwoFactorCopyKey | null>(null);
  const [successKey, setSuccessKey] = useState<TwoFactorCopyKey | null>(null);

  const statusQuery = useQuery({
    enabled: Boolean(client) && active,
    queryKey: TOTP_STATUS_QUERY_KEY,
    queryFn: () => client!.getTotpStatus(),
  });

  const resetFlow = (next: Flow | null) => {
    setFlow(next);
    setPassword("");
    setCode("");
    setRecoveryCode("");
    setUseRecovery(false);
    setBindCode("");
    setSaved(false);
    setErrorKey(null);
  };

  useEffect(() => {
    if (!active) resetFlow(null);
  }, [active]);

  const reauth = (): TotpReauthInput => (useRecovery ? { password, recoveryCode } : { password, code });

  const fail = (error: unknown) => {
    const key = getTotpErrorKey(error);
    if (key === "errorSetupExpired" && flow) {
      // Pending state is inert after expiry: start the same flow over.
      resetFlow({ kind: flow.kind, step: "identity" });
    }
    setErrorKey(key);
  };

  const identityMutation = useMutation({
    mutationFn: async (current: Flow) => {
      if (!client) throw new Error("Client is not ready");
      if (current.kind === "enable") return { setup: await client.startTotpSetup({ password }) };
      if (current.kind === "rebind") return { setup: await client.startTotpSetup(reauth()) };
      if (current.kind === "regenerate") {
        const generated = await client.regenerateRecoveryCodes(reauth());
        return { codes: generated.recoveryCodes, batchId: generated.batchId };
      }
      await client.disableTotp(reauth());
      return {};
    },
    onMutate: () => setErrorKey(null),
    onSuccess: (result, current) => {
      if (current.kind === "disable") {
        resetFlow(null);
        setSuccessKey("disabledToast");
        void queryClient.invalidateQueries({ queryKey: TOTP_STATUS_QUERY_KEY });
        return;
      }
      setPassword("");
      setCode("");
      setRecoveryCode("");
      if (result.setup) setFlow({ ...current, step: "bind", setup: result.setup });
      else setFlow({ ...current, step: "codes", recoveryCodes: result.codes, batchId: result.batchId });
    },
    onError: fail,
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Client is not ready");
      if (!flow?.setup) throw new Error("Setup is not ready");
      return client.verifyTotpSetup({ setupId: flow.setup.setupId, code: bindCode });
    },
    onMutate: () => setErrorKey(null),
    onSuccess: (result) => {
      setFlow((current) => (
        current ? { ...current, step: "codes", recoveryCodes: result.recoveryCodes, batchId: result.batchId } : current
      ));
      setSaved(false);
    },
    onError: fail,
  });

  const confirmMutation = useMutation({
    mutationFn: async (current: Flow) => {
      if (!client) throw new Error("Client is not ready");
      if (!current.batchId) throw new Error("Recovery codes are not ready");
      if (current.kind === "regenerate") {
        await client.confirmRecoveryCodes({ batchId: current.batchId });
        return;
      }
      const result = await client.confirmTotpSetup({ batchId: current.batchId });
      // Only a restricted session rotates; keep the token logic in one place anyway.
      if (result.sessionToken) await finishMfaRebind(result.sessionToken);
    },
    onMutate: () => setErrorKey(null),
    onSuccess: (_result, current) => {
      resetFlow(null);
      setSuccessKey(current.kind === "enable" ? "enabledToast" : current.kind === "rebind" ? "reboundToast" : "codesReplacedToast");
      void queryClient.invalidateQueries({ queryKey: TOTP_STATUS_QUERY_KEY });
    },
    onError: fail,
  });

  const startFlow = (kind: FlowKind) => {
    setSuccessKey(null);
    resetFlow({ kind, step: "identity" });
  };

  const status = statusQuery.data;
  const busy = identityMutation.isPending || verifyMutation.isPending || confirmMutation.isPending;
  const secondFactorReady = useRecovery ? isPlausibleRecoveryCode(recoveryCode) : isCompleteTotpCode(code);
  const identityReady = Boolean(password) && (flow?.kind === "enable" || secondFactorReady);

  const header = (
    <View style={styles.hero}>
      <ShieldCheck color="#15803d" size={22} />
      <View style={styles.flex}>
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle}>{t.title}</Text>
          {status ? (
            <View style={[styles.badge, status.enabled ? styles.badgeOn : styles.badgeOff]}>
              <Text style={[styles.badgeText, status.enabled ? styles.badgeTextOn : styles.badgeTextOff]}>
                {status.enabled ? t.statusOn : t.statusOff}
              </Text>
            </View>
          ) : null}
        </View>
        {status?.enabled ? (
          <Text style={styles.help}>
            {formatMobileCopy(t.enabledSummary, {
              date: status.enabledAt ? new Date(status.enabledAt).toLocaleDateString(locale) : "—",
              count: status.recoveryCodesRemaining,
            })}
          </Text>
        ) : (
          <Text style={styles.help}>{t.description}</Text>
        )}
      </View>
    </View>
  );

  if (!status) {
    return (
      <View style={styles.content}>
        {header}
        {statusQuery.isError ? (
          <View style={styles.stack}>
            <Text style={styles.error}>{t[getTotpErrorKey(statusQuery.error)]}</Text>
            <TotpSecondaryButton label="重试" onPress={() => void statusQuery.refetch()} />
          </View>
        ) : (
          <ActivityIndicator color={TOTP_PRIMARY_COLOR} />
        )}
      </View>
    );
  }

  const unavailableKey = getTotpUnavailableKey(status);
  const errorView = errorKey ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t[errorKey]}</Text> : null;

  const renderIdentity = (current: Flow) => {
    const description = current.kind === "rebind"
      ? t.rebindDescription
      : current.kind === "regenerate"
        ? t.regenerateDescription
        : current.kind === "disable"
          ? t.disableDescription
          : null;
    const confirmLabel = current.kind === "disable" ? t.disable : t.continue;
    const submit = () => {
      if (identityReady && !busy) identityMutation.mutate(current);
    };
    return (
      <View style={styles.stack}>
        {description ? <Text style={styles.help}>{description}</Text> : null}
        <TotpPasswordInput label={t.currentPassword} onChangeText={setPassword} value={password} />
        {current.kind === "enable" ? null : useRecovery ? (
          <>
            <TotpRecoveryCodeInput hint={t.recoveryCodeHint} label={t.recoveryCode} onChangeText={setRecoveryCode} onSubmit={submit} value={recoveryCode} />
            <TotpLinkButton label={t.useCode} onPress={() => { setUseRecovery(false); setRecoveryCode(""); }} />
          </>
        ) : (
          <>
            <TotpCodeInput label={t.code} onChangeText={setCode} onSubmit={submit} value={code} />
            <TotpLinkButton label={t.useRecoveryCode} onPress={() => { setUseRecovery(true); setCode(""); }} />
          </>
        )}
        {errorView}
        <TotpPrimaryButton danger={current.kind === "disable"} disabled={!identityReady} label={confirmLabel} loading={identityMutation.isPending} onPress={submit} />
        <TotpSecondaryButton disabled={busy} label={t.cancel} onPress={() => resetFlow(null)} />
      </View>
    );
  };

  const renderFlow = (current: Flow) => {
    const steps = current.kind === "enable"
      ? [t.stepVerify, t.stepBind, t.stepCodes]
      : current.kind === "rebind"
        ? [t.stepVerify, t.stepBindNew, t.stepNewCodes]
        : current.kind === "regenerate"
          ? [t.stepVerify, t.stepNewCodes]
          : null;
    const title = current.kind === "enable" ? t.enable : current.kind === "rebind" ? t.rebind : current.kind === "regenerate" ? t.regenerate : t.disable;

    return (
      <View style={styles.flowCard}>
        <Text style={styles.flowTitle}>{title}</Text>
        {steps ? <TotpStepProgress current={stepIndex(current)} steps={steps} /> : null}
        {current.step === "identity" ? renderIdentity(current) : null}
        {current.step === "bind" && current.setup ? (
          <View style={styles.stack}>
            <TotpBindStep
              code={bindCode}
              onCodeChange={setBindCode}
              onSubmit={() => { if (isCompleteTotpCode(bindCode) && !busy) verifyMutation.mutate(); }}
              setup={current.setup}
            />
            {errorView}
            <TotpPrimaryButton disabled={!isCompleteTotpCode(bindCode)} label={t.verifyAndContinue} loading={verifyMutation.isPending} onPress={() => verifyMutation.mutate()} />
            <TotpSecondaryButton disabled={busy} label={t.cancel} onPress={() => resetFlow(null)} />
          </View>
        ) : null}
        {current.step === "codes" && current.recoveryCodes ? (
          <View style={styles.stack}>
            <TotpRecoveryCodesStep
              codes={current.recoveryCodes}
              note={current.kind === "enable" ? t.enableNote : current.kind === "rebind" ? t.deleteOldEntry : undefined}
              onSavedChange={setSaved}
              saved={saved}
            />
            {errorView}
            <TotpPrimaryButton
              disabled={!saved}
              label={current.kind === "enable" ? t.enableConfirm : current.kind === "rebind" ? t.rebindConfirm : t.replaceConfirm}
              loading={confirmMutation.isPending}
              onPress={() => confirmMutation.mutate(current)}
            />
            <TotpSecondaryButton disabled={busy} label={t.cancel} onPress={() => resetFlow(null)} />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.content}>
      {header}
      {successKey && !flow ? <Text accessibilityLiveRegion="polite" style={styles.success}>{t[successKey]}</Text> : null}
      {flow ? renderFlow(flow) : status.enabled ? (
        <View style={styles.stack}>
          <TotpSecondaryButton label={t.rebind} onPress={() => startFlow("rebind")} />
          <TotpSecondaryButton label={t.regenerate} onPress={() => startFlow("regenerate")} />
          <TotpSecondaryButton danger label={t.disable} onPress={() => startFlow("disable")} />
        </View>
      ) : unavailableKey ? (
        <Text style={styles.notice}>{t[unavailableKey]}</Text>
      ) : (
        <TotpPrimaryButton label={t.enable} onPress={() => startFlow("enable")} />
      )}
    </View>
  );
};

const baseTotpSettingsStyles = StyleSheet.create({
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  stack: { gap: 12 },
  hero: { alignItems: "flex-start", backgroundColor: "transparent", flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  titleRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cardTitle: { color: "#17211a", fontSize: 16, fontWeight: "800" },
  help: { color: "#64748b", fontSize: 12, lineHeight: 18, marginTop: 3 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeOn: { backgroundColor: "#d1fae5" },
  badgeOff: { backgroundColor: "#f1f5f9" },
  badgeText: { fontSize: 11, fontWeight: "800" },
  badgeTextOn: { color: "#047857" },
  badgeTextOff: { color: "#64748b" },
  flowCard: { backgroundColor: "#ffffff", borderColor: "#dce7dd", borderRadius: 12, borderWidth: 1, gap: 14, padding: 14 },
  flowTitle: { color: "#17211a", fontSize: 15, fontWeight: "800" },
  notice: { backgroundColor: "#f8fafc", borderColor: "#e2e8f0", borderRadius: 10, borderWidth: 1, color: "#475569", fontSize: 13, lineHeight: 19, padding: 12 },
  error: { color: "#be123c", fontSize: 13, lineHeight: 19 },
  success: { color: "#15803d", fontSize: 13, fontWeight: "700", lineHeight: 19 },
});

let styles = baseTotpSettingsStyles;
let totpSettingsStylesTheme: MobileResolvedTheme = "light";

const refreshTotpSettingsThemeStyles = (theme: MobileResolvedTheme) => {
  if (totpSettingsStylesTheme !== theme) {
    styles = resolveMobileThemeStyles(baseTotpSettingsStyles, theme);
    totpSettingsStylesTheme = theme;
  }
};
