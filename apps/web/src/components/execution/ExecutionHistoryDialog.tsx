import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Clock3, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExecutionHistoryItemCard, type ExecutionHistoryItem } from "./ExecutionHistoryItemCard";

export interface ExecutionHistoryPage {
  items: ExecutionHistoryItem[];
  totalCount: number;
  nextOffset: number | null;
}

interface ExecutionHistoryDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: string;
  queryKey: readonly unknown[];
  loadPage(offset: number, limit: number): Promise<ExecutionHistoryPage>;
  currentExecutorId?: string | null;
  refetchInterval?: number | false;
}

const PAGE_SIZE = 30;

export const ExecutionHistoryDialog = ({
  open,
  onOpenChange,
  title,
  description,
  queryKey,
  loadPage,
  currentExecutorId,
  refetchInterval = false,
}: ExecutionHistoryDialogProps) => {
  const { t } = useTranslation();
  const historyQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => loadPage(pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: open,
    refetchInterval: open ? refetchInterval : false,
  });
  const items = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [historyQuery.data?.pages],
  );
  const totalCount = historyQuery.data?.pages[0]?.totalCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[min(760px,calc(100dvh-2rem))] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 pr-12 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {historyQuery.isPending ? (
            <div className="flex min-h-40 items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" aria-label={t("executionHistory.loading")} />
            </div>
          ) : historyQuery.isError ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {historyQuery.error instanceof Error ? historyQuery.error.message : t("executionHistory.loadFailed")}
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-slate-400">
              <Clock3 className="h-6 w-6" />
              <p className="text-sm">{t("executionHistory.empty")}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-xs text-slate-400">{t("executionHistory.total", { count: totalCount })}</p>
              {items.map((item) => (
                <ExecutionHistoryItemCard key={item.id} item={item} currentExecutorId={currentExecutorId} />
              ))}
              {historyQuery.hasNextPage ? (
                <Button
                  variant="outline"
                  disabled={historyQuery.isFetchingNextPage}
                  onClick={() => void historyQuery.fetchNextPage()}
                >
                  {historyQuery.isFetchingNextPage ? t("executionHistory.loading") : t("executionHistory.loadMore")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
