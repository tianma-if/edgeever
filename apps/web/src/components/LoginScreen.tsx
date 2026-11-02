import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeInstanceUrl } from "@edgeever/shared/public-demo";
import { Button } from "@/components/ui/button";
import { GitHubRepositoryLink } from "@/components/GitHubRepositoryLink";
import { Input } from "@/components/ui/input";

export type MfaLoginStepProps = {
  username: string;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: { code: string } | { recoveryCode: string }) => void;
  onBack: () => void;
};

interface LoginScreenProps {
  error: { message: string; diagnosticCode: string; rayId?: string } | null;
  instanceUrl?: string;
  isSubmitting: boolean;
  onSubmit: (payload: { instanceUrl?: string; username: string; password: string }) => void;
  /** Second step after the password was accepted for a TOTP account. */
  mfa?: MfaLoginStepProps | null;
}

const LOGIN_INPUT_CLASSNAME = "h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-slate-900/10";
const LOGIN_SUBMIT_CLASSNAME = "h-11 w-full justify-center rounded-lg bg-emerald-500 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(var(--brand-green-rgb)/0.35)] transition-colors duration-200 hover:bg-emerald-600";
const LOGIN_LINK_CLASSNAME = "text-xs text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline";

const MfaLoginForm = ({ username, isSubmitting, error, onSubmit, onBack }: MfaLoginStepProps) => {
  const { t } = useTranslation();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (useRecovery) {
      if (recoveryCode.trim().length >= 10) onSubmit({ recoveryCode: recoveryCode.trim() });
    } else if (code.length === 6) {
      onSubmit({ code });
    }
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {error ? (
        <div className="rounded-lg border border-rose-100 bg-rose-50/80 px-3.5 py-3 text-rose-800" role="alert">
          <p className="text-sm font-medium leading-6">{error}</p>
        </div>
      ) : null}
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-700">
          {useRecovery ? t("twoFactor.loginRecoveryTitle") : t("twoFactor.loginTitle")}
        </h2>
        <p className="text-xs leading-5 text-slate-500">
          {useRecovery ? t("twoFactor.loginRecoveryDescription") : t("twoFactor.loginDescription", { username })}
        </p>
      </div>
      {useRecovery ? (
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">{t("twoFactor.recoveryCode")}</span>
          <Input
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            className={`${LOGIN_INPUT_CLASSNAME} font-mono tracking-wider`}
            maxLength={32}
            spellCheck={false}
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
          />
          <span className="mt-1.5 block text-xs text-slate-500">{t("twoFactor.recoveryCodeHint")}</span>
        </label>
      ) : (
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">{t("twoFactor.loginCode")}</span>
          <Input
            autoFocus
            autoComplete="one-time-code"
            className={`${LOGIN_INPUT_CLASSNAME} text-center font-mono text-xl tracking-[0.5em]`}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>
      )}
      <Button
        className={LOGIN_SUBMIT_CLASSNAME}
        size="md"
        type="submit"
        variant="solid"
        disabled={isSubmitting || (useRecovery ? recoveryCode.trim().length < 10 : code.length !== 6)}
      >
        <LockKeyhole className="h-4 w-4 mr-1" />
        {isSubmitting
          ? t("twoFactor.loginVerifying")
          : useRecovery ? t("twoFactor.loginRecoverySubmit") : t("twoFactor.loginVerify")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className={LOGIN_LINK_CLASSNAME} onClick={() => setUseRecovery((value) => !value)}>
          {useRecovery ? t("twoFactor.useCode") : t("twoFactor.useRecoveryCode")}
        </button>
        <button type="button" className={LOGIN_LINK_CLASSNAME} disabled={isSubmitting} onClick={onBack}>
          {t("twoFactor.loginBackToPassword")}
        </button>
      </div>
    </form>
  );
};

const DEMO_LOGIN_CREDENTIALS = {
  username: "ee-demo",
  password: "demo#dZ6Q29Zjfor%",
};

