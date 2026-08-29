import { lazy, Suspense, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import {
  ChevronLeft,
  Plus,
  LayoutList,
  LayoutTemplate,
  Sparkles,
  BookPlus,
  ArrowDownWideNarrow,
  Notebook as NotebookIcon,
  Tags,
  Archive,
  Trash2,
  KeyRound,
  LogOut,
  CloudOff,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  CircleUserRound,
  Download,
  ExternalLink,
  RotateCcw,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotebookTreeItem } from "./NotebookTreeItem";
import { cn } from "@/lib/utils";
import type { Notebook, AuthUser } from "@edgeever/shared";
import type { NotebookNode, NotebookDropPosition, NotebookSortMode } from "@/lib/app-helpers";
import type { SyncQueueSummary } from "@/lib/sync-queue";
import {
  buildNotebookTree,
  getNotebookSortOptions,
  getNotebookSortComparator,
  hasEdgeEverDragData,
  readNotebookSortPreference,
  writeNotebookSortPreference,
} from "@/lib/app-helpers";
import type { EdgeEverRepository } from "@/lib/repository";
import { statusSettleMotion } from "@/lib/motion";
import { DesktopUpdateNotice } from "./DesktopUpdateNotice";

const DesktopSyncIssuesDialog = lazy(() => import("./DesktopSyncIssuesDialog").then((module) => ({ default: module.DesktopSyncIssuesDialog })));

const NOTEBOOK_DRAG_SCROLL_EDGE_PX = 56;
const NOTEBOOK_DRAG_SCROLL_MAX_STEP_PX = 18;
const DESKTOP_DOWNLOAD_URL = "https://github.com/tianma-if/edgeever/releases/latest";
const ANDROID_PLAY_URL = "https://play.google.com/store/apps/details?id=org.edgeever.mobile";
const ANDROID_APK_URL = "https://github.com/tianma-if/edgeever/releases/latest";
const IOS_DOWNLOAD_URL = "https://apps.apple.com/us/app/edgeever/id6792625631";
const CHROMIUM_CLIPPER_URL = "https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo";
const FIREFOX_CLIPPER_URL = "https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/";

const BrandIconContainer = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span
    className={cn(
      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
      className
    )}
  >
    {children}
  </span>
);

const BrandIcon = ({ path, color, className }: { path: string; color: string; className?: string }) => (
  <svg className={cn("h-3.5 w-3.5 shrink-0", className)} viewBox="0 0 24 24" aria-hidden="true" style={{ color }}>
    <path fill="currentColor" d={path} />
  </svg>
);

const AppStoreIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0 rounded-[2px] bg-[#0D96F6] p-[1.5px] text-white" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="m8.809 14.92l6.11-11.037c.084-.152.168-.302.244-.459c.069-.142.127-.285.165-.44c.08-.326.058-.666-.066-.977a1.5 1.5 0 0 0-.62-.735a1.42 1.42 0 0 0-.922-.193c-.32.043-.613.194-.844.43c-.11.11-.2.235-.283.368c-.092.146-.175.298-.259.45l-.386.697l-.387-.698c-.084-.151-.167-.303-.259-.449a2.2 2.2 0 0 0-.283-.369a1.45 1.45 0 0 0-.844-.429a1.42 1.42 0 0 0-.921.193a1.5 1.5 0 0 0-.62.735a1.6 1.6 0 0 0-.066.977c.038.155.096.298.164.44c.076.157.16.307.244.459l1.248 2.254l-4.862 8.782H2.03c-.168 0-.336 0-.503.01c-.152.009-.3.028-.448.071c-.31.09-.582.28-.778.548A1.58 1.58 0 0 0 .3 17.404c.197.268.468.457.779.548c.148.043.296.062.448.071c.167.01.335.01.503.01h13.097a2 2 0 0 0 .1-.27c.415-1.416-.616-2.844-2.035-2.844zm-5.696 3.622l-.792 1.5c-.082.156-.165.31-.239.471a2.4 2.4 0 0 0-.16.452a1.7 1.7 0 0 0 .064 1.003c.121.318.334.583.607.755s.589.242.901.197c.314-.044.6-.198.826-.44c.108-.115.196-.242.278-.378c.09-.15.171-.306.253-.462L6 19.464c-.09-.15-.947-1.47-2.887-.922m20.586-3.006a1.47 1.47 0 0 0-.779-.54a2 2 0 0 0-.448-.071c-.168-.01-.335-.01-.503-.01h-3.321L14.258 7.1a4.06 4.06 0 0 0-1.076 2.198a4.64 4.64 0 0 0 .546 3l5.274 9.393c.084.15.167.3.259.444c.084.13.174.253.283.364c.231.232.524.38.845.423s.643-.024.922-.19a1.5 1.5 0 0 0 .621-.726c.125-.307.146-.642.066-.964a2.2 2.2 0 0 0-.165-.434c-.075-.155-.16-.303-.244-.453l-1.216-2.166h1.596c.168 0 .335 0 .503-.009c.152-.009.3-.028.448-.07a1.47 1.47 0 0 0 .78-.541a1.54 1.54 0 0 0 .3-.916a1.54 1.54 0 0 0-.3-.916" />
  </svg>
);

const GooglePlayIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 28.99 31.99" aria-hidden="true">
    <path fill="#EA4335" d="M13.54 15.28.12 29.34a3.66 3.66 0 0 0 5.33 2.16l15.1-8.6Z" />
    <path fill="#FBBC04" d="m27.11 12.89l-6.53-3.74l-7.35 6.45l7.38 7.28l6.48-3.7a3.54 3.54 0 0 0 1.5-4.79a3.62 3.62 0 0 0-1.5-1.5" />
    <path fill="#4285F4" d="M.12 2.66a3.57 3.57 0 0 0-.12.92v24.84a3.57 3.57 0 0 0 .12.92L14 15.64Z" />
    <path fill="#34A853" d="m13.64 16l6.94-6.85L5.5.51A3.73 3.73 0 0 0 3.63 0A3.64 3.64 0 0 0 .12 2.65Z" />
  </svg>
);

const APPLE_ICON_PATH = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04c-2.04.027-3.91 1.183-4.961 3.014c-2.117 3.675-.546 9.103 1.519 12.09c1.013 1.454 2.208 3.09 3.792 3.039c1.52-.065 2.09-.987 3.935-.987c1.831 0 2.35.987 3.96.948c1.637-.026 2.676-1.48 3.676-2.948c1.156-1.688 1.636-3.325 1.662-3.415c-.039-.013-3.182-1.221-3.22-4.857c-.026-3.04 2.48-4.494 2.597-4.559c-1.429-2.09-3.623-2.324-4.39-2.376c-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83c-1.207.052-2.662.805-3.532 1.818c-.78.896-1.454 2.338-1.273 3.714c1.338.104 2.715-.688 3.559-1.701";
const WINDOWS_ICON_PATH = "M0 0h11.377v11.372H0Zm12.623 0H24v11.372H12.623ZM0 12.623h11.377V24H0Zm12.623 0H24V24H12.623";
const CHROME_ICON_PATH = "M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0M1.931 5.47A11.94 11.94 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257q.309.015.621.016c6.627 0 12-5.373 12-12c0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728a4.364 4.364 0 0 1 0 8.728";
const EDGE_ICON_PATH = "M21.86 17.86q.14 0 .25.12q.1.13.1.25t-.11.33l-.32.46l-.43.53l-.44.5q-.21.25-.38.42l-.22.23q-.58.53-1.34 1.04t-1.6.91q-.86.4-1.74.64t-1.67.24q-.9 0-1.69-.28q-.8-.28-1.48-.78T9.57 21.3q-.53-.66-.92-1.44q-.38-.77-.58-1.6t-.2-1.67q0-1 .32-1.96q.33-.97.87-1.8q.14.95.55 1.77t1.02 1.5q.6.68 1.38 1.21q.78.54 1.64.9t1.77.56q.92.2 1.8.2q1.12 0 2.18-.24q1.06-.23 2.06-.72l.2-.1zm-15.5-1.27q0 1.1.27 2.15q.27 1.06.78 2.03q.51.96 1.24 1.77q.74.82 1.66 1.4q-1.47-.2-2.8-.74q-1.33-.55-2.48-1.37q-1.15-.83-2.08-1.9q-.92-1.07-1.58-2.33T.36 14.94Q0 13.54 0 12.06q0-.81.32-1.49q.31-.68.83-1.23q.53-.55 1.2-.96q.66-.4 1.35-.66q.74-.27 1.5-.39q.78-.12 1.55-.12q.7 0 1.42.1q.72.12 1.4.35t1.32.57q.63.35 1.16.83q-.35 0-.7.07q-.33.07-.65.23v-.02q-.63.28-1.2.74t-1.05 1.04t-.87 1.26q-.38.67-.65 1.39q-.27.71-.42 1.44q-.15.72-.15 1.38M11.96.06q1.7 0 3.33.39q1.63.38 3.07 1.15q1.43.77 2.62 1.93q1.18 1.16 1.98 2.7q.49.94.76 1.96q.28 1 .28 2.08q0 .89-.23 1.7q-.24.8-.69 1.48t-1.1 1.22q-.64.53-1.45.88q-.54.24-1.11.36q-.58.13-1.16.13q-.42 0-.97-.03q-.54-.03-1.1-.12q-.55-.1-1.05-.28q-.5-.19-.84-.5q-.12-.09-.23-.24q-.1-.16-.1-.33q0-.15.16-.35t.35-.5q.2-.28.36-.68t.16-.95q0-1.06-.4-1.96q-.4-.91-1.06-1.64q-.66-.74-1.52-1.28q-.86-.55-1.79-.89q-.84-.3-1.72-.44q-.87-.14-1.76-.14q-1.55 0-3.06.45T.94 7.55q.71-1.74 1.81-3.13q1.1-1.38 2.52-2.35Q6.68 1.1 8.37.58q1.7-.52 3.58-.52Z";
const FIREFOX_ICON_PATH = "M8.824 7.287c.008 0 .004 0 0 0m-2.8-1.4c.006 0 .003 0 0 0m16.754 2.161c-.505-1.215-1.53-2.528-2.333-2.943c.654 1.283 1.033 2.57 1.177 3.53l.002.02c-1.314-3.278-3.544-4.6-5.366-7.477c-.091-.147-.184-.292-.273-.446a4 4 0 0 1-.13-.24a2 2 0 0 1-.172-.46a.03.03 0 0 0-.027-.03a.04.04 0 0 0-.021 0l-.006.001l-.01.005l.005-.008c-2.585 1.515-3.657 4.168-3.932 5.856a6.2 6.2 0 0 0-2.305.587a.297.297 0 0 0-.147.37c.057.162.24.24.396.17a5.6 5.6 0 0 1 2.008-.523l.067-.005a5.9 5.9 0 0 1 1.957.222l.095.03a6 6 0 0 1 .616.228q.12.054.238.112l.107.055a6 6 0 0 1 .368.211a5.95 5.95 0 0 1 2.034 2.104c-.62-.437-1.733-.868-2.803-.681c4.183 2.09 3.06 9.292-2.737 9.02a5.2 5.2 0 0 1-1.513-.292a4 4 0 0 1-.538-.232c-1.42-.735-2.593-2.121-2.74-3.806c0 0 .537-2 3.845-2c.357 0 1.38-.998 1.398-1.287c-.005-.095-2.029-.9-2.817-1.677c-.422-.416-.622-.616-.8-.767a4 4 0 0 0-.301-.227a5.4 5.4 0 0 1-.032-2.842c-1.195.544-2.124 1.403-2.8 2.163h-.006c-.46-.584-.428-2.51-.402-2.913c-.006-.025-.343.176-.389.206a8.4 8.4 0 0 0-1.136.974q-.596.606-1.085 1.303a9.8 9.8 0 0 0-1.562 3.52c-.003.013-.11.487-.19 1.073q-.02.135-.037.272a8 8 0 0 0-.069.667l-.002.034l-.023.387l-.001.06C.386 18.795 5.593 24 12.016 24c5.752 0 10.527-4.176 11.463-9.661q.028-.223.052-.448c.232-1.994-.025-4.09-.753-5.844z";

