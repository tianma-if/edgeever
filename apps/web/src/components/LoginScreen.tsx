import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveInstanceUrlInput } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { GitHubRepositoryLink } from "@/components/GitHubRepositoryLink";
import { Input } from "@/components/ui/input";

interface LoginScreenProps {
  error: { message: string; diagnosticCode: string; rayId?: string } | null;
  instanceUrl?: string;
  isSubmitting: boolean;
  onSubmit: (payload: { instanceUrl?: string; username: string; password: string }) => void;
}

const DEMO_LOGIN_CREDENTIALS = {
  username: "ee-demo",
  password: "demo#dZ6Q29Zjfor%",
};

const getDefaultLoginCredentials = () => {
  const hostname = window.location.hostname;
  const isDemoHost = hostname === "demo.edgeever.org" || hostname.startsWith("edgeever-demo.");

  return isDemoHost ? DEMO_LOGIN_CREDENTIALS : { username: "admin", password: "" };
};

export const LoginScreen = ({ error, instanceUrl: initialInstanceUrl, isSubmitting, onSubmit }: LoginScreenProps) => {
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
      ...(initialInstanceUrl !== undefined ? { instanceUrl: resolveInstanceUrlInput(instanceUrl) } : {}),
      username: username.trim(),
      password,
    });
  };

  return (
    <main className="flex h-[100dvh] items-center justify-center bg-gradient-to-tr from-emerald-50/70 via-emerald-50 to-emerald-100 px-4 py-8 text-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgb(var(--brand-green-rgb)/0.06),transparent_45%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgb(var(--brand-green-rgb)/0.04),transparent_55%)] pointer-events-none" />
      <GitHubRepositoryLink className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-10 w-10 justify-center rounded-full border border-slate-200 bg-white/85 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70" iconClassName="h-5 w-5" />
      
      <section className="relative w-full max-w-[400px] rounded-2xl border border-emerald-500/15 bg-white/95 p-8 shadow-[0_20px_50px_rgb(var(--brand-green-rgb)/0.08)] backdrop-blur-md transition-all duration-300 hover:shadow-[0_24px_60px_rgb(var(--brand-green-rgb)/0.12)]">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-[0_8px_16px_-4px_rgb(var(--brand-green-rgb)/0.35)]">
            <LockKeyhole className="h-5.5 w-5.5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight tracking-tight text-slate-900">{t("login.title")}</h1>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">{t("login.subtitle")}</p>
          </div>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          {error ? (
            <div
              className="rounded-lg border border-rose-100 bg-rose-50/80 px-3.5 py-3 text-rose-800 transition duration-150 animate-shake"
              role="alert"
            >
              <p className="text-sm font-medium leading-6">{error.message}</p>
              <p className="mt-1 font-mono text-[11px] text-rose-500">
                {t("login.diagnosticCode", { code: error.diagnosticCode })}
              </p>
              {error.rayId ? (
                <p className="mt-0.5 break-all font-mono text-[11px] text-rose-500">
                  {t("login.cloudflareRayId", { id: error.rayId })}
                </p>
              ) : null}
            </div>
          ) : null}

          {initialInstanceUrl !== undefined ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">{t("login.desktopInstanceUrl")}</span>
              <Input
                autoComplete="url"
                className="h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-emerald-500/10"
                placeholder={t("login.instanceUrlPlaceholder")}
                required
                type="url"
                value={instanceUrl}
                onChange={(event) => setInstanceUrl(event.target.value)}
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">{t("login.username")}</span>
            <Input
              autoComplete="username"
              className="h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-emerald-500/10"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">{t("login.password")}</span>
            <Input
              autoComplete="current-password"
              className="h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-emerald-500/10"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <Button 
            className="w-full h-11 justify-center rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-all duration-200 shadow-[0_8px_20px_-4px_rgb(var(--brand-green-rgb)/0.25)] hover:shadow-[0_12px_24px_-4px_rgb(var(--brand-green-rgb)/0.35)]"
            size="md" 
            type="submit" 
            variant="solid" 
            disabled={isSubmitting}
          >
            <LockKeyhole className="h-4 w-4 mr-1" />
            {isSubmitting ? t("login.submitting") : t("login.submit")}
          </Button>
        </form>
      </section>
    </main>
  );
};
