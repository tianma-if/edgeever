import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TotpSetupResponse } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import {
  RecoveryCodesStep,
  StepProgress,
  TotpBindStep,
  twoFactorErrorKey,
} from "@/components/two-factor/TwoFactorSteps";
import { api } from "@/lib/api";

/**
 * Shown instead of the workspace while a recovery-code session is restricted.
 * The server rejects every business request until this finishes.
 */
export const TotpRebindScreen = ({
  isLoggingOut,
  onLogout,
  onComplete,
}: {
  isLoggingOut: boolean;
  onLogout: () => void;
  onComplete: (sessionToken: string | undefined) => Promise<void> | void;
}) => {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [stage, setStage] = useState<"bind" | "codes">("bind");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  // Batch of the codes on screen; confirm names it so a flow replaced in another tab is refused.
  const [batchId, setBatchId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusQuery = useQuery({
    queryKey: ["auth", "totp"],
    queryFn: () => api.getTotpStatus(),
    retry: false,
  });

  const startSetup = async () => {
    setError(null);
    try {
      setSetup(await api.startTotpSetup({}));
    } catch (failure) {
      setError(t(twoFactorErrorKey(failure)));
    }
  };

  // Each setup call replaces the server's pending secret, so a second
  // (StrictMode) call would leave the QR code on screen out of date.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (stage === "bind") {
        if (code.length !== 6 || !setup) return;
        const verified = await api.verifyTotpSetup({ setupId: setup.setupId, code });
        setCodes(verified.recoveryCodes);
        setBatchId(verified.batchId);
        setStage("codes");
      } else if (saved && batchId) {
        const result = await api.confirmTotpSetup({ batchId });
        await onComplete(result.sessionToken);
      }
    } catch (failure) {
      if (failure && typeof failure === "object" && "code" in failure && failure.code === "totp_setup_expired") {
        setStage("bind");
        setCode("");
        setBatchId(null);
        setSaved(false);
        await startSetup();
      }
      setError(t(twoFactorErrorKey(failure)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--workspace-canvas)] text-slate-900">
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs leading-5 text-amber-900">
        <span>{t("twoFactor.rebindBanner", { count: statusQuery.data?.recoveryCodesRemaining ?? 0 })}</span>
        <Button size="sm" variant="outline" disabled={isLoggingOut} onClick={onLogout}>
          {t("twoFactor.signOut")}
        </Button>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <main className="w-full max-w-lg rounded-lg border border-slate-200 bg-card p-6">
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <h1 className="text-sm font-semibold">{t("twoFactor.rebindRequiredTitle")}</h1>
              <p className="text-xs leading-5 text-slate-500">{t("twoFactor.rebindRequiredDescription")}</p>
            </div>
            <StepProgress
              steps={[t("twoFactor.stepBindNew"), t("twoFactor.stepNewCodes")]}
              current={stage === "bind" ? 0 : 1}
            />
            {error ? (
              <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50/80 px-3 py-2 text-xs font-medium text-rose-800">
                {error}
              </p>
            ) : null}
            {stage === "bind" && setup ? (
              <>
                <TotpBindStep setup={setup} code={code} onCodeChange={setCode} />
                <p className="text-xs text-slate-500">{t("twoFactor.deleteOldEntry")}</p>
              </>
            ) : null}
            {stage === "bind" && !setup && error ? (
              <Button type="button" variant="outline" onClick={() => void startSetup()}>
                {t("twoFactor.continue")}
              </Button>
            ) : null}
            {stage === "codes" ? <RecoveryCodesStep codes={codes} saved={saved} onSavedChange={setSaved} /> : null}
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="solid"
                disabled={busy || !setup || (stage === "bind" ? code.length !== 6 : !saved)}
              >
                {stage === "bind" ? t("twoFactor.verifyAndContinue") : t("twoFactor.rebindFinish")}
              </Button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
};
