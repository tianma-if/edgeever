import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildPublicOutlineTree, collectPublicOutlineParentIds, type PublicOutlineFlatHeading, type PublicOutlineHeading } from "@/lib/public-article-outline";

const HEADING_SELECTOR = ".tiptap h1, .tiptap h2, .tiptap h3, .tiptap h4, .tiptap h5, .tiptap h6";
const OUTLINE_INDENT = 12;

const sameHeadings = (left: PublicOutlineFlatHeading[], right: PublicOutlineFlatHeading[]) =>
  left.length === right.length && left.every((heading, index) => {
    const other = right[index];
    return other?.id === heading.id && other.level === heading.level && other.text === heading.text;
  });

const headingSnapshot = (container: HTMLDivElement): PublicOutlineFlatHeading[] => {
  const counts = new Map<string, number>();
  const headings = [...container.querySelectorAll<HTMLElement>(HEADING_SELECTOR)].map((node) => ({
    node, text: node.textContent?.trim() ?? "", level: Number(node.tagName.slice(1)), id: "",
  }));
  // Reserve the original H1–H4 IDs first, including empty headings. New levels
  // must not renumber fragments that readers already copied from public sites.
  const anchorOrder = [
    ...headings.filter(({ level }) => level <= 4),
    ...headings.filter(({ level }) => level > 4),
  ];
  for (const heading of anchorOrder) {
    const slug = heading.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
    const count = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, count);
    heading.id = `article-${slug}-${count}`;
    heading.node.id = heading.id;
    heading.node.style.scrollMarginTop = "6rem";
  }
  return headings.flatMap(({ id, text, level }) => text ? [{ id, text, level }] : []);
};

const scrollToHeading = (element: HTMLElement, behavior: ScrollBehavior) => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.matches('[data-type="details"]:not(.is-open)')) {
      parent.querySelector<HTMLButtonElement>(":scope > button")?.click();
    }
  }
  element.scrollIntoView({ block: "start", behavior });
};

