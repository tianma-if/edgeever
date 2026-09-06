import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const AiPromptsCard = ({ onOpenLibrary }: { onOpenLibrary: () => void }) => {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const promptsQuery = useQuery({
    queryKey: ["ai-prompts", i18n.resolvedLanguage],
    queryFn: async () => (await api.listAiPrompts(i18n.resolvedLanguage)).prompts,
    retry: false,
  });
  const count = promptsQuery.data?.length ?? 0;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4 sm:p-5">
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-emerald-700" />
                  {t("aiPrompts.settingsTitle")}
                </CardTitle>
                <CardDescription className="mt-1 text-xs text-slate-500">{t("aiPrompts.settingsDescription")}</CardDescription>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="grid gap-3 p-4 pt-0 sm:px-5 sm:pb-5">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/70 bg-slate-50/50 px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{t("aiPrompts.listTitle")}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t("aiPrompts.count", { count })}</p>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs" onClick={onOpenLibrary}>
                {t("aiPrompts.openLibrary")}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
