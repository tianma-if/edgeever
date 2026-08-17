import { useRef, useState, useEffect, useCallback, useMemo, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Mark } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import "katex/dist/katex.min.css";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  History,
  RotateCcw,
  Trash2,
  Tags,
  Save,
  ReplaceAll,
  MoreHorizontal,
  Maximize2,
  Minimize2,
  Paperclip,
  Pencil,
  Sparkles,
  Search,
  Type,
  X,
  Check,
  CircleAlert,
  LoaderCircle,
  Info,
  FileDown,
  FileCode2,
  Printer,
  Link2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitHubRepositoryLink } from "@/components/GitHubRepositoryLink";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditorToolbar } from "./EditorToolbar";
import { EditorOutline } from "./EditorOutline";
import { EditorTagPicker } from "./EditorTagPicker";
import { useAiBubbleMenu } from "./editor/useAiBubbleMenu";
import { WeChatIcon } from "./WeChatIcon";
import { ThemeToggle } from "./ThemeToggle";
import { useEditorTheme } from "./ThemeProvider";
import { sanitizeAndScopeCss } from "@/lib/css-sandbox";
import { RevisionHistoryDialog } from "./dialogs/RevisionHistoryDialog";
import { ExternalLinkDialog } from "./dialogs/ExternalLinkDialog";
import { memoShareQueryKey, ShareMemoDialog } from "./dialogs/ShareMemoDialog";
import { AiAssistantDialog } from "./dialogs/AiAssistantDialog";
import { api } from "@/lib/api";
import { isDesktopResourceRuntime, stageDesktopResource, toDesktopResourceUrl } from "@/lib/desktop-resources";
import { cn, formatDateTime, parseTagsText } from "@/lib/utils";
import { EDITOR_CONTENT_MAX_WIDTH, EDITOR_CONTENT_MAX_WIDTH_COLLAPSED } from "@/lib/workspace-ui";
import {
  countMemoCharacters,
  docToMarkdown,
  MEMO_CONTENT_STYLE,
  markdownToDoc,
  MergeDivider,
  resolveMemoContentDoc,
  type Notebook,
  type MemoDetail,
  type MemoSummary,
  type MemoEditSession,
  type TiptapDoc,
  createMemoLinkHref,
  parseMemoLinkHref,
} from "@edgeever/shared";
import { DEFAULT_IMAGE_WIDTH_PERCENT } from "@edgeever/shared/image-display";
import { createEdgeEverMathematics } from "@edgeever/shared/mathematics";
import { codeBlockLowlight, EdgeEverCodeBlock } from "@/lib/code-block";
import { compressImageForUpload } from "@/lib/image-compression";
import { localDb, type MemoUpdateSyncPayload } from "@/lib/local-db";
import { getMemoUpdateQueueId, isMemoUpdateAlreadyApplied, queueMemoUpdate, shouldQueueMemoSaveError } from "@/lib/sync-queue";
import {
  formatLocalDraftClipboardText,
  formatMemoSaveConflictReason,
  getMemoSaveConflictInfo,
  getMemoSaveConflictInfoFromQueueItem,
} from "@/lib/memo-save-conflict";
import { copyTextToClipboard } from "@/lib/clipboard";
import { isLocalMemoId, remapLocalDraftMemoId } from "@/lib/local-mirror";
import { shouldAcceptRemoteMemoDetail } from "@/lib/memo-detail-freshness";
import type { EdgeEverRepository } from "@/lib/repository";
import {
  EDITOR_LOCAL_SAVE_DELAY_MS,
  getEditableMemoTitle,
  getNotebookMoveOptions,
  type MemoDocumentActionRequest,
} from "@/lib/app-helpers";
import { copyEditorToWeChat, copyMarkdownToWeChat } from "@/lib/wechat-copy";
import { ThemeBlock } from "./ThemeBlock";
import { SystemInfoDialog } from "./SystemInfoDialog";
import { fetchLatestRelease, isVersionOutdated } from "@/lib/version-check";
import { RELEASE_STATUS_EVENT } from "@/lib/release-notice";
import { downloadMarkdownFile } from "@/lib/note-markdown-export";
import { NOTE_HTML_FULL_STYLES } from "@/lib/note-html-export-assets";
import { downloadNoteHtmlFile, getHtmlImageEmbedNoticeKind } from "@/lib/note-html-export";
import { openNotePrintPreview, serializeNoteDocumentForPrint } from "@/lib/note-print";
import { isBrowserOffline } from "@/lib/network-status";
import {
  EDITOR_LINK_OPEN_MODE_CHANGED_EVENT,
  getStoredEditorLinkOpenMode,
  resolveEditorLinkRequireModifier,
  shouldOpenEditorLink,
  shouldShowEditorLinkOpenHint,
  type EditorLinkOpenMode,
} from "@/lib/editor-link-click";
import {
  formatMarkdownLink,
  insertMarkdownSnippet,
  isAttachmentLinkHref,
} from "@/lib/editor-external-link";
import { processFilesSequentially } from "@/lib/file-batch";
import { MEMO_ID_REMAPPED_EVENT, MEMO_SYNC_ACKNOWLEDGED_EVENT } from "@/lib/sync-events";
import { useStandaloneMobileEditor } from "@/hooks/useStandaloneMobileEditor";
import { statusSettleMotion } from "@/lib/motion";
import {
  getRichTextAiSelectionContext,
  getRichTextAiSelectionReplacement,
  normalizeAiSelectionReplacement,
} from "@/lib/ai-selection-replacement";
import { getAttachmentFilenameFromLabel, getAttachmentResourceId } from "@/lib/attachment-links";
import {
  IMAGE_MENU_HIDE_EVENT,
  IMAGE_MENU_SHOW_EVENT,
  ResizableImage,
  type ImageMenuRequestDetail,
} from "./editor/ResizableImage";
import {
  createNoteSearchHighlightPlugin,
  formatNoteSearchMatchLabel,
  getNextSearchMatchIndex,
  getSearchMatchesFromDocument,
  NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY,
  type NoteSearchMatch,
} from "./editor/note-search";
import { useEditorSaveStatus } from "./editor/useEditorSaveStatus";
import { resolveEditorDraftState } from "./editor/editor-draft-state";
import type { EdgeEverPluginHost, PluginEditorAdapter } from "@/lib/plugins/plugin-host";
import { PluginToolbarMenu } from "@/components/plugins/PluginToolbarMenu";
import {
  useEditorResourceActions,
  type AttachmentMenuTarget,
  type ResourceDialogState,
  type ResourceMenuTarget,
} from "./editor/useEditorResourceActions";

const SUPPORTED_PASTE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const MOBILE_EDITOR_QUERY = "(max-width: 639px)";
const MOBILE_DRAFT_PERSIST_DELAY_MS = 800;

const createLocalEditSession = (memo: MemoDetail): MemoEditSession => ({
  id: `local-edit:${memo.id}`,
  memoId: memo.id,
  baseRevision: memo.revision,
  baseContentHash: memo.contentHash,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

const requiresLocalEditSession = (memo: MemoDetail) =>
  isDesktopResourceRuntime() ||
  isLocalMemoId(memo.id) ||
  isBrowserOffline();

const IconTooltip = ({ label, children }: { label: string; children: ReactNode }) => (
  <TooltipProvider delayDuration={0} skipDelayDuration={0}>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

const EmptyEditorHeader = ({ pluginHost, onOpenPluginManager }: {
  pluginHost: EdgeEverPluginHost;
  onOpenPluginManager: () => void;
}) => (
  <header className="hidden h-12 shrink-0 items-center justify-end gap-1 border-b border-slate-100 px-5 lg:flex">
    <PluginToolbarMenu host={pluginHost} onManage={onOpenPluginManager} />
    <ThemeToggle />
  </header>
);

type NoteLinkHintPosition = {
  left: number;
  top: number;
  placement: "above" | "below" | "inside-bottom-right";
};

type AiSelectionContext = {
  kind: "markdown" | "plain";
  from: number;
  to: number;
  contentMarkdown: string;
} | {
  kind: "rich";
  from: number;
  to: number;
  contentMarkdown: string;
  isInline: boolean;
};

const getAttachmentLinkFromEventTarget = (target: EventTarget | null) =>
  target instanceof Element
    ? target.closest<HTMLAnchorElement>(
        'a.edgeever-attachment-link, a[href*="/api/v1/resources/"], a[href^="edgeever-resource://"]'
      )
    : null;

const getNoteLinkFromEventTarget = (target: EventTarget | null) =>
  target instanceof Element
    ? target.closest<HTMLAnchorElement>('a.edgeever-note-link, a[href^="#memo="]')
    : null;

/** Any navigable editor link (external or note). Attachment chips have their own menu. */
const getEditorNavigableLinkFromEventTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return null;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link || getAttachmentLinkFromEventTarget(link)) {
    return null;
  }

  return link;
};

const getNoteLinkHintPosition = (link: HTMLAnchorElement): NoteLinkHintPosition => {
  const rect = link.getBoundingClientRect();
  const placement = rect.top < 48 ? "below" : "above";

  return {
    left: Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12),
    top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
    placement,
  };
};

