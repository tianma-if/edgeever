import { useQuery } from "@tanstack/react-query";
import { Notebook, LoaderCircle, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getNotebookDescendantIds, type NotebookShare } from "@edgeever/shared";
import { getNotebookMoveOptions } from "@/lib/app-helpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShareManagementActions } from "./ShareManagementActions";
import { Button } from "@/components/ui/button";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import {
  ShareNotebookDialog,
  getPublicNotebookShareUrl,
} from "../dialogs/ShareNotebookDialog";

export const NotebookShareManagement = ({
  userId,
}: {
  userId: string | null;
}) => {
  const { t } = useTranslation();
  const [managed, setManaged] = useState<Pick<
    NotebookShare,
    "notebookId" | "notebookName"
  > | null>(null);
  const [selecting, setSelecting] = useState(false);
  const notebooks = useQuery({
    queryKey: ["shareable-notebooks", getConfiguredDesktopApiBaseUrl(), userId],
    queryFn: () => api.listNotebooks(),
    enabled: selecting || Boolean(managed),
    retry: false,
    refetchOnMount: "always",
  });
  const options = useMemo(
    () => getNotebookMoveOptions(notebooks.data?.notebooks ?? []),
    [notebooks.data],
  );
  const query = useQuery({
    queryKey: ["notebook-shares", getConfiguredDesktopApiBaseUrl(), userId],
    queryFn: () => api.listNotebookShares(),
    retry: false,
    refetchOnMount: "always",
  });
  return (
    <section aria-labelledby="notebook-shares-heading" className="border-t border-slate-100">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h3 id="notebook-shares-heading" className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <Notebook className="h-4 w-4 text-slate-500" />
          {t("sharing.notebookManagementTitle")}
        </h3>
        {selecting ? (
          <div className="flex w-full items-center gap-2 sm:w-64">
            <Select
              onValueChange={(id) => {
                const notebook = options.find((item) => item.id === id);
                if (notebook) {
                  setManaged({ notebookId: id, notebookName: notebook.name });
                  setSelecting(false);
                }
              }}
            >
              <SelectTrigger
                disabled={notebooks.isPending || notebooks.isError}
                aria-label={t("sharing.notebookChoose")}
              >
                <SelectValue placeholder={t("sharing.notebookChoose")} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.selectLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {notebooks.isError ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void notebooks.refetch()}
              >
                {t("sharing.retry")}
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelecting(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("sharing.notebookTitle")}
          </Button>
        )}
      </div>
      {query.isPending ? (
        <div className="px-4 pb-4">
          <LoaderCircle
            className="h-4 w-4 animate-spin"
            aria-label={t("sharing.managementLoading")}
          />
        </div>
      ) : query.isError ? (
        <div className="space-y-2 px-4 pb-4">
          <p role="alert" className="text-xs text-rose-600">
            {t("sharing.managementLoadFailed")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("sharing.retry")}
          </Button>
        </div>
      ) : !query.data.shares.length ? (
        <p className="px-4 pb-4 text-xs text-slate-500">
          {t("sharing.notebookManagementEmpty")}
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {query.data.shares.map((share) => (
            <div
              key={share.notebookId}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0 flex-1 break-words text-xs font-medium text-slate-900">
                {share.notebookName}
              </span>
              <ShareManagementActions
                onOpen={() => window.open(getPublicNotebookShareUrl(share.token, share.siteSlug), "_blank", "noopener,noreferrer")}
                onManage={() => setManaged(share)}
              />
            </div>
          ))}
        </div>
      )}
      {managed ? (
        <ShareNotebookDialog
          key={managed.notebookId}
          notebookId={managed.notebookId}
          notebookName={managed.notebookName}
          inherited={
            query.data?.shares.some(
              (share) =>
                share.notebookId !== managed.notebookId &&
                getNotebookDescendantIds(
                  notebooks.data?.notebooks ?? [],
                  share.notebookId,
                ).includes(managed.notebookId),
            ) ?? false
          }
          open
          onOpenChange={(open) => {
            if (!open) setManaged(null);
          }}
        />
      ) : null}
    </section>
  );
};
