import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, Loader2, RotateCcw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const AiTagSuggestionPromptCard = () => {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const settingsQuery = useQuery({
    queryKey: ["ai-settings", locale],
    queryFn: () => api.getAiSettings(locale),
  });
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (settingsQuery.data) setPrompt(settingsQuery.data.tagSuggestionPrompt);
  }, [settingsQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (nextPrompt: string | null) => api.updateAiTagSuggestionPrompt({ prompt: nextPrompt }, locale),
    onSuccess: async (settings) => {
      setPrompt(settings.tagSuggestionPrompt);
      await queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
    },
  });
  const settings = settingsQuery.data;
  const trimmedPrompt = prompt.trim();
  const unchanged = Boolean(settings) && trimmedPrompt === settings?.tagSuggestionPrompt;
  const disabled = !settings || settings.readOnly || updateMutation.isPending;
  const error = updateMutation.error ?? settingsQuery.error;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                  <Bot className={SETTINGS_CARD_ICON_CLASSNAME} />
                  {t("settings.aiTagPromptTitle")}
                </CardTitle>
                <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>
                  {t("settings.aiTagPromptDescription")}
                </CardDescription>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="grid gap-3 px-4 pb-4 pt-0">
            {settingsQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}
              </p>
            ) : (
              <>
                <textarea
                  aria-label={t("settings.aiTagPromptTitle")}
                  className="min-h-44 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                  disabled={disabled}
                  maxLength={4000}
                  onChange={(event) => setPrompt(event.target.value)}
                  value={prompt}
                />
                <div className="text-right text-xs text-slate-500">{prompt.length}/4000</div>
                {error ? <p className="text-xs font-medium text-rose-600" role="alert">{t("settings.aiTagPromptFailed")}</p> : null}
                {updateMutation.isSuccess ? <p className="text-xs font-medium text-emerald-700" role="status">{t("settings.aiTagPromptSaved")}</p> : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled || !settings?.tagSuggestionPromptCustomized}
                    onClick={() => updateMutation.mutate(null)}
                  >
                    <RotateCcw className="h-4 w-4" />{t("settings.aiTagPromptRestore")}
                  </Button>
                  <Button
                    type="button"
                    disabled={disabled || !trimmedPrompt || unchanged}
                    onClick={() => updateMutation.mutate(trimmedPrompt)}
                  >
                    {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("common.save")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
