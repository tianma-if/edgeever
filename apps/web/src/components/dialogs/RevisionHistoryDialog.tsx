import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Clock3, History, RotateCcw, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { getMemoTitle } from "@/lib/app-helpers";
import { AppConfirmDialog } from "./ConfirmDialogs";
import type { MemoDetail } from "@edgeever/shared";

const summarizeMarkdownDiff = (left: string, right: string) => {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const maxLines = Math.max(leftLines.length, rightLines.length);
  let changed = 0;

  for (let index = 0; index < maxLines; index += 1) {
    if ((leftLines[index] ?? "") !== (rightLines[index] ?? "")) {
      changed += 1;
    }
  }

  return { changed };
};

type DiffRow = {
  lineNumber: number | null;
  text: string;
  state: "same" | "changed" | "empty";
};

const buildRevisionDiffRows = (left: string, right: string) => {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const m = leftLines.length;
  const n = rightLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  type DiffAction =
    | { type: "same"; left: string; right: string }
    | { type: "removed"; line: string }
    | { type: "added"; line: string };
  const actions: DiffAction[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      actions.unshift({ type: "same", left: leftLines[i - 1], right: rightLines[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      actions.unshift({ type: "added", line: rightLines[j - 1] });
      j--;
    } else {
      actions.unshift({ type: "removed", line: leftLines[i - 1] });
      i--;
    }
  }

  const leftRows: DiffRow[] = [];
  const rightRows: DiffRow[] = [];

  let leftLineNum = 1;
  let rightLineNum = 1;

  let index = 0;
  while (index < actions.length) {
    const action = actions[index];
    if (action.type === "same") {
      leftRows.push({ lineNumber: leftLineNum++, text: action.left, state: "same" });
      rightRows.push({ lineNumber: rightLineNum++, text: action.right, state: "same" });
      index++;
    } else {
      const removedBlock: string[] = [];
      const addedBlock: string[] = [];

      while (index < actions.length && actions[index].type !== "same") {
        const act = actions[index];
        if (act.type === "removed") {
          removedBlock.push(act.line);
        } else if (act.type === "added") {
          addedBlock.push(act.line);
        }
        index++;
      }

      const maxLen = Math.max(removedBlock.length, addedBlock.length);
      for (let k = 0; k < maxLen; k++) {
        const hasRemoved = k < removedBlock.length;
        const hasAdded = k < addedBlock.length;

        if (hasRemoved && hasAdded) {
          leftRows.push({ lineNumber: leftLineNum++, text: removedBlock[k], state: "changed" });
          rightRows.push({ lineNumber: rightLineNum++, text: addedBlock[k], state: "changed" });
        } else if (hasRemoved) {
          leftRows.push({ lineNumber: leftLineNum++, text: removedBlock[k], state: "changed" });
          rightRows.push({ lineNumber: null, text: "", state: "empty" });
        } else if (hasAdded) {
          leftRows.push({ lineNumber: null, text: "", state: "empty" });
          rightRows.push({ lineNumber: rightLineNum++, text: addedBlock[k], state: "changed" });
        }
      }
    }
  }

  return { leftRows, rightRows };
};

const formatRevisionActor = (actor: string) => {
  if (actor.startsWith("user:")) {
    return "user";
  }

  if (actor.startsWith("agent:")) {
    return "agent";
  }

  return actor || "system";
};

export const RevisionHistoryDialog = ({
  memo,
  currentMarkdown,
  onClose,
  onRestored,
}: {
  memo: MemoDetail;
  currentMarkdown: string;
  onClose: () => void;
  onRestored: (memo: MemoDetail) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [restoreRevisionConfirmationId, setRestoreRevisionConfirmationId] = useState<string | null>(null);

  const revisionsQuery = useQuery({
    queryKey: ["memo-revisions", memo.id],
    queryFn: () => api.listMemoRevisions(memo.id),
  });

  const revisions = revisionsQuery.data?.revisions ?? [];
  const selectedRevision =
    revisions.find((revision) => revision.id === selectedRevisionId) ?? revisions[0] ?? null;

  const diffRows = useMemo(
    () => buildRevisionDiffRows(selectedRevision?.contentMarkdown ?? "", currentMarkdown),
    [currentMarkdown, selectedRevision?.contentMarkdown]
  );

  const diffSummary = useMemo(() => {
    let changed = 0;
    const len = diffRows.leftRows.length;
    for (let index = 0; index < len; index += 1) {
      const left = diffRows.leftRows[index];
      const right = diffRows.rightRows[index];
      if (left.state !== "same" || right.state !== "same") {
        changed += 1;
      }
    }
    return { changed };
  }, [diffRows]);

  const restoreMutation = useMutation({
    mutationFn: (revisionId: string) => api.restoreMemoRevision(memo.id, revisionId),
    onSuccess: async (data) => {
      setRestoreRevisionConfirmationId(null);
      await onRestored(data.memo);
    },
  });

  useEffect(() => {
    if (!selectedRevisionId && revisions.length > 0) {
      setSelectedRevisionId(revisions[0].id);
    }
  }, [revisions, selectedRevisionId]);

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !restoreRevisionConfirmationId) onClose(); }}>
      <DialogContent className="grid max-h-[88dvh] max-w-[1120px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-0 shadow-xl">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 text-left">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-slate-950">
              <History className="h-5 w-5 text-emerald-600" />
              {t("revisions.title")}
            </DialogTitle>
            <DialogDescription className="mt-1 truncate text-sm text-slate-500">
              {getMemoTitle(memo.title)}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-col bg-white">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
            <div className="min-w-0 flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">
                {selectedRevision ? t("revisions.compareTitle", { revision: selectedRevision.revision }) : t("revisions.noRevisionSelected")}
              </div>
              {selectedRevision && (
                <span className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors",
                  diffSummary.changed > 0
                    ? "bg-amber-50/80 text-amber-800 border-amber-200/40"
                    : "bg-slate-50 text-slate-600 border-slate-200/50"
                )}>
                  {t("revisions.changedLines", { count: diffSummary.changed })}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="solid"
              disabled={!selectedRevision || memo.isDeleted || restoreMutation.isPending}
              onClick={() => {
                if (selectedRevision) {
                  setRestoreRevisionConfirmationId(selectedRevision.id);
                }
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {t("revisions.restoreVersion")}
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-1">
            <aside className="min-h-0 max-h-[220px] overflow-y-auto border-b border-slate-100 bg-slate-50/30 p-4 lg:max-h-[calc(88dvh-73px)] lg:border-b-0 lg:border-r lg:border-slate-200/80">
              <div className="mb-3 px-1 text-[11px] font-medium uppercase tracking-wider text-slate-400/90">
                {t("revisions.timeline")}
              </div>
              {revisionsQuery.isLoading ? (
                <div className="px-2 py-8 text-center text-sm text-slate-500">{t("revisions.loading")}</div>
              ) : revisions.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  {t("revisions.empty")}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {revisions.map((revision) => (
                    <button
                      key={revision.id}
                      className={cn(
                        "group flex flex-col w-full rounded-lg border p-3 text-left transition-all duration-200",
                        selectedRevision?.id === revision.id
                          ? "border-emerald-200 bg-emerald-50/30 shadow-sm ring-1 ring-emerald-100/50"
                          : "border-slate-100/80 bg-white/60 hover:border-slate-200 hover:bg-slate-50/80"
                      )}
                      onClick={() => setSelectedRevisionId(revision.id)}
                    >
                      <span className={cn(
                        "block text-sm font-semibold transition-colors duration-200",
                        selectedRevision?.id === revision.id ? "text-emerald-950" : "text-slate-900 group-hover:text-slate-950"
                      )}>
                        {t("revisions.revisionName", { revision: revision.revision })}
                      </span>
                      <span className="mt-2 flex items-center gap-1.5 truncate text-[11px] text-slate-500">
                        <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{formatDateTime(revision.createdAt)}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-slate-400">
                        <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{formatRevisionActor(revision.createdBy)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </aside>

            <div className="flex min-h-0 flex-col">
              {/* Sticky Header Row */}
              <div className="sticky top-0 z-10 grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 shrink-0">
                <div className="flex h-11 items-center justify-between bg-slate-50/90 backdrop-blur-sm px-4">
                  <div className="text-xs font-semibold text-slate-600">{t("revisions.historyVersion")}</div>
                  <div className="h-2 w-2 rounded-full bg-rose-500" />
                </div>
                <div className="flex h-11 items-center justify-between bg-slate-50/90 backdrop-blur-sm px-4">
                  <div className="text-xs font-semibold text-slate-600">{t("revisions.currentContent")}</div>
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
              </div>

              {/* Unified Scroll Container */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/20">
                {diffRows.leftRows.length > 0 ? (
                  <div className="divide-y divide-slate-100/50">
                    {diffRows.leftRows.map((leftRow, idx) => {
                      const rightRow = diffRows.rightRows[idx];
                      return (
                        <div key={idx} className="grid grid-cols-2 divide-x divide-slate-200/80">
                          {/* Left Cell (History) */}
                          <div
                            className={cn(
                              "grid grid-cols-[3rem_minmax(0,1fr)] px-0 font-mono text-[13px] leading-6 transition-colors",
                              leftRow.state === "changed" && "bg-rose-50/45 text-rose-950 border-l-2 border-rose-400/85",
                              leftRow.state === "empty" && "bg-slate-50/30 text-transparent select-none border-l-2 border-transparent",
                              leftRow.state === "same" && "text-slate-700 border-l-2 border-transparent hover:bg-slate-50/30"
                            )}
                          >
                            <span className="select-none border-r border-slate-200/60 bg-slate-50/50 px-3 text-right text-[11px] text-slate-400">
                              {leftRow.lineNumber || ""}
                            </span>
                            <span className={cn("whitespace-pre-wrap break-words px-3 py-0.5", leftRow.state === "empty" && "select-none")}>
                              {leftRow.text || (leftRow.state === "empty" ? "" : " ")}
                            </span>
                          </div>

                          {/* Right Cell (Current) */}
                          <div
                            className={cn(
                              "grid grid-cols-[3rem_minmax(0,1fr)] px-0 font-mono text-[13px] leading-6 transition-colors",
                              rightRow.state === "changed" && "bg-emerald-50/45 text-emerald-950 border-l-2 border-emerald-400/85",
                              rightRow.state === "empty" && "bg-slate-50/30 text-transparent select-none border-l-2 border-transparent",
                              rightRow.state === "same" && "text-slate-700 border-l-2 border-transparent hover:bg-slate-50/30"
                            )}
                          >
                            <span className="select-none border-r border-slate-200/60 bg-slate-50/50 px-3 text-right text-[11px] text-slate-400">
                              {rightRow.lineNumber || ""}
                            </span>
                            <span className={cn("whitespace-pre-wrap break-words px-3 py-0.5", rightRow.state === "empty" && "select-none")}>
                              {rightRow.text || (rightRow.state === "empty" ? "" : " ")}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-slate-400">
                    {t("revisions.emptyMemo")}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>

      {restoreRevisionConfirmationId && (
        <AppConfirmDialog
          title={t("revisions.restoreConfirmTitle")}
          description={t("revisions.restoreConfirmDescription")}
          confirmLabel={t("revisions.restoreConfirmLabel")}
          isWorking={restoreMutation.isPending}
          tone="primary"
          onCancel={() => setRestoreRevisionConfirmationId(null)}
          onConfirm={() => restoreMutation.mutate(restoreRevisionConfirmationId)}
        />
      )}
    </Dialog>
  );
};
