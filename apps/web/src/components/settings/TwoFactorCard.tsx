import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Shield, ShieldCheck } from "lucide-react";
import type { TotpReauthInput, TotpSetupResponse } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  RecoveryCodeField,
  RecoveryCodesStep,
  StepProgress,
  TotpBindStep,
  TotpCodeField,
  twoFactorErrorKey,
} from "@/components/two-factor/TwoFactorSteps";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";

type FlowMode = "enable" | "rebind" | "regenerate" | "disable";
type FlowStage = "identity" | "bind" | "codes";

export const TOTP_STATUS_QUERY_KEY = ["auth", "totp"] as const;

const IdentityStep = ({
  needsCode,
  password,
  onPasswordChange,
  code,
  onCodeChange,
  recoveryCode,
  onRecoveryCodeChange,
  useRecovery,
  onUseRecoveryChange,
}: {
  needsCode: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  code: string;
  onCodeChange: (value: string) => void;
  recoveryCode: string;
  onRecoveryCodeChange: (value: string) => void;
  useRecovery: boolean;
  onUseRecoveryChange: (value: boolean) => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5 text-xs text-slate-700">
        {t("twoFactor.currentPassword")}
        <Input
          type="password"
          autoComplete="current-password"
          autoFocus
          className="h-10"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          required
        />
      </label>
      {needsCode ? (
        <div className="grid gap-1.5">
          {useRecovery ? (
            <RecoveryCodeField id="totp-reauth-recovery" value={recoveryCode} onChange={onRecoveryCodeChange} />
          ) : (
            <TotpCodeField id="totp-reauth-code" label={t("twoFactor.code")} value={code} onChange={onCodeChange} />
          )}
          <button
            type="button"
            className="justify-self-start text-xs text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
            onClick={() => onUseRecoveryChange(!useRecovery)}
          >
            {useRecovery ? t("twoFactor.useCode") : t("twoFactor.useRecoveryCode")}
          </button>
        </div>
      ) : null}
    </div>
  );
};

