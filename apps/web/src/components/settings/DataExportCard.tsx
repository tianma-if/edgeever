import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, DatabaseBackup, Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiRequestError } from "@/lib/api";
import {
  EdgeEverZipImportError,
  EdgeEverZipMemoryLimitError,
  parseEdgeEverZip,
  restoreEdgeEverZipAndRefresh,
  saveEdgeEverZip,
  type EdgeEverZipProgress,
  type ParsedEdgeEverZip,
} from "@/lib/json-backup";

type DataExportCardProps = {
  refreshWorkspaceAfterImport: () => Promise<void>;
};

type OperationState = "idle" | "working" | "complete" | "error";
type OperationKind = "export" | "import";

const Progress = ({ progress }: { progress: EdgeEverZipProgress }) => {
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${percentage}%` }} />
    </div>
  );
};

export const DataExportCard = ({ refreshWorkspaceAfterImport }: DataExportCardProps) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<OperationState>("idle");
  const [operation, setOperation] = useState<OperationKind>("export");
  const [scanningImport, setScanningImport] = useState(false);
  const [progress, setProgress] = useState<EdgeEverZipProgress>({ completed: 0, total: 0 });
  const [pendingImport, setPendingImport] = useState<ParsedEdgeEverZip | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const busy = state === "working";

  const describeImportError = (error: unknown) => {
    if (error instanceof EdgeEverZipImportError) {
      switch (error.code) {
        case "invalidZip": return t("dataExport.importErrors.invalidZip");
        case "missingManifest": return t("dataExport.importErrors.missingManifest");
        case "unsupportedFormat": return t("dataExport.importErrors.unsupportedFormat");
        case "unsupportedVersion": return t("dataExport.importErrors.unsupportedVersion");
        case "invalidManifest": return t("dataExport.importErrors.invalidManifest");
        case "missingData": return t("dataExport.importErrors.missingData");
        case "invalidData": return t("dataExport.importErrors.invalidData");
        case "incompleteData": return t("dataExport.importErrors.incompleteData");
        case "incompleteResources": return t("dataExport.importErrors.incompleteResources");
      }
    }
    if (error instanceof ApiRequestError) {
      return t("dataExport.importErrors.serverRejected", { message: error.message });
    }
    if (error instanceof TypeError) {
      return t("dataExport.importErrors.network");
    }
    return t("dataExport.importErrors.unknown");
  };

  const handleExport = async () => {
    setOperation("export");
    setState("working");
    setProgress({ completed: 0, total: 0 });
    setScanningImport(false);
    setErrorMessage(null);
    try {
      await saveEdgeEverZip(
        { listNotebooks: api.listNotebooks, listPrompts: api.listAiPrompts, getPage: api.getJsonBackupPage, getResourceResponse: api.getResourceResponse },
        { edgeeverVersion: __EDGEEVER_APP_VERSION__, buildId: __EDGEEVER_BUILD_ID__ },
        setProgress
      );
      setState("complete");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setState("idle");
        return;
      }
      console.error("Failed to export EdgeEver ZIP", error);
      setErrorMessage(error instanceof EdgeEverZipMemoryLimitError
        ? t("dataExport.largeBackupRequiresStreaming")
        : t("dataExport.error"));
      setState("error");
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setOperation("import");
    setState("working");
    setProgress({ completed: 0, total: 0 });
    setScanningImport(true);
    setErrorMessage(null);
    try {
      const parsed = await parseEdgeEverZip(file, (percentage) => {
        setProgress({ completed: percentage, total: 100 });
      });
      setPendingImport(parsed);
      setState("idle");
    } catch (error) {
      console.error("Invalid EdgeEver ZIP", error);
      setErrorMessage(describeImportError(error));
      setState("error");
    } finally {
      setScanningImport(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    const archive = pendingImport;
    setPendingImport(null);
    setOperation("import");
    setState("working");
    setProgress({ completed: 0, total: 0 });
    setScanningImport(false);
    setErrorMessage(null);
    try {
      await restoreEdgeEverZipAndRefresh(
        archive,
        {
          restoreNotebooks: api.restoreJsonNotebooks,
          restoreMemos: api.restoreJsonMemos,
          restorePrompts: api.restoreJsonAiPrompts,
          createResourceRestoreSink: api.createJsonResourceRestoreSink,
        },
        refreshWorkspaceAfterImport,
        setProgress
      );
      setState("complete");
    } catch (error) {
      console.error("Failed to import EdgeEver ZIP", error);
      setErrorMessage(describeImportError(error));
      setState("error");
    }
  };

  return (
    <>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                <DatabaseBackup className={SETTINGS_CARD_ICON_CLASSNAME} />
                {t("dataExport.title")}
              </CardTitle>
              <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>
                {t("dataExport.description")}
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                {t("dataExport.importButton")}
              </Button>
              <Button size="sm" type="button" disabled={busy} onClick={() => void handleExport()}>
                <Download className="h-4 w-4" />
                {t("dataExport.exportButton")}
              </Button>
              <input ref={fileInputRef} className="hidden" type="file" accept=".zip,application/zip" onChange={(event) => void handleImportFile(event.target.files?.[0])} />
            </div>
          </div>
        </CardHeader>
        {(busy || state === "complete" || state === "error") && (
          <CardContent className="grid gap-3 p-4 pt-0 sm:px-5">
            {busy ? (
              <div className="grid gap-1.5" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{operation === "import" ? t(scanningImport ? "dataExport.scanning" : "dataExport.importing") : t("dataExport.working")}</span>
                  <span>{scanningImport
                    ? t("dataExport.scanProgress", { percentage: progress.completed })
                    : t("dataExport.progress", { completed: progress.completed, total: progress.total })}</span>
                </div>
                <Progress progress={progress} />
              </div>
            ) : null}
            {state === "complete" ? <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{operation === "import" ? t("dataExport.importComplete") : t("dataExport.complete")}</p> : null}
            {state === "error" ? <p className="flex items-center gap-1.5 text-xs text-red-600" role="alert"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{errorMessage}</p> : null}
          </CardContent>
        )}
      </Card>

      <Dialog open={Boolean(pendingImport)} onOpenChange={(open) => { if (!open) setPendingImport(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dataExport.importConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("dataExport.importConfirmDescription", {
                memos: pendingImport?.manifest.counts.memos ?? 0,
                resources: pendingImport?.manifest.counts.resources ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setPendingImport(null)}>{t("common.cancel")}</Button>
            <Button type="button" onClick={() => void handleConfirmImport()}>{t("dataExport.confirmImport")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
