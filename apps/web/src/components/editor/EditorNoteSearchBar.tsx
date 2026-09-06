import type { KeyboardEvent, RefObject } from "react";
import { ChevronLeft, ChevronRight, ReplaceAll, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const EditorNoteSearchBar = ({
  inputRef,
  query,
  replacement,
  replaceOpen,
  readOnly,
  matchCount,
  matchLabel,
  onQueryChange,
  onReplacementChange,
  onMoveMatch,
  onReplaceAll,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  replacement: string;
  replaceOpen: boolean;
  readOnly: boolean;
  matchCount: number;
  matchLabel: string;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onMoveMatch: (direction: -1 | 1) => void;
  onReplaceAll: () => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const handleEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return false;
    event.preventDefault();
    onClose();
    return true;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2 sm:px-7">
      <Search className="h-4 w-4 shrink-0 text-slate-400" />
      <Input
        ref={inputRef}
        value={query}
        className="h-8 min-w-[12rem] flex-1"
        placeholder={t("editor.searchPlaceholder")}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (handleEscape(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onMoveMatch(event.shiftKey ? -1 : 1);
          }
        }}
      />
      {replaceOpen ? (
        <Input
          value={replacement}
          className="h-8 min-w-[12rem] flex-1"
          placeholder={t("editor.replacePlaceholder")}
          disabled={readOnly}
          onChange={(event) => onReplacementChange(event.target.value)}
          onKeyDown={(event) => {
            if (handleEscape(event)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              onReplaceAll();
            }
          }}
        />
      ) : null}
      <span
        className={cn(
          "w-12 shrink-0 text-center text-xs tabular-nums",
          query.trim() && matchCount === 0 ? "text-rose-500" : "text-slate-500",
        )}
        aria-live="polite"
      >
        {matchLabel}
      </span>
      <Button size="icon" variant="ghost" aria-label={t("editor.previousSearchResult")} disabled={matchCount === 0} onClick={() => onMoveMatch(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" aria-label={t("editor.nextSearchResult")} disabled={matchCount === 0} onClick={() => onMoveMatch(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      {replaceOpen ? (
        <Button size="sm" variant="solid" aria-label={t("editor.replaceAll")} disabled={readOnly || matchCount === 0} onClick={onReplaceAll}>
          <ReplaceAll className="h-4 w-4" />
          {t("editor.replaceAll")}
        </Button>
      ) : null}
      <Button size="icon" variant="ghost" aria-label={t("editor.closeSearch")} onClick={onClose}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};
