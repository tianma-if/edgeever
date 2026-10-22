import { useInfiniteQuery } from "@tanstack/react-query";
import { getMemoDisplayTitle, type PublicNotebookShare } from "@edgeever/shared";
import { createContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const NotebookSiteSearchContext = createContext<(tag?: string) => void>(() => {});

const Highlight = ({ text, terms }: { text: string; terms: string[] }) => {
  const words = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)}</>;
};

export const NotebookSiteSearch = ({ token, share, root, open, setOpen, tag, setTag }: {
  token: string; share: PublicNotebookShare; root: string; open: boolean; setOpen: (value: boolean) => void;
  tag: string; setTag: (value: string) => void;
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const result = useInfiniteQuery({
    queryKey: ["notebook-site-search", token, debounced, tag],
    queryFn: ({ pageParam }) => api.searchPublicNotebook(token, { q: debounced, tag, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: open,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const visible = useMemo(() => new Set(share.memos.map((memo) => memo.id)), [share.memos]);
  const matches = result.isError ? [] : (result.data?.pages.flatMap((page) => page.memos).filter((memo) => visible.has(memo.id)) ?? []);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}>
      <DialogHeader><DialogTitle>{t("notebookSite.search")}</DialogTitle><DialogDescription>{t("notebookSite.searchHint")}</DialogDescription></DialogHeader>
      <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("sharing.siteSearch")} aria-label={t("sharing.siteSearch")} />
      {tag && <Button variant="outline" className="justify-start" onClick={() => setTag("")}>#{tag} · {t("notebookSite.allTags")}</Button>}
      <div role="status" className="text-xs text-muted-foreground">{result.isFetching ? t("sharing.publicLoading") : t("sharing.siteResults", { count: matches.length })}</div>
      <ul className="space-y-2">{matches.map((memo) => <li key={memo.id}><Link className="block rounded-md border p-3 hover:bg-muted focus-visible:ring-2" to={`${root}/${encodeURIComponent(memo.id)}`} onClick={() => setOpen(false)}>
        <span className="block font-medium"><Highlight text={getMemoDisplayTitle(memo.title, t("common.untitledMemo"))} terms={memo.highlights} /></span>
        <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-sm text-muted-foreground"><Highlight text={memo.excerpt} terms={memo.highlights} /></span>
      </Link></li>)}</ul>
      {result.isError ? <div role="alert">{t("sharing.error")} <Button variant="outline" onClick={() => void result.refetch()}>{t("sharing.retry")}</Button></div> : !result.isPending && !matches.length ? <p>{t("sharing.siteNoResults")}</p> : null}
      {result.hasNextPage && <Button variant="outline" disabled={result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>{t("notebookSite.more")}</Button>}
    </DialogContent>
  </Dialog>;
};
