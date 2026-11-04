import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

type Preview = { id: string; href: string; left: number; top: number };

export const NotebookSiteArticleTools = ({ containerRef, token, memoUrls }: {
  containerRef: RefObject<HTMLDivElement | null>; token: string; memoUrls: Readonly<Record<string, string>>;
}) => {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cardHovered, setCardHovered] = useState(false);
  useEffect(() => { if (preview && !memoUrls[preview.id]) setPreview(null); }, [memoUrls, preview]);
  const query = useQuery({
    queryKey: ["notebook-site-preview", token, preview?.id],
    queryFn: () => api.previewPublicNotebookMemo(token, preview!.id),
    enabled: Boolean(preview), retry: false, staleTime: 0,
  });
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link) return;
      const id = Object.keys(memoUrls).find((key) => new URL(memoUrls[key], location.origin).href === link.href);
      if (!id) return;
      clearTimeout(timer);
      const rect = link.getBoundingClientRect();
      setPreview({ id, href: memoUrls[id], left: rect.left, top: rect.bottom });
    };
    const hide = () => { timer = setTimeout(() => setPreview(null), 180); };
    container.addEventListener("mouseover", show);
    container.addEventListener("focusin", show);
    if (!cardHovered) {
      container.addEventListener("mouseout", hide);
      container.addEventListener("focusout", hide);
    }
    return () => {
      clearTimeout(timer);
      container.removeEventListener("mouseover", show); container.removeEventListener("focusin", show);
      container.removeEventListener("mouseout", hide); container.removeEventListener("focusout", hide);
    };
  }, [containerRef, memoUrls, cardHovered]);
  return <>
    <HoverCard open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <HoverCardTrigger asChild><span aria-hidden="true" className="pointer-events-none fixed" style={{ left: preview?.left ?? 0, top: preview?.top ?? 0 }} /></HoverCardTrigger>
      {preview && <HoverCardContent data-notebook-preview="true" side="bottom" align="start" onMouseEnter={() => setCardHovered(true)} onMouseLeave={() => { setCardHovered(false); setPreview(null); }} onEscapeKeyDown={() => setPreview(null)}>
        {query.isError ? <p>{t("notebookSite.previewUnavailable")}</p> : query.isPending ? <p>{t("sharing.publicLoading")}</p> : <Link to={preview.href} onClick={() => setPreview(null)}><strong className="block">{query.data.memo.title || t("common.untitledMemo")}</strong><span className="mt-2 line-clamp-4 block text-sm text-muted-foreground">{query.data.memo.excerpt}</span></Link>}
      </HoverCardContent>}
    </HoverCard>
  </>;
};
