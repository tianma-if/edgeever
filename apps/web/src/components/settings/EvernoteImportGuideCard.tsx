import { ExternalLink, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EVERNOTE_MIGRATION_BLOG_URL } from "@/lib/routes";

export const EvernoteImportGuideCard = () => {
  const { t } = useTranslation();

  return (
    <Card className="hidden w-full min-w-0 overflow-hidden shadow-none lg:block">
      <CardHeader className="p-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UploadCloud className="h-4 w-4 text-emerald-700" />
            {t("evernoteImport.title")}
            <Button size="sm" variant="outline" className="h-7 gap-1 bg-white px-2.5 text-xs" type="button" asChild>
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
          </CardTitle>
        <CardDescription className="text-xs leading-4">{t("evernoteImport.description")}</CardDescription>
      </CardHeader>
    </Card>
  );
};
