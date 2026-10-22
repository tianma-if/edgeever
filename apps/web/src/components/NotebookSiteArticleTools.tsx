import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

type Heading = { id: string; text: string; level: number };
type Preview = { id: string; href: string; left: number; top: number };

export const NotebookSiteArticleTools = ({ containerRef, token, memoUrls }: {
  containerRef: RefObject<HTMLDivElement | null>; token: string; memoUrls: Readonly<Record<string, string>>;
}) => {
  const { t } = useTranslation();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(false);
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
    const update = () => {
      const counts = new Map<string, number>();
      const result = [...container.querySelectorAll<HTMLElement>(".tiptap h1, .tiptap h2, .tiptap h3, .tiptap h4")].map((node) => {
        const text = node.textContent?.trim() ?? "";
        const slug = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
        const count = (counts.get(slug) ?? 0) + 1;
        counts.set(slug, count);
        node.id = `article-${slug}-${count}`;
        node.style.scrollMarginTop = "6rem";
        return { id: node.id, text, level: Number(node.tagName.slice(1)) };
      });
      setHeadings((previous) => JSON.stringify(previous) === JSON.stringify(result) ? previous : result);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [containerRef]);
  useEffect(() => {
    if (!headings.length) return;
    const update = () => {
      let id = headings[0].id;
      for (const heading of headings) {
        if ((document.getElementById(heading.id)?.getBoundingClientRect().top ?? Infinity) <= 130) id = heading.id;
      }
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4)
        id = headings.at(-1)!.id;
      setActive(id);
    };
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    let restoring = true;
    let target: HTMLElement | null = null;
    try { target = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); } catch { /* Ignore malformed fragments. */ }
    const stopRestoring = () => { restoring = false; };
    const relayout = () => {
      // Fonts and images may change height after TipTap has created headings.
      // Stop restoring the initial fragment as soon as the reader interacts.
      if (restoring && target && containerRef.current?.contains(target)) target.scrollIntoView({ block: "start", behavior: "instant" });
      onScroll();
    };
    const observer = new ResizeObserver(relayout);
    if (containerRef.current) observer.observe(containerRef.current);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(event, stopRestoring, { passive: true });
    relayout();
    return () => {
      window.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); observer.disconnect();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(event, stopRestoring);
    };
  }, [headings]);
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
  const outline = <nav aria-label={t("notebookSite.outline")} className="max-h-[70dvh] space-y-1 overflow-y-auto text-xs">
    {headings.map((heading) => <a href={`#${heading.id}`} key={heading.id} aria-current={active === heading.id ? "location" : undefined} className={`block rounded py-1.5 pr-2 ${active === heading.id ? "bg-muted font-semibold" : "text-muted-foreground"}`} style={{ paddingLeft: (heading.level - 1) * 12 + 8 }} onClick={(event) => {
      event.preventDefault();
      history.replaceState(history.state, "", `#${heading.id}`);
      setOutlineOpen(false);
      document.getElementById(heading.id)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }}>{heading.text}</a>)}
  </nav>;
  return <>
    {headings.length > 0 && <>
      <aside className="absolute bottom-0 right-3 top-8 hidden w-48 xl:block"><div className="sticky top-24"><h2 className="mb-3 text-xs font-semibold">{t("notebookSite.outline")}</h2>{outline}</div></aside>
      <Drawer open={outlineOpen} onOpenChange={setOutlineOpen} shouldScaleBackground={false}><DrawerTrigger asChild><Button variant="outline" className="fixed bottom-5 right-5 z-20 shadow-md xl:hidden">{t("notebookSite.outline")}</Button></DrawerTrigger><DrawerContent><DrawerHeader><DrawerTitle>{t("notebookSite.outline")}</DrawerTitle><DrawerDescription>{t("sharing.readOnly")}</DrawerDescription></DrawerHeader><div className="px-6 pb-8">{outline}</div></DrawerContent></Drawer>
    </>}
    <HoverCard open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <HoverCardTrigger asChild><span aria-hidden="true" className="pointer-events-none fixed" style={{ left: preview?.left ?? 0, top: preview?.top ?? 0 }} /></HoverCardTrigger>
      {preview && <HoverCardContent data-notebook-preview="true" side="bottom" align="start" onMouseEnter={() => setCardHovered(true)} onMouseLeave={() => { setCardHovered(false); setPreview(null); }} onEscapeKeyDown={() => setPreview(null)}>
        {query.isError ? <p>{t("notebookSite.previewUnavailable")}</p> : query.isPending ? <p>{t("sharing.publicLoading")}</p> : <Link to={preview.href} onClick={() => setPreview(null)}><strong className="block">{query.data.memo.title || t("common.untitledMemo")}</strong><span className="mt-2 line-clamp-4 block text-sm text-muted-foreground">{query.data.memo.excerpt}</span></Link>}
      </HoverCardContent>}
    </HoverCard>
  </>;
};
