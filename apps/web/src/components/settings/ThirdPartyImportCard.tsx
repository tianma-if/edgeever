import { useSyncExternalStore } from "react";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { NoteImportController } from "@/lib/note-import/controller";
import { SETTINGS_CARD_DESCRIPTION_CLASSNAME, SETTINGS_CARD_HEADER_CLASSNAME, SETTINGS_CARD_ICON_CLASSNAME, SETTINGS_CARD_TITLE_CLASSNAME } from "./settings-ui";
import { ThirdPartyImportDialog } from "./ThirdPartyImportDialog";

export const ThirdPartyImportCard = ({ controller, onOpenMemo }: { controller: NoteImportController; onOpenMemo: (memoId: string, notebookId: string) => void }) => {
  const { t } = useTranslation();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const running = state.phase === "running" || state.phase === "scanning";
  return <Card className="w-full min-w-0 shadow-none">
    <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}><Upload className={SETTINGS_CARD_ICON_CLASSNAME} />{t("noteImport.title")}</CardTitle>
          <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>{t("noteImport.description")}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={controller.open}>{t(running ? "noteImport.viewProgress" : "noteImport.open")}</Button>
      </div>
    </CardHeader>
    <ThirdPartyImportDialog controller={controller} state={state} onOpenMemo={onOpenMemo} />
  </Card>;
};