const SidebarNavButton = ({
  active = false,
  tone = "default",
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  tone?: "default" | "warning";
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium leading-none transition-all duration-200",
      tone === "warning"
        ? "text-amber-700 hover:bg-amber-50/70 hover:text-amber-800"
        : active
          ? "edgeever-workspace-selection text-slate-950 font-medium"
          : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
    )}
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-200", active && "text-emerald-600 dark:text-emerald-400")}>{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

const SidebarShortcutButton = ({
  active = false,
  icon,
  label,
  onClick,
  showTooltip = true,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  showTooltip?: boolean;
}) => {
  const button = (
    <button
      className={cn(
        "flex h-9 min-w-0 w-full items-center justify-center rounded-md px-0 text-xs font-medium transition-colors duration-200",
        active ? "edgeever-workspace-selection text-emerald-600 dark:text-emerald-400" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
      )}
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={onClick}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="sr-only">{label}</span>
    </button>
  );

  return showTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
};

const SidebarTrashShortcut = ({
  active = false,
  onOpenTrash,
  onEmptyTrash,
}: {
  active?: boolean;
  onOpenTrash: () => void;
  onEmptyTrash: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <div className="group relative min-w-0">
      <SidebarShortcutButton active={active} icon={<Trash2 className="h-4 w-4" />} label={t("notebookPane.trash")} onClick={onOpenTrash} showTooltip={false} />
      {!active && (
        <div className="pointer-events-none absolute right-0 top-full z-20 w-max pt-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            className="relative flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-2 text-xs font-medium text-rose-700 shadow-lg shadow-slate-900/10 transition-colors before:absolute before:-top-1 before:right-16 before:h-2 before:w-2 before:rotate-45 before:border-l before:border-t before:border-rose-200 before:bg-white hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70"
            type="button"
            onClick={onEmptyTrash}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("notebookPane.emptyTrash")}
          </button>
        </div>
      )}
    </div>
  );
};