const NoteLinkInteractionHint = ({
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
  document.body
);

const ResourceActionMenu = ({
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
  labels: { download: string; saveAs: string; rename: string; delete: string; unavailable: string };
  onDownload: () => void;
  onSaveAs: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) => createPortal(
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
    <Button type="button" size="sm" variant="ghost" title={labels.download} onClick={onDownload}>
      <FileDown className="h-3.5 w-3.5" />
      {labels.download}
    </Button>
    <Button type="button" size="sm" variant="ghost" title={labels.saveAs} onClick={onSaveAs}>
      <Save className="h-3.5 w-3.5" />
      {labels.saveAs}
    </Button>
    <Button
      type="button"
      size="sm"
      variant="ghost"
      title={canRename ? labels.rename : labels.unavailable}
      disabled={!canRename}
      onClick={onRename}
    >
      <Pencil className="h-3.5 w-3.5" />
      {labels.rename}
    </Button>
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-slate-600 hover:bg-rose-50 hover:text-rose-600"
      title={canDelete ? labels.delete : labels.unavailable}
      disabled={!canDelete}
      onClick={onDelete}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {labels.delete}
    </Button>
  </div>,
  document.body
);

const findAttachmentLinkRange = (
  editor: Editor,
  href: string
): { from: number; to: number; marks: readonly Mark[] } | null => {
  let from: number | null = null;
  let to: number | null = null;
  let marks: readonly Mark[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const linkMark = node.marks.find((mark) => mark.type.name === "link" && mark.attrs.href === href);
    if (!linkMark) return;
    from = from === null ? pos : Math.min(from, pos);
    to = to === null ? pos + node.nodeSize : Math.max(to, pos + node.nodeSize);
    marks = node.marks;
  });

  if (from === null || to === null) return null;
  return { from: from as number, to: to as number, marks };
};

type MobileImeDebugEntry = {
  id: number;
  event: string;
  activeElement: string;
  inputType?: string;
  isComposing?: boolean;
  key?: string;
  valueLength: number;
  time: string;
};

type MobilePlainTextElement = HTMLTextAreaElement | HTMLDivElement;

const isEditorReady = (editor: Editor | null | undefined): editor is Editor =>
  Boolean(editor && !editor.isDestroyed && (editor as { extensionManager?: unknown }).extensionManager);

const getActiveElementLabel = () => {
  if (typeof document === "undefined") {
    return "document unavailable";
  }

  const element = document.activeElement;
  if (!element) {
    return "none";
  }

  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const className =
    element instanceof HTMLElement && element.className
      ? `.${String(element.className).trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  const role = element.getAttribute("role");

  return `${tag}${id}${className}${role ? `[role=${role}]` : ""}`;
};

const getMobilePlainTextElementValue = (element: MobilePlainTextElement | null) => {
  if (!element) {
    return "";
  }

  return "value" in element ? element.value : element.innerText;
};

const setMobilePlainTextElementValue = (element: MobilePlainTextElement | null, value: string) => {
  if (!element) {
    return;
  }

  if ("value" in element) {
    element.value = value;
    return;
  }

  if (element.innerText !== value) {
    element.textContent = value;
  }
};

const focusMobilePlainTextElement = (element: MobilePlainTextElement | null) => {
  if (!element) {
    return;
  }

  element.focus({ preventScroll: true });

  if ("setSelectionRange" in element) {
    element.setSelectionRange(element.value.length, element.value.length);
    return;
  }

  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const getEditorSearchMatches = (editor: Editor | null, query: string): NoteSearchMatch[] => {
  if (!isEditorReady(editor)) {
    return [];
  }

  return getSearchMatchesFromDocument(editor.state.doc, query);
};

const getResourceFilesFromDataTransfer = (dataTransfer: DataTransfer | null) => {
  if (!dataTransfer) {
    return [];
  }

  const fileItems = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const files = fileItems.length > 0 ? fileItems : Array.from(dataTransfer.files ?? []);

  return files.filter((file) => file.size > 0);
};

const syncStatusToSaveState = (status: "pending" | "syncing" | "conflict" | "error") => {
  if (status === "conflict") {
    return "conflict";
  }
  if (status === "syncing") {
    return "saving";
  }
  return "queued";
};

class MemoSaveRequestError extends Error {
  originalError: unknown;
  payload: MemoUpdateSyncPayload;
  tagsText: string;

  constructor(originalError: unknown, payload: MemoUpdateSyncPayload, tagsText: string) {
    super(originalError instanceof Error ? originalError.message : "Memo save failed");
    this.name = "MemoSaveRequestError";
    this.originalError = originalError;
    this.payload = payload;
    this.tagsText = tagsText;
  }
}

const MobileNotebookSelectSheet = ({
  isUpdating,
  options,
  selectedNotebookId,
  onClose,
  onSelect,
}: {
  isUpdating: boolean;
  options: any[];
  selectedNotebookId: string;
  onClose: () => void;
  onSelect: (notebookId: string) => void;
}) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.setTimeout(() => {
      const selectedNode = listRef.current?.querySelector<HTMLElement>(
        `[data-mobile-notebook-select-id="${CSS.escape(selectedNotebookId)}"]`
      );
      selectedNode?.scrollIntoView({ block: "center" });
    }, 0);
  }, [selectedNotebookId]);

  return (
    <Drawer open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent className="inset-x-0 max-h-[62dvh] overflow-hidden border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <header className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
          <DrawerHeader className="min-w-0 p-0">
            <DrawerTitle className="text-base">{t("editor.currentNotebook")}</DrawerTitle>
          </DrawerHeader>
          <Button size="icon" variant="ghost" title={t("editor.close")} aria-label={t("editor.close")} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
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
                      selected ? "bg-emerald-50 font-semibold text-emerald-700 data-[selected=true]:bg-emerald-50" : "text-slate-700"
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

type EditorPaneProps = {
  memo: MemoDetail | null;
  repository: EdgeEverRepository;
  desktopFocusMode: boolean;
  onToggleDesktopFocusMode: () => void;
  mobileDefaultEditMemoId: string | null;
  preserveUnsavedContentFromMemoId?: string | null;
  saveBlocked?: boolean;
  isTrashView: boolean;
  notebooks: Notebook[];
  isLoading: boolean;
  contentSearchQuery?: string;
  imageCompressionEnabled: boolean;
  hasNextMemo: boolean;
  hasPreviousMemo: boolean;
  onBackToList: () => void;
  onOpenNextMemo: () => void;
  onOpenPreviousMemo: () => void;
  onSaved: (memo: MemoDetail) => Promise<void>;
  onDeleted: (memoId: string) => Promise<void>;
  onPermanentDeleted: (memoId: string) => Promise<void>;
  onRestored: (memoId: string) => Promise<void>;
  onMobileDefaultEditConsumed: () => void;
  onSaveAsTemplate: (memo: MemoDetail, name: string) => Promise<void>;
  searchFocusToken: number;
  replaceFocusToken: number;
  documentActionRequest?: MemoDocumentActionRequest | null;
  onDocumentActionConsumed?: (requestId: number) => void;
  selectionActionBar?: ReactNode;
  onOpenMemo?: (memoId: string) => void;
  onOpenAiPrompts?: () => void;
  pluginHost: EdgeEverPluginHost;
  onOpenPluginManager: () => void;
};

type RichEditorPaneProps = EditorPaneProps & {
  onRequestMobileNativeEdit?: () => void;
};

export const EditorPane = (props: EditorPaneProps) => {
  const { t } = useTranslation();
  const readOnly = props.isTrashView || Boolean(props.memo?.isDeleted);
  const { editingActive, requestEdit } = useStandaloneMobileEditor({
    memoId: props.memo?.id ?? null,
    mobileDefaultEditMemoId: props.mobileDefaultEditMemoId,
    onBackToList: props.onBackToList,
    onDefaultEditConsumed: props.onMobileDefaultEditConsumed,
    readOnly,
  });

  if (editingActive) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-white text-sm font-medium text-slate-400">
        {t("editor.openEditor")}
      </div>
    );
  }

  return (
    <RichEditorPane
      {...props}
      mobileDefaultEditMemoId={props.mobileDefaultEditMemoId}
      onRequestMobileNativeEdit={requestEdit}
    />
  );
};
const RichEditorPane = ({
  memo,
  repository,
  desktopFocusMode,
  onToggleDesktopFocusMode,
  mobileDefaultEditMemoId,
  preserveUnsavedContentFromMemoId: _preserveUnsavedContentFromMemoId,
  saveBlocked: _saveBlocked = false,
  isTrashView,
  notebooks,
  isLoading,
  contentSearchQuery = "",
  imageCompressionEnabled,
  hasNextMemo,
  hasPreviousMemo,
  onBackToList,
  onOpenNextMemo,
  onOpenPreviousMemo,
  onSaved,
  onDeleted,
  onPermanentDeleted,
  onRestored,
  onMobileDefaultEditConsumed,
  onSaveAsTemplate,
  searchFocusToken,
  replaceFocusToken,
  documentActionRequest,
  onDocumentActionConsumed,
  selectionActionBar,
  onOpenMemo,
  onOpenAiPrompts,
  pluginHost,
  onOpenPluginManager,
  onRequestMobileNativeEdit,
}: RichEditorPaneProps) => {
  const { t, i18n } = useTranslation();
  const { customEditorTheme, editorTheme } = useEditorTheme();
  const queryClient = useQueryClient();
  const isSelectionMode = Boolean(selectionActionBar);
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const {
    dirtyVersion,
    hasUnsavedChanges,
    hasUnsavedChangesRef,
    markDirtyStatus,
    saveConflictInfo,
    saveState,
    setHasUnsavedChanges,
    setSaveConflictInfo,
    setSaveState,
  } = useEditorSaveStatus();
  const [conflictActionPending, setConflictActionPending] = useState<"adopt" | "copy" | null>(null);
  const [conflictActionMessage, setConflictActionMessage] = useState<string | null>(null);
  const [hydratedEditorMemoId, setHydratedEditorMemoId] = useState<string | null>(null);
  const [editorStateVersion, setEditorStateVersion] = useState(0);
  const [editorContentVersion, setEditorContentVersion] = useState(0);
  const [imageUploadState, setImageUploadState] = useState<"idle" | "compressing" | "uploading" | "error">("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const aiBubbleMenu = useAiBubbleMenu(aiAssistantOpen);
  const [aiSelection, setAiSelection] = useState<AiSelectionContext | null>(null);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [mobileNotebookSheetOpen, setMobileNotebookSheetOpen] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [noteSearchOpen, setNoteSearchOpen] = useState(false);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSearchReplaceOpen, setNoteSearchReplaceOpen] = useState(false);
  const [noteSearchReplacement, setNoteSearchReplacement] = useState("");
  const [noteSearchIndex, setNoteSearchIndex] = useState(0);
  const [noteLinkPickerOpen, setNoteLinkPickerOpen] = useState(false);
  const [noteLinkQuery, setNoteLinkQuery] = useState("");
  const [noteLinkHintPosition, setNoteLinkHintPosition] = useState<NoteLinkHintPosition | null>(null);
  const [externalLinkDialogOpen, setExternalLinkDialogOpen] = useState(false);
  const [externalLinkDraft, setExternalLinkDraft] = useState<{ href: string; text: string; showTextField: boolean; canRemove: boolean }>({
    href: "",
    text: "",
    showTextField: true,
    canRemove: false,
  });
  const {
    menuTarget: resourceMenuTarget,
    dialog: resourceDialog,
    filename: resourceFilename,
    pending: resourceActionPending,
    error: resourceActionError,
    clearError: clearResourceActionError,
    closeDialog: closeResourceDialog,
    completeAction: completeResourceAction,
    failAction: failResourceAction,
    hideMenu: hideResourceMenu,
    openDialog: openResourceActionDialog,
    reset: resetResourceActions,
    setFilename: setResourceFilename,
    showMenu: showResourceMenu,
    startAction: startResourceAction,
  } = useEditorResourceActions();
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(MOBILE_EDITOR_QUERY).matches
  );
  const [isMobileEditing, setIsMobileEditing] = useState(false);
  const [mobilePlainText, setMobilePlainText] = useState("");
  const [markdownSource, setMarkdownSource] = useState("");
  const [isMarkdownMode, setIsMarkdownMode] = useState(false);
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [mobileImeDebugOpen, setMobileImeDebugOpen] = useState(false);
  const [editorOutlineCollapsed, setEditorOutlineCollapsed] = useState(false);
  const [mobileImeDebugActiveElement, setMobileImeDebugActiveElement] = useState(getActiveElementLabel);
  const [mobileImeDebugEvents, setMobileImeDebugEvents] = useState<MobileImeDebugEntry[]>([]);
  const [wechatCopyState, setWechatCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [memoIdCopyNotice, setMemoIdCopyNotice] = useState<{ status: "copied" | "error"; id: string } | null>(null);
  const noteLinkModifier = useMemo(
    () => typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform) ? "⌘" : "Ctrl",
    []
  );
  const [editorLinkOpenMode, setEditorLinkOpenMode] = useState<EditorLinkOpenMode>(() =>
    getStoredEditorLinkOpenMode()
  );

  useEffect(() => {
    const syncMode = () => setEditorLinkOpenMode(getStoredEditorLinkOpenMode());
    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<EditorLinkOpenMode>).detail;
      if (detail === "click" || detail === "modifier") {
        setEditorLinkOpenMode(detail);
        return;
      }
      syncMode();
    };
    window.addEventListener(EDITOR_LINK_OPEN_MODE_CHANGED_EVENT, onPreferenceChanged);
    window.addEventListener("storage", syncMode);
    return () => {
      window.removeEventListener(EDITOR_LINK_OPEN_MODE_CHANGED_EVENT, onPreferenceChanged);
      window.removeEventListener("storage", syncMode);
    };
  }, []);
  const noteLinkResultsQuery = useQuery({
    queryKey: ["memo-link-search", noteLinkQuery],
    queryFn: () => repository.listMemos({ q: noteLinkQuery, limit: 20 }),
    enabled: noteLinkPickerOpen,
  });
  const [editorScrollContainer, setEditorScrollContainer] = useState<HTMLDivElement | null>(null);
  const setEditorScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    editorScrollContainerRef.current = element;
    setEditorScrollContainer(element);
  }, []);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const readOnly = isTrashView || Boolean(memo?.isDeleted);
  const shareMemoId = memo && !readOnly && !isLocalMemoId(memo.id) ? memo.id : null;
  const shareStatusQuery = useQuery({
    queryKey: memoShareQueryKey(shareMemoId ?? ""),
    queryFn: () => {
      if (!shareMemoId) throw new Error("Memo share query requires a memo id");
      return api.getMemoShare(shareMemoId);
    },
    enabled: Boolean(shareMemoId),
    retry: false,
    staleTime: 30_000,
  });
  const isMemoShared = Boolean(shareStatusQuery.data?.share);
  const mobileDefaultEditRequested = Boolean(memo?.id && memo.id === mobileDefaultEditMemoId && !readOnly);
  const mobileEditingActive = isMobileEditing || mobileDefaultEditRequested;

  useEffect(() => {
    const controller = new AbortController();
    void fetchLatestRelease(controller.signal)
      .then((release) => setUpdateAvailable(isVersionOutdated(__EDGEEVER_APP_VERSION__, release.version)))
      .catch(() => undefined);
    const handleReleaseStatus = () => setUpdateAvailable(true);
    window.addEventListener(RELEASE_STATUS_EVENT, handleReleaseStatus);
    return () => {
      controller.abort();
      window.removeEventListener(RELEASE_STATUS_EVENT, handleReleaseStatus);
    };
  }, []);
  const effectiveReadOnly = readOnly || (isMobileViewport && !mobileEditingActive);
  const useMobilePlainTextEditor = isMobileViewport && mobileEditingActive && !readOnly;
  const useMarkdownSourceEditor = !useMobilePlainTextEditor && isMarkdownMode;

  const memoRef = useRef<MemoDetail | null>(memo);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editorScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const mobileTextAreaRef = useRef<MobilePlainTextElement | null>(null);
  const mobileDraftTimerRef = useRef<number | null>(null);
  const mobileSaveTimerRef = useRef<number | null>(null);
  const mobileImeDebugEventIdRef = useRef(0);
  const mobileImeDebugRecorderRef = useRef<(eventName: string, event?: unknown) => void>(() => undefined);
  const markMobilePlainTextDirtyRef = useRef<() => void>(() => undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noteSearchInputRef = useRef<HTMLInputElement | null>(null);
  const noteReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const markdownTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const openExternalLinkDialogRef = useRef<() => void>(() => undefined);
  const hydratingRef = useRef(false);
  const hydratedMemoIdRef = useRef<string | null>(null);
  /** Last content source applied to the editor — used to skip redundant setContent. */
  const appliedEditorSourceKeyRef = useRef<string | null>(null);
  const editingMemoIdRef = useRef<string | null>(memo?.id ?? null);
  const imageCompressionEnabledRef = useRef(imageCompressionEnabled);
  const resourceMenuHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleMemoIdRemapped = (event: Event) => {
      const mappings = (event as CustomEvent<ReadonlyMap<string, string>>).detail;
      const currentMemo = memoRef.current;
      if (!currentMemo || !mappings) return;

      const nextMemoId = mappings.get(currentMemo.id);
      if (!nextMemoId || nextMemoId === currentMemo.id) return;

      const previousMemoId = currentMemo.id;
      memoRef.current = { ...currentMemo, id: nextMemoId };
      if (editingMemoIdRef.current === previousMemoId) editingMemoIdRef.current = nextMemoId;
      if (hydratedMemoIdRef.current === previousMemoId) {
        hydratedMemoIdRef.current = nextMemoId;
        setHydratedEditorMemoId(nextMemoId);
      }
      if (editSessionRef.current?.memoId === previousMemoId) {
        editSessionRef.current = {
          ...editSessionRef.current,
          id: `local-edit:${nextMemoId}`,
          memoId: nextMemoId,
        };
      }

      // A draft may already have been persisted during image processing.
      // Move it to the durable server id so a reload cannot orphan it under
      // the temporary id.
      void remapLocalDraftMemoId(previousMemoId, nextMemoId).catch(() => {
        // The live editor content remains authoritative; draft persistence can
        // retry on the next editor update.
      });
    };

    window.addEventListener(MEMO_ID_REMAPPED_EVENT, handleMemoIdRemapped);
    return () => window.removeEventListener(MEMO_ID_REMAPPED_EVENT, handleMemoIdRemapped);
  }, []);

  const focusMobileInputTarget = useCallback(() => {
    if (mobileTextAreaRef.current) {
      focusMobilePlainTextElement(mobileTextAreaRef.current);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_EDITOR_QUERY);
    const updateMobileViewport = () => setIsMobileViewport(mediaQuery.matches);

    updateMobileViewport();
    mediaQuery.addEventListener("change", updateMobileViewport);

    return () => mediaQuery.removeEventListener("change", updateMobileViewport);
  }, []);

  useEffect(() => {
    setIsMobileEditing(false);
    setMobileToolbarOpen(false);
  }, [memo?.id]);

  useEffect(() => {
    if (memo?.id && memo.id === mobileDefaultEditMemoId) {
      setIsMobileEditing(true);
      let frame = 0;
      let cancelled = false;

      const focusWhenReady = (attempt = 0) => {
        frame = window.requestAnimationFrame(() => {
          if (cancelled) {
            return;
          }

          if (isMobileViewport && !readOnly) {
            if (mobileTextAreaRef.current) {
              focusMobileInputTarget();
              return;
            }
          }

          const currentEditor = editorRef.current;
            if (!isMobileViewport) {
              if (isEditorReady(currentEditor) && hydratedMemoIdRef.current === memo.id) {
                currentEditor.commands.focus("end");
                // Consuming the create request updates the parent and can
                // briefly blur the editor during that rerender. Mobile
                // standalone editing consumes the request above; desktop
                // keeps it alive until the list has observed the new memo so
                // a background refresh cannot select the previous memo.
                window.setTimeout(() => {
                  if (cancelled || memoRef.current?.id !== memo.id) {
                    return;
                  }

                  const activeEditor = editorRef.current;
                  if (isEditorReady(activeEditor)) {
                    activeEditor.commands.focus("end");
                  }
                }, 0);
                return;
              }
            }

          // The editor is mounted before its memo hydration/edit session
          // finishes. Keep retrying across that async boundary so a newly
          // created note reliably receives the caret on desktop as well.
          if (attempt < 120) {
            focusWhenReady(attempt + 1);
            return;
          }
        });
      };

      focusWhenReady();

      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frame);
      };
    }
  }, [focusMobileInputTarget, isMobileViewport, memo?.id, mobileDefaultEditMemoId, onMobileDefaultEditConsumed, readOnly]);

  const insertResourceFiles = useCallback((files: File[]) => {
    const currentMemo = memoRef.current;
    const currentEditor = editorRef.current;

    if (!currentMemo || currentMemo.isDeleted || !currentEditor || !currentEditor.isEditable || files.length === 0) {
      return;
    }

    const targetMemoId = currentMemo.id;

    void (async () => {
      setImageUploadState("uploading");

      const results = await processFilesSequentially(files, async (file) => {
        const isImage = SUPPORTED_PASTE_IMAGE_TYPES.has(file.type);
        const shouldCompress = isImage && imageCompressionEnabledRef.current;
        setImageUploadState(shouldCompress ? "compressing" : "uploading");
        const uploadFile = shouldCompress ? (await compressImageForUpload(file)).file : file;

        setImageUploadState("uploading");
        let resource: { kind: "image" | "attachment"; filename: string | null; url: string };
        try {
          const uploadedResource = (await repository.uploadMemoResource(targetMemoId, uploadFile)).resource;
          resource = { ...uploadedResource, url: toDesktopResourceUrl(uploadedResource.url) };
        } catch (error) {
          if (!isDesktopResourceRuntime()) throw error;
          const staged = await stageDesktopResource(targetMemoId, uploadFile);
          if (!staged) throw error;
          resource = {
            kind: isImage ? "image" : "attachment",
            filename: uploadFile.name,
            url: `edgeever-staged://${staged.id}`,
          };
        }
        return resource;
      });

      const successfulResults = results.filter((result) => result.status === "fulfilled");
      if (successfulResults.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ["resources"] });
      }

      const activeEditor = editorRef.current;
      if (memoRef.current?.id !== targetMemoId || !isEditorReady(activeEditor)) {
        setImageUploadState("idle");
        return;
      }

      const content = successfulResults.map(({ file, value: resource }) =>
        resource.kind === "image"
          ? {
              type: "image",
              attrs: {
                src: resource.url,
                alt: file.name,
                title: file.name,
                width: DEFAULT_IMAGE_WIDTH_PERCENT,
              },
            }
          : {
              type: "paragraph",
              content: [{
                type: "text",
                text: t("editor.attachmentLabel", { filename: resource.filename || file.name }),
                marks: [{
                  type: "link",
                  attrs: { href: resource.url, target: "_blank", class: "edgeever-attachment-link" },
                }],
              }],
            }
      );

      if (content.length > 0) {
        activeEditor.chain().focus().insertContent(content).run();
      }

      if (results.some((result) => result.status === "rejected")) {
        setImageUploadState("error");
        window.setTimeout(() => setImageUploadState("idle"), 2200);
      } else {
        setImageUploadState("idle");
      }
    })();
  }, [queryClient, repository, t]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: { openOnClick: false },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      EdgeEverCodeBlock.configure({ lowlight: codeBlockLowlight, defaultLanguage: "plaintext" }),
      MergeDivider,
      ...createEdgeEverMathematics(),
      ThemeBlock,
      ResizableImage.configure({
        allowBase64: false,
        inline: false,
      }),
      TableKit.configure({
        table: { renderWrapper: true },
      }),
      Placeholder.configure({
        placeholder: t("editor.placeholder"),
      }),
    ],
    content: memo
      ? resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown)
      : { type: "doc", content: [{ type: "paragraph" }] },
    editable: Boolean(memo && !effectiveReadOnly && hydratedEditorMemoId === memo.id),
    editorProps: {
      attributes: {
        class: "prose prose-slate max-w-none focus:outline-none min-h-[300px] px-4 py-3 sm:px-7",
      },
      handleKeyDown: (view, event) => {
        const shortcutKey = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && shortcutKey === "k") {
          event.preventDefault();
          openExternalLinkDialogRef.current();
          return true;
        }

        if (
          (shortcutKey !== "f" && shortcutKey !== "h") ||
          (!event.ctrlKey && !event.metaKey) ||
          event.altKey ||
          (shortcutKey === "f" && event.shiftKey)
        ) {
          return false;
        }

        const { from, to } = view.state.selection;
        if (from === to) {
          return false;
        }

        const selectedText = view.state.doc.textBetween(from, to, "\n").trim();
        if (!selectedText) {
          return false;
        }

        event.preventDefault();
        setNoteSearchQuery(selectedText);
        setNoteSearchOpen(true);
        setNoteSearchReplaceOpen(shortcutKey === "h");
        window.requestAnimationFrame(() => {
          noteSearchInputRef.current?.focus();
          noteSearchInputRef.current?.select();
        });
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (!target) {
          return false;
        }

        // Attachment chips use the resource action menu — never treat as a plain hyperlink open.
        if (getAttachmentLinkFromEventTarget(target)) {
          return false;
        }

        // Read preference/viewport at click time so settings changes apply without remounting the editor.
        const isMobile =
          typeof window !== "undefined" && window.matchMedia(MOBILE_EDITOR_QUERY).matches;
        const requireModifier = resolveEditorLinkRequireModifier(isMobile);
        if (!shouldOpenEditorLink(event, _view.editable, { requireModifier })) {
          return false;
        }

        const href = target.getAttribute("href");
        const memoId = parseMemoLinkHref(href);
        event.preventDefault();
        if (memoId) {
          onOpenMemo?.(memoId);
        } else if (href) {
          window.open(target.href, "_blank", "noopener,noreferrer");
        }
        return true;
      },
      handlePaste: (_view, event) => {
        const files = getResourceFilesFromDataTransfer(event.clipboardData);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();
        insertResourceFiles(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = getResourceFilesFromDataTransfer(event.dataTransfer);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();
        insertResourceFiles(files);
        return true;
      },
    },
  }, [
    // A ProseMirror undo history belongs to exactly one memo. Reusing the same
    // Editor instance across memo switches lets Ctrl/Cmd+Z undo the hydration
    // transaction and restore another memo's entire document.
    memo?.id,
  ]);

  const insertMemoLink = useCallback((target: MemoSummary) => {
    if (!isEditorReady(editor) || effectiveReadOnly || target.id === memo?.id) {
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: selectedText || target.title || t("common.untitledMemo"),
        marks: [{ type: "link", attrs: { href: createMemoLinkHref(target.id), class: "edgeever-note-link" } }],
      })
      .run();
    setNoteLinkPickerOpen(false);
    setNoteLinkQuery("");
  }, [editor, effectiveReadOnly, memo?.id, t]);

  const openExternalLinkDialog = useCallback(() => {
    if (effectiveReadOnly || !memo) {
      return;
    }

    if (useMarkdownSourceEditor) {
      const textarea = markdownTextAreaRef.current;
      const start = textarea?.selectionStart ?? markdownSource.length;
      const end = textarea?.selectionEnd ?? start;
      const selected = markdownSource.slice(start, end);
      const looksLikeUrl = /^(https?:\/\/\S+|www\.\S+)$/i.test(selected.trim());
      setExternalLinkDraft({
        href: looksLikeUrl ? selected.trim() : "",
        text: looksLikeUrl ? "" : selected,
        showTextField: !selected.trim() || looksLikeUrl,
        canRemove: false,
      });
      setExternalLinkDialogOpen(true);
      return;
    }

    if (!isEditorReady(editor) || useMobilePlainTextEditor) {
      return;
    }

    if (editor.isActive("link")) {
      const href = String(editor.getAttributes("link").href ?? "");
      if (isAttachmentLinkHref(href)) {
        return;
      }
      editor.chain().focus().extendMarkRange("link").run();
    }

    const { from, to, empty } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    const activeHref = editor.isActive("link") ? String(editor.getAttributes("link").href ?? "") : "";
    const looksLikeUrl = empty
      ? false
      : /^(https?:\/\/\S+|www\.\S+)$/i.test(selectedText.trim());

    setExternalLinkDraft({
      href: activeHref || (looksLikeUrl ? selectedText.trim() : ""),
      text: selectedText,
      showTextField: empty && !activeHref,
      canRemove: Boolean(activeHref) && !isAttachmentLinkHref(activeHref),
    });
    setExternalLinkDialogOpen(true);
  }, [
    editor,
    effectiveReadOnly,
    markdownSource,
    memo,
    useMarkdownSourceEditor,
    useMobilePlainTextEditor,
  ]);

  openExternalLinkDialogRef.current = openExternalLinkDialog;

  const applyExternalLink = useCallback(
    ({ href, text }: { href: string; text: string }) => {
      if (effectiveReadOnly) {
        return;
      }

      if (useMarkdownSourceEditor) {
        const textarea = markdownTextAreaRef.current;
        const start = textarea?.selectionStart ?? markdownSource.length;
        const end = textarea?.selectionEnd ?? start;
        const selected = markdownSource.slice(start, end);
        const label = selected.trim() ? selected : text;
        const snippet = formatMarkdownLink(label, href);
        const { next, caret } = insertMarkdownSnippet(markdownSource, snippet, start, end);
        setMarkdownSource(next);
        markDirtyStatus();
        window.requestAnimationFrame(() => {
          const node = markdownTextAreaRef.current;
          if (!node) return;
          node.focus();
          node.setSelectionRange(caret, caret);
        });
        return;
      }

      if (!isEditorReady(editor)) {
        return;
      }

      const inLink = editor.isActive("link");
      if (inLink) {
        editor.chain().focus().extendMarkRange("link").run();
      }

      const { from, to, empty } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to, "\n");

      if (!empty || inLink) {
        const label = selectedText || text || href;
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from, to },
            {
              type: "text",
              text: label,
              marks: [{ type: "link", attrs: { href, target: "_blank" } }],
            }
          )
          .run();
        return;
      }

      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: text || href,
          marks: [{ type: "link", attrs: { href, target: "_blank" } }],
        })
        .run();
    },
    [editor, effectiveReadOnly, markdownSource, useMarkdownSourceEditor]
  );

  const removeExternalLink = useCallback(() => {
    if (!isEditorReady(editor) || effectiveReadOnly) {
      return;
    }
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  }, [editor, effectiveReadOnly]);

  const externalLinkActive = useMemo(() => {
    if (!isEditorReady(editor) || useMarkdownSourceEditor || useMobilePlainTextEditor) {
      return false;
    }
    try {
      if (!editor.isActive("link")) {
        return false;
      }
      const href = String(editor.getAttributes("link").href ?? "");
      return Boolean(href) && !isAttachmentLinkHref(href);
    } catch {
      return false;
    }
  }, [editor, editorStateVersion, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const cancelResourceMenuHide = useCallback(() => {
    if (resourceMenuHideTimerRef.current !== null) {
      window.clearTimeout(resourceMenuHideTimerRef.current);
      resourceMenuHideTimerRef.current = null;
    }
  }, []);

  const scheduleResourceMenuHide = useCallback(() => {
    cancelResourceMenuHide();
    resourceMenuHideTimerRef.current = window.setTimeout(() => {
      resourceMenuHideTimerRef.current = null;
      hideResourceMenu();
    }, 160);
  }, [cancelResourceMenuHide, hideResourceMenu]);

  useEffect(() => {
    const showImageMenu = (event: Event) => {
      if (isMobileViewport) return;
      const detail = (event as CustomEvent<ImageMenuRequestDetail>).detail;
      if (!detail?.element) return;
      cancelResourceMenuHide();
      const rect = detail.element.getBoundingClientRect();
      showResourceMenu({
        ...detail,
        kind: "image",
        position: {
          left: Math.min(Math.max(rect.right - 8, 12), window.innerWidth - 12),
          top: Math.min(Math.max(rect.bottom - 8, 12), window.innerHeight - 12),
          placement: "inside-bottom-right",
        },
      });
    };
    const hideImageMenu = () => scheduleResourceMenuHide();
    window.addEventListener(IMAGE_MENU_SHOW_EVENT, showImageMenu);
    window.addEventListener(IMAGE_MENU_HIDE_EVENT, hideImageMenu);
    return () => {
      window.removeEventListener(IMAGE_MENU_SHOW_EVENT, showImageMenu);
      window.removeEventListener(IMAGE_MENU_HIDE_EVENT, hideImageMenu);
    };
  }, [cancelResourceMenuHide, isMobileViewport, scheduleResourceMenuHide, showResourceMenu]);

  const showAttachmentMenu = useCallback((target: EventTarget | null) => {
    if (isMobileViewport) return false;
    const link = getAttachmentLinkFromEventTarget(target);
    if (!link) return false;

    const href = link.getAttribute("href") || "";
    cancelResourceMenuHide();
    setNoteLinkHintPosition(null);
    showResourceMenu({
      kind: "attachment",
      url: href,
      filename: getAttachmentFilenameFromLabel(link.textContent || "") || getAttachmentResourceId(href) || "attachment",
      resourceId: getAttachmentResourceId(href),
      position: getNoteLinkHintPosition(link),
    });
    return true;
  }, [cancelResourceMenuHide, isMobileViewport, showResourceMenu]);

  const showEditorLinkOpenHint = useCallback((target: EventTarget | null) => {
    if (!shouldShowEditorLinkOpenHint(Boolean(editor?.isEditable), isMobileViewport, editorLinkOpenMode)) {
      return;
    }

    const link = getEditorNavigableLinkFromEventTarget(target);
    if (link) {
      setNoteLinkHintPosition(getNoteLinkHintPosition(link));
    } else {
      setNoteLinkHintPosition(null);
    }
  }, [editor?.isEditable, editorLinkOpenMode, isMobileViewport]);

  const handleEditorMouseOver = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (showAttachmentMenu(event.target)) return;
    showEditorLinkOpenHint(event.target);
  }, [showAttachmentMenu, showEditorLinkOpenHint]);

  const handleEditorMouseOut = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const attachmentLink = getAttachmentLinkFromEventTarget(event.target);
    if (attachmentLink) {
      const relatedTarget = event.relatedTarget;
      if (
        relatedTarget instanceof Node &&
        (attachmentLink.contains(relatedTarget) ||
          (relatedTarget instanceof Element && relatedTarget.closest("[data-edgeever-resource-menu]")))
      ) {
        return;
      }
      scheduleResourceMenuHide();
      return;
    }

    const link = getEditorNavigableLinkFromEventTarget(event.target);
    if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) {
      return;
    }
    setNoteLinkHintPosition(null);
  }, [scheduleResourceMenuHide]);

  const handleEditorClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey) {
      showEditorLinkOpenHint(event.target);
    }
  }, [showEditorLinkOpenHint]);

  const handleEditorFocusCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    if (showAttachmentMenu(event.target)) return;
    showEditorLinkOpenHint(event.target);
  }, [showAttachmentMenu, showEditorLinkOpenHint]);

  const handleEditorBlurCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    if (!getEditorNavigableLinkFromEventTarget(event.relatedTarget)) {
      setNoteLinkHintPosition(null);
    }
  }, []);

  useEffect(() => {
    if (!noteLinkHintPosition) {
      return;
    }

    const hideHint = () => setNoteLinkHintPosition(null);
    window.addEventListener("resize", hideHint);
    window.addEventListener("scroll", hideHint, true);
    return () => {
      window.removeEventListener("resize", hideHint);
      window.removeEventListener("scroll", hideHint, true);
    };
  }, [noteLinkHintPosition]);

  useEffect(() => {
    if (!resourceMenuTarget) return;
    const hideMenu = () => hideResourceMenu();
    window.addEventListener("resize", hideMenu);
    window.addEventListener("scroll", hideMenu, true);
    return () => {
      window.removeEventListener("resize", hideMenu);
      window.removeEventListener("scroll", hideMenu, true);
    };
  }, [hideResourceMenu, resourceMenuTarget]);

  useEffect(() => {
    setNoteLinkHintPosition(null);
    resetResourceActions();
  }, [memo?.id, isMarkdownMode, resetResourceActions]);

  useEffect(() => () => {
    if (resourceMenuHideTimerRef.current !== null) {
      window.clearTimeout(resourceMenuHideTimerRef.current);
    }
  }, []);

  useEffect(() => {
    imageCompressionEnabledRef.current = imageCompressionEnabled;
  }, [imageCompressionEnabled]);

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    if (!isEditorReady(editor)) {
      return;
    }

    const refreshCharacterCount = () => setEditorContentVersion((version) => version + 1);
    editor.on("update", refreshCharacterCount);

    return () => {
      editor.off("update", refreshCharacterCount);
    };
  }, [editor]);

  const noteSearchMatches = useMemo(
    () => getEditorSearchMatches(editor, noteSearchQuery),
    [dirtyVersion, editor, memo?.id, noteSearchQuery]
  );
  const contentSearchMatches = useMemo(
    () => getEditorSearchMatches(editor, contentSearchQuery),
    [contentSearchQuery, dirtyVersion, editor, memo?.id]
  );

  const selectNoteSearchMatch = useCallback(
    (index: number, matches = noteSearchMatches) => {
      const match = matches[index];

      if (!isEditorReady(editor) || !match) {
        return;
      }

      // `setTextSelection` updates the ProseMirror selection but does not
      // request the view to scroll to it. This is especially visible while
      // the search input keeps focus, because the browser cannot scroll the
      // editor selection for us in that case.
      editor.chain().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();

      window.requestAnimationFrame(() => {
        const scrollContainer = editorScrollContainerRef.current;
        const domPosition = editor.view.domAtPos(match.from);
        const node = domPosition.node.nodeType === Node.TEXT_NODE
          ? domPosition.node.parentElement
          : domPosition.node instanceof Element
            ? domPosition.node
            : domPosition.node.parentElement;

        if (!scrollContainer || !node) {
          return;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const padding = 24;
        const isAbove = nodeRect.top < containerRect.top + padding;
        const isBelow = nodeRect.bottom > containerRect.bottom - padding;

        if (isAbove || isBelow) {
          const targetTop = scrollContainer.scrollTop + nodeRect.top - containerRect.top
            - (scrollContainer.clientHeight - nodeRect.height) / 2;
          scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
        }
      });
    },
    [editor, noteSearchMatches]
  );

  useEffect(() => {
    if (!isEditorReady(editor)) {
      return;
    }

    const searchHighlightPlugin = createNoteSearchHighlightPlugin({
      getQuery: () => noteSearchOpen ? noteSearchQuery : contentSearchQuery,
      getActiveIndex: () => noteSearchOpen ? noteSearchIndex : 0,
    });

    editor.registerPlugin(searchHighlightPlugin);

    return () => {
      if (isEditorReady(editor)) {
        editor.unregisterPlugin(NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY);
      }
    };
  }, [contentSearchQuery, editor, noteSearchIndex, noteSearchMatches, noteSearchOpen, noteSearchQuery]);

  const focusNoteSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      noteSearchInputRef.current?.focus();
      noteSearchInputRef.current?.select();
    });
  }, []);

  const openNoteSearch = useCallback((showReplace = false) => {
    setNoteSearchOpen(true);
    setNoteSearchReplaceOpen(showReplace);
    focusNoteSearchInput();
  }, [focusNoteSearchInput]);

  const openNoteReplace = useCallback(() => {
    setNoteSearchOpen(true);
    setNoteSearchReplaceOpen(true);
    focusNoteSearchInput();
  }, [focusNoteSearchInput]);

  const closeNoteSearch = useCallback(() => {
    setNoteSearchOpen(false);
    if (isEditorReady(editor)) {
      editor.commands.focus();
    }
  }, [editor]);

  useEffect(() => {
    if (!noteSearchOpen) {
      return;
    }

    const handleNoteSearchEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeNoteSearch();
    };

    // Capture the event so Escape works even when focus has moved to the
    // editor, toolbar, or another control outside the search inputs.
    window.addEventListener("keydown", handleNoteSearchEscape, true);
    return () => window.removeEventListener("keydown", handleNoteSearchEscape, true);
  }, [closeNoteSearch, noteSearchOpen]);

  const moveNoteSearchMatch = useCallback(
    (direction: 1 | -1) => {
      if (noteSearchMatches.length === 0) {
        return;
      }

      setNoteSearchIndex((current) => {
        const next = getNextSearchMatchIndex(current, direction, noteSearchMatches.length);
        selectNoteSearchMatch(next);
        return next;
      });
    },
    [noteSearchMatches.length, selectNoteSearchMatch]
  );

  useEffect(() => {
    if (searchFocusToken === 0) {
      return;
    }

    openNoteSearch();
  }, [openNoteSearch, searchFocusToken]);

  useEffect(() => {
    if (replaceFocusToken === 0) {
      return;
    }

    openNoteReplace();
  }, [openNoteReplace, replaceFocusToken]);

  useEffect(() => {
    setNoteSearchIndex(0);

    if (noteSearchOpen && noteSearchMatches[0]) {
      selectNoteSearchMatch(0, noteSearchMatches);
    } else if (!noteSearchOpen && contentSearchMatches[0]) {
      selectNoteSearchMatch(0, contentSearchMatches);
    }
  }, [contentSearchMatches, noteSearchMatches, noteSearchOpen, selectNoteSearchMatch]);

  const replaceAllNoteSearchMatches = useCallback(() => {
    if (!isEditorReady(editor) || effectiveReadOnly || noteSearchMatches.length === 0) {
      return;
    }

    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        for (const match of [...noteSearchMatches].reverse()) {
          tr.insertText(noteSearchReplacement, match.from, match.to);
        }

        dispatch?.(tr);
        return true;
      })
      .run();

    setNoteSearchIndex(0);
    window.requestAnimationFrame(() => noteSearchInputRef.current?.focus());
  }, [editor, effectiveReadOnly, noteSearchMatches, noteSearchReplacement]);

  useEffect(() => {
    if (!isEditorReady(editor)) {
      return;
    }

    const refreshToolbar = () => setEditorStateVersion((version) => version + 1);
    editor.on("selectionUpdate", refreshToolbar);
    editor.on("transaction", refreshToolbar);

    return () => {
      editor.off("selectionUpdate", refreshToolbar);
      editor.off("transaction", refreshToolbar);
    };
  }, [editor]);

  const getMobilePlainTextValue = useCallback(
    () => (mobileTextAreaRef.current ? getMobilePlainTextElementValue(mobileTextAreaRef.current) : mobilePlainText),
    [mobilePlainText]
  );

  const recordMobileImeDebugEvent = useCallback((eventName: string, event?: unknown) => {
    const plainTextElement = mobileTextAreaRef.current;
    const nativeEvent = event && typeof event === "object" && "nativeEvent" in event
      ? (event as { nativeEvent?: unknown }).nativeEvent
      : event;
    const inputEvent = nativeEvent as Partial<InputEvent> | undefined;
    const keyboardEvent = nativeEvent as Partial<KeyboardEvent> | undefined;

    mobileImeDebugEventIdRef.current += 1;
    setMobileImeDebugActiveElement(getActiveElementLabel());
    setMobileImeDebugEvents((current) =>
      [
        {
          id: mobileImeDebugEventIdRef.current,
          event: eventName,
          activeElement: getActiveElementLabel(),
          inputType: typeof inputEvent?.inputType === "string" ? inputEvent.inputType : undefined,
          isComposing: typeof inputEvent?.isComposing === "boolean" ? inputEvent.isComposing : undefined,
          key: typeof keyboardEvent?.key === "string" ? keyboardEvent.key : undefined,
          valueLength: getMobilePlainTextElementValue(plainTextElement).length,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        },
        ...current,
      ].slice(0, 20)
    );
  }, []);

  useEffect(() => {
    mobileImeDebugRecorderRef.current = recordMobileImeDebugEvent;
  }, [recordMobileImeDebugEvent]);

  useEffect(() => {
    if (!useMobilePlainTextEditor) {
      return;
    }

    recordMobileImeDebugEvent("mount-mobile-plain-editor");
    const timer = window.setInterval(() => {
      setMobileImeDebugActiveElement(getActiveElementLabel());
    }, 800);

    return () => window.clearInterval(timer);
  }, [recordMobileImeDebugEvent, useMobilePlainTextEditor]);

  const persistCurrentDraft = useCallback(
    (nextTitle = title, nextTagsText = tagsText, nextMobilePlainText = getMobilePlainTextValue()) => {
      const currentMemo = memoRef.current;
      const currentEditor = editorRef.current;

      if (
        !currentMemo ||
        currentMemo.isDeleted ||
        hydratedMemoIdRef.current !== currentMemo.id ||
        (!useMobilePlainTextEditor && !isEditorReady(currentEditor))
      ) {
        return;
      }

      void localDb.drafts.put({
        memoId: currentMemo.id,
        title: nextTitle,
        tagsText: nextTagsText,
        contentJson: useMobilePlainTextEditor
          ? markdownToDoc(nextMobilePlainText)
          : useMarkdownSourceEditor
            ? markdownToDoc(markdownSource)
            : (currentEditor?.getJSON() as TiptapDoc),
        updatedAt: new Date().toISOString(),
      });
    },
    [getMobilePlainTextValue, markdownSource, tagsText, title, useMarkdownSourceEditor, useMobilePlainTextEditor]
  );

  const markDirty = useCallback(() => {
    const currentMemo = memoRef.current;
    if (
      hydratingRef.current ||
      currentMemo?.isDeleted ||
      !currentMemo ||
      hydratedMemoIdRef.current !== currentMemo.id
    ) {
      return;
    }

    markDirtyStatus();
  }, [markDirtyStatus]);

  const getCurrentMarkdownForAi = useCallback(() => {
    if (useMobilePlainTextEditor) return getMobilePlainTextValue();
    if (useMarkdownSourceEditor) return markdownSource;
    return isEditorReady(editor)
      ? docToMarkdown(editor.getJSON() as TiptapDoc)
      : memoRef.current?.contentMarkdown ?? "";
  }, [editor, getMobilePlainTextValue, markdownSource, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const openAiAssistant = useCallback(() => {
    let selection: AiSelectionContext | null = null;

    if (useMobilePlainTextEditor) {
      const source = getMobilePlainTextValue();
      const plainTextElement = mobileTextAreaRef.current;
      const from = plainTextElement instanceof HTMLTextAreaElement ? plainTextElement.selectionStart : 0;
      const to = plainTextElement instanceof HTMLTextAreaElement ? plainTextElement.selectionEnd : from;
      const contentMarkdown = source.slice(from, to).trim();
      if (to > from && contentMarkdown) selection = { kind: "plain", from, to, contentMarkdown };
    } else if (useMarkdownSourceEditor) {
      const from = markdownTextAreaRef.current?.selectionStart ?? 0;
      const to = markdownTextAreaRef.current?.selectionEnd ?? from;
      const contentMarkdown = markdownSource.slice(from, to).trim();
      if (to > from && contentMarkdown) selection = { kind: "markdown", from, to, contentMarkdown };
    } else if (isEditorReady(editor)) {
      const richSelection = getRichTextAiSelectionContext(editor.state.doc, editor.state.selection);
      if (richSelection) selection = { kind: "rich", ...richSelection };
    }

    setAiSelection(selection);
    setAiAssistantOpen(true);
  }, [editor, getMobilePlainTextValue, markdownSource, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const handleAiAssistantOpenChange = useCallback((nextOpen: boolean) => {
    setAiAssistantOpen(nextOpen);
    if (!nextOpen) setAiSelection(null);
  }, []);

  const applyAiDraft = useCallback((draft: string, mode: "append" | "replace") => {
    if (mode === "replace" && aiSelection) {
      const replacementDraft = normalizeAiSelectionReplacement(draft);
      if (!replacementDraft) return;

      if (aiSelection.kind === "plain") {
        const source = getMobilePlainTextValue();
        const { next, caret } = insertMarkdownSnippet(source, replacementDraft, aiSelection.from, aiSelection.to);
        setMobilePlainText(next);
        setMobilePlainTextElementValue(mobileTextAreaRef.current, next);
        persistCurrentDraft(title, tagsText, next);
        window.requestAnimationFrame(() => {
          const plainTextElement = mobileTextAreaRef.current;
          plainTextElement?.focus();
          if (plainTextElement instanceof HTMLTextAreaElement) plainTextElement.setSelectionRange(caret, caret);
        });
      } else if (aiSelection.kind === "markdown") {
        const { next, caret } = insertMarkdownSnippet(markdownSource, replacementDraft, aiSelection.from, aiSelection.to);
        setMarkdownSource(next);
        window.requestAnimationFrame(() => {
          markdownTextAreaRef.current?.focus();
          markdownTextAreaRef.current?.setSelectionRange(caret, caret);
        });
      } else if (aiSelection.kind === "rich" && isEditorReady(editor)) {
        const maxPos = editor.state.doc.content.size;
        const from = Math.max(1, Math.min(aiSelection.from, maxPos));
        const to = Math.max(from, Math.min(aiSelection.to, maxPos));
        editor.chain().focus().insertContentAt(
          { from, to },
          getRichTextAiSelectionReplacement(replacementDraft, aiSelection.isInline),
        ).run();
      }
      markDirty();
      setAiSelection(null);
      setAiAssistantOpen(false);
      return;
    }

    const current = getCurrentMarkdownForAi();
    const next = mode === "append" && current.trim()
      ? `${current.replace(/\s+$/, "")}\n\n${draft}`
      : draft;
    if (useMobilePlainTextEditor) {
      setMobilePlainText(next);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, next);
      persistCurrentDraft(title, tagsText, next);
    } else if (useMarkdownSourceEditor) {
      setMarkdownSource(next);
    } else if (isEditorReady(editor)) {
      editor.commands.setContent(markdownToDoc(next));
    }
    markDirty();
    setAiSelection(null);
    setAiAssistantOpen(false);
  }, [aiSelection, editor, getCurrentMarkdownForAi, getMobilePlainTextValue, markDirty, markdownSource, persistCurrentDraft, tagsText, title, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const getCurrentContentJson = useCallback((): TiptapDoc | null => {
    if (useMobilePlainTextEditor) {
      return markdownToDoc(getMobilePlainTextValue());
    }

    if (useMarkdownSourceEditor) {
      return markdownToDoc(markdownSource);
    }

    const currentEditor = editorRef.current;
    if (!isEditorReady(currentEditor)) {
      return null;
    }

    return currentEditor.getJSON() as TiptapDoc;
  }, [getMobilePlainTextValue, markdownSource, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const characterCount = useMemo(() => {
    const contentJson = getCurrentContentJson()
      ?? (memo ? resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown) : null);

    return countMemoCharacters(contentJson);
  }, [dirtyVersion, editorContentVersion, getCurrentContentJson, memo]);

  const currentSnapshot = useCallback(() => {
    const contentJson = getCurrentContentJson();
    if (!contentJson) {
      return null;
    }

    return JSON.stringify({
      title,
      tagsText,
      contentJson,
    });
  }, [getCurrentContentJson, tagsText, title]);

  useEffect(() => {
    const currentEditor = editorRef.current;
    let cancelled = false;

    if (!memo) {
      memoRef.current = null;
      editSessionRef.current = null;
      hydratedMemoIdRef.current = null;
      appliedEditorSourceKeyRef.current = null;
      setHydratedEditorMemoId(null);
      editingMemoIdRef.current = null;
      setHasUnsavedChanges(false);
      setTitle("");
      setTagsText("");
      setMobilePlainText("");
      setMarkdownSource("");
      setIsMarkdownMode(false);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, "");
      setSaveState("idle");
      if (isEditorReady(currentEditor)) {
        currentEditor.commands.clearContent();
      }
      return;
    }

    const previousMemo = memoRef.current;
    const sameMemo = editingMemoIdRef.current === memo.id;

    if (!sameMemo) {
      hydratedMemoIdRef.current = null;
      appliedEditorSourceKeyRef.current = null;
      setHydratedEditorMemoId(null);
    }

    // While the user still has unsaved keystrokes, ignore memo prop churn entirely
    // unless the incoming snapshot is strictly fresher (e.g. another device).
    if (sameMemo && hasUnsavedChangesRef.current && !memo.isDeleted) {
      if (previousMemo && shouldAcceptRemoteMemoDetail(previousMemo, memo)) {
        memoRef.current = memo;
      }
      return;
    }

    // After local autosave clears dirty, reject stale remote props that would
    // call setContent and roll the document back (cursor jump / deleted text returns).
    if (
      sameMemo &&
      !memo.isDeleted &&
      previousMemo &&
      previousMemo.id === memo.id &&
      !shouldAcceptRemoteMemoDetail(previousMemo, memo)
    ) {
      return;
    }

    // Same memo already on screen and the query only re-emitted an equivalent
    // snapshot (common when switching away/back triggers a detail refetch).
    // Refresh the edit session quietly — never touch document or selection.
    if (
      sameMemo &&
      !memo.isDeleted &&
      hydratedMemoIdRef.current === memo.id &&
      previousMemo &&
      previousMemo.id === memo.id &&
      previousMemo.revision === memo.revision &&
      previousMemo.updatedAt === memo.updatedAt &&
      previousMemo.contentHash === memo.contentHash &&
      previousMemo.title === memo.title &&
      previousMemo.tags.length === memo.tags.length &&
      previousMemo.tags.every((tag, index) => tag === memo.tags[index])
    ) {
      memoRef.current = memo;
      if (!requiresLocalEditSession(memo)) {
        void api.createMemoEditSession(memo.id).then((response) => {
          if (cancelled || editingMemoIdRef.current !== memo.id) return;
          editSessionRef.current = response.editSession;
        }).catch(() => {
          // Keep the previous session; the next save can open a new one.
        });
      }
      return;
    }

    memoRef.current = memo;

    void (async () => {
      let [draft, queuedUpdate] = memo.isDeleted
        ? [null, null]
        : await Promise.all([
            localDb.drafts.get(memo.id),
            localDb.syncQueue.get(getMemoUpdateQueueId(memo.id)),
          ]);

      if (cancelled) {
        return;
      }

      if (queuedUpdate && isMemoUpdateAlreadyApplied(memo, queuedUpdate)) {
        await Promise.all([
          localDb.syncQueue.delete(queuedUpdate.id),
          localDb.drafts.delete(memo.id),
        ]);
        draft = null;
        queuedUpdate = undefined;
      }

      const resolvedDraft = resolveEditorDraftState({ memo, draft, queuedUpdate });
      if (draft && !queuedUpdate && resolvedDraft.source === "memo") {
        await localDb.drafts.delete(memo.id);
      }
      const {
        title: nextTitle,
        tagsText: nextTagsText,
        contentJson: nextContent,
        contentMarkdown: nextMarkdown,
        hasUnsavedChanges: nextHasUnsavedChanges,
        sourceKey,
      } = resolvedDraft;

      const alreadyHydratedSameMemo = sameMemo && hydratedMemoIdRef.current === memo.id;
      const editorMarkdownMatches = Boolean(
        alreadyHydratedSameMemo &&
        isEditorReady(currentEditor) &&
        docToMarkdown(currentEditor.getJSON() as TiptapDoc) === nextMarkdown &&
        title === nextTitle &&
        tagsText === nextTagsText
      );
      const sourceAlreadyApplied = alreadyHydratedSameMemo && appliedEditorSourceKeyRef.current === sourceKey;

      // Skip a full document replace when content already matches — setContent
      // always resets the selection and feels like a line jump / jump-to-end.
      if (sourceAlreadyApplied || editorMarkdownMatches) {
        editingMemoIdRef.current = memo.id;
        appliedEditorSourceKeyRef.current = sourceKey;
        if (queuedUpdate) {
          const nextState = syncStatusToSaveState(queuedUpdate.status);
          setSaveState(nextState);
          setSaveConflictInfo(nextState === "conflict" ? getMemoSaveConflictInfoFromQueueItem(queuedUpdate) : null);
        }
        if (requiresLocalEditSession(memo)) {
          editSessionRef.current = editSessionRef.current ?? createLocalEditSession(memo);
        } else {
          void api.createMemoEditSession(memo.id).then((response) => {
            if (cancelled || editingMemoIdRef.current !== memo.id) return;
            editSessionRef.current = response.editSession;
          }).catch(() => {
            // Keep any previous session for this memo.
          });
        }
        return;
      }

      const previousSelection = alreadyHydratedSameMemo && isEditorReady(currentEditor)
        ? {
            from: currentEditor.state.selection.from,
            to: currentEditor.state.selection.to,
          }
        : null;

      hydratingRef.current = true;
      editingMemoIdRef.current = memo.id;
      if (nextHasUnsavedChanges) {
        // A recovered draft is a real save request, not merely a label state.
        // Incrementing dirtyVersion guarantees the autosave effect is armed
        // after the editor and local edit session finish hydrating.
        markDirtyStatus();
      } else {
        setHasUnsavedChanges(false);
      }
      if (queuedUpdate) {
        const nextState = syncStatusToSaveState(queuedUpdate.status);
        setSaveState(nextState);
        setSaveConflictInfo(nextState === "conflict" ? getMemoSaveConflictInfoFromQueueItem(queuedUpdate) : null);
      } else {
        setSaveState("idle");
        setSaveConflictInfo(null);
      }
      setTitle(nextTitle);
      setTagsText(nextTagsText);
      setMobilePlainText(nextMarkdown);
      setMarkdownSource(nextMarkdown);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, nextMarkdown);

      if (isEditorReady(currentEditor)) {
        try {
          currentEditor.commands.setContent(nextContent);
        } catch (err) {
          console.error("Failed to set TipTap contentJson, falling back to markdownToDoc:", err);
          currentEditor.commands.setContent(markdownToDoc(nextMarkdown));
        }

        // Re-applying content on an already-open note (e.g. draft vs server)
        // must not yank the caret to the document end.
        if (previousSelection) {
          const maxPos = currentEditor.state.doc.content.size;
          const from = Math.max(1, Math.min(previousSelection.from, maxPos));
          const to = Math.max(1, Math.min(previousSelection.to, maxPos));
          currentEditor.commands.setTextSelection({ from, to });
        }
      }

      appliedEditorSourceKeyRef.current = sourceKey;
      hydratedMemoIdRef.current = memo.id;
      setHydratedEditorMemoId(memo.id);

      if (requiresLocalEditSession(memo)) {
        editSessionRef.current = createLocalEditSession(memo);
      } else {
        // Do not block first paint / caret on the edit-session network round-trip.
        void api.createMemoEditSession(memo.id).then((response) => {
          if (cancelled || editingMemoIdRef.current !== memo.id) return;
          editSessionRef.current = response.editSession;
        }).catch(() => {
          if (cancelled || editingMemoIdRef.current !== memo.id) return;
          editSessionRef.current = createLocalEditSession(memo);
        });
      }

      window.setTimeout(() => {
        hydratingRef.current = false;
      }, 0);
    })();

    return () => {
      cancelled = true;
    };
    // title/tagsText are read only for same-content skip detection; re-running on
    // every keystroke would re-hydrate the editor while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [isTrashView, memo, editor]);

  useEffect(() => {
    if (!useMobilePlainTextEditor) {
      return;
    }

    if (isEditorReady(editor)) {
      const nextMarkdown = docToMarkdown(editor.getJSON() as TiptapDoc);
      setMobilePlainText(nextMarkdown);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, nextMarkdown);
      return;
    }

    if (memo) {
      const nextMarkdown = docToMarkdown(resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown));
      setMobilePlainText(nextMarkdown);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, nextMarkdown);
    }
  }, [editor, memo?.id, useMobilePlainTextEditor]);

  useEffect(() => {
    if (isEditorReady(editor)) {
      editor.setEditable(Boolean(memo && !effectiveReadOnly && hydratedEditorMemoId === memo.id));
    }
  }, [editor, effectiveReadOnly, hydratedEditorMemoId, memo]);

  useEffect(() => {
    if (!isEditorReady(editor) || !memo) {
      return;
    }

    const persistDraft = () => {
      if (hydratingRef.current || memoRef.current?.isDeleted) {
        return;
      }
      persistCurrentDraft();
      markDirty();
    };

    editor.on("update", persistDraft);
    return () => {
      editor.off("update", persistDraft);
    };
  }, [editor, markDirty, memo, persistCurrentDraft]);

  useEffect(() => {
    const advanceMemoSyncBase = (syncedMemo: MemoDetail | null | undefined) => {
      const currentMemo = memoRef.current;
      if (!syncedMemo || currentMemo?.id !== syncedMemo.id || syncedMemo.revision < currentMemo.revision) {
        return;
      }

      // Keep the live document, title, and tags intact while moving its
      // concurrency base to the revision acknowledged for this device.
      memoRef.current = {
        ...currentMemo,
        revision: syncedMemo.revision,
        contentHash: syncedMemo.contentHash,
        updatedAt: syncedMemo.updatedAt,
      };
      if (editSessionRef.current?.memoId === syncedMemo.id) {
        editSessionRef.current = {
          ...editSessionRef.current,
          baseRevision: syncedMemo.revision,
          baseContentHash: syncedMemo.contentHash,
        };
      }
    };

    const handleMemoSyncAcknowledged = (event: Event) => {
      advanceMemoSyncBase((event as CustomEvent<MemoDetail>).detail);
    };

    const handleSyncCompleted = (event: Event) => {
      const result = (event as CustomEvent<{
        failed?: number;
        conflicted?: number;
        syncedMemos?: ReadonlyMap<string, MemoDetail>;
      }>).detail;
      const memoId = memoRef.current?.id;

      const syncedMemo = memoId ? result?.syncedMemos?.get(memoId) : null;
      advanceMemoSyncBase(syncedMemo);

      if (memoId && (result?.conflicted ?? 0) > 0) {
        void localDb.syncQueue.get(getMemoUpdateQueueId(memoId)).then((item) => {
          if (!item || item.status !== "conflict" || memoRef.current?.id !== memoId) {
            return;
          }
          setSaveState("conflict");
          setSaveConflictInfo(getMemoSaveConflictInfoFromQueueItem(item));
        });
        return;
      }

      if ((result?.failed ?? 0) > 0 || hasUnsavedChangesRef.current) {
        return;
      }

      setSaveState((current) => {
        if (current !== "queued") {
          return current;
        }
        setSaveConflictInfo(null);
        return "saved";
      });
    };

    window.addEventListener(MEMO_SYNC_ACKNOWLEDGED_EVENT, handleMemoSyncAcknowledged);
    window.addEventListener("edgeever:sync-completed", handleSyncCompleted);
    return () => {
      window.removeEventListener(MEMO_SYNC_ACKNOWLEDGED_EVENT, handleMemoSyncAcknowledged);
      window.removeEventListener("edgeever:sync-completed", handleSyncCompleted);
    };
  }, []);

  const handleMarkdownModeChange = useCallback(() => {
    if (effectiveReadOnly || !isEditorReady(editor)) {
      return;
    }

    if (isMarkdownMode) {
      hydratingRef.current = true;
      editor.commands.setContent(markdownToDoc(markdownSource));
      setIsMarkdownMode(false);
      window.setTimeout(() => {
        hydratingRef.current = false;
      }, 0);
      return;
    }

    setMarkdownSource(docToMarkdown(editor.getJSON() as TiptapDoc));
    setIsMarkdownMode(true);
  }, [editor, effectiveReadOnly, isMarkdownMode, markdownSource]);

  const handleMarkdownSourceChange = useCallback((value: string) => {
    setMarkdownSource(value);
    markDirty();
  }, [markDirty]);

  const handleCopyToWeChat = useCallback(async () => {
    if (!isEditorReady(editor)) {
      return;
    }

    setWechatCopyState("copying");
    try {
      if (useMarkdownSourceEditor) {
        await copyMarkdownToWeChat(markdownSource);
      } else {
        await copyEditorToWeChat(editor);
      }
      setWechatCopyState("copied");
      window.setTimeout(() => setWechatCopyState("idle"), 2200);
    } catch {
      setWechatCopyState("error");
      window.setTimeout(() => setWechatCopyState("idle"), 2600);
    }
  }, [editor, markdownSource, useMarkdownSourceEditor]);

  const handleCopyMemoId = useCallback(async () => {
    if (!memo || isLocalMemoId(memo.id)) {
      return;
    }
    const copied = await copyTextToClipboard(memo.id);
    setMemoIdCopyNotice({ status: copied ? "copied" : "error", id: memo.id });
    window.setTimeout(() => setMemoIdCopyNotice(null), copied ? 2200 : 3000);
  }, [memo]);

  const handleExportPdf = useCallback((preopenedWindow?: Window | null) => {
    if (!isEditorReady(editor) || !memo) {
      return;
    }

    if (preopenedWindow === null) {
      window.alert(t("editor.pdfExport.popupBlocked"));
      return;
    }

    const currentDocument = useMobilePlainTextEditor
      ? markdownToDoc(getMobilePlainTextValue())
      : useMarkdownSourceEditor
        ? markdownToDoc(markdownSource)
        : editor.getJSON() as TiptapDoc;
    const html = serializeNoteDocumentForPrint(editor, currentDocument);
    const opened = openNotePrintPreview(
      {
        title: title.trim() || t("common.untitledMemo"),
        notebook: notebookOptions.find((notebook) => notebook.id === memo.notebookId)?.name ?? "",
        tags: parseTagsText(tagsText),
        updatedAt: formatDateTime(memo.updatedAt),
        html,
        language: i18n.resolvedLanguage ?? i18n.language,
        labels: {
          close: t("editor.pdfExport.close"),
          error: t("editor.pdfExport.error"),
          hint: t("editor.pdfExport.hint"),
          preparing: t("editor.pdfExport.preparing"),
          print: t("editor.pdfExport.print"),
          ready: t("editor.pdfExport.ready"),
        },
      },
      preopenedWindow ?? undefined,
    );

    if (!opened) {
      window.alert(t("editor.pdfExport.popupBlocked"));
    }
  }, [
    editor,
    getMobilePlainTextValue,
    i18n.language,
    i18n.resolvedLanguage,
      markdownSource,
      markDirtyStatus,
    memo,
    notebookOptions,
    t,
    tagsText,
    title,
    useMarkdownSourceEditor,
    useMobilePlainTextEditor,
  ]);

  const handleExportMarkdown = useCallback(() => {
    if (!isEditorReady(editor) || !memo) {
      return;
    }

    const markdown = useMobilePlainTextEditor
      ? getMobilePlainTextValue()
      : useMarkdownSourceEditor
        ? markdownSource
        : docToMarkdown(editor.getJSON() as TiptapDoc);
    downloadMarkdownFile(
      markdown,
      title,
      t("common.untitledMemo")
    );
  }, [
    editor,
    getMobilePlainTextValue,
    markdownSource,
    memo,
    t,
    title,
    useMarkdownSourceEditor,
    useMobilePlainTextEditor,
  ]);

  const handleExportHtml = useCallback(async () => {
    if (!isEditorReady(editor) || !memo) {
      return;
    }

    const currentDocument = useMobilePlainTextEditor
      ? markdownToDoc(getMobilePlainTextValue())
      : useMarkdownSourceEditor
        ? markdownToDoc(markdownSource)
        : editor.getJSON() as TiptapDoc;
    const bodyHtml = serializeNoteDocumentForPrint(editor, currentDocument);

    try {
      const { images } = await downloadNoteHtmlFile({
        bodyHtml,
        title: title.trim() || t("common.untitledMemo"),
        notebook: notebookOptions.find((notebook) => notebook.id === memo.notebookId)?.name ?? "",
        tags: parseTagsText(tagsText),
        updatedAt: formatDateTime(memo.updatedAt),
        language: i18n.resolvedLanguage ?? i18n.language,
        fallbackTitle: t("common.untitledMemo"),
        styles: NOTE_HTML_FULL_STYLES,
      });

      const noticeKind = getHtmlImageEmbedNoticeKind(images);
      if (noticeKind === "partial") {
        window.alert(t("editor.htmlExport.imageEmbedPartial", {
          embedded: images.embedded,
          total: images.total,
          failed: images.failed,
        }));
      } else if (noticeKind === "failed-all") {
        window.alert(t("editor.htmlExport.imageEmbedFailed", {
          total: images.total,
        }));
      }
    } catch {
      window.alert(t("editor.htmlExport.error"));
    }
  }, [
    editor,
    getMobilePlainTextValue,
    i18n.language,
    i18n.resolvedLanguage,
    markdownSource,
    memo,
    notebookOptions,
    t,
    tagsText,
    title,
    useMarkdownSourceEditor,
    useMobilePlainTextEditor,
  ]);

  const handleSaveAsTemplate = useCallback(() => {
    if (!memo) {
      return;
    }

    const name = window.prompt(t("templates.templateNamePrompt"), memo.title || "");
    if (!name?.trim()) {
      return;
    }

    const currentMarkdown = useMobilePlainTextEditor
      ? getMobilePlainTextValue()
      : isEditorReady(editor)
        ? docToMarkdown(editor.getJSON() as TiptapDoc)
        : memo.contentMarkdown;
    const currentTemplateMemo: MemoDetail = {
      ...memo,
      title,
      tags: parseTagsText(tagsText),
      contentJson: markdownToDoc(currentMarkdown),
      contentMarkdown: currentMarkdown,
    };
    void onSaveAsTemplate(currentTemplateMemo, name.trim());
  }, [editor, getMobilePlainTextValue, memo, onSaveAsTemplate, t, tagsText, title, useMobilePlainTextEditor]);

  useEffect(() => {
    if (
      !documentActionRequest ||
      documentActionRequest.memoId !== memo?.id ||
      hydratedEditorMemoId !== memo.id ||
      !isEditorReady(editor)
    ) {
      return;
    }

    onDocumentActionConsumed?.(documentActionRequest.id);

    switch (documentActionRequest.action) {
      case "share":
        setShareOpen(true);
        break;
      case "export-markdown":
        handleExportMarkdown();
        break;
      case "export-html":
        void handleExportHtml();
        break;
      case "export-pdf":
        handleExportPdf(documentActionRequest.printWindow);
        break;
      case "save-as-template":
        handleSaveAsTemplate();
        break;
    }
  }, [
    documentActionRequest,
    editor,
    handleExportHtml,
    handleExportMarkdown,
    handleExportPdf,
    handleSaveAsTemplate,
    hydratedEditorMemoId,
    memo,
    onDocumentActionConsumed,
  ]);

  useEffect(() => {
    if (!useMobilePlainTextEditor) {
      return;
    }

    const persistBeforeSuspend = () => {
      if (hasUnsavedChangesRef.current) {
        persistCurrentDraft(title, tagsText, getMobilePlainTextValue());
      }
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        persistBeforeSuspend();
      }
    };

    window.addEventListener("pagehide", persistBeforeSuspend);
    document.addEventListener("visibilitychange", persistWhenHidden);

    return () => {
      window.removeEventListener("pagehide", persistBeforeSuspend);
      document.removeEventListener("visibilitychange", persistWhenHidden);
    };
  }, [getMobilePlainTextValue, persistCurrentDraft, tagsText, title, useMobilePlainTextEditor]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentMemo = memoRef.current;
      const contentJson = getCurrentContentJson();
      const editSession = editSessionRef.current;

      if (!currentMemo || !contentJson || !editSession || hydratedMemoIdRef.current !== currentMemo.id) {
        throw new Error("No memo selected");
      }

      if (currentMemo.isDeleted) {
        throw new Error("Deleted memos are read-only");
      }

      const snapshot = currentSnapshot();
      if (!snapshot) {
        throw new Error("Editor is not ready");
      }

      const payload: MemoUpdateSyncPayload = {
        memoId: currentMemo.id,
        expectedRevision: currentMemo.revision,
        expectedContentHash: currentMemo.contentHash,
        editSessionId: editSession.id,
        title,
        contentJson,
        contentMarkdown: useMarkdownSourceEditor ? markdownSource : undefined,
        tags: parseTagsText(tagsText),
      };
      const { memo: localMemo } = await repository.updateMemo(currentMemo, payload);
      return { memo: localMemo, snapshot, queued: true };
    },
    onMutate: () => setSaveState("saving"),
    onSuccess: async ({ memo: savedMemo, snapshot, queued }) => {
      memoRef.current = savedMemo;
      const currentEditSession = editSessionRef.current;
      if (currentEditSession) {
        editSessionRef.current = {
          ...currentEditSession,
          baseRevision: savedMemo.revision,
          baseContentHash: savedMemo.contentHash,
        };
      }

      if (useMobilePlainTextEditor && isEditorReady(editorRef.current)) {
        hydratingRef.current = true;
        try {
          editorRef.current.commands.setContent(savedMemo.contentJson);
        } catch (err) {
          console.error("Failed to update mobile editor contentJson, falling back to markdownToDoc:", err);
          editorRef.current.commands.setContent(markdownToDoc(savedMemo.contentMarkdown ?? ""));
        }
        window.setTimeout(() => {
          hydratingRef.current = false;
        }, 0);
      }

      await onSaved(savedMemo);

      if (currentSnapshot() === snapshot) {
        setMobilePlainText(docToMarkdown(savedMemo.contentJson));
        setHasUnsavedChanges(false);
        await localDb.drafts.delete(savedMemo.id);
        setSaveConflictInfo(null);
        setSaveState(queued ? "queued" : "saved");
        if (!queued) {
          window.setTimeout(() => setSaveState("idle"), 1400);
        }
        return;
      }

      persistCurrentDraft();
      setHasUnsavedChanges(true);
      setSaveConflictInfo(null);
      setSaveState("idle");
    },
    onError: async (error) => {
      const sourceError = error instanceof MemoSaveRequestError ? error.originalError : error;
      const conflictInfo = getMemoSaveConflictInfo(sourceError);

      if (conflictInfo) {
        setSaveConflictInfo(conflictInfo);
        setSaveState("conflict");
        return;
      }

      if (error instanceof MemoSaveRequestError && shouldQueueMemoSaveError(sourceError)) {
        await queueMemoUpdate(error.payload);
        await localDb.drafts.put({
          memoId: error.payload.memoId,
          title: error.payload.title,
          tagsText: error.tagsText,
          contentJson: error.payload.contentJson,
          updatedAt: new Date().toISOString(),
        });

        setHasUnsavedChanges(false);
        setSaveConflictInfo(null);
        setSaveState("queued");
        return;
      }

      setSaveConflictInfo(null);
      setSaveState("error");
    },
  });

  const pluginEditorMemoId = memo?.id ?? null;
  useEffect(() => {
    if (!editor || !pluginEditorMemoId || effectiveReadOnly || hydratedEditorMemoId !== pluginEditorMemoId) {
      return;
    }

    const adapter: PluginEditorAdapter = {
      getSelection: () => {
        const { selection, doc } = editor.state;
        const context = getRichTextAiSelectionContext(doc, selection);
        return {
          noteId: pluginEditorMemoId,
          from: selection.from,
          to: selection.to,
          empty: selection.empty,
          text: doc.textBetween(selection.from, selection.to, "\n"),
          contentMarkdown: context?.contentMarkdown ?? "",
        };
      },
      replaceSelection: (contentMarkdown) => {
        const { selection, doc } = editor.state;
        const context = getRichTextAiSelectionContext(doc, selection);
        const content = getRichTextAiSelectionReplacement(contentMarkdown, context?.isInline ?? true);
        editor.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, content).run();
      },
      insertAtCursor: (contentMarkdown) => {
        const content = getRichTextAiSelectionReplacement(contentMarkdown, true);
        editor.chain().focus().insertContent(content).run();
      },
    };
    return pluginHost.setEditorAdapter(adapter);
  }, [editor, effectiveReadOnly, hydratedEditorMemoId, pluginEditorMemoId, pluginHost]);
  // useMutation returns a new result object on every render. Depending on the
  // whole object makes autosave timers restart during unrelated renders and
  // can starve a recovered draft indefinitely. These members are stable (or
  // primitive) and are safe effect dependencies.
  const mutateSave = saveMutation.mutate;
  const saveMutationPending = saveMutation.isPending;

  const replaceAttachmentLabel = useCallback((target: AttachmentMenuTarget, filename: string) => {
    const activeEditor = editorRef.current;
    if (!isEditorReady(activeEditor)) return;
    const range = findAttachmentLinkRange(activeEditor, target.url);
    if (!range) return;
    activeEditor.view.dispatch(
      activeEditor.state.tr.replaceWith(
        range.from,
        range.to,
        activeEditor.schema.text(t("editor.attachmentLabel", { filename }), [...range.marks])
      )
    );
  }, [t]);

  const removeAttachmentLink = useCallback((target: AttachmentMenuTarget) => {
    const activeEditor = editorRef.current;
    if (!isEditorReady(activeEditor)) return;
    const range = findAttachmentLinkRange(activeEditor, target.url);
    if (!range) return;

    const resolved = activeEditor.state.doc.resolve(range.from);
    let deleteFrom = range.from;
    let deleteTo = range.to;
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const node = resolved.node(depth);
      if (node.type.name !== "paragraph") continue;
      const nodeFrom = resolved.before(depth);
      if (range.from === nodeFrom + 1 && range.to === nodeFrom + node.nodeSize - 1) {
        deleteFrom = nodeFrom;
        deleteTo = nodeFrom + node.nodeSize;
      }
      break;
    }

    activeEditor.view.dispatch(activeEditor.state.tr.delete(deleteFrom, deleteTo));
  }, []);

  const getResourceActionFailure = useCallback((target: ResourceMenuTarget) =>
    target.kind === "image" ? t("editor.imageActions.failed") : t("editor.attachmentActions.failed"), [t]);

  const fetchResourceBlob = useCallback(async (target: ResourceMenuTarget) => {
    try {
      return await api.getResourceBlob(target.url);
    } catch (error) {
      if (target.resourceId) throw error;
      const response = await fetch(target.url);
      if (!response.ok) throw new Error(response.statusText || getResourceActionFailure(target));
      return response.blob();
    }
  }, [getResourceActionFailure]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }, []);

  const handleResourceDownload = useCallback(async (target: ResourceMenuTarget) => {
    hideResourceMenu();
    clearResourceActionError();
    try {
      downloadBlob(await fetchResourceBlob(target), target.filename);
    } catch (error) {
      failResourceAction(error instanceof Error ? error.message : getResourceActionFailure(target));
    }
  }, [clearResourceActionError, downloadBlob, failResourceAction, fetchResourceBlob, getResourceActionFailure, hideResourceMenu]);

  const handleResourceSaveAs = useCallback(async (target: ResourceMenuTarget) => {
    hideResourceMenu();
    clearResourceActionError();
    try {
      const savePicker = (window as Window & {
        showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
          createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
        }>;
      }).showSaveFilePicker;

      if (!savePicker) {
        downloadBlob(await fetchResourceBlob(target), target.filename);
        return;
      }

      const handle = await savePicker.call(window, { suggestedName: target.filename });
      const blob = await fetchResourceBlob(target);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      failResourceAction(error instanceof Error ? error.message : getResourceActionFailure(target));
    }
  }, [clearResourceActionError, downloadBlob, failResourceAction, fetchResourceBlob, getResourceActionFailure, hideResourceMenu]);

  const openResourceDialog = useCallback((action: ResourceDialogState["action"], target: ResourceMenuTarget) => {
    openResourceActionDialog(action, target);
  }, [openResourceActionDialog]);

  const handleResourceRename = useCallback(async () => {
    const target = resourceDialog?.action === "rename" ? resourceDialog.target : null;
    const filename = resourceFilename.trim();
    if (!target?.resourceId || !filename || resourceActionPending) return;

    startResourceAction();
    try {
      const result = await repository.renameResource(target.resourceId, filename);
      const nextFilename = result.resource.filename || filename;
      if (target.kind === "image") {
        target.updateAttributes({ alt: nextFilename, title: nextFilename });
      } else {
        replaceAttachmentLabel(target, nextFilename);
      }
      await queryClient.invalidateQueries({ queryKey: ["resources"] });
      completeResourceAction();
    } catch (error) {
      failResourceAction(error instanceof Error ? error.message : getResourceActionFailure(target));
    }
  }, [completeResourceAction, failResourceAction, getResourceActionFailure, queryClient, replaceAttachmentLabel, repository, resourceActionPending, resourceDialog, resourceFilename, startResourceAction]);

  const handleResourceDelete = useCallback(async () => {
    const target = resourceDialog?.action === "delete" ? resourceDialog.target : null;
    if (!target || resourceActionPending) return;

    startResourceAction();
    try {
      if (target.kind === "image" && target.url.startsWith("edgeever-staged://") && window.edgeeverDesktop) {
        const stagedUrl = new URL(target.url);
        const stagedId = decodeURIComponent(stagedUrl.hostname || stagedUrl.pathname.replace(/^\//, ""));
        if (stagedId) await window.edgeeverDesktop.removeStagedResource(stagedId);
      } else if (target.resourceId && !target.resourceId.startsWith("local_resource_")) {
        await repository.deleteResource(target.resourceId);
        await queryClient.invalidateQueries({ queryKey: ["resources"] });
      }
      if (target.kind === "image") {
        target.deleteNode();
      } else {
        removeAttachmentLink(target);
      }
      completeResourceAction();
    } catch (error) {
      failResourceAction(error instanceof Error ? error.message : getResourceActionFailure(target));
    }
  }, [completeResourceAction, failResourceAction, getResourceActionFailure, queryClient, removeAttachmentLink, repository, resourceActionPending, resourceDialog, startResourceAction]);

  const clearMobileEditorTimers = useCallback(() => {
    if (mobileDraftTimerRef.current !== null) {
      window.clearTimeout(mobileDraftTimerRef.current);
      mobileDraftTimerRef.current = null;
    }

    if (mobileSaveTimerRef.current !== null) {
      window.clearTimeout(mobileSaveTimerRef.current);
      mobileSaveTimerRef.current = null;
    }
  }, []);

  const markMobilePlainTextDirty = useCallback(() => {
    const currentMemo = memoRef.current;
    if (hydratingRef.current || currentMemo?.isDeleted) {
      return;
    }

    if (!hasUnsavedChangesRef.current) {
      setHasUnsavedChanges(true);
      setSaveState((current) => (current === "conflict" ? current : "idle"));
    } else if (saveState === "saved") {
      setSaveState("idle");
    }

    if (mobileDraftTimerRef.current !== null) {
      window.clearTimeout(mobileDraftTimerRef.current);
    }
    mobileDraftTimerRef.current = window.setTimeout(() => {
      mobileDraftTimerRef.current = null;
      persistCurrentDraft(title, tagsText, getMobilePlainTextValue());
    }, MOBILE_DRAFT_PERSIST_DELAY_MS);

    if (mobileSaveTimerRef.current !== null) {
      window.clearTimeout(mobileSaveTimerRef.current);
    }
    mobileSaveTimerRef.current = window.setTimeout(() => {
      mobileSaveTimerRef.current = null;
      if (
        !memoRef.current ||
        memoRef.current.isDeleted ||
        !hasUnsavedChangesRef.current ||
        saveMutationPending ||
        saveState === "conflict"
      ) {
        return;
      }

      mutateSave();
    }, EDITOR_LOCAL_SAVE_DELAY_MS);
  }, [getMobilePlainTextValue, mutateSave, persistCurrentDraft, saveMutationPending, saveState, tagsText, title]);

  useEffect(() => {
    markMobilePlainTextDirtyRef.current = markMobilePlainTextDirty;
  }, [markMobilePlainTextDirty]);

  useEffect(() => {
    if (!useMobilePlainTextEditor) {
      return;
    }

    const plainTextElement = mobileTextAreaRef.current;
    if (!plainTextElement) {
      return;
    }

    const recordNativeEvent = (event: Event) => {
      mobileImeDebugRecorderRef.current(event.type, event);
    };
    const handleNativeInput = (event: Event) => {
      mobileImeDebugRecorderRef.current(event.type, event);
      markMobilePlainTextDirtyRef.current();
    };

    plainTextElement.addEventListener("focus", recordNativeEvent);
    plainTextElement.addEventListener("blur", recordNativeEvent);
    plainTextElement.addEventListener("click", recordNativeEvent);
    plainTextElement.addEventListener("beforeinput", recordNativeEvent);
    plainTextElement.addEventListener("compositionstart", recordNativeEvent);
    plainTextElement.addEventListener("compositionupdate", recordNativeEvent);
    plainTextElement.addEventListener("compositionend", recordNativeEvent);
    plainTextElement.addEventListener("input", handleNativeInput);
    mobileImeDebugRecorderRef.current("native-listeners-ready");

    return () => {
      plainTextElement.removeEventListener("focus", recordNativeEvent);
      plainTextElement.removeEventListener("blur", recordNativeEvent);
      plainTextElement.removeEventListener("click", recordNativeEvent);
      plainTextElement.removeEventListener("beforeinput", recordNativeEvent);
      plainTextElement.removeEventListener("compositionstart", recordNativeEvent);
      plainTextElement.removeEventListener("compositionupdate", recordNativeEvent);
      plainTextElement.removeEventListener("compositionend", recordNativeEvent);
      plainTextElement.removeEventListener("input", handleNativeInput);
    };
  }, [useMobilePlainTextEditor]);

  useEffect(() => () => clearMobileEditorTimers(), [clearMobileEditorTimers]);

  useEffect(() => {
    if (!useMobilePlainTextEditor) {
      clearMobileEditorTimers();
    }
  }, [clearMobileEditorTimers, useMobilePlainTextEditor]);

  useEffect(() => {
    if (
      !memo ||
      memo.isDeleted ||
      useMobilePlainTextEditor ||
      !editor ||
      !hasUnsavedChanges ||
      saveMutationPending ||
      saveState === "conflict"
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      mutateSave();
    }, EDITOR_LOCAL_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [dirtyVersion, editor, hasUnsavedChanges, memo, mutateSave, saveMutationPending, saveState, useMobilePlainTextEditor]);

  // Must stay above early returns so hook order never changes across loading/empty/editor states.
  const saveConflictReason = useMemo(
    () => (saveState === "conflict" ? formatMemoSaveConflictReason(t, saveConflictInfo) : null),
    [saveConflictInfo, saveState, t],
  );

  useEffect(() => {
    if (saveState !== "conflict") {
      setConflictActionPending(null);
      setConflictActionMessage(null);
    }
  }, [saveState]);

  const getLocalDraftMarkdown = useCallback(() => {
    if (useMobilePlainTextEditor) {
      return getMobilePlainTextValue();
    }
    if (useMarkdownSourceEditor) {
      return markdownSource;
    }
    const contentJson = getCurrentContentJson();
    if (contentJson) {
      return docToMarkdown(contentJson);
    }
    return memo?.contentMarkdown ?? "";
  }, [
    getCurrentContentJson,
    getMobilePlainTextValue,
    markdownSource,
    memo?.contentMarkdown,
    useMarkdownSourceEditor,
    useMobilePlainTextEditor,
  ]);

  const handleCopyLocalDraft = useCallback(async () => {
    if (conflictActionPending) {
      return;
    }

    setConflictActionPending("copy");
    setConflictActionMessage(null);
    try {
      const text = formatLocalDraftClipboardText({
        title,
        tags: parseTagsText(tagsText),
        contentMarkdown: getLocalDraftMarkdown(),
      });
      const copied = await copyTextToClipboard(text);
      if (!copied) {
        setConflictActionMessage(t("editor.saveState.conflictCopyDraftFailed"));
        return;
      }
      setConflictActionMessage(t("editor.saveState.conflictCopyDraftDone"));
      window.setTimeout(() => {
        setConflictActionMessage((current) =>
          current === t("editor.saveState.conflictCopyDraftDone") ? null : current
        );
      }, 2000);
    } catch {
      setConflictActionMessage(t("editor.saveState.conflictCopyDraftFailed"));
    } finally {
      setConflictActionPending(null);
    }
  }, [conflictActionPending, getLocalDraftMarkdown, t, tagsText, title]);

  const handleAdoptCloudAndReload = useCallback(async () => {
    const currentMemo = memoRef.current;
    if (!currentMemo || conflictActionPending === "adopt") {
      return;
    }

    setConflictActionPending("adopt");
    setConflictActionMessage(null);
    try {
      const { memo: remoteMemo } = await repository.adoptCloudMemo(currentMemo.id);
      await onSaved(remoteMemo);

      setHasUnsavedChanges(false);
      setSaveConflictInfo(null);
      setSaveState("idle");
      setConflictActionMessage(null);

      const nextTitle = getEditableMemoTitle(remoteMemo.title);
      const nextTagsText = remoteMemo.tags.join(", ");
      const nextContent = resolveMemoContentDoc(remoteMemo.contentJson, remoteMemo.contentMarkdown);
      const nextMarkdown = remoteMemo.contentMarkdown || docToMarkdown(nextContent);

      memoRef.current = remoteMemo;
      editSessionRef.current = null;
      hydratedMemoIdRef.current = remoteMemo.id;
      setHydratedEditorMemoId(remoteMemo.id);
      editingMemoIdRef.current = remoteMemo.id;
      appliedEditorSourceKeyRef.current = `memo:${remoteMemo.id}:${remoteMemo.revision}:${remoteMemo.updatedAt}:${remoteMemo.contentHash}:${nextTitle}:${nextTagsText}:${nextMarkdown}`;

      setTitle(nextTitle);
      setTagsText(nextTagsText);
      setMobilePlainText(nextMarkdown);
      setMarkdownSource(nextMarkdown);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, nextMarkdown);

      const currentEditor = editorRef.current;
      if (isEditorReady(currentEditor)) {
        hydratingRef.current = true;
        try {
          currentEditor.commands.setContent(nextContent);
        } catch (err) {
          console.error("Failed to apply cloud memo after conflict resolve:", err);
          currentEditor.commands.setContent(markdownToDoc(nextMarkdown));
        }
        window.setTimeout(() => {
          hydratingRef.current = false;
        }, 0);
      }

      if (requiresLocalEditSession(remoteMemo)) {
        editSessionRef.current = createLocalEditSession(remoteMemo);
      } else {
        void api.createMemoEditSession(remoteMemo.id).then((response) => {
          if (editingMemoIdRef.current !== remoteMemo.id) return;
          editSessionRef.current = response.editSession;
        }).catch(() => {
          if (editingMemoIdRef.current !== remoteMemo.id) return;
          editSessionRef.current = createLocalEditSession(remoteMemo);
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["memo", remoteMemo.id] });
    } catch {
      setConflictActionMessage(t("editor.saveState.conflictAdoptFailed"));
    } finally {
      setConflictActionPending(null);
    }
  }, [conflictActionPending, onSaved, queryClient, repository, t]);

  if (isSelectionMode) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-white">
        {selectionActionBar}
      </div>
    );
  }

  if (isLoading && !memo) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-white">
        <EmptyEditorHeader pluginHost={pluginHost} onOpenPluginManager={onOpenPluginManager} />
        {selectionActionBar}
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">{t("editor.loading")}</div>
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-white">
        <EmptyEditorHeader pluginHost={pluginHost} onOpenPluginManager={onOpenPluginManager} />
        {selectionActionBar}
        <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
          <div>
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-300 animate-pulse" />
            <div className="text-sm font-medium text-slate-400">{t("editor.emptySelection")}</div>
          </div>
        </div>
      </div>
    );
  }

  const saveLabel =
    saveState === "saving"
      ? t("editor.saveState.saving")
      : saveState === "saved"
        ? t("editor.saveState.saved")
        : saveState === "queued"
          ? t("editor.saveState.queued")
          : saveState === "conflict"
            ? t("editor.saveState.conflict")
            : saveState === "error"
              ? t("editor.saveState.error")
              : hasUnsavedChanges
                ? t("editor.saveState.unsaved")
                : t("editor.saveState.saved");

  const saveStateClassName =
    saveState === "error" || saveState === "conflict"
      ? "bg-rose-50 text-rose-700"
      : saveState === "queued"
        ? "bg-slate-50 text-slate-400"
        : saveState === "saving" || hasUnsavedChanges
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-500";

  const imageUploadLabel =
    imageUploadState === "error"
      ? t("editor.uploadState.failed")
      : imageUploadState === "compressing"
        ? t("editor.uploadState.compressing")
        : imageUploadState === "uploading"
          ? t("editor.uploadState.uploading")
          : null;

  const mobileStatusLabel = imageUploadLabel ?? saveLabel;
  const mobileStatusClassName =
    imageUploadState === "error"
      ? "bg-rose-50 text-rose-700"
      : imageUploadState !== "idle"
        ? "bg-emerald-50 text-emerald-700"
        : saveStateClassName;

  const updatedLabel = formatDateTime(memo.updatedAt);
  const currentNotebookLabel = notebookOptions.find((notebook) => notebook.id === memo.notebookId)?.name ?? t("editor.notebookFallback");
  const currentMarkdownForAi = getCurrentMarkdownForAi();

  const mobileDoneDisabled =
    saveMutation.isPending ||
    notebookUpdatePending ||
    imageUploadState === "compressing" ||
    imageUploadState === "uploading";
  const noteSearchMatchLabel = formatNoteSearchMatchLabel(
    noteSearchQuery,
    noteSearchIndex,
    noteSearchMatches.length,
  );
  const mobileImeDebugEditorFocused =
    typeof document !== "undefined" && mobileTextAreaRef.current === document.activeElement;
  const mobileImeDebugLogText = [
    `memoId=${memo.id}`,
    `mobile=${isMobileViewport}`,
    `editingState=${isMobileEditing}`,
    `editingActive=${mobileEditingActive}`,
    `plainTextEditor=${useMobilePlainTextEditor}`,
    `editorFocused=${mobileImeDebugEditorFocused}`,
    `activeElement=${mobileImeDebugActiveElement}`,
    `valueLength=${getMobilePlainTextValue().length}`,
    `saveState=${saveState}`,
    ...mobileImeDebugEvents.map((entry) =>
      `${entry.time} ${entry.event} active=${entry.activeElement} len=${entry.valueLength}` +
      `${entry.inputType ? ` inputType=${entry.inputType}` : ""}` +
      `${entry.isComposing !== undefined ? ` composing=${entry.isComposing}` : ""}` +
      `${entry.key ? ` key=${entry.key}` : ""}`
    ),
  ].join("\n");

  const appendMobilePlainText = (nextText: string, eventName: string) => {
    const currentText = getMobilePlainTextValue();
    const nextValue = `${currentText}${currentText ? "\n" : ""}${nextText}`;
    setMobilePlainText(nextValue);
    setMobilePlainTextElementValue(mobileTextAreaRef.current, nextValue);
    markMobilePlainTextDirty();
    recordMobileImeDebugEvent(eventName);
    window.requestAnimationFrame(() => focusMobileInputTarget());
  };

  const handleMobilePromptInput = () => {
    const nextText = window.prompt(t("editor.typeInput"));
    if (!nextText) {
      focusMobileInputTarget();
      return;
    }

    appendMobilePlainText(nextText, "prompt-input");
  };

  const handleMobileClipboardInput = async () => {
    try {
      const nextText = await navigator.clipboard?.readText();
      if (!nextText?.trim()) {
        recordMobileImeDebugEvent("clipboard-empty");
        focusMobileInputTarget();
        return;
      }

      appendMobilePlainText(nextText, "clipboard-input");
    } catch {
      recordMobileImeDebugEvent("clipboard-error");
      window.alert(t("editor.clipboardReadFailed"));
      focusMobileInputTarget();
    }
  };

  const updateMemoNotebook = (notebookId: string, sourceMemo: MemoDetail = memoRef.current ?? memo) => {
    if (effectiveReadOnly || notebookId === sourceMemo.notebookId || notebookUpdatePending) {
      setMobileNotebookSheetOpen(false);
      return;
    }

    setNotebookUpdatePending(true);
    setSaveState("saving");

    void api
      .updateMemo(sourceMemo.id, {
        expectedRevision: sourceMemo.revision,
        notebookId,
      })
      .then(async (data) => {
        memoRef.current = data.memo;
        await onSaved(data.memo);
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1200);
      })
      .catch(() => setSaveState("error"))
      .finally(() => {
        setNotebookUpdatePending(false);
        setMobileNotebookSheetOpen(false);
      });
  };

  const handleNotebookChange = (notebookId: string) => {
    if (!hasUnsavedChanges || saveMutation.isPending) {
      updateMemoNotebook(notebookId);
      return;
    }

    saveMutation.mutate(undefined, {
      onSuccess: ({ memo: savedMemo }) => updateMemoNotebook(notebookId, savedMemo),
    });
  };

  const handleMobileBack = () => {
    if (readOnly || !editor || !hasUnsavedChanges) {
      onMobileDefaultEditConsumed();
      onBackToList();
      return;
    }

    saveMutation.mutate(undefined, {
      onSuccess: () => {
        onMobileDefaultEditConsumed();
        onBackToList();
      },
      onError: (error) => {
        const sourceError = error instanceof MemoSaveRequestError ? error.originalError : error;
        if (error instanceof MemoSaveRequestError && shouldQueueMemoSaveError(sourceError)) {
          onMobileDefaultEditConsumed();
          onBackToList();
        }
      },
    });
  };

  const handleMobileDone = () => {
    if (readOnly || !editor || !hasUnsavedChanges) {
      onMobileDefaultEditConsumed();
      setIsMobileEditing(false);
      setMobileToolbarOpen(false);
      return;
    }

    saveMutation.mutate(undefined, {
      onSuccess: () => {
        onMobileDefaultEditConsumed();
        setIsMobileEditing(false);
        setMobileToolbarOpen(false);
      },
      onError: (error) => {
        const sourceError = error instanceof MemoSaveRequestError ? error.originalError : error;
        if (error instanceof MemoSaveRequestError && shouldQueueMemoSaveError(sourceError)) {
          onMobileDefaultEditConsumed();
          setIsMobileEditing(false);
          setMobileToolbarOpen(false);
        }
      },
    });
  };

  const resourceMenuLabels = {
    download: t("editor.resourceActions.download"),
    saveAs: t("editor.resourceActions.saveAs"),
    rename: t("editor.resourceActions.rename"),
    delete: t("editor.resourceActions.delete"),
    unavailable: t("editor.resourceActions.unavailable"),
  };
  const resourceDialogLabels = resourceDialog?.target.kind === "image"
    ? {
        renameTitle: t("editor.imageActions.renameTitle"),
        renameDescription: t("editor.imageActions.renameDescription"),
        filenameLabel: t("editor.imageActions.filenameLabel"),
        deleteTitle: t("editor.imageActions.deleteTitle"),
        deleteDescription: t("editor.imageActions.deleteDescription"),
      }
    : {
        renameTitle: t("editor.attachmentActions.renameTitle"),
        renameDescription: t("editor.attachmentActions.renameDescription"),
        filenameLabel: t("editor.attachmentActions.filenameLabel"),
        deleteTitle: t("editor.attachmentActions.deleteTitle"),
        deleteDescription: t("editor.attachmentActions.deleteDescription"),
      };

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-white">
      {selectionActionBar}
      <ExternalLinkDialog
        open={externalLinkDialogOpen}
        onOpenChange={setExternalLinkDialogOpen}
        initialHref={externalLinkDraft.href}
        initialText={externalLinkDraft.text}
        showTextField={externalLinkDraft.showTextField}
        canRemove={externalLinkDraft.canRemove}
        onApply={applyExternalLink}
        onRemove={removeExternalLink}
      />
      {noteLinkPickerOpen && (
        <div className="absolute left-3 right-3 top-14 z-30 h-[min(22rem,calc(100%-4rem))] max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl sm:left-5 sm:right-auto sm:w-[28rem]" role="dialog" aria-label={t("noteLinkPicker.title")}>
          <Command shouldFilter={false}>
            <div className="flex items-center justify-between border-b border-slate-100 pr-2">
              <CommandInput
                autoFocus
                value={noteLinkQuery}
                placeholder={t("noteLinkPicker.searchPlaceholder")}
                onValueChange={setNoteLinkQuery}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setNoteLinkPickerOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={t("noteLinkPicker.close")}
                onClick={() => setNoteLinkPickerOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <CommandList>
              {noteLinkResultsQuery.isLoading ? (
                <div className="p-6 text-center text-sm text-slate-500">{t("noteLinkPicker.loading")}</div>
              ) : (
                <>
                  <CommandEmpty>{t("noteLinkPicker.empty")}</CommandEmpty>
                  <CommandGroup>
                    {(noteLinkResultsQuery.data?.memos ?? [])
                      .filter((candidate) => candidate.id !== memo?.id && !candidate.isDeleted)
                      .map((candidate) => (
                        <CommandItem key={candidate.id} value={candidate.id} onSelect={() => insertMemoLink(candidate)}>
                          <Link2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span className="min-w-0 flex-1 truncate">{candidate.title || t("common.untitledMemo")}</span>
                          <span className="max-w-40 truncate text-xs text-slate-400">{candidate.excerpt}</span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </div>
      )}
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Button
              className="lg:hidden"
              size="icon"
              variant="ghost"
              title={hasUnsavedChanges && !readOnly ? t("editor.saveAndBack") : t("editor.backToList")}
              aria-label={hasUnsavedChanges && !readOnly ? t("editor.saveAndBack") : t("editor.backToList")}
              disabled={mobileDoneDisabled}
              onClick={handleMobileBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="hidden items-center gap-1 sm:flex lg:hidden">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30"
                type="button"
                title={t("editor.previousMemo")}
                aria-label={t("editor.previousMemo")}
                disabled={!hasPreviousMemo}
                onClick={onOpenPreviousMemo}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30"
                type="button"
                title={t("editor.nextMemo")}
                aria-label={t("editor.nextMemo")}
                disabled={!hasNextMemo}
                onClick={onOpenNextMemo}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="hidden items-center gap-1 lg:flex">
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant={desktopFocusMode ? "soft" : "ghost"}
                      aria-label={t(desktopFocusMode ? "editor.exitFocusMode" : "editor.enterFocusMode")}
                      aria-pressed={desktopFocusMode}
                      onClick={onToggleDesktopFocusMode}
                    >
                      {desktopFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t(desktopFocusMode ? "editor.exitFocusMode" : "editor.focusMode")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <IconTooltip label={t("editor.previousMemo")}>
                <Button size="icon" variant="ghost" aria-label={t("editor.previousMemo")} onClick={onOpenPreviousMemo} disabled={!hasPreviousMemo}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </IconTooltip>
              <IconTooltip label={t("editor.nextMemo")}>
                <Button size="icon" variant="ghost" aria-label={t("editor.nextMemo")} onClick={onOpenNextMemo} disabled={!hasNextMemo}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </IconTooltip>
            </div>
            <span className="hidden truncate text-xs text-slate-400 sm:inline">
              {t("editor.updatedAt", { time: updatedLabel })}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isMemoShared && (
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                type="button"
                title={t("sharing.manage")}
                aria-label={t("sharing.manage")}
                onClick={() => setShareOpen(true)}
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t("sharing.active")}</span>
              </button>
            )}
            <span
              className="hidden whitespace-nowrap px-1.5 text-xs tabular-nums text-slate-400 sm:inline-flex"
              title={t("editor.characterCount", { count: characterCount })}
            >
              {t("editor.characterCount", { count: characterCount })}
            </span>
            {imageUploadState !== "idle" && (
              <span
                className={cn(
                  "hidden rounded-md px-2 py-1 text-xs font-medium md:inline-flex",
                  imageUploadState === "error"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-emerald-50 text-emerald-700"
                )}
              >
                {imageUploadState === "error"
                  ? t("editor.uploadState.fileFailed")
                  : imageUploadState === "compressing"
                    ? t("editor.uploadState.imageCompressing")
                    : t("editor.uploadState.fileUploading")}
              </span>
            )}
            <m.span
              key={`${saveState}-${String(hasUnsavedChanges)}`}
              className={cn("hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium sm:inline-flex", saveStateClassName)}
              role="status"
              aria-live="polite"
              title={saveConflictReason ?? undefined}
              aria-label={saveState === "conflict" && saveConflictReason ? `${saveLabel}. ${saveConflictReason}` : undefined}
              {...statusSettleMotion}
            >
              {saveState === "saving" ? (
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : saveState === "error" || saveState === "conflict" || saveState === "queued" ? (
                <CircleAlert className="h-3 w-3" aria-hidden="true" />
              ) : hasUnsavedChanges ? (
                <Pencil className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Check className="h-3 w-3" aria-hidden="true" />
              )}
              {saveLabel}
            </m.span>
            <m.span
              key={`${imageUploadState}-${saveState}-${String(hasUnsavedChanges)}`}
              className={cn("inline-flex max-w-[5.5rem] truncate rounded-full px-2 py-1 text-[11px] font-medium sm:hidden", mobileStatusClassName)}
              role="status"
              aria-live="polite"
              title={saveConflictReason ?? undefined}
              aria-label={saveState === "conflict" && saveConflictReason ? `${saveLabel}. ${saveConflictReason}` : undefined}
              {...statusSettleMotion}
            >
              {mobileStatusLabel}
            </m.span>
            {mobileEditingActive && !readOnly && (
              <button
                className="inline-flex h-8 items-center justify-center rounded-full bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 sm:hidden"
                type="button"
                disabled={mobileDoneDisabled}
                onClick={handleMobileDone}
              >
                {saveMutation.isPending ? t("editor.saveState.saving") : t("editor.done")}
              </button>
            )}
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                insertResourceFiles(files);
              }}
            />
            {mobileEditingActive && !readOnly && !useMobilePlainTextEditor && (
              <Button
                className="sm:hidden"
                size="icon"
                variant="ghost"
                title={t("editor.uploadAttachment")}
                aria-label={t("editor.uploadAttachment")}
                disabled={mobileDoneDisabled || effectiveReadOnly}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            )}
            {mobileEditingActive && !readOnly && (
              <Button
                className="sm:hidden"
                size="icon"
                variant={mobileToolbarOpen ? "soft" : "ghost"}
                title={mobileToolbarOpen ? t("editor.collapseFormat") : t("editor.format")}
                aria-label={mobileToolbarOpen ? t("editor.collapseFormat") : t("editor.format")}
                aria-pressed={mobileToolbarOpen}
                disabled={effectiveReadOnly}
                onClick={() => setMobileToolbarOpen((open) => !open)}
              >
                <Type className="h-4 w-4" />
              </Button>
            )}
            <IconTooltip label={t("editor.searchCurrentMemo")}>
              <Button className="hidden h-8 w-8 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-slate-300 sm:inline-flex" size="icon" variant="ghost" aria-label={t("editor.searchCurrentMemo")} onClick={() => openNoteSearch()}>
                <Search className="h-5 w-5" strokeWidth={2.25} />
              </Button>
            </IconTooltip>
            {!readOnly && (
              <IconTooltip label={t("aiAssistant.open")}>
                <Button className="hidden h-8 w-8 text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-300 sm:inline-flex" size="icon" variant="ghost" aria-label={t("aiAssistant.open")} onClick={openAiAssistant}>
                  <Sparkles className="h-5 w-5" strokeWidth={2.25} />
                </Button>
              </IconTooltip>
            )}
            <TooltipProvider delayDuration={0} skipDelayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className={cn(
                      "hidden h-8 w-8 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-slate-300 min-[1600px]:inline-flex",
                      wechatCopyState === "copying" && "bg-slate-100 text-slate-700",
                      wechatCopyState === "copied" && "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100",
                      wechatCopyState === "error" && "bg-rose-100 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                    )}
                    size="icon"
                    variant="ghost"
                    aria-label={t("editor.copyToWeChat")}
                    onClick={() => void handleCopyToWeChat()}
                    disabled={!editor || effectiveReadOnly || useMobilePlainTextEditor || wechatCopyState === "copying"}
                  >
                    {wechatCopyState === "copying" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : wechatCopyState === "copied" ? (
                      <Check className="h-5 w-5" strokeWidth={2.75} />
                    ) : wechatCopyState === "error" ? (
                      <CircleAlert className="h-5 w-5" strokeWidth={2.25} />
                    ) : (
                      <WeChatIcon className="h-5 w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t(wechatCopyState === "copying" ? "editor.copyingToWeChat" : wechatCopyState === "copied" ? "editor.copiedToWeChat" : wechatCopyState === "error" ? "editor.copyToWeChatFailed" : "editor.copyToWeChat")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <IconTooltip label={t("editor.versionHistory")}>
              <Button className="hidden h-8 w-8 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-slate-300 min-[1600px]:inline-flex" size="icon" variant="ghost" aria-label={t("editor.versionHistory")} onClick={() => setHistoryOpen(true)}>
                <History className="h-5 w-5" strokeWidth={2.25} />
              </Button>
            </IconTooltip>
            <GitHubRepositoryLink className="hidden h-8 w-8 justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 min-[1600px]:inline-flex" iconClassName="h-5 w-5" />
            <IconTooltip label={t("systemInfo.title")}>
              <Button className="relative hidden h-8 w-8 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-500/70 min-[1600px]:inline-flex" size="icon" variant="ghost" aria-label={t("systemInfo.title")} onClick={() => setSystemInfoOpen(true)}>
                <Info className="h-5 w-5" strokeWidth={2.25} />
                {updateAvailable ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-white" /> : null}
              </Button>
            </IconTooltip>
            <PluginToolbarMenu host={pluginHost} onManage={onOpenPluginManager} />
            <ThemeToggle />
            {!readOnly && (
              <IconTooltip label={t("editor.save")}>
                <Button
                  className="hidden sm:inline-flex"
                  size="icon"
                  variant="solid"
                  aria-label={t("editor.save")}
                  onClick={() => saveMutation.mutate()}
                  disabled={!editor || saveMutation.isPending || !hasUnsavedChanges}
                >
                  <Save className="h-4 w-4" />
                </Button>
              </IconTooltip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className={cn(!mobileEditingActive && !readOnly && "hidden sm:inline-flex")}
                  size="icon"
                  variant="ghost"
                  title={t("editor.more")}
                  aria-label={t("editor.moreAria")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 bg-white border border-slate-200 rounded-md py-1 shadow-md">
                {!readOnly && (
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-emerald-700 hover:bg-emerald-50 cursor-pointer outline-none"
                    onClick={openAiAssistant}
                  >
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                    {t("aiAssistant.title")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={() => openNoteSearch()}
                >
                  <Search className="h-4 w-4 text-slate-500" />
                  {t("editor.searchCurrentMemo")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  disabled={isLocalMemoId(memo.id)}
                  onClick={() => void handleCopyMemoId()}
                >
                  <Copy className="h-4 w-4 text-slate-500" />
                  {t(isLocalMemoId(memo.id) ? "editor.copyNoteIdAfterSync" : "editor.copyNoteId")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={openNoteReplace}
                >
                  <ReplaceAll className="h-4 w-4 text-slate-500" />
                  {t("editor.replaceCurrentMemo")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={() => {
                    setHistoryOpen(true);
                  }}
                >
                  <History className="h-4 w-4 text-slate-500" />
                  {t("editor.versionHistory")}
                </DropdownMenuItem>
                {!readOnly && (
                  <DropdownMenuItem
                    className={cn(
                      "flex h-9 w-full items-center gap-2 px-3 text-left text-sm hover:bg-slate-50 cursor-pointer outline-none",
                      isMemoShared ? "bg-emerald-50 text-emerald-800" : "text-slate-700",
                    )}
                    disabled={isLocalMemoId(memo.id)}
                    onClick={() => setShareOpen(true)}
                  >
                    <Link2 className={cn("h-4 w-4", isMemoShared ? "text-emerald-600" : "text-slate-500")} />
                    {t(isMemoShared ? "sharing.manage" : "sharing.action")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={handleExportMarkdown}
                >
                  <FileDown className="h-4 w-4 text-slate-500" />
                  {t("editor.exportMarkdown")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={() => void handleExportHtml()}
                >
                  <FileCode2 className="h-4 w-4 text-slate-500" />
                  {t("editor.exportHtml")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={() => handleExportPdf()}
                >
                  <Printer className="h-4 w-4 text-slate-500" />
                  {t("editor.exportPdf")}
                </DropdownMenuItem>
                {readOnly ? (
                  <>
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                      onClick={() => void onRestored(memo.id)}
                    >
                      <RotateCcw className="h-4 w-4 text-slate-500" />
                      {t("editor.restoreMemo")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                      onClick={() => void onPermanentDeleted(memo.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("editor.deleteForever")}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                      onClick={handleSaveAsTemplate}
                    >
                      <Pencil className="h-4 w-4 text-slate-500" />
                      {t("templates.saveAsTemplate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                      onClick={() => void onDeleted(memo.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("editor.deleteMemo")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-3 px-4 pb-4 pt-4 sm:px-7 lg:space-y-0 lg:pb-1 lg:pt-2">
          <input
            value={title}
            readOnly={effectiveReadOnly}
            onChange={(event) => {
              setTitle(event.target.value);
              persistCurrentDraft(event.target.value, tagsText, getMobilePlainTextValue());
              markDirty();
            }}
            className="block w-full rounded-md border-0 bg-transparent text-2xl font-bold leading-tight text-slate-950 outline-none transition placeholder:text-slate-300 focus-visible:bg-muted focus-visible:shadow-[inset_3px_0_0_var(--brand-green)] sm:text-3xl"
            placeholder={t("common.untitledMemo")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="flex h-8 min-w-0 max-w-full items-center gap-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-slate-600 outline-none transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/20 disabled:opacity-50 sm:hidden"
              type="button"
              disabled={effectiveReadOnly || notebookUpdatePending}
              title={t("editor.currentNotebook")}
              aria-label={t("editor.currentNotebookAria", { name: currentNotebookLabel })}
              onClick={() => setMobileNotebookSheetOpen(true)}
            >
              <span className="min-w-0 truncate">{currentNotebookLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
            <div className="hidden min-w-[9rem] max-w-[18rem] sm:block">
              <Select
                value={memo.notebookId}
                disabled={effectiveReadOnly || notebookUpdatePending}
                onValueChange={(value) => handleNotebookChange(value)}
              >
                <SelectTrigger className="h-8 min-w-0 border-transparent bg-transparent px-2 text-sm font-medium text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap">
                  <SelectValue placeholder={t("editor.notebookPlaceholder")}>{currentNotebookLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-60 bg-white border border-slate-200 rounded-md py-1 shadow-md">
                  {notebookOptions.map((notebook) => (
                    <SelectItem key={notebook.id} value={notebook.id}>
                      {notebook.selectLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <EditorTagPicker
              contentMarkdown={currentMarkdownForAi}
              disabled={effectiveReadOnly}
              loadTags={() => repository.listTags()}
              title={title}
              value={tagsText}
              onChange={(nextTagsText) => {
                setTagsText(nextTagsText);
                persistCurrentDraft(title, nextTagsText, getMobilePlainTextValue());
                markDirty();
              }}
            />
          </div>
        </div>
        {noteSearchOpen && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2 sm:px-7">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <Input
              ref={noteSearchInputRef}
              value={noteSearchQuery}
              className="h-8 min-w-[12rem] flex-1"
              placeholder={t("editor.searchPlaceholder")}
              onChange={(event) => setNoteSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  moveNoteSearchMatch(event.shiftKey ? -1 : 1);
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  closeNoteSearch();
                }
              }}
            />
            {noteSearchReplaceOpen && (
              <Input
                ref={noteReplaceInputRef}
                value={noteSearchReplacement}
                className="h-8 min-w-[12rem] flex-1"
                placeholder={t("editor.replacePlaceholder")}
                disabled={effectiveReadOnly}
                onChange={(event) => setNoteSearchReplacement(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    replaceAllNoteSearchMatches();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeNoteSearch();
                  }
                }}
              />
            )}
            <span
              className={cn(
                "w-12 shrink-0 text-center text-xs tabular-nums",
                noteSearchQuery.trim() && noteSearchMatches.length === 0 ? "text-rose-500" : "text-slate-500"
              )}
              aria-live="polite"
            >
              {noteSearchMatchLabel}
            </span>
            <Button
              size="icon"
              variant="ghost"
              title={t("editor.previousSearchResult")}
              aria-label={t("editor.previousSearchResult")}
              disabled={noteSearchMatches.length === 0}
              onClick={() => moveNoteSearchMatch(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title={t("editor.nextSearchResult")}
              aria-label={t("editor.nextSearchResult")}
              disabled={noteSearchMatches.length === 0}
              onClick={() => moveNoteSearchMatch(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {noteSearchReplaceOpen && (
              <Button
                size="sm"
                variant="solid"
                title={t("editor.replaceAll")}
                aria-label={t("editor.replaceAll")}
                disabled={effectiveReadOnly || noteSearchMatches.length === 0}
                onClick={replaceAllNoteSearchMatches}
              >
                <ReplaceAll className="h-4 w-4" />
                {t("editor.replaceAll")}
              </Button>
            )}
            <Button size="icon" variant="ghost" title={t("editor.closeSearch")} aria-label={t("editor.closeSearch")} onClick={closeNoteSearch}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {(!isMobileViewport || (mobileToolbarOpen && !useMobilePlainTextEditor)) && (
          <EditorToolbar
            editor={editor}
            readOnly={effectiveReadOnly}
            markdownMode={useMarkdownSourceEditor}
            onMarkdownModeChange={handleMarkdownModeChange}
            onPickAttachment={() => fileInputRef.current?.click()}
            onPickExternalLink={openExternalLinkDialog}
            externalLinkActive={externalLinkActive}
            onPickNoteLink={() => setNoteLinkPickerOpen(true)}
          />
        )}
        {saveState === "conflict" && saveConflictReason ? (
          <div
            className="flex flex-col gap-2 border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800 sm:px-5"
            role="alert"
          >
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{saveConflictReason}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-5">
              <Button
                size="sm"
                variant="solid"
                className="h-7 bg-rose-700 px-2.5 text-[11px] text-white hover:bg-rose-800"
                disabled={conflictActionPending !== null}
                onClick={() => void handleAdoptCloudAndReload()}
              >
                {conflictActionPending === "adopt"
                  ? t("editor.saveState.conflictAdopting")
                  : t("editor.saveState.conflictAdoptCloud")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-[11px] text-rose-800 hover:bg-rose-100"
                disabled={conflictActionPending !== null}
                onClick={() => void handleCopyLocalDraft()}
              >
                {t("editor.saveState.conflictCopyDraft")}
              </Button>
              {conflictActionMessage ? (
                <span className="text-[11px] font-medium text-rose-700" role="status" aria-live="polite">
                  {conflictActionMessage}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      <div
        ref={setEditorScrollContainerRef}
        data-editor-theme={
          editorTheme === "default" ||
          editorTheme === "minimal-emerald" ||
          editorTheme === "outline-emerald" ||
          editorTheme === "wechat-green" ||
          editorTheme === "modern-mint"
            ? editorTheme
            : "custom"
        }
        style={{
          "--editor-body-font-size": `${MEMO_CONTENT_STYLE.body.fontSize}px`,
          "--editor-body-line-height": String(MEMO_CONTENT_STYLE.body.lineHeight / MEMO_CONTENT_STYLE.body.fontSize),
          "--editor-paragraph-spacing": `${MEMO_CONTENT_STYLE.body.paragraphSpacing}px`,
          "--memo-content-divider-spacing": `${MEMO_CONTENT_STYLE.divider.marginVertical}px`,
          ...(editorTheme !== "default" &&
          editorTheme !== "minimal-emerald" &&
          editorTheme !== "outline-emerald" &&
          editorTheme !== "wechat-green" &&
          editorTheme !== "modern-mint"
            ? {
                "--editor-theme-light-bg": customEditorTheme.light.background,
                "--editor-theme-light-text": customEditorTheme.light.text,
                "--editor-theme-light-muted": customEditorTheme.light.muted,
                "--editor-theme-light-heading": customEditorTheme.light.heading,
                "--editor-theme-light-accent": customEditorTheme.light.accent,
                "--editor-theme-light-soft": customEditorTheme.light.soft,
                "--editor-theme-light-border": customEditorTheme.light.border,
                "--editor-theme-dark-bg": customEditorTheme.dark.background,
                "--editor-theme-dark-text": customEditorTheme.dark.text,
                "--editor-theme-dark-muted": customEditorTheme.dark.muted,
                "--editor-theme-dark-heading": customEditorTheme.dark.heading,
                "--editor-theme-dark-accent": customEditorTheme.dark.accent,
                "--editor-theme-dark-soft": customEditorTheme.dark.soft,
                "--editor-theme-dark-border": customEditorTheme.dark.border,
              }
            : {}),
        } as CSSProperties}
        className={cn(
          "edgeever-editor relative min-h-0 flex-1 bg-white",
          useMobilePlainTextEditor
            ? "overflow-visible"
            : useMarkdownSourceEditor
              // Source mode: fill the pane and scroll inside the textarea (not a 300px card).
              ? "flex flex-col overflow-hidden"
              : "overflow-y-auto"
        )}
      >
        {editorTheme !== "default" &&
          editorTheme !== "minimal-emerald" &&
          editorTheme !== "outline-emerald" &&
          editorTheme !== "wechat-green" &&
          editorTheme !== "modern-mint" &&
          customEditorTheme.customCss && (
            <style
              data-theme-custom-css
              data-original-css={customEditorTheme.customCss}
              dangerouslySetInnerHTML={{ __html: sanitizeAndScopeCss(customEditorTheme.customCss) }}
            />
          )}
        <div
          className={cn(
            "flex gap-8 transition-all duration-200",
            useMarkdownSourceEditor
              ? "h-full min-h-0 flex-1 items-stretch px-0 py-0"
              : "min-h-full items-start px-6 py-6 sm:px-10",
            desktopFocusMode
              ? "mx-auto w-full max-w-[1400px] justify-center"
              : "w-full justify-start"
          )}
        >
          <div
            className={cn(
              "min-w-0 flex-1 transition-[max-width] duration-200",
              useMarkdownSourceEditor && "flex h-full min-h-0 flex-col",
              desktopFocusMode
                ? "max-w-[960px]"
                : "max-w-none"
            )}
            style={
              !desktopFocusMode && !useMarkdownSourceEditor
                ? {
                    maxWidth: editorOutlineCollapsed
                      ? EDITOR_CONTENT_MAX_WIDTH_COLLAPSED
                      : EDITOR_CONTENT_MAX_WIDTH,
                  }
                : undefined
            }
          >
            {useMobilePlainTextEditor ? (
              <>
                <textarea
                  ref={(element) => {
                    mobileTextAreaRef.current = element;
                  }}
                  defaultValue={mobilePlainText}
                  autoCapitalize="sentences"
                  autoComplete="on"
                  autoCorrect="on"
                  enterKeyHint="enter"
                  inputMode="text"
                  name="memo-body"
                  spellCheck
                  data-edgeever-mobile-editor="plain-textarea"
                  aria-label={t("editor.noteBodyAria")}
                  className="block min-h-[60dvh] w-full resize-none border border-slate-200 bg-white px-4 py-3 pr-32 text-base leading-7 text-slate-950 outline-none placeholder:text-slate-400 sm:px-7"
                  placeholder={t("editor.placeholder")}
                  style={{ WebkitUserSelect: "text", userSelect: "text", caretColor: "auto" }}
                />
                <div className="absolute right-3 top-3 flex gap-2">
                  <button
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 shadow-sm"
                    type="button"
                    onClick={() => void handleMobileClipboardInput()}
                  >
                      {t("editor.paste")}
                  </button>
                  <button
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm"
                    type="button"
                    onClick={handleMobilePromptInput}
                  >
                      {t("editor.typeInput")}
                  </button>
                </div>
              </>
            ) : useMarkdownSourceEditor ? (
              // Absolute fill: native <textarea> often ignores flex-1 height; pin to the pane instead.
              <div className="relative min-h-0 flex-1">
                <textarea
                  ref={markdownTextAreaRef}
                  value={markdownSource}
                  onChange={(event) => handleMarkdownSourceChange(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
                      event.preventDefault();
                      openExternalLinkDialog();
                    }
                  }}
                  readOnly={effectiveReadOnly}
                  spellCheck={false}
                  aria-label={t("editor.markdownSourceAria")}
                  className="absolute inset-0 h-full w-full resize-none border-0 bg-slate-950 px-4 py-3 font-mono text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 sm:px-6"
                  placeholder={`# ${t("editor.placeholder")}`}
                />
              </div>
            ) : (
              <div
                onMouseOver={handleEditorMouseOver}
                onMouseOut={handleEditorMouseOut}
                onClickCapture={handleEditorClickCapture}
                onFocusCapture={handleEditorFocusCapture}
                onBlurCapture={handleEditorBlurCapture}
              >
                <BubbleMenu
                  editor={editor}
                  shouldShow={aiBubbleMenu.shouldShow}
                  options={aiBubbleMenu.options}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="solid"
                    className="shadow-lg"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={openAiAssistant}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("aiAssistant.openForSelection")}
                  </Button>
                </BubbleMenu>
                <EditorContent editor={editor} />
              </div>
            )}
          </div>
          {!isMobileViewport && !useMobilePlainTextEditor && !useMarkdownSourceEditor && (
            <EditorOutline
              editor={editor}
              scrollContainer={editorScrollContainer}
              collapsed={editorOutlineCollapsed}
              onCollapsedChange={setEditorOutlineCollapsed}
            />
          )}
        </div>
      </div>

      {noteLinkHintPosition && (
        <NoteLinkInteractionHint
          label={t("noteLinkPicker.openHint", { modifier: noteLinkModifier })}
          position={noteLinkHintPosition}
        />
      )}

      {resourceMenuTarget && (
        <ResourceActionMenu
          target={resourceMenuTarget}
          canRename={Boolean(
            resourceMenuTarget.resourceId &&
            !resourceMenuTarget.resourceId.startsWith("local_resource_") &&
            editor?.isEditable &&
            !effectiveReadOnly
          )}
          canDelete={Boolean(
            editor?.isEditable &&
            !effectiveReadOnly &&
            (resourceMenuTarget.kind === "image" || (
              resourceMenuTarget.resourceId && !resourceMenuTarget.resourceId.startsWith("local_resource_")
            ))
          )}
          labels={resourceMenuLabels}
          onDownload={() => void handleResourceDownload(resourceMenuTarget)}
          onSaveAs={() => void handleResourceSaveAs(resourceMenuTarget)}
          onRename={() => openResourceDialog("rename", resourceMenuTarget)}
          onDelete={() => openResourceDialog("delete", resourceMenuTarget)}
          onMouseEnter={cancelResourceMenuHide}
          onMouseLeave={scheduleResourceMenuHide}
        />
      )}

      <Dialog
        open={resourceDialog?.action === "rename"}
        onOpenChange={(open) => {
          if (!open) closeResourceDialog();
        }}
      >
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void handleResourceRename();
            }}
          >
            <DialogHeader>
              <DialogTitle>{resourceDialogLabels.renameTitle}</DialogTitle>
              <DialogDescription>{resourceDialogLabels.renameDescription}</DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              {resourceDialogLabels.filenameLabel}
              <Input
                autoFocus
                value={resourceFilename}
                maxLength={160}
                disabled={resourceActionPending}
                onChange={(event) => setResourceFilename(event.target.value)}
              />
            </label>
            {resourceActionError && (
              <p className="text-sm text-rose-600" role="alert">{resourceActionError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={resourceActionPending} onClick={closeResourceDialog}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="solid" disabled={resourceActionPending || !resourceFilename.trim()}>
                {resourceActionPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resourceDialog?.action === "delete"}
        onOpenChange={(open) => {
          if (!open) closeResourceDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resourceDialogLabels.deleteTitle}</DialogTitle>
            <DialogDescription>{resourceDialogLabels.deleteDescription}</DialogDescription>
          </DialogHeader>
          <p className="truncate rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            {resourceDialog?.target.filename}
          </p>
          {resourceActionError && (
            <p className="text-sm text-rose-600" role="alert">{resourceActionError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={resourceActionPending} onClick={closeResourceDialog}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="danger" disabled={resourceActionPending} onClick={() => void handleResourceDelete()}>
              {resourceActionPending ? t("common.processing") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {resourceActionError && !resourceDialog && (
        <div className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white shadow-lg" role="alert">
          {resourceActionError}
        </div>
      )}

      {memoIdCopyNotice && (
        <ClipboardCopyNotice status={memoIdCopyNotice.status}>
          {t(memoIdCopyNotice.status === "copied" ? "editor.noteIdCopied" : "editor.noteIdCopyFailed", { id: memoIdCopyNotice.id })}
        </ClipboardCopyNotice>
      )}

      {false && useMobilePlainTextEditor && (
        <div className="fixed left-2 right-2 top-[max(3.5rem,env(safe-area-inset-top))] z-[70] rounded-md border border-amber-200 bg-amber-50/95 p-2 text-[11px] text-slate-800 shadow-lg backdrop-blur sm:hidden">
          <div className="flex items-center justify-between gap-2">
            <button
              className="min-w-0 flex-1 truncate text-left font-semibold"
              type="button"
              onClick={() => setMobileImeDebugOpen((open) => !open)}
            >
              IME 诊断：{mobileImeDebugEditorFocused ? "正文已聚焦" : "正文未聚焦"} · len {getMobilePlainTextValue().length}
            </button>
            <button
              className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-slate-700"
              type="button"
              onClick={() => void handleMobileClipboardInput()}
            >
              粘贴
            </button>
            <button
              className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-slate-700"
              type="button"
              onClick={handleMobilePromptInput}
            >
              输入
            </button>
            <button
              className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-slate-700"
              type="button"
              onClick={() => {
                focusMobileInputTarget();
                recordMobileImeDebugEvent("debug-focus-button");
              }}
            >
              聚焦
            </button>
            <button
              className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-slate-700"
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(mobileImeDebugLogText);
              }}
            >
              复制
            </button>
          </div>
          {mobileImeDebugOpen && (
            <div className="mt-2 max-h-40 overflow-auto rounded border border-amber-200 bg-white/80 p-2 font-mono leading-5">
              <div>active: {mobileImeDebugActiveElement}</div>
              <div>editorFocused: {String(mobileImeDebugEditorFocused)}</div>
              <div>mode: mobile={String(isMobileViewport)} editingState={String(isMobileEditing)} editingActive={String(mobileEditingActive)} plain={String(useMobilePlainTextEditor)}</div>
              <div>save: {saveState} dirty={String(hasUnsavedChanges)}</div>
              <div className="mt-1 border-t border-amber-100 pt-1">
                {mobileImeDebugEvents.length === 0 ? (
                  <div>暂无事件。点正文或按键后这里应该变化。</div>
                ) : (
                  mobileImeDebugEvents.map((entry) => (
                    <div key={entry.id}>
                      {entry.time} {entry.event} len={entry.valueLength}
                      {entry.inputType ? ` type=${entry.inputType}` : ""}
                      {entry.isComposing !== undefined ? ` comp=${entry.isComposing}` : ""}
                      {entry.key ? ` key=${entry.key}` : ""}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {isMobileViewport && !mobileEditingActive && !readOnly && (
        <Button
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 h-12 w-12 rounded-full shadow-lg sm:hidden"
          size="icon"
          variant="solid"
          title={t("editor.editMemo")}
          aria-label={t("editor.editMemo")}
          onClick={() => {
            if (onRequestMobileNativeEdit) {
              onRequestMobileNativeEdit();
              return;
            }
            setIsMobileEditing(true);
            window.requestAnimationFrame(() => focusMobileInputTarget());
          }}
        >
          <Pencil className="h-5 w-5" />
        </Button>
      )}

      {historyOpen && (
        <RevisionHistoryDialog
          currentMarkdown={
            useMobilePlainTextEditor
              ? getMobilePlainTextValue()
              : isEditorReady(editor)
                ? docToMarkdown(editor.getJSON() as TiptapDoc)
                : memo.contentMarkdown
          }
          memo={memo}
          repository={repository}
          onClose={() => setHistoryOpen(false)}
          onRestored={async (restoredMemo) => {
            await localDb.drafts.delete(restoredMemo.id);
            setHasUnsavedChanges(false);
            await onSaved(restoredMemo);
            setHistoryOpen(false);
          }}
        />
      )}

      <SystemInfoDialog open={systemInfoOpen} onOpenChange={setSystemInfoOpen} />

      <AiAssistantDialog
        open={aiAssistantOpen}
        title={title}
        contentMarkdown={currentMarkdownForAi}
        selectionMarkdown={aiSelection?.contentMarkdown}
        onOpenChange={handleAiAssistantOpenChange}
        onApply={applyAiDraft}
        onOpenPromptLibrary={onOpenAiPrompts}
      />

      <ShareMemoDialog memoId={memo.id} open={shareOpen} onOpenChange={setShareOpen} />

      {mobileNotebookSheetOpen && (
        <MobileNotebookSelectSheet
          isUpdating={notebookUpdatePending || saveMutation.isPending}
          options={notebookOptions}
          selectedNotebookId={memo.notebookId}
          onClose={() => setMobileNotebookSheetOpen(false)}
          onSelect={handleNotebookChange}
        />
      )}
    </div>
  );
};
