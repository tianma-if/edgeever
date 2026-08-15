import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "./settings-utils";

const ADVANCED_PROMPT_KEYS = ["persona", "knowledgeMap", "tagAdvice"] as const;

export const AdvancedPlayCard = () => {
  const { t } = useTranslation();
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleCopyPrompt = async (title: string, prompt: string) => {
    if (!(await copyTextToClipboard(prompt))) {
      return;
    }

    setCopiedPrompt(title);
    window.setTimeout(() => {
      setCopiedPrompt((current) => (current === title ? null : current));
    }, 1600);
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4 sm:p-5">
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-emerald-700" />
                  {t("advancedPlay.title")}
                </CardTitle>
                <CardDescription className="mt-1 text-xs text-slate-500">{t("advancedPlay.description")}</CardDescription>
              </span>
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform",
                  expanded ? "rotate-180" : "rotate-0"
                )}
              />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="grid gap-3 p-4 pt-0 sm:px-5 sm:pb-5">
            {ADVANCED_PROMPT_KEYS.map((key) => {
              const title = t(`advancedPlay.prompts.${key}.title`);
              const prompt = t(`advancedPlay.prompts.${key}.prompt`);

              return (
                <div key={key} className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm font-semibold text-slate-900">{title}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-full gap-1.5 justify-center bg-white px-2.5 text-xs sm:w-auto"
                      type="button"
                      onClick={() => void handleCopyPrompt(title, prompt)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copiedPrompt === title ? t("common.copied") : t("advancedPlay.copyPrompt")}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{prompt}</p>
                </div>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