const TwoFactorFlowDialog = ({
  mode,
  onClose,
  onDone,
}: {
  mode: FlowMode;
  onClose: () => void;
  onDone: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const [stage, setStage] = useState<FlowStage>("identity");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [bindCode, setBindCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  // Batch of the codes on screen; confirm names it so a flow replaced in another tab is refused.
  const [batchId, setBatchId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsCode = mode !== "enable";
  const title = {
    enable: t("twoFactor.enable"),
    rebind: t("twoFactor.rebind"),
    regenerate: t("twoFactor.regenerate"),
    disable: t("twoFactor.disable"),
  }[mode];
  const steps = mode === "regenerate"
    ? [t("twoFactor.stepVerify"), t("twoFactor.stepNewCodes")]
    : [t("twoFactor.stepVerify"), mode === "rebind" ? t("twoFactor.stepBindNew") : t("twoFactor.stepBind"),
      mode === "rebind" ? t("twoFactor.stepNewCodes") : t("twoFactor.stepCodes")];
  const stageIndex = stage === "identity" ? 0 : stage === "bind" ? 1 : steps.length - 1;
  const description = {
    enable: t("twoFactor.verifyHint"),
    rebind: t("twoFactor.rebindDescription"),
    regenerate: t("twoFactor.regenerateDescription"),
    disable: t("twoFactor.disableDescription"),
  }[mode];

  const reauth = (): TotpReauthInput => ({
    password,
    ...(needsCode ? (useRecovery ? { recoveryCode: recoveryCode.trim() } : { code }) : {}),
  });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(t(twoFactorErrorKey(failure)));
    } finally {
      setBusy(false);
    }
  };

  const identityReady = Boolean(password) && (!needsCode || (useRecovery ? recoveryCode.trim().length >= 10 : code.length === 6));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (stage === "identity") {
      if (!identityReady) return;
      void run(async () => {
        if (mode === "disable") {
          await api.disableTotp(reauth());
          onDone(t("twoFactor.disabledToast"));
          return;
        }
        if (mode === "regenerate") {
          const generated = await api.regenerateRecoveryCodes(reauth());
          setCodes(generated.recoveryCodes);
          setBatchId(generated.batchId);
          setStage("codes");
          return;
        }
        setSetup(await api.startTotpSetup(reauth()));
        setStage("bind");
      });
      return;
    }
    if (stage === "bind") {
      if (bindCode.length !== 6 || !setup) return;
      void run(async () => {
        const verified = await api.verifyTotpSetup({ setupId: setup.setupId, code: bindCode });
        setCodes(verified.recoveryCodes);
        setBatchId(verified.batchId);
        setStage("codes");
      });
      return;
    }
    if (!saved || !batchId) return;
    void run(async () => {
      if (mode === "regenerate") {
        await api.confirmRecoveryCodes({ batchId });
        onDone(t("twoFactor.codesReplacedToast"));
        return;
      }
      await api.confirmTotpSetup({ batchId });
      onDone(mode === "rebind" ? t("twoFactor.reboundToast") : t("twoFactor.enabledToast"));
    });
  };

  const submitLabel = stage === "identity"
    ? (mode === "disable" ? t("twoFactor.disable") : t("twoFactor.continue"))
    : stage === "bind"
      ? t("twoFactor.verifyAndContinue")
      : mode === "regenerate"
        ? t("twoFactor.replaceConfirm")
        : mode === "rebind" ? t("twoFactor.rebindConfirm") : t("twoFactor.enableConfirm");
  const submitDisabled = busy || (stage === "identity" ? !identityReady : stage === "bind" ? bindCode.length !== 6 : !saved);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
            <DialogDescription className="text-xs leading-5">{description}</DialogDescription>
          </DialogHeader>
          {mode !== "disable" ? <StepProgress steps={steps} current={stageIndex} /> : null}
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50/80 px-3 py-2 text-xs font-medium text-rose-800">
              {error}
            </p>
          ) : null}
          {stage === "identity" ? (
            <IdentityStep
              needsCode={needsCode}
              password={password}
              onPasswordChange={setPassword}
              code={code}
              onCodeChange={setCode}
              recoveryCode={recoveryCode}
              onRecoveryCodeChange={setRecoveryCode}
              useRecovery={useRecovery}
              onUseRecoveryChange={setUseRecovery}
            />
          ) : null}
          {stage === "bind" && setup ? <TotpBindStep setup={setup} code={bindCode} onCodeChange={setBindCode} /> : null}
          {stage === "codes" ? (
            <>
              <RecoveryCodesStep codes={codes} saved={saved} onSavedChange={setSaved} />
              {mode === "enable" ? <p className="text-xs text-slate-500">{t("twoFactor.enableNote")}</p> : null}
            </>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("twoFactor.cancel")}
            </Button>
            <Button type="submit" variant={mode === "disable" ? "danger" : "solid"} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const formatEnabledAt = (value: string | null, locale: string | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
};

export const TwoFactorCard = ({ authRequired }: { authRequired: boolean }) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<FlowMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusQuery = useQuery({
    queryKey: TOTP_STATUS_QUERY_KEY,
    queryFn: () => api.getTotpStatus(),
    enabled: authRequired,
    retry: false,
  });

  if (!authRequired) return null;

  const status = statusQuery.data;
  const enabled = status?.enabled === true;
  const unavailableMessage = status && !status.available && !enabled
    ? status.unavailableReason === "demo" ? t("twoFactor.unavailableDemo") : t("twoFactor.unavailableEncryption")
    : null;

  const finish = (message: string) => {
    setMode(null);
    setNotice(message);
    void queryClient.invalidateQueries({ queryKey: TOTP_STATUS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
  };

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className={cn(SETTINGS_CARD_HEADER_CLASSNAME, "flex-row flex-wrap items-center justify-between gap-3")}>
        <div className="min-w-0 flex-1 basis-80">
          <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
            {enabled
              ? <ShieldCheck className={SETTINGS_CARD_ICON_CLASSNAME} />
              : <Shield className={SETTINGS_CARD_ICON_CLASSNAME} />}
            {t("twoFactor.title")}
            {status ? (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  enabled ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-900",
                )}
              >
                {enabled ? t("twoFactor.statusOn") : t("twoFactor.statusOff")}
              </span>
            ) : null}
          </CardTitle>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            {enabled
              ? t("twoFactor.enabledSummary", {
                date: formatEnabledAt(status.enabledAt, i18n.resolvedLanguage),
                count: status.recoveryCodesRemaining,
              })
              : unavailableMessage ?? t("twoFactor.description")}
          </p>
        </div>
        {status && !enabled && status.available ? (
          <Button size="sm" variant="outline" onClick={() => { setNotice(null); setMode("enable"); }}>
            {t("twoFactor.enable")}
          </Button>
        ) : null}
      </CardHeader>
      {enabled || notice ? (
        <CardContent className="grid gap-2 p-4 pt-0">
          {enabled ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setNotice(null); setMode("rebind"); }}>
                {t("twoFactor.rebind")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setNotice(null); setMode("regenerate"); }}>
                {t("twoFactor.regenerate")}
              </Button>
              <Button size="sm" variant="danger" onClick={() => { setNotice(null); setMode("disable"); }}>
                {t("twoFactor.disable")}
              </Button>
            </div>
          ) : null}
          {notice ? <p role="status" className="text-xs font-medium text-emerald-700">{notice}</p> : null}
        </CardContent>
      ) : null}
      {mode ? <TwoFactorFlowDialog mode={mode} onClose={() => setMode(null)} onDone={finish} /> : null}
    </Card>
  );
};