export const PublicArticleOutline = ({
  containerRef,
  onAvailableChange,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  onAvailableChange?: (available: boolean) => void;
}) => {
  const { t } = useTranslation();
  const [headings, setHeadings] = useState<PublicOutlineFlatHeading[]>([]);
  const [active, setActive] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const jumpTargetRef = useRef<string | null>(null);
  const tree = useMemo(() => buildPublicOutlineTree(headings), [headings]);
  const parentIds = useMemo(() => collectPublicOutlineParentIds(tree), [tree]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const next = headingSnapshot(container);
      setHeadings((previous) => sameHeadings(previous, next) ? previous : next);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    setCollapsed((current) => {
      const valid = new Set(parentIds);
      const next = new Set([...current].filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [parentIds]);

  useEffect(() => {
    onAvailableChange?.(headings.length > 0);
    return () => onAvailableChange?.(false);
  }, [headings.length, onAvailableChange]);

  useEffect(() => {
    if (headings.length === 0) return;
    const update = () => {
      const jumpTarget = jumpTargetRef.current;
      if (jumpTarget && headings.some((heading) => heading.id === jumpTarget)) {
        setActive(jumpTarget);
        return;
      }
      jumpTargetRef.current = null;
      let id = "";
      let lastVisible = "";
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (!element?.getClientRects().length) continue;
        id ||= heading.id;
        lastVisible = heading.id;
        if (element.getBoundingClientRect().top <= 130) id = heading.id;
      }
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) id = lastVisible;
      setActive(id);
    };
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });

    let restoring = true;
    let target: HTMLElement | null = null;
    try { target = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); } catch { /* Ignore malformed fragments. */ }
    if (target && containerRef.current?.contains(target)) jumpTargetRef.current = target.id;
    const stopRestoring = () => { restoring = false; };
    const resumeTracking = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      // Wheel/touch scrolling stays inside the outline. Scroll keys can move the
      // document while an outline link still has focus after a jump.
      if (element?.closest('[role="dialog"]')) return;
      if (!(event instanceof KeyboardEvent) && element?.closest("aside")) return;
      if (event instanceof WheelEvent && event.deltaY === 0) return;
      if (event instanceof KeyboardEvent) {
        if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
        if (event.defaultPrevented || element?.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (event.key === " " && element?.closest('button, [role="button"]')) return;
      }
      jumpTargetRef.current = null;
      stopRestoring();
      onScroll();
    };
    const relayout = () => {
      if (restoring && target && containerRef.current?.contains(target)) scrollToHeading(target, "instant");
      onScroll();
    };
    const observer = new ResizeObserver(relayout);
    if (containerRef.current) observer.observe(containerRef.current);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(event, stopRestoring, { passive: true });
    for (const event of ["wheel", "touchmove", "keydown"]) window.addEventListener(event, resumeTracking, { passive: true });
    relayout();

    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(event, stopRestoring);
      for (const event of ["wheel", "touchmove", "keydown"]) window.removeEventListener(event, resumeTracking);
    };
  }, [containerRef, headings]);

  if (headings.length === 0) return null;

  const jumpToHeading = (heading: PublicOutlineFlatHeading) => {
    jumpTargetRef.current = heading.id;
    history.replaceState(history.state, "", `#${heading.id}`);
    setOpen(false);
    const element = document.getElementById(heading.id);
    if (element) scrollToHeading(element, matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
    setActive(heading.id);
  };

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderItems = (items: PublicOutlineHeading[], depth = 0): ReactNode => (
    <ol className={cn("space-y-0.5", depth > 0 && "py-0.5")}>
      {items.map((item) => {
        const hasChildren = item.children.length > 0;
        const itemCollapsed = collapsed.has(item.id);
        const isActive = active === item.id;
        const toggleLabel = t(itemCollapsed ? "editor.expandOutlineHeading" : "editor.collapseOutlineHeading", { name: item.text });
        return (
          <li key={item.id}>
            <div
              className={cn(
                "relative group flex min-h-8 items-center rounded-[6px] pr-2 text-[12px] leading-5 transition-colors duration-150",
                isActive ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50/70 hover:text-slate-900",
              )}
              style={{ paddingLeft: depth * OUTLINE_INDENT }}
            >
              {hasChildren ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                      onClick={() => toggle(item.id)}
                      aria-label={toggleLabel}
                      aria-expanded={!itemCollapsed}
                    >
                      {itemCollapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{toggleLabel}</TooltipContent>
                </Tooltip>
              ) : <span className="h-7 w-6 shrink-0" aria-hidden="true" />}
              <a
                href={`#${item.id}`}
                className="min-w-0 flex-1 truncate py-1 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  jumpToHeading(item);
                }}
                aria-current={isActive ? "location" : undefined}
              >
                {item.text}
              </a>
            </div>
            {hasChildren && !itemCollapsed ? (
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l border-slate-200/90" style={{ left: `calc(${depth * OUTLINE_INDENT}px + 0.75rem)` }} />
                {renderItems(item.children, depth + 1)}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );

  const outline = (
    <TooltipProvider delayDuration={350} skipDelayDuration={100}>
      <div className="select-none overflow-x-hidden" aria-label={t("editor.outline")}>
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-slate-700">{t("editor.outline")}</h2>
          {parentIds.length > 0 ? (
            <div className="flex shrink-0 items-center gap-0.5">
              {([
                ["editor.collapseAllOutline", ChevronsDownUp, true],
                ["editor.expandAllOutline", ChevronsUpDown, false],
              ] as const).map(([label, Icon, collapseAll]) => (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:opacity-40"
                      aria-label={t(label)}
                      disabled={collapseAll ? parentIds.every((id) => collapsed.has(id)) : collapsed.size === 0}
                      onClick={() => setCollapsed(new Set(collapseAll ? parentIds : []))}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t(label)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          ) : null}
        </div>
        <nav className="max-h-[70dvh] overflow-y-auto pr-2" aria-label={t("editor.outline")}>{renderItems(tree)}</nav>
      </div>
    </TooltipProvider>
  );

  return (
    <>
      <aside className="absolute bottom-0 right-3 top-8 hidden w-48 xl:block">
        <div className="sticky top-24">{outline}</div>
      </aside>
      <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
        <DrawerTrigger asChild>
          <Button variant="outline" className="fixed bottom-5 right-5 z-20 shadow-md xl:hidden">{t("editor.outline")}</Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("editor.outline")}</DrawerTitle>
            <DrawerDescription>{t("sharing.readOnly")}</DrawerDescription>
          </DrawerHeader>
          <div className="px-6 pb-8">{outline}</div>
        </DrawerContent>
      </Drawer>
    </>
  );
};
