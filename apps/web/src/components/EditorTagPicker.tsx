import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Check, ChevronDown, Loader2, Sparkles, Tags, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeTags, type TagSummary } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiRequestError } from "@/lib/api";
import { parseTagsText } from "@/lib/utils";

type EditorTagPickerProps = {
  contentMarkdown: string;
  disabled: boolean;
  loadTags: () => Promise<{ tags: TagSummary[] }>;
  title: string;
  value: string;
  onChange: (value: string) => void;
};

type AiGenerationStatus =
  | { kind: "idle" }
  | { kind: "success"; count: number }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export const EditorTagPicker = ({ contentMarkdown, disabled, loadTags, title, value, onChange }: EditorTagPickerProps) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [aiStatus, setAiStatus] = useState<AiGenerationStatus>({ kind: "idle" });
  const [suggesting, setSuggesting] = useState(false);
  const suggestionControllerRef = useRef<AbortController | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTags = useMemo(() => normalizeTags(parseTagsText(value)), [value]);
  const selectedTagKeys = useMemo(
    () => new Set(selectedTags.map((tag) => tag.toLocaleLowerCase())),
    [selectedTags],
  );
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: loadTags,
    enabled: open,
  });
  const normalizedQuery = query.trim().replace(/^#/, "");
  const visibleTags = (tagsQuery.data?.tags ?? []).filter((tag) =>
    tag.name.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase())
  );
  const exactMatch = (tagsQuery.data?.tags ?? []).some(
    (tag) => tag.name.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase()
  );

  useEffect(() => () => {
    suggestionControllerRef.current?.abort();
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const commit = (tags: string[]) => onChange(normalizeTags(tags).join(", "));
  const toggleTag = (name: string) => {
    commit(selectedTags.includes(name)
      ? selectedTags.filter((tag) => tag !== name)
      : [...selectedTags, name]);
  };
  const createTag = () => {
    const additions = parseTagsText(normalizedQuery);
    if (additions.length === 0) return;
    commit([...selectedTags, ...additions]);
    setQuery("");
  };
  const resetAiStatusLater = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setAiStatus({ kind: "idle" });
      feedbackTimerRef.current = null;
    }, 4000);
  };
  const generateAndApplyTags = async () => {
    if (!title.trim() && !contentMarkdown.trim()) return;
    suggestionControllerRef.current?.abort();
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    const controller = new AbortController();
    suggestionControllerRef.current = controller;
    setSuggesting(true);
    setAiStatus({ kind: "idle" });
    try {
      const result = await api.suggestAiTags(
        {
          title,
          contentMarkdown,
          currentTags: selectedTags,
          locale: i18n.resolvedLanguage,
        },
        controller.signal,
      );
      const availableSlots = Math.max(0, 24 - selectedTags.length);
      const additions = result.suggestions
        .filter((suggestion) => !selectedTagKeys.has(suggestion.name.toLocaleLowerCase()))
        .slice(0, availableSlots)
        .map((suggestion) => suggestion.name);
      if (additions.length > 0) {
        commit([...selectedTags, ...additions]);
        setAiStatus({ kind: "success", count: additions.length });
      } else {
        setAiStatus({ kind: "empty" });
      }
      resetAiStatusLater();
    } catch (error) {
      if (controller.signal.aborted) return;
      setAiStatus({
        kind: "error",
        message:
        error instanceof ApiRequestError && error.code === "ai_not_configured"
          ? t("editor.tagPicker.aiConfigure")
          : error instanceof Error
            ? error.message
            : t("editor.tagPicker.aiFailed"),
      });
    } finally {
      if (suggestionControllerRef.current === controller) {
        suggestionControllerRef.current = null;
        setSuggesting(false);
      }
    }
  };
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) return;
    setQuery("");
  };
  const aiLabel = suggesting
    ? t("editor.tagPicker.aiGenerating")
    : aiStatus.kind === "success"
      ? t("editor.tagPicker.aiAdded", { count: aiStatus.count })
      : aiStatus.kind === "empty"
        ? t("editor.tagPicker.aiEmptyShort")
        : aiStatus.kind === "error"
          ? t("editor.tagPicker.aiRetry")
          : t("editor.tagPicker.aiGenerateDirect");
  const aiDescription = aiStatus.kind === "error" ? aiStatus.message : aiLabel;

  return (
    <>
      <div className="flex min-w-0 max-w-full items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          className="flex h-8 min-w-0 max-w-[32rem] items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm text-slate-500 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/15 disabled:opacity-50"
          aria-label={t("editor.tagPicker.open")}
          onClick={() => setOpen(true)}
        >
          <Tags className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">
            {selectedTags.length > 0 ? selectedTags.map((tag) => `#${tag}`).join(", ") : t("editor.tagPlaceholder")}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>

        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled || suggesting || selectedTags.length >= 24 || (!title.trim() && !contentMarkdown.trim())}
                className={aiStatus.kind === "error"
                  ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-rose-700 outline-none transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500/20 disabled:opacity-50"
                  : aiStatus.kind === "success"
                    ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500/20 disabled:opacity-50"
                    : "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-emerald-700 outline-none transition hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500/20 disabled:opacity-50"}
                aria-label={aiDescription}
                onClick={() => void generateAndApplyTags()}
              >
                {suggesting
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : aiStatus.kind === "success"
                    ? <Check className="h-4 w-4" />
                    : aiStatus.kind === "error"
                    ? <CircleAlert className="h-4 w-4" />
                    : <Sparkles className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{aiDescription}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <span className="sr-only" aria-live="polite">{suggesting || aiStatus.kind !== "idle" ? aiDescription : ""}</span>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] max-w-lg flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("editor.tagPicker.title")}</DialogTitle>
            <DialogDescription>{t("editor.tagPicker.description")}</DialogDescription>
          </DialogHeader>

          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label={t("editor.tagPicker.selected")}>
              {selectedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-emerald-50 px-3 text-sm font-medium text-emerald-800 outline-none hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                  onClick={() => toggleTag(tag)}
                  aria-label={t("editor.tagPicker.remove", { name: tag })}
                >
                  #{tag}<X className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          )}

          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); createTag(); }}>
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("editor.tagPicker.searchPlaceholder")}
              aria-label={t("editor.tagPicker.searchPlaceholder")}
            />
            <Button type="submit" variant="outline" disabled={!normalizedQuery || exactMatch || selectedTags.length >= 24}>
              {t("editor.tagPicker.create")}
            </Button>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
            {tagsQuery.isLoading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">{t("editor.tagPicker.loading")}</p>
            ) : visibleTags.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">{t("editor.tagPicker.empty")}</p>
            ) : (
              visibleTags.map((tag) => {
                const selected = selectedTags.includes(tag.name);
                return (
                  <button
                    key={tag.name}
                    type="button"
                    className="flex min-h-11 w-full items-center gap-3 border-b border-slate-100 px-3 text-left text-sm outline-none last:border-b-0 hover:bg-slate-50 focus-visible:bg-emerald-50"
                    onClick={() => toggleTag(tag.name)}
                    aria-pressed={selected}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 text-emerald-700">
                      {selected && <Check className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">#{tag.name}</span>
                    <span className="text-xs text-slate-400">{t("editor.tagPicker.memoCount", { count: tag.memoCount })}</span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