const SidebarSectionLabel = ({ icon, label }: { icon: ReactNode; label: string }) => (
  <div className="flex h-9 items-center gap-3 px-3 text-xs font-medium leading-none tracking-wide text-slate-500">
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </div>
);

const getSyncStatusLabel = (summary: SyncQueueSummary, isOnline: boolean, isSyncing: boolean, t: ReturnType<typeof useTranslation>["t"]) => {
  if (!isOnline) {
    return summary.total > 0 ? t("notebookPane.sync.offlineWithPending", { count: summary.total }) : t("notebookPane.sync.offline");
  }

  if (isSyncing || summary.syncing > 0) {
    return t("notebookPane.sync.syncing");
  }

  if (summary.conflict > 0) {
    return t("notebookPane.sync.conflicts", { count: summary.conflict });
  }

  if (summary.error > 0) {
    return t("notebookPane.sync.retry", { count: summary.error });
  }

  if (summary.pending > 0) {
    return t("notebookPane.sync.pending", { count: summary.pending });
  }

  return t("notebookPane.sync.synced");
};

const SyncStatusBar = ({
  summary,
  isOnline,
  isSyncing,
  onSyncNow,
  onDiscardConflicts,
  notebooks,
}: {
  summary: SyncQueueSummary;
  isOnline: boolean;
  isSyncing: boolean;
  onSyncNow: () => void;
  onDiscardConflicts: () => void;
  notebooks: Notebook[];
}) => {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasQueuedWork = summary.total > 0;
  const label = getSyncStatusLabel(summary, isOnline, isSyncing, t);
  const statusClassName = !isOnline
    ? "border-slate-200 bg-slate-50 text-slate-600"
    : summary.conflict > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : hasQueuedWork
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-slate-200 bg-white text-slate-500";

  return (
    <div
      className={cn("mb-3 flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 transition-all duration-200", statusClassName)}
      role="status"
      aria-live="polite"
    >
      <m.span
        key={label}
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        aria-hidden="true"
        {...statusSettleMotion}
      >
        {!isOnline ? (
          <CloudOff className="h-4 w-4" />
        ) : summary.conflict > 0 ? (
          <AlertTriangle className="h-4 w-4" />
        ) : hasQueuedWork || isSyncing ? (
          <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
      </m.span>
      <button
        className="min-w-0 flex-1 truncate text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        type="button"
        onClick={() => setDetailsOpen(true)}
      >
        {label}
      </button>
      {summary.conflict > 0 && (
        <button
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-white/70 disabled:opacity-50"
          type="button"
          disabled={!isOnline || isSyncing}
          onClick={onDiscardConflicts}
        >
          {t("notebookPane.sync.discardConflicts")}
        </button>
      )}
      {hasQueuedWork && (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/70 disabled:opacity-50 transition-colors"
                type="button"
                aria-label={t("notebookPane.syncNow")}
                disabled={!isOnline || isSyncing}
                onClick={onSyncNow}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("notebookPane.syncNow")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {detailsOpen && (
        <Suspense fallback={null}>
          <DesktopSyncIssuesDialog
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            notebooks={notebooks}
            onSyncNow={onSyncNow}
          />
        </Suspense>
      )}
    </div>
  );
};

export const NotebookPane = ({
  repository,
  user,
  view,
  selectedNotebookId,
  onSelect,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onMoveNotebook,
  onMoveMemos,
  onBackToList,
  onOpenTags,
  onOpenAssets,
  onOpenTemplates,
  onOpenAiPrompts,
  onOpenPluginMarketplace,
  onOpenTrash,
  onEmptyTrash,
  onOpenSettings,
  onCreateMemo,
  canCreateMemo,
  isCreatingMemo,
  syncSummary,
  isOnline,
  isSyncingQueuedChanges,
  onSyncQueuedChanges,
  onDiscardConflicts,
  imageCompressionEnabled,
  onImageCompressionChange,
  authRequired,
  onLogout,
  isLoggingOut,
  demoMode = false,
  onResetDemo,
  isResettingDemo = false,
}: {
  repository: EdgeEverRepository;
  user: AuthUser | null;
  view: string;
  selectedNotebookId: string | null;
  onSelect: (notebookId: string) => void;
  onCreateNotebook: (parentId?: string | null) => void;
  onRenameNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
  onMoveNotebook: (notebookId: string, targetNotebookId: string, position: NotebookDropPosition) => void;
  onMoveMemos: (memoIds: string[], targetNotebookId: string) => void;
  onBackToList: () => void;
  onOpenTags: () => void;
  onOpenAssets: () => void;
  onOpenTemplates: () => void;
  onOpenAiPrompts: () => void;
  onOpenPluginMarketplace: () => void;
  onOpenTrash: () => void;
  onEmptyTrash: () => void;
  onOpenSettings: () => void;
  onCreateMemo: () => void;
  canCreateMemo: boolean;
  isCreatingMemo: boolean;
  syncSummary: SyncQueueSummary;
  isOnline: boolean;
  isSyncingQueuedChanges: boolean;
  onSyncQueuedChanges: () => void;
  onDiscardConflicts: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  authRequired: boolean;
  onLogout: () => void;
  isLoggingOut: boolean;
  demoMode?: boolean;
  onResetDemo?: () => void;
  isResettingDemo?: boolean;
}) => {
  const { t } = useTranslation();
  // Temporarily keep template actions out of the primary workspace navigation.
  const showTemplateEntry = true;
  const notebookScrollRef = useRef<HTMLDivElement | null>(null);
  const notebookDragScrollFrameRef = useRef<number | null>(null);
  const [expandSiblingsRequest, setExpandSiblingsRequest] = useState<{ parentId: string | null; token: number } | null>(null);
  const [notebookSortMode, setNotebookSortMode] = useState<NotebookSortMode>(readNotebookSortPreference);

  const handleMoveNotebook = useCallback((notebookId: string, targetNotebookId: string, position: NotebookDropPosition) => {
    setNotebookSortMode("custom");
    onMoveNotebook(notebookId, targetNotebookId, position);
  }, [onMoveNotebook]);

  const stopNotebookDragAutoScroll = useCallback(() => {
    if (notebookDragScrollFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(notebookDragScrollFrameRef.current);
    notebookDragScrollFrameRef.current = null;
  }, []);

  useEffect(() => () => stopNotebookDragAutoScroll(), [stopNotebookDragAutoScroll]);

  const handleExpandNotebookSiblings = useCallback((parentId: string | null) => {
    setExpandSiblingsRequest((current: { parentId: string | null; token: number } | null) => ({ parentId, token: (current?.token ?? 0) + 1 }));
  }, []);

  const handleNotebookScrollDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasEdgeEverDragData(event.dataTransfer)) {
      stopNotebookDragAutoScroll();
      return;
    }

    const scrollContainer = notebookScrollRef.current;

    if (!scrollContainer) {
      return;
    }

    const rect = scrollContainer.getBoundingClientRect();
    const distanceToTop = event.clientY - rect.top;
    const distanceToBottom = rect.bottom - event.clientY;
    const topPressure = Math.max(0, NOTEBOOK_DRAG_SCROLL_EDGE_PX - distanceToTop);
    const bottomPressure = Math.max(0, NOTEBOOK_DRAG_SCROLL_EDGE_PX - distanceToBottom);
    const direction = bottomPressure > 0 ? 1 : topPressure > 0 ? -1 : 0;

    if (direction === 0) {
      stopNotebookDragAutoScroll();
      return;
    }

    event.preventDefault();

    const pressure = Math.max(topPressure, bottomPressure) / NOTEBOOK_DRAG_SCROLL_EDGE_PX;
    const scrollStep = Math.max(4, Math.ceil(pressure * NOTEBOOK_DRAG_SCROLL_MAX_STEP_PX)) * direction;
    const tick = () => {
      scrollContainer.scrollTop += scrollStep;
      notebookDragScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    if (notebookDragScrollFrameRef.current !== null) {
      return;
    }

    notebookDragScrollFrameRef.current = window.requestAnimationFrame(tick);
  };

  const notebooksQuery = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => repository.listNotebooks(),
  });

  const notebooks = notebooksQuery.data?.notebooks ?? [];
  const notebookSortOptions = useMemo(() => getNotebookSortOptions(t), [t]);
  const tree = useMemo(() => buildNotebookTree(notebooks, getNotebookSortComparator(notebookSortMode)), [notebooks, notebookSortMode]);
  const isLoading = notebooksQuery.isLoading;
  const activeNotebookSortLabel = notebookSortOptions.find((option) => option.value === notebookSortMode)?.label ?? t("options.notebookSort.nameAsc");

  useEffect(() => {
    writeNotebookSortPreference(notebookSortMode);
  }, [notebookSortMode]);

  useEffect(() => {
    if (!selectedNotebookId) {
      return;
    }

    window.setTimeout(() => {
      const selectedNode = notebookScrollRef.current?.querySelector<HTMLElement>(
        `[data-notebook-id="${CSS.escape(selectedNotebookId)}"]`
      );

      selectedNode?.scrollIntoView({ block: "nearest" });
    }, 0);
  }, [selectedNotebookId, tree]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 px-4 pb-3 pt-[env(safe-area-inset-top)] lg:hidden">
        <div>
          <div className="text-base font-semibold tracking-normal">{t("notebookPane.notebooks")}</div>
          <div className="text-xs text-slate-500">{user?.username ?? t("notebookPane.workspaceFallback")}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" title={t("notebookPane.backToList")} aria-label={t("notebookPane.backToList")} onClick={onBackToList}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title={t("notebookPane.newNotebook")} aria-label={t("notebookPane.newNotebook")} onClick={() => onCreateNotebook(null)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <nav className="grid shrink-0 grid-cols-2 gap-0.5 border-b border-slate-100 px-2 py-1.5 sm:grid-cols-3 lg:grid-cols-6" aria-label={t("notebookPane.secondaryEntries")}>
          <SidebarShortcutButton icon={<Tags className="h-4 w-4" />} label={t("mobileSheets.tags")} onClick={onOpenTags} />
          <SidebarShortcutButton icon={<Archive className="h-4 w-4" />} label={t("mobileSheets.assets")} onClick={onOpenAssets} />
          {showTemplateEntry && <SidebarShortcutButton icon={<LayoutTemplate className="h-4 w-4" />} label={t("nav.templates")} onClick={onOpenTemplates} />}
          <SidebarShortcutButton icon={<Sparkles className="h-4 w-4" />} label={t("nav.prompts")} onClick={onOpenAiPrompts} />
          <SidebarShortcutButton icon={<Store className="h-4 w-4" />} label={t("plugins.marketplace.title")} onClick={onOpenPluginMarketplace} />
          <SidebarTrashShortcut active={view === "trash"} onOpenTrash={onOpenTrash} onEmptyTrash={onEmptyTrash} />
        </nav>
      </TooltipProvider>

      {window.edgeeverDesktop?.isAvailable && (
        <div className="px-3 pt-2">
          <SyncStatusBar
            summary={syncSummary}
            isOnline={isOnline}
            isSyncing={isSyncingQueuedChanges}
            onSyncNow={onSyncQueuedChanges}
            onDiscardConflicts={onDiscardConflicts}
            notebooks={notebooks}
          />
        </div>
      )}

      <div className="hidden shrink-0 px-3 pb-4 pt-4 lg:block">
        <div className="flex overflow-hidden rounded-full border border-slate-200/90 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.06)] transition-all duration-200 hover:border-emerald-200/80 hover:shadow-[0_8px_24px_rgba(22,160,110,0.12)]">
          <button
            className="group flex h-14 min-w-0 flex-1 items-center gap-3 px-3 text-left transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            title={t("notebookPane.newMemo")}
            aria-label={t("notebookPane.newMemo")}
            onClick={onCreateMemo}
            disabled={!canCreateMemo || isCreatingMemo}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_8px_18px_rgb(var(--brand-green-rgb)/0.28)] transition-transform duration-200 group-hover:scale-105">
              <Plus className="h-6 w-6" />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold text-slate-950">{t("notebookPane.newMemo")}</span>
          </button>
        </div>
      </div>

      <div
        ref={notebookScrollRef}
        className="flex-1 overflow-y-auto px-3 py-4 lg:pt-0"
        onDragEnd={stopNotebookDragAutoScroll}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            stopNotebookDragAutoScroll();
          }
        }}
        onDragOver={handleNotebookScrollDragOver}
        onDrop={stopNotebookDragAutoScroll}
      >
        {showTemplateEntry && (
          <button
            className="mb-3 hidden h-8 w-full items-center justify-start gap-2 rounded-md px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 lg:flex"
            type="button"
            title={t("templates.useTemplate")}
            onClick={onOpenTemplates}
            disabled={isCreatingMemo}
          >
            <LayoutTemplate className="h-4 w-4" />
            {t("templates.useTemplate")}
          </button>
        )}

        <nav className="mb-3 space-y-1" aria-label={t("notebookPane.entries")}>
          <SidebarNavButton
            active={view === "notebook" && selectedNotebookId === null}
            icon={<LayoutList className="h-4 w-4" />}
            label={t("notebookPane.allMemos")}
            onClick={onBackToList}
          />
          {demoMode && onResetDemo && (
            <SidebarNavButton
              tone="warning"
              icon={<RotateCcw className={cn("h-4 w-4 text-amber-600", isResettingDemo && "animate-spin")} />}
              label={isResettingDemo ? t("demo.resetting") : t("demo.resetButton")}
              onClick={onResetDemo}
            />
          )}
        </nav>

        <div className="group mb-2 flex items-center justify-between gap-2">
          <SidebarSectionLabel icon={<NotebookIcon className="h-4 w-4" />} label={t("notebookPane.notebooks")} />
          <div className="flex items-center gap-1 opacity-100 transition-opacity duration-200 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
              type="button"
              title={t("notebookPane.newNotebook")}
              aria-label={t("notebookPane.newNotebook")}
              onClick={() => onCreateNotebook(null)}
            >
              <BookPlus className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
                        type="button"
                        aria-label={t("notebookPane.sortTitle", { label: activeNotebookSortLabel })}
                      >
                        <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("notebookPane.sortTitle", { label: activeNotebookSortLabel })}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DropdownMenuContent align="end" className="w-36">
                {notebookSortOptions.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={notebookSortMode === option.value}
                    onSelect={() => setNotebookSortMode(option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isLoading ? (
          <div className="mb-4 px-2 py-3 text-sm text-slate-500">{t("notebookPane.loading")}</div>
        ) : (
          <div className="mb-4 space-y-1" data-notebook-tree>
            {tree.map((node) => (
              <NotebookTreeItem
                key={node.id}
                node={node}
                depth={0}
                selectedNotebookId={selectedNotebookId}
                onSelect={onSelect}
                onCreateNotebook={onCreateNotebook}
                onRenameNotebook={onRenameNotebook}
                onDeleteNotebook={onDeleteNotebook}
                onMoveNotebook={handleMoveNotebook}
                onMoveMemos={onMoveMemos}
                onDragScroll={handleNotebookScrollDragOver}
                expandSiblingsRequest={expandSiblingsRequest}
                onExpandSiblings={handleExpandNotebookSiblings}
              />
            ))}
          </div>
        )}

      </div>

      <footer className="edgeever-workspace-sidebar-footer border-t border-slate-200 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm">
        <div className="space-y-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium leading-none text-slate-700 transition-colors duration-200 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:data-[state=open]:bg-slate-800"
                type="button"
                aria-label={t("pwa.sidebarDownloadsTitle") || "下载 EdgeEver 客户端与浏览器插件"}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Download className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{t("pwa.sidebarDownloads") || "下载客户端"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={6}
              className="w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {t("pwa.sidebarGroupApps") || "客户端应用"}
                </DropdownMenuLabel>
                {!window.edgeeverDesktop?.isAvailable && (
                  <>
                    <DropdownMenuItem asChild>
                      <a
                        href={DESKTOP_DOWNLOAD_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <BrandIconContainer>
                            <BrandIcon path={APPLE_ICON_PATH} color="#111827" />
                          </BrandIconContainer>
                          <span className="truncate font-medium">{t("pwa.sidebarMac") || "macOS"}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                          <span className="text-[11px]">DMG</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </div>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled
                      className="flex cursor-not-allowed items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-400 opacity-60 dark:text-slate-500"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <BrandIconContainer className="opacity-60">
                          <BrandIcon path={WINDOWS_ICON_PATH} color="#0078D4" />
                        </BrandIconContainer>
                        <span className="truncate">{t("pwa.sidebarWindows") || "Windows"}</span>
                      </div>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {t("pwa.sidebarWindowsBadge") || "即将推出"}
                      </span>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem asChild>
                  <a
                    href={ANDROID_PLAY_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("pwa.sidebarAndroidTitle") || "在 Google Play 下载 EdgeEver 安卓端"}
                    className="group flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <BrandIconContainer>
                        <GooglePlayIcon />
                      </BrandIconContainer>
                      <span className="truncate font-medium">{t("pwa.sidebarAndroid") || "Android"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                      <span className="text-[11px]">{t("pwa.sidebarAndroidGooglePlay") || "Google Play"}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={ANDROID_APK_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <BrandIconContainer>
                        <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      </BrandIconContainer>
                      <span className="truncate font-medium">{t("pwa.sidebarAndroidApk") || "APK 下载"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                      <span className="text-[11px]">Releases</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={IOS_DOWNLOAD_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("pwa.sidebarIosTitle") || "在 App Store 下载 EdgeEver iOS 端（仅支持非大陆区 Apple ID）"}
                    className="group flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <BrandIconContainer>
                        <AppStoreIcon />
                      </BrandIconContainer>
                      <span className="truncate font-medium">{t("pwa.sidebarIos") || "iOS"}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {t("pwa.sidebarIosRegionBadge") || "非大陆区"}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                      <span className="text-[11px]">{t("pwa.sidebarIosBadge") || "App Store"}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="my-1 bg-slate-100 dark:bg-slate-800" />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {t("pwa.sidebarGroupClippers") || "浏览器剪藏插件"}
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <a
                    href={CHROMIUM_CLIPPER_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <BrandIconContainer>
                        <div className="flex items-center -space-x-1">
                          <BrandIcon path={CHROME_ICON_PATH} color="#4285F4" className="h-3 w-3" />
                          <BrandIcon path={EDGE_ICON_PATH} color="#0C59A4" className="h-3 w-3" />
                        </div>
                      </BrandIconContainer>
                      <span className="truncate font-medium">{t("pwa.sidebarChromeEdge") || "Chrome / Edge"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                      <span className="text-[11px]">{t("pwa.sidebarWebStoreBadge") || "扩展商店"}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={FIREFOX_CLIPPER_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <BrandIconContainer>
                        <BrandIcon path={FIREFOX_ICON_PATH} color="#FF7139" />
                      </BrandIconContainer>
                      <span className="truncate font-medium">{t("pwa.sidebarFirefox") || "Firefox"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                      <span className="text-[11px]">{t("pwa.sidebarAddonsBadge") || "附加组件"}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenSettings}
              className="flex h-8 min-w-0 flex-1 items-center gap-3 rounded-md px-3 text-left text-sm font-medium leading-none text-slate-700 transition-colors duration-200 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
              type="button"
              aria-label={t("notebookPane.profile")}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <CircleUserRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate">{t("notebookPane.profile")}</span>
            </button>
            <DesktopUpdateNotice />
          </div>
        </div>
      </footer>
    </div>
  );
};
