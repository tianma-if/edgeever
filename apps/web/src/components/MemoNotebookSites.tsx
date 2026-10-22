import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "./ui/dropdown-menu";

export const memoNotebookSitesQueryKey = (memoId: string) => ["memo-notebook-sites", getConfiguredDesktopApiBaseUrl(), memoId] as const;

export const MemoNotebookSites = ({ memoId, presentation = "dialog" }: {
  memoId: string;
  presentation?: "dialog" | "menu";
}) => {
  const { t } = useTranslation();
  const client = useQueryClient();
  const baseUrl = getConfiguredDesktopApiBaseUrl();
  const queryKey = memoNotebookSitesQueryKey(memoId);
  const query = useQuery({
    queryKey,
    queryFn: () => api.getMemoNotebookSites(memoId),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const change = useMutation({
    mutationFn: ({ notebookId, excluded }: { notebookId: string; excluded: boolean }) => api.setNotebookSiteExclusion(notebookId, memoId, excluded),
    onSuccess: async (_, { notebookId }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: ["notebook-site-memos"] }),
        client.invalidateQueries({ queryKey: ["notebook-share", baseUrl, notebookId] }),
      ]);
    },
  });
  const sites = query.data?.sites ?? [];
  if (query.isSuccess && sites.length === 0) return null;
  const busy = change.isPending || query.isFetching;
  if (presentation === "menu") return <DropdownMenuSub>
    <DropdownMenuSubTrigger className="gap-2 px-3"><Globe className="size-4 shrink-0" />{t("notebookSite.noteSites")}</DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto" collisionPadding={12}>
      {query.isPending ? <DropdownMenuItem disabled>{t("sharing.publicLoading")}</DropdownMenuItem>
        : query.isError ? <>
          <DropdownMenuLabel className="font-normal text-destructive">{t("sharing.error")}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void query.refetch(); }}>{t("sharing.retry")}</DropdownMenuItem>
        </> : sites.map((site) => <DropdownMenuCheckboxItem key={site.notebookId} checked={!site.excluded} disabled={busy}
          aria-label={t("notebookSite.showInSite", { name: site.notebookName })}
          className="break-words whitespace-normal"
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) => change.mutate({ notebookId: site.notebookId, excluded: !checked })}>
          {site.notebookName}
        </DropdownMenuCheckboxItem>)}
      {change.isError && <DropdownMenuLabel role="alert" className="break-words font-normal text-destructive">{change.error.message}</DropdownMenuLabel>}
    </DropdownMenuSubContent>
  </DropdownMenuSub>;
  return <section className="space-y-3 rounded-lg border p-3" aria-label={t("notebookSite.noteSites")}>
    <h2 className="text-sm font-semibold">{t("notebookSite.noteSites")}</h2>
    <p className="text-xs text-muted-foreground">{t("notebookSite.noteSitesHint")}</p>
    {query.isPending ? <p role="status" className="text-sm text-muted-foreground">{t("sharing.publicLoading")}</p>
      : query.isError ? <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{t("sharing.error")}</p><Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>{t("sharing.retry")}</Button></div>
        : sites.map((site) => <label key={site.notebookId} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 break-words">{t("notebookSite.showInSite", { name: site.notebookName })}</span>
          <Switch aria-label={t("notebookSite.showInSite", { name: site.notebookName })} checked={!site.excluded} disabled={busy} onCheckedChange={(checked) => change.mutate({ notebookId: site.notebookId, excluded: !checked })} />
        </label>)}
    {change.isSuccess && <p role="status" className="text-xs text-muted-foreground">{t("notebookSite.contentSaved")}</p>}
    {change.isError && <p role="alert" className="break-words text-xs text-destructive">{change.error.message}</p>}
  </section>;
};
