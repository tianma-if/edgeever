import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Power } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SETTINGS_ITEM_DESCRIPTION_CLASSNAME, SETTINGS_ITEM_TITLE_CLASSNAME } from "./settings-ui";

type LoginItemLaunchMode = "window" | "tray";

interface LoginItemState {
  supported: boolean;
  openAtLogin: boolean;
  launchMode: LoginItemLaunchMode;
  status: string;
  error?: string;
}

export const LoginItemSettingsItem = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<LoginItemState | null>(null);
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

  const update = async (patch: { openAtLogin?: boolean; launchMode?: LoginItemLaunchMode }) => {
    const bridge = window.edgeeverDesktop;
    if (!bridge?.setLoginItem) return;
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
    <>
      <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Power className="h-4 w-4 shrink-0 text-slate-500" />
          <div className="min-w-0">
            <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.loginItem.title")}</div>
            <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>
              {state.status === "requires-approval"
                ? t("settings.loginItem.requiresApproval")
                : t("settings.loginItem.description")}
            </p>
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
      {state.openAtLogin ? (
        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-4 w-4 shrink-0" />
            <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.loginItem.launchModeLabel")}</div>
          </div>
          <div className="w-full shrink-0 sm:w-80">
            <Select
              value={state.launchMode}
              disabled={busy}
              onValueChange={(launchMode) => { void update({ launchMode: launchMode as LoginItemLaunchMode }); }}
            >
              <SelectTrigger aria-label={t("settings.loginItem.launchModeLabel")} className="h-9 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="window">{t("settings.loginItem.launchModeWindow")}</SelectItem>
                <SelectItem value="tray">{t("settings.loginItem.launchModeTray")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </>
  );
};
