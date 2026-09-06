import { useState } from "react";
import { AlertCircle, CheckCircle2, CloudUpload, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { createEdgeEverZipTemporaryFile, EdgeEverZipMemoryLimitError, type EdgeEverZipProgress } from "@/lib/json-backup";
import {
  loadWebDavBackupConfig,
  loadWebDavBackupPassword,
  loadWebDavBackupSchedule,
  saveWebDavBackupConfig,
  saveWebDavBackupPassword,
  saveWebDavBackupSchedule,
  testWebDavConnection,
  uploadWebDavBackup,
  WEBDAV_AUTO_BACKUP_ENABLED,
  type WebDavBackupConfig,
  type WebDavBackupSchedule,
} from "@/lib/webdav-backup";

type OperationState = "idle" | "working" | "complete" | "error";
type OperationKind = "webdav" | "webdav-test";

const Progress = ({ progress }: { progress: EdgeEverZipProgress }) => {
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${percentage}%` }} />
    </div>
  );
};

export const WebDavBackupCard = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<OperationState>("idle");
  const [operation, setOperation] = useState<OperationKind>("webdav");
  const [progress, setProgress] = useState<EdgeEverZipProgress>({ completed: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [config, setConfig] = useState<WebDavBackupConfig>(loadWebDavBackupConfig);
  const [password, setPassword] = useState(loadWebDavBackupPassword);
  const [schedule, setSchedule] = useState<WebDavBackupSchedule>(loadWebDavBackupSchedule);
  const busy = state === "working";

  const persistSettings = () => {
    const normalized = saveWebDavBackupConfig(config);
    saveWebDavBackupPassword(WEBDAV_AUTO_BACKUP_ENABLED && schedule.enabled ? password : "");
    saveWebDavBackupSchedule(schedule);
    setConfig(normalized);
    return normalized;
  };

  const describeError = (error: unknown) => {
    if (error instanceof EdgeEverZipMemoryLimitError) return t("dataExport.webdavErrors.largeBackupRequiresStreaming");
    if (error instanceof TypeError) return t("dataExport.webdavErrors.network");
    if (error instanceof Error && error.message) return error.message;
    return t("dataExport.webdavErrors.unknown");
  };

  const handleTest = async () => {
    setOperation("webdav-test");
    setState("working");
    setMessage(null);
    try {
      const normalized = persistSettings();
      await testWebDavConnection(normalized, password);
      setState("complete");
    } catch (error) {
      console.error("Failed to test WebDAV connection", error);
      setMessage(describeError(error));
      setState("error");
    }
  };

  const handleBackup = async () => {
    setOperation("webdav");
    setState("working");
    setProgress({ completed: 0, total: 0 });
    setMessage(null);
    try {
      const normalized = persistSettings();
      const temporary = await createEdgeEverZipTemporaryFile(
        { listNotebooks: api.listNotebooks, listPrompts: api.listAiPrompts, getPage: api.getJsonBackupPage, getResourceResponse: api.getResourceResponse },
        { edgeeverVersion: __EDGEEVER_APP_VERSION__, buildId: __EDGEEVER_BUILD_ID__ },
        setProgress
      );
      const result = await uploadWebDavBackup(normalized, password, temporary.file)
        .finally(temporary.cleanup);
      const nextSchedule = { ...schedule, lastSuccessAt: new Date().toISOString() };
      saveWebDavBackupSchedule(nextSchedule);
      setSchedule(nextSchedule);
      setMessage(t("dataExport.webdavComplete", { filename: result.filename }));
      setState("complete");
    } catch (error) {
      console.error("Failed to upload WebDAV backup", error);
      setMessage(describeError(error));
      setState("error");
    }
  };

  const updateSchedule = (patch: Partial<WebDavBackupSchedule>) => {
    setSchedule((current) => {
      const next = { ...current, ...patch };
      saveWebDavBackupSchedule(next);
      return next;
    });
  };

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className="p-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm"><CloudUpload className="h-4 w-4 text-emerald-700" />{t("dataExport.webdavTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 pt-0">
        <CardDescription className="text-xs leading-5">{t(WEBDAV_AUTO_BACKUP_ENABLED ? "dataExport.webdavDescription" : "dataExport.webdavManualDescription")}</CardDescription>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("dataExport.webdavUrl")}<Input value={config.url} placeholder="https://cloud.example.com/remote.php/dav/files/user" disabled={busy} onChange={(event) => setConfig((current) => ({ ...current, url: event.target.value }))} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("dataExport.webdavPath")}<Input value={config.remotePath} placeholder="/EdgeEver/backups" disabled={busy} onChange={(event) => setConfig((current) => ({ ...current, remotePath: event.target.value }))} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("dataExport.webdavUsername")}<Input value={config.username} autoComplete="username" disabled={busy} onChange={(event) => setConfig((current) => ({ ...current, username: event.target.value }))} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("dataExport.webdavPassword")}<Input type="password" value={password} autoComplete="current-password" disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
          {WEBDAV_AUTO_BACKUP_ENABLED ? (
            <>
              <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("dataExport.webdavInterval")}
                <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" value={schedule.intervalDays} disabled={busy} onChange={(event) => updateSchedule({ intervalDays: Number(event.target.value) as WebDavBackupSchedule["intervalDays"] })}>
                  <option value={1}>{t("dataExport.webdavIntervals.daily")}</option><option value={7}>{t("dataExport.webdavIntervals.weekly")}</option><option value={14}>{t("dataExport.webdavIntervals.biweekly")}</option><option value={30}>{t("dataExport.webdavIntervals.monthly")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={schedule.enabled} disabled={busy} onChange={(event) => updateSchedule({ enabled: event.target.checked })} />{t("dataExport.webdavEnableAuto")}</label>
            </>
          ) : null}
        </div>
        <p className="text-[11px] leading-4 text-slate-500">{t(WEBDAV_AUTO_BACKUP_ENABLED ? "dataExport.webdavSecurityNote" : "dataExport.webdavManualSecurityNote")}</p>
        {WEBDAV_AUTO_BACKUP_ENABLED && schedule.enabled ? <p className="text-[11px] leading-4 text-emerald-700">{schedule.lastSuccessAt ? t("dataExport.webdavLastSuccess", { time: new Date(schedule.lastSuccessAt).toLocaleString() }) : t("dataExport.webdavWaitingForFirstBackup")}</p> : null}
        {busy ? <div className="grid gap-1.5" aria-live="polite"><div className="flex items-center justify-between text-xs text-slate-500"><span>{t("dataExport.webdavWorking")}</span><span>{t("dataExport.progress", { completed: progress.completed, total: progress.total })}</span></div><Progress progress={progress} /></div> : null}
        {state === "complete" ? <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{operation === "webdav-test" ? t("dataExport.webdavTestComplete") : message}</p> : null}
        {state === "error" ? <p className="flex items-center gap-1.5 text-xs text-red-600" role="alert"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{message}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row"><Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => void handleTest()}><Wifi className="h-4 w-4" />{t("dataExport.webdavTest")}</Button><Button size="sm" type="button" disabled={busy} onClick={() => void handleBackup()}><CloudUpload className="h-4 w-4" />{t("dataExport.webdavBackup")}</Button></div>
      </CardContent>
    </Card>
  );
};
