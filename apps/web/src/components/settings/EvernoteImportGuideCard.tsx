import { ExternalLink, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EVERNOTE_MIGRATION_BLOG_URL } from "@/lib/routes";

export const EvernoteImportGuideCard = () => {
  const { t } = useTranslation();

  return (
    <Card className="hidden w-full min-w-0 overflow-hidden shadow-none lg:block">
      <CardHeader className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <UploadCloud className="h-4 w-4 text-emerald-700 shrink-0" />
              {t("evernoteImport.title")}
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed text-slate-500">
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
