import { useMemo } from "react";
import { ChevronLeft, HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { marked } from "marked";
import migrationGuideMarkdown from "../../../../docs/evernote-migration-guide.md?raw";
import migrationGuideEnglishMarkdown from "../../../../docs/evernote-migration-guide.en-US.md?raw";

export const EvernoteImportGuidePane = ({ onClose }: { onClose: () => void }) => {
  const { i18n, t } = useTranslation();
  const markdown = i18n.resolvedLanguage === "en-US" ? migrationGuideEnglishMarkdown : migrationGuideMarkdown;
  const htmlContent = useMemo(() => marked.parse(markdown) as string, [markdown]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-slate-50">
      <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:px-6 lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            title={t("common.back")}
            aria-label={t("common.back")}
            onClick={onClose}
            className="h-9 w-9 rounded-lg hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
              <HelpCircle className="h-4 w-4 text-emerald-700" />
              {t("evernoteGuide.title")}
            </h1>
            <p className="mt-0.5 truncate text-xs font-medium text-slate-400">
              {t("evernoteGuide.subtitle")}
            </p>
          </div>
        </div>
      </header>

      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 lg:px-6 lg:py-6">
        <article className="mx-auto w-full min-w-0 max-w-4xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div
            className="markdown-content max-w-none"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </article>
      </main>
    </div>
  );
};