const getDefaultLoginCredentials = () => {
  const hostname = window.location.hostname;
  const isDemoHost = hostname === "demo.edgeever.org" || hostname.startsWith("edgeever-demo.");

  return isDemoHost ? DEMO_LOGIN_CREDENTIALS : { username: "", password: "" };
};

export const LoginScreen = ({ error, instanceUrl: initialInstanceUrl, isSubmitting, onSubmit, mfa }: LoginScreenProps) => {
  const { t } = useTranslation();
  const [instanceUrl, setInstanceUrl] = useState(initialInstanceUrl ?? "");
  const [username, setUsername] = useState(() => getDefaultLoginCredentials().username);
  const [password, setPassword] = useState(() => getDefaultLoginCredentials().password);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if ((initialInstanceUrl !== undefined && !instanceUrl.trim()) || !username.trim() || !password) {
      return;
    }

    onSubmit({
      ...(initialInstanceUrl !== undefined ? { instanceUrl: normalizeInstanceUrl(instanceUrl) } : {}),
      username: username.trim(),
      password,
    });
  };

  return (
    <main className="flex h-[100dvh] items-center justify-center bg-[var(--workspace-canvas)] px-4 py-8 text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgb(var(--brand-green-rgb)/0.045),transparent_42%)]" />
      <GitHubRepositoryLink className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-10 w-10 justify-center rounded-full border border-slate-200 bg-card/85 text-slate-600 backdrop-blur transition hover:border-slate-300 hover:bg-card hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20" iconClassName="h-5 w-5" />

      <section className="relative w-full max-w-[400px] rounded-2xl border border-slate-200 bg-card/95 p-8 shadow-[0_20px_50px_rgb(0_0_0/0.08)] backdrop-blur-md">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-[0_8px_18px_-8px_rgb(var(--brand-green-rgb)/0.45)]">
            <LockKeyhole className="h-5.5 w-5.5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight tracking-tight text-slate-900">{t("login.title")}</h1>
            <p className="mt-1 text-xs font-medium tracking-wide text-slate-500">{t("login.subtitle")}</p>
          </div>
        </div>

        {mfa ? <MfaLoginForm {...mfa} /> : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          {error ? (
            <div
              className="rounded-lg border border-rose-100 bg-rose-50/80 px-3.5 py-3 text-rose-800 transition duration-150 animate-shake"
              role="alert"
            >
              <p className="text-sm font-medium leading-6">{error.message}</p>
              <p className="mt-1 font-mono text-xs text-rose-500">
                {t("login.diagnosticCode", { code: error.diagnosticCode })}
              </p>
              {error.rayId ? (
                <p className="mt-0.5 break-all font-mono text-xs text-rose-500">
                  {t("login.cloudflareRayId", { id: error.rayId })}
                </p>
              ) : null}
            </div>
          ) : null}

          {initialInstanceUrl !== undefined ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">{t("login.desktopInstanceUrl")}</span>
              <Input
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                className="h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-slate-900/10"
                inputMode="url"
                placeholder={t("login.instanceUrlPlaceholder")}
                required
                spellCheck={false}
                value={instanceUrl}
                onChange={(event) => setInstanceUrl(event.target.value)}
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">{t("login.username")}</span>
            <Input
              autoComplete="username"
              className="h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-slate-900/10"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">{t("login.password")}</span>
            <Input
              autoComplete="current-password"
              className="h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-slate-900/10"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <Button
            className="h-11 w-full justify-center rounded-lg bg-emerald-500 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(var(--brand-green-rgb)/0.35)] transition-colors duration-200 hover:bg-emerald-600"
            size="md"
            type="submit"
            variant="solid"
            disabled={isSubmitting}
          >
            <LockKeyhole className="h-4 w-4 mr-1" />
            {isSubmitting ? t("login.submitting") : t("login.submit")}
          </Button>
        </form>
        )}
      </section>
    </main>
  );
};
