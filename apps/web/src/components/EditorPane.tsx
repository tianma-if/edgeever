import { useRef, useState, useEffect, useCallback, useMemo, lazy, Suspense, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
  Share2,
  Copy,
  Lock,
  LockOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitHubRepositoryLink } from "@/components/GitHubRepositoryLink";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EditorToolbar } from "./EditorToolbar";
import { EditorOutline } from "./EditorOutline";
import { EditorTagPicker } from "./EditorTagPicker";
import { useAiBubbleMenu } from "./editor/useAiBubbleMenu";
import {
  createEditorInstanceMemoIdentity,
  isEditorInstanceHydratedForMemo,
  reconcileEditorInstanceMemoIdentity,
  remapEditorInstanceMemoIdentity,
} from "./editor/editor-instance-identity";
import {
  createMarkdownModeSnapshot,
  isMarkdownSourceUnchanged,
  resolveMarkdownModeContent,
  type MarkdownModeSnapshot,
} from "./editor/editor-mode-content";
import {
  ImageUploadPlaceholderExtension,
  addImageUploadPlaceholder,
  createImageUploadPlaceholder,
  removeImageUploadPlaceholder,
  waitForImageSourceReady,
  updateImageUploadPlaceholder,
} from "./editor/image-upload-placeholder";
import {
  clampResourceInsertionTarget,
  clearNodeSelectionAtDocumentEnd,
  getResourceInsertionTarget,
  shouldSelectInsertedResources,
} from "@/lib/resource-insertion-target";
import { insertUploadedResources } from "@/lib/resource-insertion";
import {
  createSlashCommandExtension,
  type SlashCommandActions,
  type SlashCommandLabels,
} from "./editor/SlashCommandMenu";
import {
  createNoteLinkSuggestionExtension,
  type NoteLinkSuggestionLabels,
} from "./editor/NoteLinkSuggestion";
import { WeChatIcon } from "./WeChatIcon";
import { ThemeToggle } from "./ThemeToggle";
import { ExecutionCenterButton } from "./execution/ExecutionCenterButton";
import { useEditorTheme, useMarkdownTheme } from "./ThemeProvider";
import type { MarkdownSourceEditorRef } from "./editor/MarkdownSourceEditor";

const MarkdownSourceEditor = lazy(() =>
  import("./editor/MarkdownSourceEditor").then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);
import { sanitizeAndScopeCss } from "@/lib/css-sandbox";
import { RevisionHistoryDialog } from "./dialogs/RevisionHistoryDialog";
import { ExternalLinkDialog } from "./dialogs/ExternalLinkDialog";
import { memoShareQueryKey, ShareMemoDialog } from "./dialogs/ShareMemoDialog";
import { ShareNoteImageDialog, type ShareNoteImageSource } from "./dialogs/ShareNoteImageDialog";
import { AiAssistantDialog, type AiAssistantAnchor } from "./dialogs/AiAssistantDialog";
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
  normalizeImageGalleries,
  PLUGIN_EMBED_NODE_TYPE,
  pluginEmbedToMarkdown,
  isPdfAttachment,
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
import { EdgeEverLink } from "@edgeever/shared/editor-link";
import { createEdgeEverMathematics } from "@edgeever/shared/mathematics";
import { codeBlockLowlight, EdgeEverCodeBlock } from "@/lib/code-block";
import { compressImageForUpload } from "@/lib/image-compression";
import { LOCAL_DATABASE_INTERRUPTED_EVENT, localDb, selectNewestLocalDraft, type MemoUpdateSyncPayload } from "@/lib/local-db";
import { LocalDatabaseUnavailableError } from "@/lib/local-database-recovery";
import { persistEmergencyDraft, readEmergencyDraft, removeEmergencyDraft } from "@/lib/emergency-draft";
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
  formatShortcutBinding,
  getEditableMemoTitle,
  getNotebookMoveOptions,
  readDesktopReadingProtectionPreference,
  readEditorOutlineCollapsedPreference,
  writeDesktopReadingProtectionPreference,
  writeEditorOutlineCollapsedPreference,
  type EditorContentAlignment,
  type MemoDocumentActionRequest,
  type ShortcutSettings,
} from "@/lib/app-helpers";
import { copyEditorToWeChat, copyMarkdownToWeChat } from "@/lib/wechat-copy";
import { ThemeBlock } from "./ThemeBlock";
import { SystemInfoDialog } from "./SystemInfoDialog";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";
import { downloadMarkdownFile } from "@/lib/note-markdown-export";
import { NOTE_HTML_FULL_STYLES } from "@/lib/note-html-export-assets";
import { downloadNoteHtmlFile, getHtmlImageEmbedNoticeKind } from "@/lib/note-html-export";
import { openNotePrintPreview, serializeNoteDocumentForPrint } from "@/lib/note-print";
import type { NoteImageFormat } from "@/lib/note-image-export";
import {
  applyPlainTextTab,
  getAiSlashCommandStart,
  preserveEmptyListIndentOnBackspace,
  saveAndSyncEditor,
  shouldOpenAiFromSpace,
} from "@/lib/editor-shortcuts";
import {
  AI_SPACE_SHORTCUT_CHANGED_EVENT,
  readAiSpaceShortcutPreference,
} from "@/lib/ai-space-shortcut-preference";
import { isBrowserOffline } from "@/lib/network-status";
import {
  EDITOR_LINK_OPEN_MODE_CHANGED_EVENT,
  getStoredEditorLinkOpenMode,
  resolveEditorLinkRequireModifier,
  shouldOpenEditorLink,
  shouldOpenInternalNoteLink,
  shouldShowEditorLinkOpenHint,
  type EditorLinkOpenMode,
} from "@/lib/editor-link-click";
import {
  formatMarkdownLink,
  insertMarkdownSnippet,
  isAttachmentLinkHref,
} from "@/lib/editor-external-link";
import { insertAiDraftAtTextCursor } from "@/lib/ai-draft-insertion";
import { createFileBatchQueue, processFileUploadBatch } from "@/lib/file-batch";
import { MEMO_ID_REMAPPED_EVENT, MEMO_SYNC_ACKNOWLEDGED_EVENT } from "@/lib/sync-events";
import { useStandaloneMobileEditor } from "@/hooks/useStandaloneMobileEditor";
import { statusSettleMotion } from "@/lib/motion";
import {
  getRichTextAiSelectionContext,
  getRichTextAiReplacementRange,
  getRichTextAiSelectionReplacement,
  normalizeAiSelectionReplacement,
} from "@/lib/ai-selection-replacement";
import { getAttachmentFilenameFromLabel, getAttachmentResourceId } from "@/lib/attachment-links";
import {
  IMAGE_MENU_HIDE_EVENT,
  IMAGE_MENU_SHOW_EVENT,
  IMAGE_PREVIEW_SHOW_EVENT,
  ResizableImage,
  type ImageMenuRequestDetail,
  type ImagePreviewRequestDetail,
} from "./editor/ResizableImage";
import { EditableImageGallery } from "./editor/ImageGallery";
import { ImageViewer } from "./editor/ImageViewer";
import { PdfAttachment } from "./editor/PdfAttachment";
import { FileAttachment } from "./editor/FileAttachment";
import { createPluginEmbedExtension } from "./editor/PluginEmbed";
import { getEditorScrollProgress, restoreEditorScrollProgress } from "./editor/editor-mode-scroll";
import { useEditorSaveStatus } from "./editor/useEditorSaveStatus";
import { useEditorNoteSearchController } from "./editor/useEditorNoteSearchController";
import { EditorNoteLinkPicker } from "./editor/EditorNoteLinkPicker";
import { EditorResourceDialogs } from "./editor/EditorResourceDialogs";
import { EditorNoteSearchBar } from "./editor/EditorNoteSearchBar";
import { EditorSaveRecoveryBanner } from "./editor/EditorSaveRecoveryBanner";
import {
  EmptyEditorHeader,
  IconTooltip,
  MobileNotebookSelectSheet,
  NoteLinkInteractionHint,
  ResourceActionMenu,
  type NoteLinkHintPosition,
} from "./editor/EditorPaneChrome";
import {
  resolveEditorDraftState,
  shouldReplaceEditorDocument,
} from "./editor/editor-draft-state";
import type { EdgeEverPluginHost, PluginEditorAdapter } from "@/lib/plugins/plugin-host";
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

