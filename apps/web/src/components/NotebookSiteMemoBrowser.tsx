import { useQuery } from "@tanstack/react-query";
import { getMemoDisplayTitle, type NotebookSiteMemo } from "@edgeever/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export const NotebookSiteMemoBrowser = ({ notebookId, token, selectedId, onSelect }: {
  notebookId: string;
  token: string;
  selectedId?: string | null;
  onSelect: (memo: NotebookSiteMemo) => void;
}) => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const prefix = ["notebook-site-memos", getConfiguredDesktopApiBaseUrl(), token];
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(input.trim()); setCursors([null]); }, 200);
    return () => window.clearTimeout(timer);
  }, [input]);
  const cursor = cursors.at(-1)!;
  const query = useQuery({
    queryKey: [...prefix, notebookId, search, "public", cursor],
    queryFn: () => api.listNotebookSiteMemos(notebookId, { q: search, visibility: "public", cursor, limit: 20 }),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const pagination = <div className="flex flex-wrap items-center justify-between gap-2">
    <span className="text-xs text-muted-foreground" aria-live="polite">{t("notebookSite.page", { page: cursors.length })}</span>
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="outline" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors((previous) => previous.slice(0, -1))}>{t("notebookSite.previousPage")}</Button>
      <Button type="button" size="sm" variant="outline" disabled={!query.data?.nextCursor || query.isFetching} onClick={() => { if (query.data?.nextCursor) setCursors((previous) => [...previous, query.data!.nextCursor]); }}>{t("notebookSite.nextPage")}</Button>
    </div>
  </div>;
  return <section className="space-y-4" aria-label={t("notebookSite.chooseHomepage")}>
    <Input type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("notebookSite.findNotes")} aria-label={t("notebookSite.findNotes")} />
    {pagination}
    {query.isError ? <div role="alert" className="space-y-2 text-sm"><p>{t("sharing.error")}</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>{t("sharing.retry")}</Button></div>
      : query.isPending ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">{t("sharing.publicLoading")}</p>
      : !query.data?.memos.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("notebookSite.noNotes")}</p>
      : <ul className="divide-y rounded-lg border bg-card">{query.data.memos.map((memo) => {
        const title = getMemoDisplayTitle(memo.title, t("common.untitledMemo"));
        return <li key={memo.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4">
          <div className="min-w-0">
            <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="line-clamp-2 break-words rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2">{title}</span></TooltipTrigger><TooltipContent className="max-w-[80vw] break-words sm:max-w-lg">{title}</TooltipContent></Tooltip>
            <p className="mt-1 truncate text-xs text-muted-foreground">{memo.notebookName}</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => onSelect(memo)}>{t(selectedId === memo.id ? "notebookSite.homepageSelected" : "notebookSite.selectNote")}</Button>
        </li>;
      })}</ul>}
    {query.data && query.data.memos.length > 0 && pagination}
  </section>;
};
