import { ExternalLink, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { EVERNOTE_MIGRATION_BLOG_URL } from "@/lib/routes";

export const EvernoteImportGuideCard = () => {
  const { t } = useTranslation();

  return (
    <Card className="hidden w-full min-w-0 overflow-hidden shadow-none lg:block">
      <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
              <UploadCloud className={SETTINGS_CARD_ICON_CLASSNAME} />
              {t("evernoteImport.title")}
            </CardTitle>
            <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>
              {t("evernoteImport.description")}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-white px-3 text-xs" type="button" asChild>
              <a
                href={EVERNOTE_MIGRATION_BLOG_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("evernoteImport.openGuideAria")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("evernoteImport.guide")}
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
};
