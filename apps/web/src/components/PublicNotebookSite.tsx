import type { PublicNotebookShare } from "@edgeever/shared";
import { NotebookSiteSearch, NotebookSiteSearchContext } from "./NotebookSiteSearch";
import { useAppearanceTheme, type ThemePreference } from "./ThemeProvider";
import { ButtonTooltip } from "./ui/button-tooltip";
import "./notebook-site.css";
import { getMemoDisplayTitle } from "@edgeever/shared";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Notebook = PublicNotebookShare["notebooks"][number];
type Memo = PublicNotebookShare["memos"][number];
type Section = { notebook: Notebook; path: Notebook[]; memos: Memo[] };

const linkClass =
  "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2";

const NavigationNotes = ({
  memos,
  selectedId,
  href,
  onNavigate,
}: {
  memos: Memo[];
  selectedId?: string;
  href: (id: string) => string;
  onNavigate: () => void;
}) => {
  const { t } = useTranslation();
  const selected = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  return (
    <ul className="space-y-0.5">
      {memos.map((memo) => {
        const title = getMemoDisplayTitle(memo.title, t("common.untitledMemo"));
        return (
          <li key={memo.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  ref={selectedId === memo.id ? selected : undefined}
                  to={href(memo.id)}
                  onClick={onNavigate}
                  aria-current={selectedId === memo.id ? "page" : undefined}
                  className={cn(
                    linkClass,
                    "block px-3 py-2 text-[13px] leading-5 transition-colors",
                    selectedId === memo.id
                      ? "bg-slate-100 font-medium text-slate-950"
                      : "text-slate-500 hover:bg-slate-100/70 hover:text-slate-900",
                  )}
                >
                  <span className="line-clamp-2 break-words">{title}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-72 break-words">
                {title}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
};

const NavigationSection = ({
  section,
  selectedId,
  containsSelection,
  href,
  onNavigate,
}: {
  section: Section;
  selectedId?: string;
  containsSelection: boolean;
  href: (id: string) => string;
  onNavigate: () => void;
}) => {
  const [open, setOpen] = useState(containsSelection);
  useEffect(() => {
    if (containsSelection) setOpen(true);
  }, [selectedId, containsSelection]);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-5">
      <CollapsibleTrigger
        className={cn(
          linkClass,
          "group flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] font-semibold text-slate-900 hover:bg-slate-100/70",
        )}
      >
        <span className="min-w-0 break-words">
          {section.path
            .slice(1)
            .map((item) => item.name)
            .join(" / ")}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        <NavigationNotes
          memos={section.memos}
          selectedId={selectedId}
          href={href}
          onNavigate={onNavigate}
        />
      </CollapsibleContent>
    </Collapsible>
  );
};

const NoteTitle = ({ memo }: { memo: Memo }) => {
  const { t } = useTranslation();
  return (
    <span className="min-w-0 break-words">
      {getMemoDisplayTitle(memo.title, t("common.untitledMemo"))}
    </span>
  );
};

const HomepageContents = ({
  sections,
  href,
  onNavigate,
}: {
  sections: Section[];
  href: (id: string) => string;
  onNavigate: () => void;
}) => {
  const { t } = useTranslation();
  const children = useMemo(() => {
    const children = new Map<string, Section[]>();
    for (const section of sections) {
      const parent = section.path.at(-2);
      if (parent) {
        const siblings = children.get(parent.id) ?? [];
        siblings.push(section);
        children.set(parent.id, siblings);
      }
    }
    return children;
  }, [sections]);
  const renderContents = (section: Section, nested: boolean): ReactNode => (
    <ul
      className={cn(
        "space-y-2 pl-6",
        nested ? "mt-2 list-[circle]" : "list-disc",
      )}
    >
      {section.memos
        .map((memo) => (
          <li key={memo.id} className="pl-1 marker:text-slate-400">
            <Link
              to={href(memo.id)}
              onClick={onNavigate}
              className={cn(
                linkClass,
                "break-words text-slate-700 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-slate-950 hover:decoration-slate-900 focus-visible:text-slate-950 focus-visible:decoration-slate-900",
              )}
            >
              <NoteTitle memo={memo} />
            </Link>
          </li>
        ))}
      {(children.get(section.notebook.id) ?? [])
        .map((child) => (
          <li
            key={child.notebook.id}
            id={`section-${child.notebook.id}`}
            className="scroll-mt-24 pt-3 pl-1 marker:text-slate-400"
          >
            <span className="break-words font-semibold text-slate-900">
              {child.notebook.name}
            </span>
            {(child.memos.length > 0 || children.has(child.notebook.id)) &&
              renderContents(child, true)}
          </li>
        ))}
    </ul>
  );
  return (
    <nav
      aria-label={t("sharing.notebookContents")}
      id={`section-${sections[0]?.notebook.id}`}
      className="mt-9 scroll-mt-24 text-base leading-7 sm:text-[17px] sm:leading-8"
    >
      <h2 className="mb-6 border-b border-slate-200 pb-4 text-2xl font-semibold tracking-tight">
        {t("sharing.notebookContents")}
      </h2>
      {sections[0] && renderContents(sections[0], false)}
    </nav>
  );
};

const SiteLogo = ({ src }: { src?: string | null }) => {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img src={src} alt="" className="size-8 shrink-0 rounded-lg object-contain" onError={() => setFailed(true)} /> : <BookOpen className="size-6 shrink-0" />;
};

export const PublicNotebookSite = ({ share, token, selectedId, children }: {
  share: PublicNotebookShare; token: string; selectedId?: string; children?: ReactNode;
}) => {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const { preference, setPreference } = useAppearanceTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tag, setTag] = useState("");
  const root = share.siteSlug ? `/s/${encodeURIComponent(share.siteSlug)}` : `/share/notebook/${encodeURIComponent(token)}`;
  const directory = `${root}?contents=1`;
  const href = (id: string) => `${root}/${encodeURIComponent(id)}`;
  const sections = useMemo(() => {
    const result: Section[] = [];
    const notebooks = new Map(share.notebooks.map((item) => [item.id, item]));
    const children = new Map<string, Notebook[]>();
    const memos = new Map<string, Memo[]>();
    for (const notebook of share.notebooks) {
      if (!notebook.parentId) continue;
      const siblings = children.get(notebook.parentId) ?? [];
      siblings.push(notebook); children.set(notebook.parentId, siblings);
    }
    for (const memo of share.memos) {
      const siblings = memos.get(memo.notebookId) ?? [];
      siblings.push(memo); memos.set(memo.notebookId, siblings);
    }
    const visited = new Set<string>();
    const visit = (notebook: Notebook, path: Notebook[]) => {
      if (visited.has(notebook.id)) return;
      visited.add(notebook.id);
      const nextPath = [...path, notebook];
      result.push({ notebook, path: nextPath, memos: memos.get(notebook.id) ?? [] });
      for (const child of children.get(notebook.id) ?? []) visit(child, nextPath);
    };
    visit(notebooks.get(share.notebookId) ?? { id: share.notebookId, parentId: null, name: share.name }, []);
    return result;
  }, [share]);
  const notes = useMemo(() => sections.flatMap((section) => section.memos.map((memo) => ({ memo, section }))), [sections]);
  const index = notes.findIndex(({ memo }) => memo.id === selectedId);
  const current = notes[index];
  const navigate = () => setMobileOpen(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (hash && !selectedId) {
      try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start", behavior: "instant" }); } catch { /* Ignore malformed fragments. */ }
    } else if (!hash) window.scrollTo({ top: 0, behavior: "instant" });
  }, [selectedId, token, hash]);
  const contents = <div className="flex min-h-0 flex-1 flex-col">
    <div className="px-6 pb-4"><Button variant="outline" className="w-full justify-start text-xs" onClick={() => setSearchOpen(true)}><Search className="size-4" />{t("sharing.siteSearch")}</Button></div>
    <nav aria-label={t("sharing.notebookContents")} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <Link to={root} onClick={navigate} className={`${linkClass} block px-3 py-2 text-sm font-medium`}>{t("sharing.siteHome")}</Link>
      {share.settings?.homeMemoId && <Link to={directory} onClick={navigate} className={`${linkClass} block px-3 py-2 text-sm`}>{t("notebookSite.directory")}</Link>}
      {sections[0] && <NavigationNotes memos={sections[0].memos} selectedId={selectedId} href={href} onNavigate={navigate} />}
      {sections.slice(1).filter((section) => section.memos.length).map((section) => <NavigationSection key={section.notebook.id} section={section} selectedId={selectedId} containsSelection={section.memos.some((memo) => memo.id === selectedId)} href={href} onNavigate={navigate} />)}
    </nav><div className="px-8 py-5 text-[11px] text-muted-foreground">{t("sharing.sitePoweredBy")}</div>
  </div>;
  return <NotebookSiteSearchContext.Provider value={(selectedTag) => { setTag(selectedTag ?? ""); setSearchOpen(true); }}><TooltipProvider delayDuration={400}>
    <div data-site-theme="default" className="edgeever-notebook-site min-h-[100dvh] bg-card text-foreground">
      <a href="#notebook-site-content" className="sr-only z-[60] rounded-md bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">{t("sharing.siteSkipToContent")}</a>
      <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        <Link to={root} onClick={navigate} className={`${linkClass} flex min-w-0 items-center gap-3 font-semibold`}><SiteLogo key={share.settings?.logoUrl} src={share.settings?.logoUrl} /><span className="max-w-[40vw] truncate">{share.name}</span></Link>
        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex flex-wrap gap-3 text-xs">{share.settings?.headerLinks.map((link, i) => <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{link.label}</a>)}</nav>
          <select aria-label={t("notebookSite.theme")} value={preference} onChange={(event) => setPreference(event.target.value as ThemePreference)} className="max-w-28 rounded border bg-background px-1 py-1 text-xs">{(["light", "dark", "system"] as const).map((value) => <option key={value} value={value}>{t(`notebookSite.${value}`)}</option>)}</select>
          <ButtonTooltip title={t(sidebarOpen ? "sharing.siteHideContents" : "sharing.siteShowContents")}><Button variant="ghost" size="icon" className="hidden lg:inline-flex" aria-label={t(sidebarOpen ? "sharing.siteHideContents" : "sharing.siteShowContents")} aria-expanded={sidebarOpen} aria-controls="notebook-site-sidebar" onClick={() => setSidebarOpen((open) => !open)}>{sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}</Button></ButtonTooltip>
          <Drawer open={mobileOpen} onOpenChange={setMobileOpen} shouldScaleBackground={false}><DrawerTrigger asChild><Button variant="outline" size="sm" className="lg:hidden"><Menu className="size-4" />{t("sharing.notebookContents")}</Button></DrawerTrigger><DrawerContent className="h-[85dvh] bg-card"><DrawerHeader><DrawerTitle>{share.name}</DrawerTitle><DrawerDescription>{t("sharing.siteNoteCount", { count: notes.length })}</DrawerDescription><DrawerClose asChild><Button variant="outline" size="sm">{t("common.close")}</Button></DrawerClose></DrawerHeader>{contents}</DrawerContent></Drawer>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px] items-start">
        <aside id="notebook-site-sidebar" className={cn("sticky top-16 hidden h-[calc(100dvh-4rem)] w-72 shrink-0 flex-col border-r bg-card pt-6", sidebarOpen && "lg:flex")}>{contents}</aside>
        <main id="notebook-site-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {!selectedId ? <div className="mx-auto max-w-5xl px-5 py-10 sm:px-10 sm:py-14"><p className="mb-4 text-sm text-muted-foreground">{t("sharing.siteNoteCount", { count: notes.length })}</p><h1 className="break-words text-3xl font-bold">{share.name}</h1>{!notes.length && <p className="mt-4">{t("sharing.notebookEmpty")}</p>}<HomepageContents sections={sections} href={href} onNavigate={navigate} /></div> : <>
            <nav aria-label={t("sharing.siteBreadcrumb")} className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-xs text-muted-foreground"><Link to={root} onClick={navigate}>{t("sharing.siteHome")}</Link>{current?.section.path.map((notebook) => <span key={notebook.id} className="contents"><ChevronRight className="size-3" /><Link to={`${directory}#section-${notebook.id}`} onClick={navigate}>{notebook.name}</Link></span>)}{current && <span aria-current="page"><NoteTitle memo={current.memo} /></span>}</nav>
            {children}
            {current && <nav aria-label={t("sharing.siteReadingNavigation")} className="mx-auto grid max-w-4xl grid-cols-2 gap-4 border-t px-5 py-8 sm:px-10">
              {notes[index - 1] ? <Link to={href(notes[index - 1].memo.id)} onClick={navigate} className={`${linkClass} min-w-0 p-3 hover:bg-muted`}><span className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><ArrowLeft className="size-3.5" />{t("sharing.sitePrevious")}</span><NoteTitle memo={notes[index - 1].memo} /></Link> : <span />}
              {notes[index + 1] && <Link to={href(notes[index + 1].memo.id)} onClick={navigate} className={`${linkClass} min-w-0 p-3 text-right hover:bg-muted`}><span className="mb-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">{t("sharing.siteNext")}<ArrowRight className="size-3.5" /></span><NoteTitle memo={notes[index + 1].memo} /></Link>}
            </nav>}
          </>}
          {share.settings?.footerText && <footer className="whitespace-pre-wrap border-t px-5 py-6 text-sm text-muted-foreground">{share.settings.footerText}</footer>}
        </main>
      </div>
    </div>
    <NotebookSiteSearch token={token} share={share} root={root} open={searchOpen} setOpen={setSearchOpen} tag={tag} setTag={setTag} />
  </TooltipProvider></NotebookSiteSearchContext.Provider>;
};