type AiInsertionTarget = {
  kind: "markdown" | "plain" | "rich";
  position: number;
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

type MobilePlainTextElement = HTMLTextAreaElement | HTMLDivElement;

const isEditorReady = (editor: Editor | null | undefined): editor is Editor =>
  Boolean(editor && !editor.isDestroyed && (editor as { extensionManager?: unknown }).extensionManager);

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

type EditorPaneProps = {
  memo: MemoDetail | null;
  repository: EdgeEverRepository;
  desktopFocusMode: boolean;
  onToggleDesktopFocusMode: () => void;
  editorContentAlignment: EditorContentAlignment;
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
  aiAssistantOpenToken: number;
  saveAndSyncToken: number;
  readingProtectionToggleToken: number;
  editorModeToggleToken: number;
  outlineToggleToken: number;
  shortcutSettings: ShortcutSettings;
  onSyncRequested: () => Promise<void>;
  documentActionRequest?: MemoDocumentActionRequest | null;
  onDocumentActionConsumed?: (requestId: number) => void;
  selectionActionBar?: ReactNode;
  onOpenMemo?: (memoId: string) => void;
  onOpenAiPrompts?: () => void;
  pluginHost: EdgeEverPluginHost;
  pluginNavigationRequest?: { id: number; noteId: string; search: string } | null;
  onOpenExecutionCenter: () => void;
  companionDiscoveryHub?: ReactNode;
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
  editorContentAlignment,
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
  aiAssistantOpenToken,
  saveAndSyncToken,
  readingProtectionToggleToken,
  editorModeToggleToken,
  outlineToggleToken,
  shortcutSettings,
  onSyncRequested,
  documentActionRequest,
  onDocumentActionConsumed,
  selectionActionBar,
  onOpenMemo,
  onOpenAiPrompts,
  pluginHost,
  pluginNavigationRequest,
  onOpenExecutionCenter,
  companionDiscoveryHub,
  onRequestMobileNativeEdit,
}: RichEditorPaneProps) => {
  const { t, i18n } = useTranslation();
  const { customEditorTheme, editorTheme } = useEditorTheme();
  const { markdownTheme } = useMarkdownTheme();
  const queryClient = useQueryClient();
  const resourceInsertionLimit = useMemo(createFileBatchQueue, []);
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
  const [storageSaveError, setStorageSaveError] = useState(false);
  const [hydratedEditorMemoId, setHydratedEditorMemoId] = useState<string | null>(null);

  useEffect(() => {
    setStorageSaveError(false);
  }, [memo?.id]);
  const [editorStateVersion, setEditorStateVersion] = useState(0);
  const [editorContentVersion, setEditorContentVersion] = useState(0);
  const [imageUploadState, setImageUploadState] = useState<"idle" | "compressing" | "uploading" | "error">("idle");
  const [imagePreview, setImagePreview] = useState<ImagePreviewRequestDetail | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [imageShareOpen, setImageShareOpen] = useState(false);
  const [imageShareSource, setImageShareSource] = useState<ShareNoteImageSource | null>(null);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [aiAssistantAnchor, setAiAssistantAnchor] = useState<AiAssistantAnchor>({ left: 24, placement: "below", top: 96 });
  const aiBubbleMenu = useAiBubbleMenu(aiAssistantOpen);
  const [aiSelection, setAiSelection] = useState<AiSelectionContext | null>(null);
  const [aiInsertionTarget, setAiInsertionTarget] = useState<AiInsertionTarget | null>(null);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const { unseen: deployedUpdateUnseen } = useDeployedUpdateNotice();
  const [mobileNotebookSheetOpen, setMobileNotebookSheetOpen] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [noteSearchOpen, setNoteSearchOpen] = useState(false);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSearchReplaceOpen, setNoteSearchReplaceOpen] = useState(false);
  const [noteSearchReplacement, setNoteSearchReplacement] = useState("");
  const [noteSearchIndex, setNoteSearchIndex] = useState(0);
  const handledPluginNavigationRequestRef = useRef(0);
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
  const [desktopReadingProtection, setDesktopReadingProtection] = useState(readDesktopReadingProtectionPreference);
  const [mobilePlainText, setMobilePlainText] = useState("");
  const [markdownSource, setMarkdownSource] = useState("");
  const [isMarkdownMode, setIsMarkdownMode] = useState(false);
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [editorOutlineCollapsed, setEditorOutlineCollapsed] = useState(readEditorOutlineCollapsedPreference);
  const [wechatCopyState, setWechatCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [memoIdCopyNotice, setMemoIdCopyNotice] = useState<{ status: "copied" | "error"; id: string } | null>(null);
  const handledSaveAndSyncTokenRef = useRef(saveAndSyncToken);
  const handledReadingProtectionToggleTokenRef = useRef(readingProtectionToggleToken);
  const handledEditorModeToggleTokenRef = useRef(editorModeToggleToken);
  const handledOutlineToggleTokenRef = useRef(outlineToggleToken);
  const handledAiAssistantOpenTokenRef = useRef(aiAssistantOpenToken);
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

  const effectiveReadOnly = readOnly
    || (isMobileViewport && !mobileEditingActive)
    || (!isMobileViewport && desktopReadingProtection);
  const useMobilePlainTextEditor = isMobileViewport && mobileEditingActive && !readOnly;
  const useMarkdownSourceEditor = !useMobilePlainTextEditor && isMarkdownMode;

  const toggleDesktopReadingProtection = useCallback(() => {
    setDesktopReadingProtection((protectedMode) => {
      const nextProtectedMode = !protectedMode;
      writeDesktopReadingProtectionPreference(nextProtectedMode);
      return nextProtectedMode;
    });
  }, []);

  const handleEditorOutlineCollapsedChange = useCallback((collapsed: boolean) => {
    setEditorOutlineCollapsed(collapsed);
    writeEditorOutlineCollapsedPreference(collapsed);
  }, []);

  const toggleEditorOutline = useCallback(() => {
    setEditorOutlineCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      writeEditorOutlineCollapsedPreference(nextCollapsed);
      return nextCollapsed;
    });
  }, []);

  useEffect(() => {
    if (!isMobileViewport && mobileDefaultEditRequested && desktopReadingProtection) {
      setDesktopReadingProtection(false);
      writeDesktopReadingProtectionPreference(false);
    }
  }, [desktopReadingProtection, isMobileViewport, mobileDefaultEditRequested]);

  useEffect(() => {
    if (!desktopReadingProtection) return;
    setAiAssistantOpen(false);
    setAiSelection(null);
    setAiInsertionTarget(null);
    setNoteSearchReplaceOpen(false);
    setExternalLinkDialogOpen(false);
    setNoteLinkPickerOpen(false);
  }, [desktopReadingProtection]);

  const memoRef = useRef<MemoDetail | null>(memo);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editorCanvasInteractionVersionRef = useRef(0);
  const openAiAssistantRef = useRef<() => void>(() => undefined);
  const aiSpaceShortcutEnabledRef = useRef(readAiSpaceShortcutPreference());
  const editorScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const mobileTextAreaRef = useRef<MobilePlainTextElement | null>(null);
  const mobileDraftTimerRef = useRef<number | null>(null);
  const mobileSaveTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noteSearchInputRef = useRef<HTMLInputElement | null>(null);
  const markdownSourceEditorRef = useRef<MarkdownSourceEditorRef | null>(null);
  const markdownModeSnapshotRef = useRef<MarkdownModeSnapshot | null>(null);
  const openExternalLinkDialogRef = useRef<() => void>(() => undefined);
  const slashCommandLabelsRef = useRef<SlashCommandLabels>({
    menu: "",
    empty: "",
    close: "",
    groups: { suggested: "", basic: "", insert: "" },
    items: {
      ai: "",
      paragraph: "",
      "heading-1": "",
      "heading-2": "",
      "heading-3": "",
      "bullet-list": "",
      "ordered-list": "",
      "task-list": "",
      blockquote: "",
      "code-block": "",
      divider: "",
      table: "",
      "current-date": "",
      "current-time": "",
      "current-date-time": "",
      attachment: "",
      "note-link": "",
      "external-link": "",
    },
  });
  slashCommandLabelsRef.current = {
    menu: t("slashMenu.menu"),
    empty: t("slashMenu.empty"),
    close: t("slashMenu.close"),
    groups: {
      suggested: t("slashMenu.groups.suggested"),
      basic: t("slashMenu.groups.basic"),
      insert: t("slashMenu.groups.insert"),
    },
    items: {
      ai: t("slashMenu.items.ai"),
      paragraph: t("editorToolbar.paragraph"),
      "heading-1": t("editorToolbar.heading1"),
      "heading-2": t("editorToolbar.heading2"),
      "heading-3": t("editorToolbar.heading3"),
      "bullet-list": t("editorToolbar.bulletList"),
      "ordered-list": t("editorToolbar.orderedList"),
      "task-list": t("editorToolbar.taskList"),
      blockquote: t("editorToolbar.quote"),
      "code-block": t("editorToolbar.codeBlock"),
      divider: t("editorToolbar.horizontalRule"),
      table: t("editorToolbar.table"),
      "current-date": t("slashMenu.items.currentDate"),
      "current-time": t("slashMenu.items.currentTime"),
      "current-date-time": t("slashMenu.items.currentDateTime"),
      attachment: t("editorToolbar.attachment"),
      "note-link": t("editorToolbar.noteLink"),
      "external-link": t("editorToolbar.externalLink"),
    },
  };
  const slashCommandActionsRef = useRef<SlashCommandActions | null>(null);
  if (!slashCommandActionsRef.current) {
    slashCommandActionsRef.current = {
      openAi: () => openAiAssistantRef.current(),
      openAttachmentPicker: () => fileInputRef.current?.click(),
      openExternalLinkPicker: () => openExternalLinkDialogRef.current(),
      openNoteLinkPicker: () => setNoteLinkPickerOpen(true),
    };
  }
  const slashCommandExtensionRef = useRef<ReturnType<typeof createSlashCommandExtension> | null>(null);
  if (!slashCommandExtensionRef.current) {
    slashCommandExtensionRef.current = createSlashCommandExtension({
      actions: slashCommandActionsRef.current,
      getLabels: () => slashCommandLabelsRef.current,
    });
  }
  const noteLinkSuggestionLabelsRef = useRef<NoteLinkSuggestionLabels>({
    menu: "",
    empty: "",
    close: "",
    untitled: "",
  });
  noteLinkSuggestionLabelsRef.current = {
    menu: t("noteLinkPicker.title"),
    empty: t("noteLinkPicker.empty"),
    close: t("noteLinkPicker.close"),
    untitled: t("common.untitledMemo"),
  };
  const noteLinkSuggestionExtensionRef = useRef<ReturnType<typeof createNoteLinkSuggestionExtension> | null>(null);
  if (!noteLinkSuggestionExtensionRef.current) {
    noteLinkSuggestionExtensionRef.current = createNoteLinkSuggestionExtension({
      getCurrentMemoId: () => memoRef.current?.id ?? null,
      getLabels: () => noteLinkSuggestionLabelsRef.current,
      searchMemos: async (query) => {
        const result = await repository.listMemos({ q: query, limit: 20 });
        return result.memos;
      },
    });
  }
  const hydratingRef = useRef(false);
  const hydratedMemoIdRef = useRef<string | null>(null);
  const editorInstanceMemoIdentityRef = useRef(
    createEditorInstanceMemoIdentity(memo?.id ?? null),
  );
  editorInstanceMemoIdentityRef.current = reconcileEditorInstanceMemoIdentity(
    editorInstanceMemoIdentityRef.current,
    memo?.id ?? null,
  );
  const editorInstanceMemoKey = editorInstanceMemoIdentityRef.current.instanceKey;
  const editorIsHydratedForCurrentMemo = isEditorInstanceHydratedForMemo(
    editorInstanceMemoIdentityRef.current,
    hydratedEditorMemoId,
    memo?.id ?? null,
  );
  /** Last content source applied to the editor — used to skip redundant setContent. */
  const appliedEditorSourceKeyRef = useRef<string | null>(null);
  const editingMemoIdRef = useRef<string | null>(memo?.id ?? null);
  const imageCompressionEnabledRef = useRef(imageCompressionEnabled);
  const resourceMenuHideTimerRef = useRef<number | null>(null);

  const restoreScrollAfterModeChange = useCallback((targetMode: "markdown" | "rich", progress: number) => {
    const restore = (attempt: number) => {
      const target = targetMode === "markdown"
        ? markdownSourceEditorRef.current?.getScrollContainer() ?? null
        : editorScrollContainerRef.current;

      if (restoreEditorScrollProgress(target, progress) || attempt >= 2) {
        return;
      }

      window.requestAnimationFrame(() => restore(attempt + 1));
    };

    window.requestAnimationFrame(() => restore(0));
  }, []);

  useEffect(() => {
    const handleMemoIdRemapped = (event: Event) => {
      const mappings = (event as CustomEvent<ReadonlyMap<string, string>>).detail;
      const currentMemo = memoRef.current;
      if (!currentMemo || !mappings) return;

      const nextMemoId = mappings.get(currentMemo.id);
      if (!nextMemoId || nextMemoId === currentMemo.id) return;

      const previousMemoId = currentMemo.id;
      editorInstanceMemoIdentityRef.current = remapEditorInstanceMemoIdentity(
        editorInstanceMemoIdentityRef.current,
        mappings,
      );
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
    const interactionVersionAtRequest = editorCanvasInteractionVersionRef.current;
    const placeholderPosition = currentEditor.state.selection.from;
    const imagePlaceholderByFile = new Map(files
      .filter((file) => SUPPORTED_PASTE_IMAGE_TYPES.has(file.type))
      .map((file) => [file, createImageUploadPlaceholder(
        file,
        t("editor.uploadState.imagePreparing"),
      )] as const));
    const imagePlaceholders = [...imagePlaceholderByFile.values()];
    imagePlaceholders.forEach((placeholder) => {
      addImageUploadPlaceholder(currentEditor, placeholder, placeholderPosition);
    });

    void resourceInsertionLimit(async () => {
      const insertionEditor = editorRef.current;
      if (
        memoRef.current?.id !== targetMemoId ||
        !isEditorReady(insertionEditor) ||
        !insertionEditor.isEditable
      ) {
        return;
      }

      // Read the selection only after earlier resource insertions complete.
      // Rapid consecutive pastes otherwise race with the same stale cursor.
      const insertionTarget = getResourceInsertionTarget(insertionEditor.state.selection);
      setImageUploadState("uploading");
      const imageReadiness: Promise<void>[] = [];

      const results = await processFileUploadBatch(files, async (file) => {
        const isImage = SUPPORTED_PASTE_IMAGE_TYPES.has(file.type);
        const shouldCompress = isImage && imageCompressionEnabledRef.current;
        const placeholder = imagePlaceholderByFile.get(file);
        if (placeholder) updateImageUploadPlaceholder(editorRef.current, placeholder,
          t(shouldCompress ? "editor.uploadState.imageCompressing" : "editor.uploadState.uploading"));
        setImageUploadState(shouldCompress ? "compressing" : "uploading");
        const preparedFile = shouldCompress ? (await compressImageForUpload(file)).file : file;
        if (placeholder) updateImageUploadPlaceholder(editorRef.current, placeholder,
          t("editor.uploadState.waitingToUpload"));
        return preparedFile;
      }, async (uploadFile, file) => {
        const isImage = SUPPORTED_PASTE_IMAGE_TYPES.has(file.type);
        const placeholder = imagePlaceholderByFile.get(file);
        setImageUploadState("uploading");
        if (placeholder) updateImageUploadPlaceholder(editorRef.current, placeholder,
          t("editor.uploadState.uploading"));
        let resource: {
          kind: "image" | "attachment";
          filename: string | null;
          mimeType: string | null;
          byteSize: number;
          url: string;
        };
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
            mimeType: uploadFile.type || null,
            byteSize: uploadFile.size,
            url: `edgeever-staged://${staged.id}`,
          };
        }
        if (resource.kind === "image") {
          imageReadiness.push(waitForImageSourceReady(resource.url));
        }
        return resource;
      });

      const successfulResults = results.filter((result) => result.status === "fulfilled");
      if (successfulResults.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ["resources"] });
      }
      await Promise.all(imageReadiness);

      const activeEditor = editorRef.current;
      if (memoRef.current?.id !== targetMemoId || !isEditorReady(activeEditor)) {
        setImageUploadState("idle");
        return;
      }

      const content = successfulResults.map(({ file, value: resource }) => {
        const filename = resource.filename || file.name;
        if (resource.kind === "image") {
          return {
            type: "image",
            attrs: {
              src: resource.url,
              alt: file.name,
              title: file.name,
              width: DEFAULT_IMAGE_WIDTH_PERCENT,
            },
          };
        }
        if (isPdfAttachment(file.type, filename)) {
          return {
            type: "paragraph",
            content: [{
              type: "edgeeverPdfAttachment",
              attrs: {
                url: resource.url,
                label: t("editor.attachmentLabel", { filename }),
                filename,
                mimeType: resource.mimeType || file.type || "application/pdf",
                byteSize: resource.byteSize,
                displayMode: "compact",
              },
            }],
          };
        }
        return {
          type: "paragraph",
          content: [{
            type: "edgeeverFileAttachment",
            attrs: {
              url: resource.url,
              label: t("editor.attachmentLabel", { filename }),
              filename,
              mimeType: file.type,
              byteSize: resource.byteSize,
            },
          }],
        };
      });

      if (content.length > 0) {
        const safeInsertionTarget = clampResourceInsertionTarget(
          insertionTarget,
          activeEditor.state.doc.content.size,
        );
        const updateSelection = shouldSelectInsertedResources(
          interactionVersionAtRequest,
          editorCanvasInteractionVersionRef.current,
        );
        const insertion = activeEditor.chain();
        if (updateSelection) {
          insertion.focus();
        }
        insertion
          .command(insertUploadedResources(
            safeInsertionTarget,
            content,
            updateSelection,
          ))
          .run();
        if (!updateSelection) {
          // ProseMirror can still map a cursor at the document boundary to a
          // NodeSelection for the newly inserted block image. Honor the newer
          // canvas click deterministically instead of trusting that mapping.
          clearNodeSelectionAtDocumentEnd(activeEditor);
        }
      }

      if (results.some((result) => result.status === "rejected")) {
        setImageUploadState("error");
        window.setTimeout(() => setImageUploadState("idle"), 2200);
      } else {
        setImageUploadState("idle");
      }
    }).finally(() => {
      const placeholderEditor = editorRef.current;
      imagePlaceholders.forEach((placeholder) => {
        removeImageUploadPlaceholder(placeholderEditor, placeholder);
      });
    });
  }, [queryClient, repository, resourceInsertionLimit, t]);

  const pluginEmbedExtension = useMemo(() => createPluginEmbedExtension(pluginHost), [pluginHost]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false,
      }),
      EdgeEverLink.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      EdgeEverCodeBlock.configure({ lowlight: codeBlockLowlight, defaultLanguage: "plaintext" }),
      MergeDivider,
      pluginEmbedExtension,
      PdfAttachment,
      FileAttachment,
      ...createEdgeEverMathematics(),
      ThemeBlock,
      EditableImageGallery,
      ResizableImage.configure({
        allowBase64: false,
        inline: false,
      }),
      ImageUploadPlaceholderExtension,
      TableKit.configure({
        table: { renderWrapper: true },
      }),
      Placeholder.configure({
        placeholder: () => aiSpaceShortcutEnabledRef.current
          ? t("editor.placeholder")
          : t("editor.placeholderCommands"),
      }),
      slashCommandExtensionRef.current,
      noteLinkSuggestionExtensionRef.current,
    ],
    content: memo
      ? resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown)
      : { type: "doc", content: [{ type: "paragraph" }] },
    editable: Boolean(memo && !effectiveReadOnly && editorIsHydratedForCurrentMemo),
    editorProps: {
      attributes: {
        class: "edgeever-note-rich-editor prose prose-slate max-w-none focus:outline-none min-h-[240px] px-4 py-3 sm:px-7 lg:min-h-[180px]",
      },
      handleKeyDown: (view, event) => {
        const { selection } = view.state;
        const currentNode = selection.$from.parent;
        if (event.key === "Backspace" && preserveEmptyListIndentOnBackspace(view.state, view.dispatch)) {
          event.preventDefault();
          return true;
        }

        if (event.key === "Tab" && applyPlainTextTab(view.state, view.dispatch, event.shiftKey)) {
          event.preventDefault();
          return true;
        }

        if (aiSpaceShortcutEnabledRef.current && shouldOpenAiFromSpace({
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          isComposing: event.isComposing,
          isEmptyParagraph: currentNode.type.name === "paragraph" && currentNode.content.size === 0,
          key: event.key,
          keyCode: event.keyCode,
          metaKey: event.metaKey,
          repeat: event.repeat,
          selectionEmpty: selection.empty,
          shiftKey: event.shiftKey,
        })) {
          event.preventDefault();
          window.requestAnimationFrame(() => openAiAssistantRef.current());
          return true;
        }

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

        const { from, to } = selection;
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
      handleTextInput: (view, from, to, text) => {
        if (from !== to) return false;
        const resolved = view.state.doc.resolve(from);
        if (resolved.parent.type.name !== "paragraph") return false;
        const textBefore = view.state.doc.textBetween(resolved.start(), from, "\n", "\n");
        const commandStart = getAiSlashCommandStart({
          caretPosition: from,
          insertedText: text,
          textBefore,
        });
        if (commandStart === null) return false;

        view.dispatch(view.state.tr.delete(commandStart, from));
        window.requestAnimationFrame(() => openAiAssistantRef.current());
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
    // A ProseMirror undo history belongs to exactly one logical memo. A newly
    // created memo keeps the same instance while its local id is remapped to a
    // durable id; an actual memo switch still receives a fresh undo history.
    editorInstanceMemoKey,
  ]);

  useEffect(() => {
    const syncPreference = (event?: Event) => {
      const detail = event && event.type === AI_SPACE_SHORTCUT_CHANGED_EVENT
        ? (event as CustomEvent<boolean>).detail
        : undefined;
      aiSpaceShortcutEnabledRef.current = typeof detail === "boolean"
        ? detail
        : readAiSpaceShortcutPreference();
      if (isEditorReady(editor)) {
        editor.view.dispatch(editor.state.tr);
      }
    };
    window.addEventListener(AI_SPACE_SHORTCUT_CHANGED_EVENT, syncPreference);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(AI_SPACE_SHORTCUT_CHANGED_EVENT, syncPreference);
      window.removeEventListener("storage", syncPreference);
    };
  }, [editor]);

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
      const selection = markdownSourceEditorRef.current?.getSelection() ?? { from: markdownSource.length, to: markdownSource.length };
      const start = selection.from;
      const end = selection.to;
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
        const selection = markdownSourceEditorRef.current?.getSelection() ?? { from: markdownSource.length, to: markdownSource.length };
        const start = selection.from;
        const end = selection.to;
        const selected = markdownSource.slice(start, end);
        const label = selected.trim() ? selected : text;
        const snippet = formatMarkdownLink(label, href);
        const { next, caret } = insertMarkdownSnippet(markdownSource, snippet, start, end);
        setMarkdownSource(next);
        markDirtyStatus();
        window.requestAnimationFrame(() => {
          markdownSourceEditorRef.current?.focus();
          markdownSourceEditorRef.current?.setSelection(caret, caret);
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
          left: rect.left + rect.width / 2,
          top: rect.bottom + 8,
          placement: "below",
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

  useEffect(() => {
    const showImagePreview = (event: Event) => {
      const detail = (event as CustomEvent<ImagePreviewRequestDetail>).detail;
      if (!detail?.url) return;
      setImagePreview(detail);
    };
    window.addEventListener(IMAGE_PREVIEW_SHOW_EVENT, showImagePreview);
    return () => window.removeEventListener(IMAGE_PREVIEW_SHOW_EVENT, showImagePreview);
  }, []);

  useEffect(() => {
    setImagePreview(null);
  }, [memo?.id]);

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
    const link = getEditorNavigableLinkFromEventTarget(target);
    if (parseMemoLinkHref(link?.getAttribute("href"))) {
      setNoteLinkHintPosition(null);
      return;
    }

    if (!shouldShowEditorLinkOpenHint(Boolean(editor?.isEditable), isMobileViewport, editorLinkOpenMode)) {
      return;
    }

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
    const noteLink = getNoteLinkFromEventTarget(event.target);
    const memoId = parseMemoLinkHref(noteLink?.getAttribute("href"));
    if (shouldOpenInternalNoteLink(event, memoId)) {
      event.preventDefault();
      event.stopPropagation();
      setNoteLinkHintPosition(null);
      onOpenMemo?.(memoId as string);
      return;
    }

    if (event.button === 0 && !event.ctrlKey && !event.metaKey) {
      showEditorLinkOpenHint(event.target);

      const target = event.target;
      const proseMirror = event.currentTarget.querySelector<HTMLElement>(".ProseMirror");
      const clickedEmptyCanvas = target === proseMirror || (
        target instanceof Node &&
        proseMirror !== null &&
        !proseMirror.contains(target)
      );
      if (clickedEmptyCanvas) {
        editorCanvasInteractionVersionRef.current += 1;
        // This handler runs in capture phase, before ProseMirror translates the
        // click coordinates into a selection. In a desktop WebView that later
        // selection can map the empty area beside/below a block image back onto
        // the image, undoing an immediate clear. Reconcile after ProseMirror's
        // click handling has completed instead.
        window.requestAnimationFrame(() => {
          const activeEditor = editorRef.current;
          if (activeEditor !== editor || !isEditorReady(activeEditor)) {
            return;
          }
          if (clearNodeSelectionAtDocumentEnd(activeEditor)) {
            activeEditor.commands.focus();
          }
        });
      }
    }
  }, [editor, onOpenMemo, showEditorLinkOpenHint]);

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

  const {
    closeSearch: closeNoteSearch,
    matchLabel: noteSearchMatchLabel,
    matches: noteSearchMatches,
    moveMatch: moveNoteSearchMatch,
    openReplace: openNoteReplace,
    openSearch: openNoteSearch,
    replaceAllMatches: replaceAllNoteSearchMatches,
  } = useEditorNoteSearchController({
    contentSearchQuery,
    dirtyVersion,
    editor,
    editorScrollContainerRef,
    memoId: memo?.id ?? null,
    noteSearchIndex,
    noteSearchInputRef,
    noteSearchOpen,
    noteSearchQuery,
    noteSearchReplacement,
    readOnly: effectiveReadOnly,
    replaceFocusToken,
    searchFocusToken,
    setNoteSearchIndex,
    setNoteSearchOpen,
    setNoteSearchReplaceOpen,
  });

  useEffect(() => {
    if (
      !pluginNavigationRequest
      || !memo
      || pluginNavigationRequest.id === handledPluginNavigationRequestRef.current
      || pluginNavigationRequest.noteId !== memo.id
      || hydratedEditorMemoId !== memo.id
      || !isEditorReady(editor)
    ) return;
    handledPluginNavigationRequestRef.current = pluginNavigationRequest.id;
    setNoteSearchQuery(pluginNavigationRequest.search);
    setNoteSearchIndex(0);
    setNoteSearchReplaceOpen(false);
    setNoteSearchOpen(true);
    window.requestAnimationFrame(() => noteSearchInputRef.current?.focus());
  }, [editor, hydratedEditorMemoId, memo?.id, pluginNavigationRequest]);

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
            ? resolveMarkdownModeContent(
                markdownModeSnapshotRef.current,
                currentMemo.id,
                markdownSource,
              )
            : normalizeImageGalleries(currentEditor?.getJSON() as TiptapDoc),
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
    if (effectiveReadOnly) return;
    let selection: AiSelectionContext | null = null;
    let insertionTarget: AiInsertionTarget | null = null;

    if (useMobilePlainTextEditor) {
      const source = getMobilePlainTextValue();
      const plainTextElement = mobileTextAreaRef.current;
      const from = plainTextElement instanceof HTMLTextAreaElement ? plainTextElement.selectionStart : 0;
      const to = plainTextElement instanceof HTMLTextAreaElement ? plainTextElement.selectionEnd : from;
      insertionTarget = { kind: "plain", position: to };
      const contentMarkdown = source.slice(from, to).trim();
      if (to > from && contentMarkdown) selection = { kind: "plain", from, to, contentMarkdown };
    } else if (useMarkdownSourceEditor) {
      const selectionPos = markdownSourceEditorRef.current?.getSelection() ?? { from: 0, to: 0 };
      const from = selectionPos.from;
      const to = selectionPos.to;
      insertionTarget = { kind: "markdown", position: to };
      const contentMarkdown = markdownSource.slice(from, to).trim();
      if (to > from && contentMarkdown) selection = { kind: "markdown", from, to, contentMarkdown };
    } else if (isEditorReady(editor)) {
      insertionTarget = { kind: "rich", position: editor.state.selection.head };
      const richSelection = getRichTextAiSelectionContext(editor.state.doc, editor.state.selection);
      if (richSelection) selection = { kind: "rich", ...richSelection };
    }

    let anchor: AiAssistantAnchor | null = null;
    if (!useMobilePlainTextEditor && !useMarkdownSourceEditor && isEditorReady(editor)) {
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.head);
        const placeAbove = coords.bottom > window.innerHeight * 0.58;
        anchor = {
          left: coords.left,
          placement: placeAbove ? "above" : "below",
          top: placeAbove ? coords.top - 8 : coords.bottom + 8,
        };
      } catch {
        anchor = null;
      }
    }
    if (!anchor) {
      const fallback = useMarkdownSourceEditor
        ? markdownSourceEditorRef.current?.getSelectionCoordinates() ?? markdownSourceEditorRef.current?.getScrollContainer()?.getBoundingClientRect()
        : useMobilePlainTextEditor
          ? mobileTextAreaRef.current?.getBoundingClientRect()
          : editorScrollContainerRef.current?.getBoundingClientRect();
      anchor = {
        left: fallback?.left ?? 24,
        placement: "below",
        top: Math.min((fallback?.top ?? 72) + 48, window.innerHeight - 120),
      };
    }

    setAiAssistantAnchor(anchor);
    setAiSelection(selection);
    setAiInsertionTarget(insertionTarget);
    setAiAssistantOpen(true);
  }, [editor, effectiveReadOnly, getMobilePlainTextValue, markdownSource, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  useEffect(() => {
    openAiAssistantRef.current = openAiAssistant;
  }, [openAiAssistant]);

  const handleAiAssistantOpenChange = useCallback((nextOpen: boolean) => {
    setAiAssistantOpen(nextOpen);
    if (!nextOpen) {
      setAiSelection(null);
      setAiInsertionTarget(null);
    }
  }, []);

  const applyAiDraft = useCallback((draft: string, mode: "append" | "replace") => {
    if (effectiveReadOnly) return false;
    if (mode === "replace" && aiSelection) {
      const replacementDraft = normalizeAiSelectionReplacement(draft);
      if (!replacementDraft) return false;

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
          markdownSourceEditorRef.current?.focus();
          markdownSourceEditorRef.current?.setSelection(caret, caret);
        });
      } else if (aiSelection.kind === "rich" && isEditorReady(editor)) {
        const maxPos = editor.state.doc.content.size;
        const { from, to } = getRichTextAiReplacementRange(aiSelection.from, aiSelection.to, maxPos);
        try {
          const applied = editor.commands.insertContentAt(
            { from, to },
            getRichTextAiSelectionReplacement(replacementDraft, aiSelection.isInline),
          );
          if (!applied) return false;
          editor.commands.focus();
        } catch {
          return false;
        }
      } else {
        return false;
      }
      markDirty();
      setAiSelection(null);
      setAiInsertionTarget(null);
      setAiAssistantOpen(false);
      return true;
    }

    if (mode === "append" && aiInsertionTarget) {
      const insertionDraft = draft.trim();
      if (!insertionDraft) return false;

      if (aiInsertionTarget.kind === "plain") {
        const source = getMobilePlainTextValue();
        const { next, caret } = insertAiDraftAtTextCursor(source, insertionDraft, aiInsertionTarget.position);
        setMobilePlainText(next);
        setMobilePlainTextElementValue(mobileTextAreaRef.current, next);
        persistCurrentDraft(title, tagsText, next);
        window.requestAnimationFrame(() => {
          const plainTextElement = mobileTextAreaRef.current;
          plainTextElement?.focus();
          if (plainTextElement instanceof HTMLTextAreaElement) plainTextElement.setSelectionRange(caret, caret);
        });
      } else if (aiInsertionTarget.kind === "markdown") {
        const { next, caret } = insertAiDraftAtTextCursor(markdownSource, insertionDraft, aiInsertionTarget.position);
        setMarkdownSource(next);
        window.requestAnimationFrame(() => {
          markdownSourceEditorRef.current?.focus();
          markdownSourceEditorRef.current?.setSelection(caret, caret);
        });
      } else if (isEditorReady(editor)) {
        const position = Math.max(0, Math.min(aiInsertionTarget.position, editor.state.doc.content.size));
        try {
          const applied = editor.commands.insertContentAt(
            position,
            getRichTextAiSelectionReplacement(insertionDraft, false),
          );
          if (!applied) return false;
          editor.commands.focus();
        } catch {
          return false;
        }
      } else {
        return false;
      }

      markDirty();
      setAiSelection(null);
      setAiInsertionTarget(null);
      setAiAssistantOpen(false);
      return true;
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
      try {
        if (!editor.commands.setContent(markdownToDoc(next))) return false;
      } catch {
        return false;
      }
    } else {
      return false;
    }
    markDirty();
    setAiSelection(null);
    setAiInsertionTarget(null);
    setAiAssistantOpen(false);
    return true;
  }, [aiInsertionTarget, aiSelection, editor, effectiveReadOnly, getCurrentMarkdownForAi, getMobilePlainTextValue, markDirty, markdownSource, persistCurrentDraft, tagsText, title, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const getCurrentContentJson = useCallback((): TiptapDoc | null => {
    if (useMobilePlainTextEditor) {
      return markdownToDoc(getMobilePlainTextValue());
    }

    if (useMarkdownSourceEditor) {
      return resolveMarkdownModeContent(
        markdownModeSnapshotRef.current,
        memoRef.current?.id,
        markdownSource,
      );
    }

    const currentEditor = editorRef.current;
    if (!isEditorReady(currentEditor)) {
      return null;
    }

    return normalizeImageGalleries(currentEditor.getJSON() as TiptapDoc);
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
    const handleLocalDatabaseInterrupted = () => {
      const currentMemo = memoRef.current;
      const contentJson = getCurrentContentJson();
      if (currentMemo && contentJson && !currentMemo.isDeleted) {
        persistEmergencyDraft({
          memoId: currentMemo.id,
          expectedRevision: currentMemo.revision,
          title,
          tagsText,
          contentJson,
          updatedAt: new Date().toISOString(),
        });
        setHasUnsavedChanges(true);
      }
      setStorageSaveError(true);
      setSaveConflictInfo(null);
      setSaveState("error");
    };

    window.addEventListener(LOCAL_DATABASE_INTERRUPTED_EVENT, handleLocalDatabaseInterrupted);
    return () => window.removeEventListener(LOCAL_DATABASE_INTERRUPTED_EVENT, handleLocalDatabaseInterrupted);
  }, [getCurrentContentJson, setHasUnsavedChanges, setSaveConflictInfo, setSaveState, tagsText, title]);

  useEffect(() => {
    const currentEditor = editorRef.current;
    let cancelled = false;

    if (!memo) {
      memoRef.current = null;
      editSessionRef.current = null;
      hydratedMemoIdRef.current = null;
      appliedEditorSourceKeyRef.current = null;
      markdownModeSnapshotRef.current = null;
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
      setStorageSaveError(false);
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
      markdownModeSnapshotRef.current = null;
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
      let [indexedDbDraft, queuedUpdate] = memo.isDeleted
        ? [null, null]
        : await Promise.all([
            localDb.drafts.get(memo.id),
            localDb.syncQueue.get(getMemoUpdateQueueId(memo.id)),
          ]);
      let draft = selectNewestLocalDraft(indexedDbDraft, readEmergencyDraft(memo.id));

      if (cancelled) {
        return;
      }

      if (queuedUpdate && isMemoUpdateAlreadyApplied(memo, queuedUpdate)) {
        await Promise.all([
          localDb.syncQueue.delete(queuedUpdate.id),
          localDb.drafts.delete(memo.id),
        ]);
        removeEmergencyDraft(memo.id);
        draft = null;
        queuedUpdate = undefined;
      }

      const resolvedDraft = resolveEditorDraftState({ memo, draft, queuedUpdate });
      if (draft && !queuedUpdate && resolvedDraft.source === "memo") {
        await localDb.drafts.delete(memo.id);
        removeEmergencyDraft(memo.id);
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
      const currentEditorDocument = isEditorReady(currentEditor)
        ? currentEditor.getJSON() as TiptapDoc
        : null;
      const shouldReplaceDocument = shouldReplaceEditorDocument(currentEditorDocument, nextContent);
      const editorMarkdownMatches = Boolean(
        alreadyHydratedSameMemo &&
        currentEditorDocument &&
        docToMarkdown(currentEditorDocument) === nextMarkdown &&
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
      markdownModeSnapshotRef.current = isMarkdownMode
        ? createMarkdownModeSnapshot(memo.id, nextContent, nextMarkdown)
        : null;
      setMobilePlainTextElementValue(mobileTextAreaRef.current, nextMarkdown);

      if (isEditorReady(currentEditor) && shouldReplaceDocument) {
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
      editor.setEditable(Boolean(
        memo
        && !effectiveReadOnly
        && isEditorInstanceHydratedForMemo(
          editorInstanceMemoIdentityRef.current,
          hydratedEditorMemoId,
          memo.id,
        )
      ));
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

      // A newly created note keeps a local ID until its create request has
      // been acknowledged and remapped. A different queue item completing
      // must not make that note claim it is already synced.
      if (!memoId || isLocalMemoId(memoId)) {
        return;
      }

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

      // Sync runs are workspace-wide. Confirm that this memo has no successor
      // request left in the outbox before changing its per-note status.
      void localDb.syncQueue.where("memoId").equals(memoId).first().then((item) => {
        if (item || memoRef.current?.id !== memoId || hasUnsavedChangesRef.current) {
          return;
        }
        setSaveState((current) => {
          if (current !== "queued") {
            return current;
          }
          setSaveConflictInfo(null);
          return "saved";
        });
      });
    };

    window.addEventListener(MEMO_SYNC_ACKNOWLEDGED_EVENT, handleMemoSyncAcknowledged);
    window.addEventListener("edgeever:sync-completed", handleSyncCompleted);
    return () => {
      window.removeEventListener(MEMO_SYNC_ACKNOWLEDGED_EVENT, handleMemoSyncAcknowledged);
      window.removeEventListener("edgeever:sync-completed", handleSyncCompleted);
    };
  }, []);

  const applyMarkdownSourceToRichText = useCallback((scrollProgress: number) => {
    if (!isEditorReady(editor)) {
      return;
    }

    hydratingRef.current = true;
    editor.commands.setContent(resolveMarkdownModeContent(
      markdownModeSnapshotRef.current,
      memoRef.current?.id,
      markdownSource,
    ));
    markdownModeSnapshotRef.current = null;
    setIsMarkdownMode(false);
    restoreScrollAfterModeChange("rich", scrollProgress);
    window.setTimeout(() => {
      hydratingRef.current = false;
    }, 0);
  }, [editor, markdownSource, restoreScrollAfterModeChange]);

  const handleMarkdownModeChange = useCallback(() => {
    if (effectiveReadOnly || !isEditorReady(editor)) {
      return;
    }

    const scrollProgress = getEditorScrollProgress(
      isMarkdownMode ? (markdownSourceEditorRef.current?.getScrollContainer() ?? null) : editorScrollContainerRef.current,
    );

    if (isMarkdownMode) {
      applyMarkdownSourceToRichText(scrollProgress);
      return;
    }

    const currentMemoId = memoRef.current?.id;
    if (!currentMemoId) {
      return;
    }
    const snapshot = createMarkdownModeSnapshot(
      currentMemoId,
      editor.getJSON() as TiptapDoc,
    );
    markdownModeSnapshotRef.current = snapshot;
    setMarkdownSource(snapshot.markdownSource);
    setIsMarkdownMode(true);
    restoreScrollAfterModeChange("markdown", scrollProgress);
  }, [applyMarkdownSourceToRichText, editor, effectiveReadOnly, isMarkdownMode, markdownSource, restoreScrollAfterModeChange]);

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

  const buildImageExportOptions = useCallback((format: NoteImageFormat) => {
    if (!isEditorReady(editor) || !memo) return;
    const currentDocument = useMobilePlainTextEditor
      ? markdownToDoc(getMobilePlainTextValue())
      : useMarkdownSourceEditor
        ? markdownToDoc(markdownSource)
        : editor.getJSON() as TiptapDoc;
    return {
      bodyHtml: serializeNoteDocumentForPrint(editor, currentDocument),
      title: title.trim() || t("common.untitledMemo"),
      notebook: notebookOptions.find((notebook) => notebook.id === memo.notebookId)?.name ?? "",
      tags: parseTagsText(tagsText),
      updatedAt: formatDateTime(memo.updatedAt),
      language: i18n.resolvedLanguage ?? i18n.language,
      fallbackTitle: t("common.untitledMemo"),
      format,
      styles: NOTE_HTML_FULL_STYLES,
    };
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

  const handleOpenImageShare = useCallback(() => {
    const options = buildImageExportOptions("png");
    if (!options) return;
    const { format: _format, ...source } = options;
    setImageShareSource(source);
    setImageShareOpen(true);
  }, [buildImageExportOptions]);

  const handleSaveAsTemplate = useCallback(() => {
    if (!memo || effectiveReadOnly) {
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
  }, [editor, effectiveReadOnly, getMobilePlainTextValue, memo, onSaveAsTemplate, t, tagsText, title, useMobilePlainTextEditor]);

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
        if (!effectiveReadOnly) setShareOpen(true);
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
      case "share-image":
        handleOpenImageShare();
        break;
      case "save-as-template":
        handleSaveAsTemplate();
        break;
    }
  }, [
    documentActionRequest,
    editor,
    effectiveReadOnly,
    handleExportHtml,
    handleExportMarkdown,
    handleExportPdf,
    handleOpenImageShare,
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
      persistEmergencyDraft({
        memoId: currentMemo.id,
        expectedRevision: currentMemo.revision,
        title,
        tagsText,
        contentJson,
        updatedAt: new Date().toISOString(),
      });
      const { memo: localMemo } = await repository.updateMemo(currentMemo, payload);
      return { memo: localMemo, snapshot, queued: true };
    },
    onMutate: () => {
      setStorageSaveError(false);
      setSaveState("saving");
    },
    onSuccess: async ({ memo: savedMemo, snapshot, queued }) => {
      setStorageSaveError(false);
      removeEmergencyDraft(savedMemo.id);
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
        void localDb.drafts.delete(savedMemo.id).catch(() => undefined);
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
      if (error instanceof LocalDatabaseUnavailableError) {
        setStorageSaveError(true);
        setSaveConflictInfo(null);
        setSaveState("error");
        return;
      }
      setStorageSaveError(false);
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
        removeEmergencyDraft(error.payload.memoId);

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
      getDocument: () => ({
        noteId: pluginEditorMemoId,
        contentMarkdown: isMarkdownMode
          ? markdownSource
          : docToMarkdown(editor.getJSON() as TiptapDoc),
        hasUnsavedChanges: hasUnsavedChanges || saveMutation.isPending,
      }),
      replaceDocument: (contentMarkdown) => {
        if (isMarkdownMode) setMarkdownSource(contentMarkdown);
        else editor.commands.setContent(markdownToDoc(contentMarkdown));
        markDirty();
      },
      insertEmbed: (embed) => {
        const attributes = {
          id: embed.id,
          pluginId: embed.pluginId,
          type: embed.type,
          resourceId: embed.resourceId,
          previewResourceId: embed.previewResourceId,
          title: embed.title,
          dataJson: JSON.stringify(embed.data),
        };
        if (isMarkdownMode) {
          setMarkdownSource((current) => `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${pluginEmbedToMarkdown(attributes)}\n`);
        } else {
          editor.chain().focus().insertContent({ type: PLUGIN_EMBED_NODE_TYPE, attrs: attributes }).run();
        }
        markDirty();
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
  }, [editor, effectiveReadOnly, hasUnsavedChanges, hydratedEditorMemoId, isMarkdownMode, markdownSource, markDirty, pluginEditorMemoId, pluginHost, saveMutation.isPending]);
  // useMutation returns a new result object on every render. Depending on the
  // whole object makes autosave timers restart during unrelated renders and
  // can starve a recovered draft indefinitely. These members are stable (or
  // primitive) and are safe effect dependencies.
  const mutateSave = saveMutation.mutate;
  const mutateSaveAsync = saveMutation.mutateAsync;
  const saveMutationPending = saveMutation.isPending;

  const editorShortcutBlocked = Boolean(
    historyOpen ||
      shareOpen ||
      aiAssistantOpen ||
      systemInfoOpen ||
      mobileNotebookSheetOpen ||
      noteLinkPickerOpen ||
      externalLinkDialogOpen ||
      resourceDialog ||
      imagePreview
  );

  useEffect(() => {
    if (handledAiAssistantOpenTokenRef.current === aiAssistantOpenToken) return;
    handledAiAssistantOpenTokenRef.current = aiAssistantOpenToken;
    if (editorShortcutBlocked || effectiveReadOnly || !memoRef.current) return;
    openAiAssistant();
  }, [aiAssistantOpenToken, editorShortcutBlocked, effectiveReadOnly, openAiAssistant]);

  useEffect(() => {
    if (handledReadingProtectionToggleTokenRef.current === readingProtectionToggleToken) return;
    handledReadingProtectionToggleTokenRef.current = readingProtectionToggleToken;
    if (editorShortcutBlocked || isMobileViewport || readOnly || !memoRef.current) return;
    toggleDesktopReadingProtection();
  }, [editorShortcutBlocked, isMobileViewport, readOnly, readingProtectionToggleToken, toggleDesktopReadingProtection]);

  useEffect(() => {
    if (handledEditorModeToggleTokenRef.current === editorModeToggleToken) {
      return;
    }

    handledEditorModeToggleTokenRef.current = editorModeToggleToken;
    if (editorShortcutBlocked || useMobilePlainTextEditor) {
      return;
    }

    handleMarkdownModeChange();
  }, [editorModeToggleToken, editorShortcutBlocked, handleMarkdownModeChange, useMobilePlainTextEditor]);

  useEffect(() => {
    if (handledOutlineToggleTokenRef.current === outlineToggleToken) {
      return;
    }

    handledOutlineToggleTokenRef.current = outlineToggleToken;
    if (editorShortcutBlocked || isMobileViewport || useMobilePlainTextEditor || useMarkdownSourceEditor) {
      return;
    }

    toggleEditorOutline();
  }, [editorShortcutBlocked, isMobileViewport, outlineToggleToken, toggleEditorOutline, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  useEffect(() => {
    if (handledSaveAndSyncTokenRef.current === saveAndSyncToken || saveMutationPending) {
      return;
    }

    handledSaveAndSyncTokenRef.current = saveAndSyncToken;
    if (
      editorShortcutBlocked ||
      effectiveReadOnly ||
      !memoRef.current ||
      !isEditorReady(editorRef.current) ||
      saveState === "conflict"
    ) {
      return;
    }

    void (async () => {
      try {
        await saveAndSyncEditor({
          hasUnsavedChanges: hasUnsavedChangesRef.current,
          save: mutateSaveAsync,
          sync: onSyncRequested,
        });
      } catch {
        // The save mutation owns its visible error/conflict state. Do not sync
        // after a failed save because the queue may not contain this snapshot.
      }
    })();
  }, [
    editorShortcutBlocked,
    effectiveReadOnly,
    mutateSaveAsync,
    onSyncRequested,
    saveAndSyncToken,
    saveMutationPending,
    saveState,
  ]);

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

  const fetchResourceResponse = useCallback(async (target: ResourceMenuTarget) => {
    const response = target.url.startsWith("edgeever-resource:") || target.url.startsWith("edgeever-staged:")
      ? await fetch(target.url)
      : await api.getResourceResponse(target.url);
    if (!response.ok) throw new Error(response.statusText || getResourceActionFailure(target));
    return response;
  }, [getResourceActionFailure]);

  const downloadResourceDirectly = useCallback((target: ResourceMenuTarget) => {
    const anchor = document.createElement("a");
    anchor.href = target.url;
    anchor.download = target.filename;
    anchor.click();
  }, []);

  const handleResourceDownload = useCallback(async (target: ResourceMenuTarget) => {
    hideResourceMenu();
    clearResourceActionError();
    downloadResourceDirectly(target);
  }, [clearResourceActionError, downloadResourceDirectly, hideResourceMenu]);

  const handleResourceSaveAs = useCallback(async (target: ResourceMenuTarget) => {
    hideResourceMenu();
    clearResourceActionError();
    try {
      const savePicker = (window as Window & {
        showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
          createWritable: () => Promise<WritableStream<Uint8Array>>;
        }>;
      }).showSaveFilePicker;

      if (!savePicker) {
        downloadResourceDirectly(target);
        return;
      }

      const handle = await savePicker.call(window, { suggestedName: target.filename });
      const response = await fetchResourceResponse(target);
      if (!response.body) throw new Error(getResourceActionFailure(target));
      const writable = await handle.createWritable();
      await response.body.pipeTo(writable);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      failResourceAction(error instanceof Error ? error.message : getResourceActionFailure(target));
    }
  }, [clearResourceActionError, downloadResourceDirectly, failResourceAction, fetchResourceResponse, getResourceActionFailure, hideResourceMenu]);

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
    } else if (saveState === "saved" || saveState === "error") {
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
        saveState === "conflict" ||
        saveState === "error"
      ) {
        return;
      }

      mutateSave();
    }, EDITOR_LOCAL_SAVE_DELAY_MS);
  }, [getMobilePlainTextValue, mutateSave, persistCurrentDraft, saveMutationPending, saveState, tagsText, title]);

  useEffect(() => {
    if (!useMobilePlainTextEditor) {
      return;
    }

    const plainTextElement = mobileTextAreaRef.current;
    if (!plainTextElement) {
      return;
    }

    const handleNativeInput = () => markMobilePlainTextDirty();
    plainTextElement.addEventListener("input", handleNativeInput);

    return () => {
      plainTextElement.removeEventListener("input", handleNativeInput);
    };
  }, [markMobilePlainTextDirty, useMobilePlainTextEditor]);

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
      saveState === "conflict" ||
      saveState === "error"
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
      markdownModeSnapshotRef.current = isMarkdownMode
        ? createMarkdownModeSnapshot(remoteMemo.id, nextContent, nextMarkdown)
        : null;
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
  }, [conflictActionPending, isMarkdownMode, onSaved, queryClient, repository, t]);

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
        <EmptyEditorHeader />
        {selectionActionBar}
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">{t("editor.loading")}</div>
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-white">
        <EmptyEditorHeader />
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
  const appendMobilePlainText = (nextText: string) => {
    const currentText = getMobilePlainTextValue();
    const nextValue = `${currentText}${currentText ? "\n" : ""}${nextText}`;
    setMobilePlainText(nextValue);
    setMobilePlainTextElementValue(mobileTextAreaRef.current, nextValue);
    markMobilePlainTextDirty();
    window.requestAnimationFrame(() => focusMobileInputTarget());
  };

  const handleMobilePromptInput = () => {
    const nextText = window.prompt(t("editor.typeInput"));
    if (!nextText) {
      focusMobileInputTarget();
      return;
    }

    appendMobilePlainText(nextText);
  };

  const handleMobileClipboardInput = async () => {
    try {
      const nextText = await navigator.clipboard?.readText();
      if (!nextText?.trim()) {
        focusMobileInputTarget();
        return;
      }

      appendMobilePlainText(nextText);
    } catch {
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
        <EditorNoteLinkPicker
          query={noteLinkQuery}
          isLoading={noteLinkResultsQuery.isLoading}
          memos={noteLinkResultsQuery.data?.memos ?? []}
          currentMemoId={memo.id}
          onQueryChange={setNoteLinkQuery}
          onClose={() => setNoteLinkPickerOpen(false)}
          onInsert={insertMemoLink}
        />
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
              {updatedLabel}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isMemoShared && (
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                type="button"
                title={t("sharing.manage")}
                aria-label={t("sharing.manage")}
                disabled={effectiveReadOnly}
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
            {!effectiveReadOnly && (
              <IconTooltip label={`${t("aiAssistant.open")} (${formatShortcutBinding(shortcutSettings.openAiAssistant)})`}>
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
                    disabled={!editor || useMobilePlainTextEditor || wechatCopyState === "copying"}
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
            <GitHubRepositoryLink className="hidden h-8 w-8 justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 min-[1600px]:inline-flex" iconClassName="h-5 w-5" />
            <IconTooltip label={t("systemInfo.title")}>
              <Button className="relative hidden h-8 w-8 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-500/70 min-[1600px]:inline-flex" size="icon" variant="ghost" aria-label={t("systemInfo.title")} onClick={() => setSystemInfoOpen(true)}>
                <Info className="h-5 w-5" strokeWidth={2.25} />
                {deployedUpdateUnseen ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-white" /> : null}
              </Button>
            </IconTooltip>
            {companionDiscoveryHub}
            <ExecutionCenterButton className="h-8 w-8" onClick={onOpenExecutionCenter} />
            <ThemeToggle />
            {!effectiveReadOnly && (
              <IconTooltip label={t("editor.save")}>
                <Button
                  className={cn(
                    "hidden h-8 w-8 transition-colors sm:inline-flex",
                    hasUnsavedChanges
                      ? "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-300"
                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-slate-300"
                  )}
                  size="icon"
                  variant="ghost"
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
                {!effectiveReadOnly && (
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
                  disabled={effectiveReadOnly}
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
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none min-[1600px]:hidden"
                  onClick={() => setSystemInfoOpen(true)}
                >
                  <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                    <Info className="h-4 w-4 text-slate-500" />
                    {deployedUpdateUnseen ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-white" /> : null}
                  </span>
                  {t("systemInfo.title")}
                </DropdownMenuItem>
                {!effectiveReadOnly && (
                  <DropdownMenuItem
                    className={cn(
                      "flex h-9 w-full items-center gap-2 px-3 text-left text-sm hover:bg-slate-50 cursor-pointer outline-none",
                      isMemoShared ? "bg-emerald-50 text-emerald-800" : "text-slate-700",
                    )}
                    disabled={isLocalMemoId(memo.id)}
                    onClick={() => setShareOpen(true)}
                  >
                    <Link2 className={cn("h-4 w-4", isMemoShared ? "text-emerald-600" : "text-slate-500")} />
                    {t(isLocalMemoId(memo.id) ? "sharing.afterSync" : isMemoShared ? "sharing.manage" : "sharing.action")}
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
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={handleOpenImageShare}
                >
                  <Share2 className="h-4 w-4 text-slate-500" />
                  {t("editor.imageShare.action")}
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
                      disabled={effectiveReadOnly}
                    >
                      <Pencil className="h-4 w-4 text-slate-500" />
                      {t("templates.saveAsTemplate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                      onClick={() => void onDeleted(memo.id)}
                      disabled={effectiveReadOnly}
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

        <div className="space-y-1.5 px-4 pb-2.5 pt-2.5 sm:space-y-3 sm:px-7 sm:pb-4 sm:pt-4 lg:space-y-0 lg:pb-0.5 lg:pt-1.5">
          <input
            value={title}
            readOnly={effectiveReadOnly}
            onChange={(event) => {
              setTitle(event.target.value);
              persistCurrentDraft(event.target.value, tagsText, getMobilePlainTextValue());
              markDirty();
            }}
            className="block w-full rounded-md border-0 bg-transparent text-xl font-bold leading-snug text-slate-950 outline-none transition placeholder:text-slate-300 focus-visible:bg-muted focus-visible:shadow-[inset_3px_0_0_var(--brand-green)] sm:text-2xl lg:text-[26px]"
            placeholder={t("common.untitledMemo")}
          />
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              className="flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md border border-transparent bg-transparent px-1.5 text-xs font-medium text-slate-600 outline-none transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/20 disabled:opacity-50 sm:hidden"
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
            {!readOnly && (
              <IconTooltip label={`${t(desktopReadingProtection ? "editor.disableReadingProtection" : "editor.enableReadingProtection")} (${formatShortcutBinding(shortcutSettings.toggleReadingProtection)})`}>
                <Button
                  className={cn(
                    "hidden shrink-0 sm:inline-flex",
                    desktopReadingProtection && "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-200 hover:text-slate-900"
                  )}
                  size="icon"
                  variant={desktopReadingProtection ? "soft" : "ghost"}
                  aria-label={`${t(desktopReadingProtection ? "editor.disableReadingProtection" : "editor.enableReadingProtection")} (${formatShortcutBinding(shortcutSettings.toggleReadingProtection)})`}
                  aria-pressed={desktopReadingProtection}
                  onClick={toggleDesktopReadingProtection}
                >
                  {desktopReadingProtection ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                </Button>
              </IconTooltip>
            )}
          </div>
        </div>
        {noteSearchOpen ? (
          <EditorNoteSearchBar
            inputRef={noteSearchInputRef}
            query={noteSearchQuery}
            replacement={noteSearchReplacement}
            replaceOpen={noteSearchReplaceOpen}
            readOnly={effectiveReadOnly}
            matchCount={noteSearchMatches.length}
            matchLabel={noteSearchMatchLabel}
            onQueryChange={setNoteSearchQuery}
            onReplacementChange={setNoteSearchReplacement}
            onMoveMatch={moveNoteSearchMatch}
            onReplaceAll={replaceAllNoteSearchMatches}
            onClose={closeNoteSearch}
          />
        ) : null}
        {(!isMobileViewport || (mobileToolbarOpen && !useMobilePlainTextEditor)) && (
          <EditorToolbar
            editor={editor}
            readOnly={effectiveReadOnly}
            markdownMode={useMarkdownSourceEditor}
            onMarkdownModeChange={handleMarkdownModeChange}
            markdownModeShortcut={shortcutSettings.toggleEditorMode}
            onPickAttachment={() => fileInputRef.current?.click()}
            onPickExternalLink={openExternalLinkDialog}
            externalLinkActive={externalLinkActive}
            onPickNoteLink={() => setNoteLinkPickerOpen(true)}
          />
        )}
        <EditorSaveRecoveryBanner
          saveState={saveState}
          conflictReason={saveConflictReason}
          storageSaveError={storageSaveError}
          savePending={saveMutationPending}
          actionPending={conflictActionPending}
          actionMessage={conflictActionMessage}
          onAdoptCloud={handleAdoptCloudAndReload}
          onCopyDraft={handleCopyLocalDraft}
          onRetry={mutateSave}
        />
      </header>

      <div
        ref={setEditorScrollContainerRef}
        data-editor-theme={
          editorTheme === "default" ||
          editorTheme === "minimal-emerald" ||
          editorTheme === "outline-emerald" ||
          editorTheme === "wechat-green" ||
          editorTheme === "modern-mint" ||
          editorTheme === "marxico"
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
          editorTheme !== "modern-mint" &&
          editorTheme !== "marxico"
            ? {
                "--editor-theme-light-bg": customEditorTheme.light.background,
                "--editor-theme-light-text": customEditorTheme.light.text,
                "--editor-theme-light-muted": customEditorTheme.light.muted,
                "--editor-theme-light-heading": customEditorTheme.light.heading,
                "--editor-theme-light-accent": customEditorTheme.light.accent,
                "--editor-theme-light-soft": customEditorTheme.light.soft,
                "--editor-theme-light-code-bg": customEditorTheme.light.codeBackground,
                "--editor-theme-light-border": customEditorTheme.light.border,
                "--editor-theme-dark-bg": customEditorTheme.dark.background,
                "--editor-theme-dark-text": customEditorTheme.dark.text,
                "--editor-theme-dark-muted": customEditorTheme.dark.muted,
                "--editor-theme-dark-heading": customEditorTheme.dark.heading,
                "--editor-theme-dark-accent": customEditorTheme.dark.accent,
                "--editor-theme-dark-soft": customEditorTheme.dark.soft,
                "--editor-theme-dark-code-bg": customEditorTheme.dark.codeBackground,
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
          editorTheme !== "marxico" &&
          customEditorTheme.customCss && (
            <style
              data-theme-custom-css
              data-original-css={customEditorTheme.customCss}
              dangerouslySetInnerHTML={{ __html: sanitizeAndScopeCss(customEditorTheme.customCss) }}
            />
          )}
        <div
          onClickCapture={
            !useMobilePlainTextEditor && !useMarkdownSourceEditor
              ? handleEditorClickCapture
              : undefined
          }
          className={cn(
            "flex gap-8 transition-all duration-200",
            useMarkdownSourceEditor
              ? "h-full min-h-0 flex-1 items-stretch px-0 py-0"
              : "min-h-full items-start px-4 py-2 sm:px-7 lg:px-10",
            desktopFocusMode
              ? "mx-auto w-full max-w-[1400px] justify-center"
              : editorContentAlignment === "center"
                ? "w-full justify-center"
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
              <div className="relative min-h-0 flex-1">
                <Suspense fallback={<div className="h-full w-full" />}>
                  <MarkdownSourceEditor
                    ref={markdownSourceEditorRef}
                    value={markdownSource}
                    onChange={handleMarkdownSourceChange}
                    themeName={markdownTheme}
                    readOnly={effectiveReadOnly}
                    placeholder={`# ${t("editor.placeholder")}`}
                    ariaLabel={t("editor.markdownSourceAria")}
                    onSlashCommandTrigger={() => {
                      openAiAssistant();
                    }}
                    onLinkShortcut={openExternalLinkDialog}
                    className="absolute inset-0 h-full w-full"
                  />
                </Suspense>
              </div>
            ) : (
              <div
                onMouseOver={handleEditorMouseOver}
                onMouseOut={handleEditorMouseOut}
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
              shortcutLabel={formatShortcutBinding(shortcutSettings.toggleOutline)}
              onCollapsedChange={handleEditorOutlineCollapsedChange}
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

      <ImageViewer
        alt={imagePreview?.alt ?? ""}
        closeLabel={t("editor.closeImagePreview")}
        open={Boolean(imagePreview)}
        src={imagePreview?.url ?? ""}
        viewerLabel={t("editor.imageViewer")}
        zoomInLabel={t("editor.imageZoomIn")}
        zoomOutLabel={t("editor.imageZoomOut")}
        onClose={() => setImagePreview(null)}
      />

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

      <EditorResourceDialogs
        dialog={resourceDialog}
        labels={resourceDialogLabels}
        filename={resourceFilename}
        pending={resourceActionPending}
        error={resourceActionError}
        onFilenameChange={setResourceFilename}
        onClose={closeResourceDialog}
        onRename={handleResourceRename}
        onDelete={handleResourceDelete}
      />

      {memoIdCopyNotice && (
        <ClipboardCopyNotice status={memoIdCopyNotice.status}>
          {t(memoIdCopyNotice.status === "copied" ? "editor.noteIdCopied" : "editor.noteIdCopyFailed", { id: memoIdCopyNotice.id })}
        </ClipboardCopyNotice>
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
        anchor={aiAssistantAnchor}
        title={title}
        contentMarkdown={currentMarkdownForAi}
        selectionMarkdown={aiSelection?.contentMarkdown}
        onOpenChange={handleAiAssistantOpenChange}
        onApply={applyAiDraft}
        onOpenPromptLibrary={onOpenAiPrompts}
      />

      <ShareMemoDialog memoId={memo.id} open={shareOpen} onOpenChange={setShareOpen} />

      {imageShareSource && (
        <ShareNoteImageDialog
          open={imageShareOpen}
          source={imageShareSource}
          onOpenChange={setImageShareOpen}
        />
      )}

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
