import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Tags, X } from "lucide-react";
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
import { parseTagsText } from "@/lib/utils";

type EditorTagPickerProps = {
  disabled: boolean;
  loadTags: () => Promise<{ tags: TagSummary[] }>;
  value: string;
  onChange: (value: string) => void;
};

export const EditorTagPicker = ({ disabled, loadTags, value, onChange }: EditorTagPickerProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedTags = useMemo(() => normalizeTags(parseTagsText(value)), [value]);
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

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className="flex h-8 min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm text-slate-500 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/15 disabled:opacity-50"
        aria-label={t("editor.tagPicker.open")}
        onClick={() => setOpen(true)}
      >
        <Tags className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {selectedTags.length > 0 ? selectedTags.map((tag) => `#${tag}`).join(", ") : t("editor.tagPlaceholder")}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>

      <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setQuery(""); }}>
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
