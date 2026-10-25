import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { SETTINGS_ITEM_DESCRIPTION_CLASSNAME, SETTINGS_ITEM_TITLE_CLASSNAME } from "./settings-ui";

// Lucide Power draws an asymmetric arc and a stem that crowds the opening at 16px.
const StartupPowerIcon = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height="24"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="24"
  >
    <path d="M12 3v6.2" />
    <path d="M16.76 6.93a7.4 7.4 0 1 1-9.51 0" />
  </svg>
);

type LoginItemLaunchMode = "window" | "tray";

interface LoginItemState {
  supported: boolean;
  openAtLogin: boolean;
  launchMode: LoginItemLaunchMode;
  status: string;
  error?: string;
}

// Packaged desktop is the only place this setting can change the OS. Local web
// dev still shows the row so the layout can be previewed.
const devPreviewState = (): LoginItemState | null => (
  import.meta.env.DEV && typeof window !== "undefined" && !window.edgeeverDesktop?.loginItem
    ? { supported: true, openAtLogin: false, launchMode: "window", status: "disabled" }
    : null
);

export const LoginItemSettingsItem = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<LoginItemState | null>(devPreviewState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const bridge = window.edgeeverDesktop;
    if (!bridge?.loginItem) return undefined;
    let cancelled = false;
    void bridge.loginItem().then((next) => {
      if (!cancelled && next) setState(next);
    }).catch(() => {
      if (!cancelled) setState(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state?.supported) return null;

  const approvalNotice = state.status === "requires-approval" ? t("settings.loginItem.requiresApproval") : "";

  const update = async (patch: { openAtLogin: boolean }) => {
    const bridge = window.edgeeverDesktop;
    if (!bridge?.setLoginItem) {
      setState((current) => {
        if (!current || !import.meta.env.DEV) return current;
        return {
          ...current,
          openAtLogin: patch.openAtLogin,
          launchMode: "window",
          status: patch.openAtLogin ? "enabled" : "disabled",
        };
      });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await bridge.setLoginItem(patch);
      if (next) setState(next);
      setError(next?.error ? t("settings.loginItem.saveFailed") : "");
    } catch {
      setError(t("settings.loginItem.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <StartupPowerIcon className="h-4 w-4 shrink-0 text-slate-500" />
        <div className="min-w-0">
          <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.loginItem.title")}</div>
          {approvalNotice ? <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{approvalNotice}</p> : null}
          {error ? <p role="status" className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{error}</p> : null}
        </div>
      </div>
      <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
        <Switch
          checked={state.openAtLogin}
          disabled={busy}
          onCheckedChange={(openAtLogin) => { void update({ openAtLogin }); }}
          aria-label={t("settings.loginItem.aria")}
        />
      </div>
    </div>
  );
};
