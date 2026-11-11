import { useSyncExternalStore } from "react";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import flomoLogo from "@/assets/import-logos/flomo.png?url";
import evernoteLogo from "@/assets/import-logos/evernote.svg?url";
import joplinLogo from "@/assets/import-logos/joplin.svg?url";
import obsidianLogo from "@/assets/import-logos/obsidian.svg?url";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { NoteImportController } from "@/lib/note-import/controller";
import { SETTINGS_CARD_HEADER_CLASSNAME, SETTINGS_CARD_ICON_CLASSNAME, SETTINGS_CARD_TITLE_CLASSNAME } from "./settings-ui";
import { ThirdPartyImportDialog } from "./ThirdPartyImportDialog";

const importSources = [
  { label: "flomo (.zip)", logo: flomoLogo },
  { label: "Evernote (.enex)", logo: evernoteLogo },
  { label: "Obsidian", logo: obsidianLogo },
  { label: "Joplin (.jex)", logo: joplinLogo },
];

export const ThirdPartyImportCard = ({ controller, onOpenMemo }: { controller: NoteImportController; onOpenMemo: (memoId: string, notebookId: string) => void }) => {
  const { t } = useTranslation();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const running = state.phase === "running" || state.phase === "scanning";
  return <Card className="w-full min-w-0 shadow-none">
    <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}><Upload className={SETTINGS_CARD_ICON_CLASSNAME} />{t("noteImport.title")}</CardTitle>
          <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
            {importSources.map(({ label, logo }) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 font-mono">
                {logo && <img src={logo} alt="" className="size-3 shrink-0 object-contain" />}
                {label}
              </span>
            ))}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={controller.open}>{t(running ? "noteImport.viewProgress" : "noteImport.open")}</Button>
      </div>
    </CardHeader>
    <ThirdPartyImportDialog controller={controller} state={state} onOpenMemo={onOpenMemo} />
  </Card>;
};
