import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Share2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { Button } from "./ui/button";
import { NotebookSiteSettings } from "./NotebookSiteSettings";
import { ShareNotebookDialog } from "./dialogs/ShareNotebookDialog";

export const NotebookSiteManagementPage = () => {
  const { notebookId = "" } = useParams();
  const { t } = useTranslation();
  const client = useQueryClient();
  const [sharing, setSharing] = useState(false);
  const queryKey = ["notebook-share", getConfiguredDesktopApiBaseUrl(), notebookId];
  const query = useQuery({
    queryKey,
    queryFn: () => api.getNotebookShare(notebookId),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const share = query.isError ? null : query.data?.share;
  return <div className="flex h-[100dvh] flex-col bg-background text-foreground">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button asChild size="sm" variant="ghost"><Link to="/"><ArrowLeft className="size-4" />{t("notebookSite.backToNotes")}</Link></Button>
        <div className="min-w-0"><h1 className="text-base font-semibold">{t("notebookSite.manage")}</h1><p className="max-w-[45vw] truncate text-xs text-muted-foreground">{share?.notebookName}</p></div>
      </div>
      {share && <Button size="sm" variant="outline" onClick={() => setSharing(true)}><Share2 className="size-4" />{t("sharing.notebookTitle")}</Button>}
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {query.isPending ? <p role="status" className="py-12 text-center">{t("sharing.publicLoading")}</p>
          : !share ? <section className="space-y-4 py-12 text-center"><p>{t(query.isError ? "sharing.error" : "notebookSite.noActiveShare")}</p>{query.isError && <Button variant="outline" onClick={() => void query.refetch()}>{t("sharing.retry")}</Button>}</section>
          : <NotebookSiteSettings key={`${share.token}-${share.passwordProtected}`} notebookId={notebookId} share={share} onSaved={(data) => { client.setQueryData(queryKey, data); void client.invalidateQueries({ queryKey: ["notebook-shares"] }); }} />}
      </div>
    </main>
    {share && <ShareNotebookDialog notebookId={notebookId} notebookName={share.notebookName} open={sharing} onOpenChange={setSharing} />}
  </div>;
};
