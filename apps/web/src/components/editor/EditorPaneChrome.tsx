import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileDown, Pencil, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import type { getNotebookMoveOptions } from "@/lib/app-helpers";
import type { ResourceMenuTarget } from "./useEditorResourceActions";

export const IconTooltip = ({ label, children }: { label: string; children: ReactNode }) => (
  <TooltipProvider delayDuration={0} skipDelayDuration={0}>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const EmptyEditorHeader = () => (
  <header className="hidden h-12 shrink-0 items-center justify-end gap-1 border-b border-slate-100 px-5 lg:flex">
    <ThemeToggle />
  </header>
);

export type NoteLinkHintPosition = {
  left: number;
  top: number;
  placement: "above" | "below" | "inside-bottom-right";
};

export const NoteLinkInteractionHint = ({
  label,
  position,
}: {
  label: string;
  position: NoteLinkHintPosition;
}) => createPortal(
  <div
    role="tooltip"
    className="pointer-events-none fixed z-[100] whitespace-nowrap rounded-md bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-md"
    style={{
      left: position.left,
      top: position.top,
      transform: position.placement === "above" ? "translate(-50%, -100%)" : "translateX(-50%)",
    }}
  >
    {label}
  </div>,
  document.body,
);

type ResourceActionLabels = {
  download: string;
  saveAs: string;
  rename: string;
  delete: string;
  unavailable: string;
};

export const ResourceActionMenu = ({
  target,
  canRename,
  canDelete,
  labels,
  onDownload,
  onSaveAs,
  onRename,
  onDelete,
  onMouseEnter,
  onMouseLeave,
}: {
  target: ResourceMenuTarget;
  canRename: boolean;
  canDelete: boolean;
  labels: ResourceActionLabels;
  onDownload: () => void;
  onSaveAs: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) => createPortal(
  <TooltipProvider delayDuration={0} skipDelayDuration={0}>
    <div
      data-edgeever-resource-menu
      role="toolbar"
      aria-label={labels.download}
      className="fixed z-[110] flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      style={{
        left: target.position.left,
        top: target.position.top,
        transform: target.position.placement === "inside-bottom-right"
          ? "translate(-100%, -100%)"
          : target.position.placement === "above"
            ? "translate(-50%, -100%)"
            : "translateX(-50%)",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <IconTooltip label={labels.download}>
        <Button type="button" size="sm" variant="ghost" aria-label={labels.download} onClick={onDownload}>
          <FileDown className="h-3.5 w-3.5" />
          {labels.download}
        </Button>
      </IconTooltip>
      <IconTooltip label={labels.saveAs}>
        <Button type="button" size="sm" variant="ghost" aria-label={labels.saveAs} onClick={onSaveAs}>
          <Save className="h-3.5 w-3.5" />
          {labels.saveAs}
        </Button>
      </IconTooltip>
      <IconTooltip label={canRename ? labels.rename : labels.unavailable}>
        <Button type="button" size="sm" variant="ghost" aria-label={labels.rename} disabled={!canRename} onClick={onRename}>
          <Pencil className="h-3.5 w-3.5" />
          {labels.rename}
        </Button>
      </IconTooltip>
      <IconTooltip label={canDelete ? labels.delete : labels.unavailable}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-slate-600 hover:bg-rose-50 hover:text-rose-600"
          aria-label={labels.delete}
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {labels.delete}
        </Button>
      </IconTooltip>
    </div>
  </TooltipProvider>,
  document.body,
);

type NotebookMoveOption = ReturnType<typeof getNotebookMoveOptions>[number];

export const MobileNotebookSelectSheet = ({
  isUpdating,
  options,
  selectedNotebookId,
  onClose,
  onSelect,
}: {
  isUpdating: boolean;
  options: NotebookMoveOption[];
  selectedNotebookId: string;
  onClose: () => void;
  onSelect: (notebookId: string) => void;
}) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const selectedNode = listRef.current?.querySelector<HTMLElement>(
        `[data-mobile-notebook-select-id="${CSS.escape(selectedNotebookId)}"]`,
      );
      selectedNode?.scrollIntoView({ block: "center" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedNotebookId]);

  return (
    <Drawer open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent className="inset-x-0 max-h-[62dvh] overflow-hidden border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <header className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
          <DrawerHeader className="min-w-0 p-0">
            <DrawerTitle className="text-base">{t("editor.currentNotebook")}</DrawerTitle>
          </DrawerHeader>
          <IconTooltip label={t("editor.close")}>
            <Button size="icon" variant="ghost" aria-label={t("editor.close")} onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </IconTooltip>
        </header>
        <Command className="min-h-0 flex-1">
          <CommandInput placeholder={t("editor.searchNotebook")} />
          <CommandList ref={listRef} className="max-h-[calc(62dvh-6.25rem-env(safe-area-inset-bottom))] p-2">
            <CommandEmpty>{t("editor.noNotebookFound")}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const selected = option.id === selectedNotebookId;
                return (
                  <CommandItem
                    key={option.id}
                    className={cn(
                      "h-12 px-3 text-base",
                      selected ? "bg-emerald-50 font-semibold text-emerald-700 data-[selected=true]:bg-emerald-50" : "text-slate-700",
                    )}
                    style={{ paddingLeft: `${12 + option.depth * 18}px` }}
                    value={option.id}
                    keywords={[option.name, option.selectLabel, option.slug ?? ""]}
                    data-mobile-notebook-select-id={option.id}
                    aria-label={selected ? t("editor.currentNotebookAria", { name: option.name }) : t("editor.switchToNotebook", { name: option.name })}
                    aria-current={selected ? "page" : undefined}
                    disabled={isUpdating}
                    onSelect={() => onSelect(option.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DrawerContent>
    </Drawer>
  );
};
