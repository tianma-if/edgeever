import { useEffect, useRef, useState } from "react";
import { ChevronRight, CloudUpload, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DesktopBackupStatus, DesktopOffsiteConfig } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { describeDesktopBackupError } from "@/lib/desktop-backup";
import { formatBytes } from "@/lib/format-bytes";

const DEFAULT_FOLDER = "/EdgeEver/backups";
const emptyConfig: DesktopOffsiteConfig = { enabled: false, url: "", username: "", folder: DEFAULT_FOLDER };

/** Status lines for the WebDAV copy, shown inside the backup status box. */
export const DesktopOffsiteStatusLines = ({ status, disabled, onUpload }: {
  status: DesktopBackupStatus;
  disabled: boolean;
  onUpload: () => void;
}) => {
  const { t } = useTranslation();
  const offsite = status.offsite;
  if (!offsite?.config.enabled) return null;
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : t("desktopBackup.never");
  return <div className="grid gap-1.5 border-t border-slate-200/70 pt-1.5" data-offsite-status>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium text-slate-800">{t("desktopBackup.offsite.lastSuccess", { time: date(offsite.lastSuccessAt) })}</p>
      {!offsite.task && status.history.length ? <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs font-normal" disabled={disabled} onClick={onUpload}><CloudUpload className="h-3.5 w-3.5" />{t("desktopBackup.offsite.uploadNow")}</Button> : null}
    </div>
    {offsite.task ? <p className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("desktopBackup.offsite.uploading", { name: offsite.task.name, sent: formatBytes(offsite.task.sent), total: formatBytes(offsite.task.total) })}</p> : offsite.lastUploaded ? <p className="break-all text-muted-foreground">{t("desktopBackup.offsite.lastUploaded", { name: offsite.lastUploaded.name, size: formatBytes(offsite.lastUploaded.size) })}</p> : null}
    {offsite.error ? <p className="break-words text-destructive" role="alert">{t("desktopBackup.offsite.failed", { message: describeDesktopBackupError(t, offsite.error) })}</p> : null}
    {offsite.warning ? <p className="text-amber-700">{describeDesktopBackupError(t, offsite.warning)}</p> : null}
  </div>;
};

