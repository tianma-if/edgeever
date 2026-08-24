import { useDeferredValue, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoSummary } from "@edgeever/shared";
import type { EdgeEverRepository } from "@/lib/repository";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type QuickMemoSwitcherProps = {
  open: boolean;
  query: string;
  repository: EdgeEverRepository;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onOpenMemo: (memo: MemoSummary) => void;
};

const EMPTY_MEMOS: MemoSummary[] = [];

export const QuickMemoSwitcher = ({
  open,
  query,
  repository,
  onOpenChange,
  onQueryChange,
  onOpenMemo,
}: QuickMemoSwitcherProps) => {
  const { t } = useTranslation();
  const [selectedMemoId, setSelectedMemoId] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const memoQuery = useQuery({
    queryKey: ["quick-memo-switcher", deferredQuery],
    queryFn: () => repository.listMemos({
      notebookId: null,
      q: deferredQuery,
      trash: false,
      filter: "all",
      sort: "updated-desc",
      offset: 0,
      limit: 50,
    }),
    enabled: open,
    staleTime: 15_000,
  });
  const memos = memoQuery.data?.memos ?? EMPTY_MEMOS;
  const loading = memoQuery.isPending || memoQuery.isFetching;

  useEffect(() => {
    setSelectedMemoId((current) => (
      memos.some((memo) => memo.id === current) ? current : memos[0]?.id ?? ""
    ));
  }, [memos]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] block max-w-xl translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{t("quickSwitcher.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("quickSwitcher.description")}</DialogDescription>
        <Command shouldFilter={false} value={selectedMemoId} onValueChange={setSelectedMemoId}>
          <CommandInput
            autoFocus
            className="pr-9"
            placeholder={t("quickSwitcher.placeholder")}
            value={query}
            onValueChange={onQueryChange}
          />
          <CommandList className="max-h-[min(26rem,60dvh)] p-1.5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500" role="status">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {t("quickSwitcher.loading")}
              </div>
            ) : (
              <>
                <CommandEmpty>{t("quickSwitcher.empty")}</CommandEmpty>
                <CommandGroup heading={deferredQuery ? t("quickSwitcher.results") : t("quickSwitcher.recent")}>
                  {memos.map((memo) => (
                    <CommandItem
                      key={memo.id}
                      className={COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME}
                      value={memo.id}
                      onSelect={() => onOpenMemo(memo)}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0 flex-1 py-0.5">
                        <div className="truncate font-medium text-slate-900">{memo.title}</div>
                        {memo.excerpt ? (
                          <div className="mt-0.5 truncate text-xs text-slate-500">{memo.excerpt}</div>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
            <span>{t("quickSwitcher.openHint")}</span>
            <span>{t("quickSwitcher.closeHint")}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
};
