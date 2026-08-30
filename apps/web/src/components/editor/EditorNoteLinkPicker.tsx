import { Link2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoSummary } from "@edgeever/shared";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export const EditorNoteLinkPicker = ({
  query,
  isLoading,
  memos,
  currentMemoId,
  onQueryChange,
  onClose,
  onInsert,
}: {
  query: string;
  isLoading: boolean;
  memos: MemoSummary[];
  currentMemoId: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onInsert: (memo: MemoSummary) => void;
}) => {
  const { t } = useTranslation();
  const candidates = memos.filter((candidate) => candidate.id !== currentMemoId && !candidate.isDeleted);

  return (
    <div
      className="absolute left-3 right-3 top-14 z-30 h-[min(22rem,calc(100%-4rem))] max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl sm:left-5 sm:right-auto sm:w-[28rem]"
      role="dialog"
      aria-label={t("noteLinkPicker.title")}
    >
      <Command shouldFilter={false}>
        <div className="flex items-center justify-between border-b border-slate-100 pr-2">
          <CommandInput
            autoFocus
            value={query}
            placeholder={t("noteLinkPicker.searchPlaceholder")}
            onValueChange={onQueryChange}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
          />
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("noteLinkPicker.close")}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <CommandList>
          {isLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">{t("noteLinkPicker.loading")}</div>
          ) : (
            <>
              <CommandEmpty>{t("noteLinkPicker.empty")}</CommandEmpty>
              <CommandGroup>
                {candidates.map((candidate) => (
                  <CommandItem key={candidate.id} value={candidate.id} onSelect={() => onInsert(candidate)}>
                    <Link2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 truncate">{candidate.title || t("common.untitledMemo")}</span>
                    <span className="max-w-40 truncate text-xs text-slate-400">{candidate.excerpt}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </div>
  );
};