/** Collapsible WebDAV settings. Saved explicitly because the fields only make sense together. */
export const DesktopOffsiteSettings = ({ status, disabled }: { status: DesktopBackupStatus; disabled: boolean }) => {
  const { t } = useTranslation();
  const bridge = window.edgeeverDesktop;
  const saved = status.offsite?.config ?? emptyConfig;
  const savedKey = JSON.stringify(saved);
  const [config, setConfig] = useState<DesktopOffsiteConfig>(saved);
  const [password, setPassword] = useState("");
  const [changePassword, setChangePassword] = useState(false);
  const [working, setWorking] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const scope = useRef(status.backupSetId);
  useEffect(() => {
    setConfig(JSON.parse(savedKey) as DesktopOffsiteConfig);
    setPassword(""); setChangePassword(false);
  }, [savedKey, status.backupSetId]);
  useEffect(() => { scope.current = status.backupSetId; setMessage(null); setWorking(null); }, [status.backupSetId]);
  if (!bridge?.backup || status.offsite === undefined) return null;
  const offsite = status.offsite;
  // The saved password only applies to the address and username it was entered for.
  const credentialsChanged = config.url.trim().replace(/\/+$/, "") !== saved.url || config.username.trim() !== saved.username;
  const passwordSet = Boolean(offsite?.passwordSet) && !credentialsChanged;
  const secureUnavailable = offsite ? !offsite.secureStorageAvailable : false;
  const passwordEditable = !passwordSet || changePassword;
  const dirty = JSON.stringify(config) !== savedKey || Boolean(password);
  const complete = Boolean(config.url.trim() && config.username.trim() && (password || passwordSet));
  const run = async (kind: "save" | "test") => {
    const expected = status.backupSetId;
    setWorking(kind); setMessage(null);
    try {
      const input = { backupSetId: expected, config, ...(password ? { password } : {}) };
      if (kind === "test") {
        await bridge.backup("offsite-test", input);
        if (scope.current === expected) setMessage({ tone: "success", text: t("desktopBackup.offsite.testComplete") });
      } else {
        await bridge.backup("offsite-save", input);
        if (scope.current === expected) { setPassword(""); setChangePassword(false); setMessage({ tone: "success", text: t("desktopBackup.offsite.saved") }); }
      }
    } catch (failure) {
      if (scope.current === expected) setMessage({ tone: "error", text: describeDesktopBackupError(t, failure) });
    } finally { if (scope.current === expected) setWorking(null); }
  };
  const field = "grid gap-1.5 text-xs font-medium text-slate-700";
  return <details className="group border-t pt-3" data-offsite-settings>
    <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700 select-none transition-colors hover:text-slate-900 list-none [&::-webkit-details-marker]:hidden">
      <ChevronRight className="h-3.5 w-3.5 text-slate-400 transition-transform duration-200 group-open:rotate-90" />
      <span>{t("desktopBackup.offsite.title")}</span>
    </summary>
    <form className="mt-3.5 grid gap-3.5" onSubmit={(event) => { event.preventDefault(); if (!working && (!config.enabled || complete)) void run("save"); }}>
      <p className="text-xs leading-5 text-muted-foreground">{t("desktopBackup.offsite.description")}</p>
      <fieldset disabled={disabled || Boolean(working)} className="grid min-w-0 gap-3.5 disabled:opacity-60">
        <label className="flex items-center justify-between gap-3 text-xs font-medium text-slate-700">
          <span>{t("desktopBackup.offsite.enable")}</span>
          <Switch checked={config.enabled} onCheckedChange={(enabled) => setConfig({ ...config, enabled })} />
        </label>
        <label className={field}><span>{t("desktopBackup.offsite.url")}</span><Input className="h-8 text-xs" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://dav.example.com/remote.php/dav/files/me" value={config.url} onChange={(event) => setConfig({ ...config, url: event.target.value })} /></label>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className={field}><span>{t("desktopBackup.offsite.username")}</span><Input className="h-8 text-xs" autoComplete="username" spellCheck={false} value={config.username} onChange={(event) => setConfig({ ...config, username: event.target.value })} /></label>
          <label className={field}><span>{t("desktopBackup.offsite.folder")}</span><Input className="h-8 font-mono text-xs" spellCheck={false} placeholder={DEFAULT_FOLDER} value={config.folder} onChange={(event) => setConfig({ ...config, folder: event.target.value })} /></label>
        </div>
        {passwordEditable
          ? <label className={field}><span>{t("desktopBackup.offsite.password")}</span><Input className="h-8 text-xs" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><span className="font-normal text-muted-foreground">{t("desktopBackup.offsite.passwordHint")}</span></label>
          : <div className="flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{t("desktopBackup.offsite.passwordSet")}</span><Button type="button" variant="ghost" size="sm" className="h-7 text-xs font-normal" onClick={() => setChangePassword(true)}>{t("desktopBackup.changePassword")}</Button></div>}
        {secureUnavailable ? <p className="text-xs text-amber-700">{t("desktopBackup.offsite.secureUnavailable")}</p> : null}
        {config.url.trim().startsWith("http://") ? <p className="text-xs text-muted-foreground">{t("desktopBackup.offsite.httpLocalOnly")}</p> : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="bg-foreground text-background hover:bg-foreground/90" disabled={disabled || Boolean(working) || !dirty || (config.enabled && !complete)}>{working === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{t("desktopBackup.offsite.save")}</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || Boolean(working) || !complete} onClick={() => void run("test")}>{working === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{t("desktopBackup.offsite.test")}</Button>
      </div>
      {message ? <p className={message.tone === "error" ? "break-words text-xs text-destructive" : "text-xs text-emerald-700"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    </form>
  </details>;
};
