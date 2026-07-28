import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Database, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type LocalBackup = { path: string; name: string; size: number; modifiedAt: string };
type OperationState = "idle" | "working" | "complete" | "error";

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const DesktopLocalBackupCard = () => {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<LocalBackup[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [state, setState] = useState<OperationState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const bridge = window.edgeeverDesktop;

  const refresh = useCallback(async () => {
    if (!bridge?.isAvailable) return;
    try {
      const result = await bridge.sidecarRequest<{ backups: LocalBackup[] }>("storage.backups", {});
      setBackups(result.backups);
      setSelectedPath((current) => result.backups.some((backup) => backup.path === current) ? current : (result.backups[0]?.path ?? ""));
    } catch {
      setState("error");
      setMessage(t("dataExport.desktopLocalError"));
    }
  }, [bridge, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (method: "storage.backup" | "storage.restore") => {
    if (!bridge?.isAvailable) return;
    if (method === "storage.restore" && (!selectedPath || !window.confirm(t("dataExport.desktopLocalRestoreConfirm")))) return;
    setState("working");
    setMessage(null);
    try {
      const result = await bridge.sidecarRequest<{ ok: true; path: string }>(method, method === "storage.restore" ? { path: selectedPath } : {});
      await refresh();
      setState("complete");
      setMessage(method === "storage.restore" ? t("dataExport.desktopLocalProtectedBackup", { name: result.path.split(/[\\/]/).pop() }) : t("dataExport.desktopLocalSuccess"));
      if (method === "storage.restore") window.setTimeout(() => window.location.reload(), 350);
    } catch {
      setState("error");
      setMessage(t("dataExport.desktopLocalError"));
    }
  };

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className="p-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm"><Database className="h-4 w-4 text-emerald-700" />{t("dataExport.desktopLocalTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 pt-0">
        <CardDescription className="text-xs leading-5">{t("dataExport.desktopLocalDescription")}</CardDescription>
        {backups.length > 0 ? (
          <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" value={selectedPath} disabled={state === "working"} onChange={(event) => setSelectedPath(event.target.value)}>
            {backups.map((backup) => <option key={backup.path} value={backup.path}>{backup.name} · {formatSize(backup.size)}</option>)}
          </select>
        ) : <p className="text-xs text-slate-500">{state === "working" ? t("dataExport.desktopLocalRefreshing") : t("dataExport.desktopLocalEmpty")}</p>}
        {message && <p className={`flex items-center gap-1.5 text-xs ${state === "error" ? "text-red-600" : "text-emerald-700"}`} role={state === "error" ? "alert" : undefined}>{state === "error" ? <AlertCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{message}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="sm" variant="outline" type="button" disabled={state === "working"} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />{t("common.refresh")}</Button>
          <Button size="sm" type="button" disabled={state === "working"} onClick={() => void run("storage.backup")}><Database className="h-4 w-4" />{t("dataExport.desktopLocalBackup")}</Button>
          <Button size="sm" variant="outline" type="button" disabled={state === "working" || !selectedPath} onClick={() => void run("storage.restore")}>{t("dataExport.desktopLocalRestore")}</Button>
        </div>
      </CardContent>
    </Card>
  );
};
