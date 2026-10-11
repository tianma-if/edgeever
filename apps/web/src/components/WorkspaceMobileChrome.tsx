import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Component, FileText, GitFork, Home, PieChart, Plus, Search, Table2, UserRound, Workflow, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";
import { BETA_BADGE_CLASSNAME } from "@/lib/workspace-ui";
import type { NoteCreateKind, Notebook } from "@edgeever/shared";
import type { MobileBottomNavItem, NotebookNode } from "@/lib/app-helpers";
import {
  buildNotebookTree,
  filterNotebookTree,
  getExpandableNotebookIds,
  getNotebookAncestorIds,
} from "@/lib/app-helpers";

const MobileBottomNavButton = ({
  active = false,
  icon,
  label,
  notice = false,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  notice?: boolean;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "relative mx-auto flex h-12 w-20 flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/25",
      active
        ? "font-bold text-slate-950 [&_svg]:text-slate-950"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
    )}
    type="button"
    aria-current={active ? "page" : undefined}
    aria-label={label}
    onClick={onClick}
  >
    {active ? <span aria-hidden="true" className="absolute top-0 h-0.5 w-5 rounded-full bg-slate-950" /> : null}
    <span className="relative">
      {icon}
      {notice ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-card" /> : null}
    </span>
    <span>{label}</span>
  </button>
);

export const MobileBottomNav = ({
  activeItem,
  canCreateMemo,
  isCreating,
  onCreateMemo,
  onHome,
  onOpenSettings,
}: {
  activeItem: MobileBottomNavItem;
  canCreateMemo: boolean;
  isCreating: boolean;
  onCreateMemo: (kind?: NoteCreateKind) => void;
  onHome: () => void;
  onOpenSettings: () => void;
}) => {
  const { t } = useTranslation();
  const { unseen: deployedUpdateUnseen } = useDeployedUpdateNotice();
  const createMemoLabel = !canCreateMemo ? t("nav.createDisabled") : isCreating ? t("nav.creating") : t("nav.createMemo");

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-card/95 px-5 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-0 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
      aria-label={t("nav.mobileMain")}
    >
      <div className="relative grid h-mobile-bottom-nav grid-cols-3 items-center">
        <MobileBottomNavButton active={activeItem === "home"} icon={<Home className="h-5 w-5" />} label={t("nav.home")} onClick={onHome} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-mobile-touch flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              aria-label={createMemoLabel}
              disabled={!canCreateMemo || isCreating}
            >
              <Plus className="h-5 w-5" />
              <span>{t("nav.createMemo")}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" sideOffset={8} className="w-52">
            <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo()}>
              <FileText className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("diagram.normalNote")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("mind-map")}>
              <GitFork className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("diagram.mindMap")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("flowchart")}>
              <Workflow className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("diagram.flowchart")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("architecture")}>
              <Component className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("diagram.architecture")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("infographic")}>
              <PieChart className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("infographic.name")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("poster")}>
        <FileText className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("poster.name")}</span>
        <span className={BETA_BADGE_CLASSNAME}>Beta</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("table")}>
              <Table2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("structuredTable.name")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <MobileBottomNavButton active={activeItem === "settings"} icon={<UserRound className="h-5 w-5" />} label={t("nav.mine")} notice={deployedUpdateUnseen} onClick={onOpenSettings} />
      </div>
    </nav>
  );
};

