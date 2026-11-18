import { useSyncExternalStore } from "react";
import { ChevronRight, FileText, LoaderCircle, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NoteImportController } from "@/lib/note-import/controller";
import { getImportSources } from "./import-sources";
import {
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
export const ThirdPartyImportCard = ({ controller, defaultNotebookId }: { controller: NoteImportController; defaultNotebookId: string | null }) => {
  const { t, i18n } = useTranslation();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const running = state.phase === "running" || state.phase === "scanning";
  const importSources = Object.values(getImportSources(i18n.resolvedLanguage));

  return (
    <Card className="w-full min-w-0 shadow-none">
      <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
            <Upload className={SETTINGS_CARD_ICON_CLASSNAME} />
            {t("noteImport.importNotes")}
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 text-xs font-normal"
            onClick={() => controller.open(undefined, defaultNotebookId ?? "")}
          >
            {t(running ? "noteImport.viewProgress" : "noteImport.open")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 pt-0">
        {running ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs" role="status" aria-live="polite">
            <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
              <span className="truncate">
                {state.phase === "scanning"
                  ? t("noteImport.scanning")
                  : state.progress
                    ? t(`noteImport.phases.${state.progress.phase}`)
                    : t("noteImport.viewProgress")}
              </span>
            </span>
            {state.phase === "running" && state.progress ? (
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {state.progress.unit === "bytes"
                  ? `${(state.progress.completed / 1048576).toFixed(1)} / ${(state.progress.total / 1048576).toFixed(1)} MiB`
                  : `${state.progress.completed} / ${state.progress.total}`}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {importSources.map(({ format, label, logo, formatHint }) => (
            <button
              key={format}
              type="button"
              onClick={() => controller.open(format, defaultNotebookId ?? "")}
              className="group flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-1"
            >
              {logo ? <img src={logo} alt="" className="size-4 shrink-0 object-contain" /> : <FileText aria-hidden="true" className="size-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">{label}</div>
                <div className="truncate font-mono text-[11px] leading-4 text-muted-foreground">{formatHint}</div>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground"
              />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