export const MobileNotebookPicker = ({
  currentLabel,
  notebooks,
  selectedNotebookId,
  onClose,
  onSelectAll,
  onSelect,
}: {
  currentLabel?: string;
  notebooks: Notebook[];
  selectedNotebookId: string | null;
  onClose: () => void;
  onSelectAll: () => void;
  onSelect: (notebookId: string) => void;
}) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [notebookSearch, setNotebookSearch] = useState("");
  const tree = useMemo(() => buildNotebookTree(notebooks), [notebooks]);
  const filteredTree = useMemo(() => filterNotebookTree(tree, notebookSearch), [notebookSearch, tree]);
  const selectedAncestorIds = useMemo(
    () => (selectedNotebookId ? getNotebookAncestorIds(tree, selectedNotebookId) : []),
    [selectedNotebookId, tree]
  );
  const expandableNotebookIds = useMemo(() => getExpandableNotebookIds(tree), [tree]);
  const [expandedNotebookIds, setExpandedNotebookIds] = useState<Set<string>>(() => new Set(selectedAncestorIds));
  const allSelected = !currentLabel && selectedNotebookId === null;
  const selectedNotebookName =
    currentLabel ?? (allSelected ? t("mobileNotebookPicker.allMemos") : notebooks.find((item) => item.id === selectedNotebookId)?.name ?? t("mobileNotebookPicker.notebookFallback"));
  const searchQuery = notebookSearch.trim();
  const searchActive = Boolean(searchQuery);
  const allNotebookBranchesExpanded =
    expandableNotebookIds.length > 0 && expandableNotebookIds.every((notebookId) => expandedNotebookIds.has(notebookId));

  useEffect(() => {
    if (selectedAncestorIds.length === 0) {
      return;
    }
    setExpandedNotebookIds((current) => {
      const next = new Set(current);
      for (const notebookId of selectedAncestorIds) {
        next.add(notebookId);
      }
      return next;
    });
  }, [selectedAncestorIds]);

  useEffect(() => {
    if (searchActive) {
      return;
    }
    window.setTimeout(() => {
      const listNode = listRef.current;
      const targetNotebookId = selectedNotebookId ?? "__all__";
      const selectedNode = listNode?.querySelector<HTMLElement>(`[data-mobile-notebook-id="${CSS.escape(targetNotebookId)}"]`);
      selectedNode?.scrollIntoView({ block: "center" });
    }, 0);
  }, [searchActive, selectedNotebookId]);

  const handleToggleNotebookExpanded = (notebookId: string) => {
    setExpandedNotebookIds((current) => {
      const next = new Set(current);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      return next;
    });
  };

  const handleToggleAllNotebookBranches = () => {
    setExpandedNotebookIds(allNotebookBranchesExpanded ? new Set() : new Set(expandableNotebookIds));
  };

  return (
    <Drawer open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent className="inset-x-0 max-h-[82dvh] overflow-hidden border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <DrawerHeader className="min-w-0 p-0">
            <DrawerTitle className="text-base">{t("mobileNotebookPicker.title")}</DrawerTitle>
            <DrawerDescription className="truncate">{t("mobileNotebookPicker.current", { name: selectedNotebookName })}</DrawerDescription>
          </DrawerHeader>
          <Button size="icon" variant="ghost" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="border-b border-slate-100 px-4 py-2">
          <div className="flex h-9 items-center gap-2 rounded-md bg-slate-100 px-3 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <input
              className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
              value={notebookSearch}
              placeholder={t("mobileNotebookPicker.searchPlaceholder")}
              aria-label={t("mobileNotebookPicker.searchPlaceholder")}
              onChange={(event) => setNotebookSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && notebookSearch) {
                  event.preventDefault();
                  setNotebookSearch("");
                }
              }}
            />
            {notebookSearch && (
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-card hover:text-slate-700"
                type="button"
                title={t("mobileNotebookPicker.clearSearch")}
                aria-label={t("mobileNotebookPicker.clearSearch")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setNotebookSearch("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div ref={listRef} className="max-h-[calc(82dvh_-_8.25rem_-_env(safe-area-inset-bottom))] overflow-y-auto p-2">
          <button
            className={cn(
              "mb-1 flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition",
              allSelected ? "bg-slate-100 font-semibold text-slate-950" : "text-slate-800 hover:bg-slate-50"
            )}
            type="button"
            data-mobile-notebook-id="__all__"
            aria-label={allSelected ? t("mobileNotebookPicker.currentAll") : t("mobileNotebookPicker.switchAll")}
            aria-current={allSelected ? "page" : undefined}
            onClick={onSelectAll}
          >
            <span className="min-w-0 flex-1 truncate text-base">{t("mobileNotebookPicker.allMemos")}</span>
          </button>
          {filteredTree.length > 0 ? (
            <>
              <div className="mb-1 flex h-8 items-center justify-between px-3 text-xs font-semibold text-slate-400">
                <span>{searchActive ? t("mobileNotebookPicker.matchedNotebooks") : t("mobileNotebookPicker.notebooks")}</span>
                {!searchActive && expandableNotebookIds.length > 0 && (
                  <button
                    className="rounded-md px-2 py-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    aria-label={allNotebookBranchesExpanded ? t("mobileNotebookPicker.collapseAllAria") : t("mobileNotebookPicker.expandAllAria")}
                    aria-pressed={allNotebookBranchesExpanded}
                    onClick={handleToggleAllNotebookBranches}
                  >
                    {allNotebookBranchesExpanded ? t("mobileNotebookPicker.collapseAll") : t("mobileNotebookPicker.expandAll")}
                  </button>
                )}
              </div>
              {filteredTree.map((node) => (
                <MobileNotebookPickerItem
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedNotebookIds={expandedNotebookIds}
                  searchActive={searchActive}
                  selectedNotebookId={selectedNotebookId}
                  onSelect={onSelect}
                  onToggleExpanded={handleToggleNotebookExpanded}
                />
              ))}
            </>
          ) : (
            <div className="px-3 py-8 text-center">
              <div className="text-sm font-medium text-slate-700">
                {searchQuery ? t("mobileNotebookPicker.noSearchResult", { query: searchQuery }) : t("mobileNotebookPicker.noNotebook")}
              </div>
              {searchQuery && (
                <button
                  className="mt-3 text-sm font-semibold text-slate-600"
                  type="button"
                  onClick={() => setNotebookSearch("")}
                >
                  {t("mobileNotebookPicker.showAll")}
                </button>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};

const MobileNotebookPickerItem = ({
  node,
  depth,
  expandedNotebookIds,
  searchActive,
  selectedNotebookId,
  onSelect,
  onToggleExpanded,
}: {
  node: NotebookNode;
  depth: number;
  expandedNotebookIds: Set<string>;
  searchActive: boolean;
  selectedNotebookId: string | null;
  onSelect: (notebookId: string) => void;
  onToggleExpanded: (notebookId: string) => void;
}) => {
  const { t } = useTranslation();
  const selected = node.id === selectedNotebookId;
  const hasChildren = node.children.length > 0;
  const expanded = searchActive || expandedNotebookIds.has(node.id);

  return (
    <div>
      <div
        data-mobile-notebook-id={node.id}
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition",
          selected
            ? "bg-slate-100 font-semibold text-black dark:text-slate-950"
            : "text-slate-800 hover:bg-slate-50"
        )}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        {hasChildren ? (
          <button
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition",
              selected ? "text-slate-950" : "text-slate-400",
              searchActive ? "cursor-default" : selected ? "hover:bg-slate-100" : "hover:bg-slate-100 hover:text-slate-700"
            )}
            type="button"
            disabled={searchActive}
            aria-label={expanded ? t("mobileNotebookPicker.collapse", { name: node.name }) : t("mobileNotebookPicker.expand", { name: node.name })}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(node.id);
            }}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        )}
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          type="button"
          aria-label={selected ? t("mobileNotebookPicker.currentNotebook", { name: node.name }) : t("mobileNotebookPicker.switchToNotebook", { name: node.name })}
          aria-current={selected ? "page" : undefined}
          onClick={() => onSelect(node.id)}
        >
          <span className="min-w-0 flex-1 truncate text-base">{node.name}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <div className="mt-1 border-l border-slate-100 pl-1">
          {node.children.map((child) => (
            <MobileNotebookPickerItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedNotebookIds={expandedNotebookIds}
              searchActive={searchActive}
              selectedNotebookId={selectedNotebookId}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
