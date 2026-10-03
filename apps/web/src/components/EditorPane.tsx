import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, lazy, Suspense, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Placeholder from "@tiptap/extension-placeholder";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import "katex/dist/katex.min.css";
import {
  ChevronLeft,
  History,
  RotateCcw,
  Trash2,
  Tags,
  ReplaceAll,
  Paperclip,
  Pencil,
  Sparkles,
  Type,
  X,
  Check,
  CircleAlert,
  LoaderCircle,
  FileDown,
  FileCode2,
  Printer,
  Image as ImageIcon,
  Share2,
  Copy,
  Lock,
  LockOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import { WeChatCopyProgress } from "@/components/WeChatCopyProgress";
import { MemoEditorHeaderActions } from "@/components/MemoEditorHeaderActions";
import { MemoEditorMetadataRow } from "@/components/MemoEditorMetadataRow";
import { MemoEditorFocusModeButton, MemoEditorTopRowLeading } from "@/components/MemoEditorTopRowLeading";
import { MemoEditorToolbarDivider } from "@/components/MemoEditorToolbarChrome";
import {
  MEMO_EDITOR_METADATA_ROW_CLASS_NAME,
  MEMO_EDITOR_READING_GUTTER_CLASS_NAME,
  MEMO_EDITOR_READING_GUTTER_PROPERTIES_CLASS_NAME,
  MEMO_EDITOR_TOP_ROW_CLASS_NAME,
  nextTitleStatusClearance,
} from "@/components/MemoEditorChromeDensity";
import { MemoTitleInput } from "@/components/MemoTitleInput";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EditorToolbar } from "./EditorToolbar";
import { EditorOutline } from "./EditorOutline";
import { SelectionAiActions } from "./editor/SelectionAiActions";
import { useAiBubbleMenu } from "./editor/useAiBubbleMenu";
import {
  createEditorInstanceMemoIdentity,
  isEditorInstanceHydratedForMemo,
  reconcileEditorInstanceMemoIdentity,
  remapEditorInstanceMemoIdentity,
} from "./editor/editor-instance-identity";
import {
  isMarkdownSourceUnchanged,
  resolveMarkdownModeContent,
} from "./editor/editor-mode-content";
import { useEditorMarkdownMode } from "./editor/useEditorMarkdownMode";
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
import { useMarkdownTheme } from "./ThemeProvider";
const MarkdownSourceEditor = lazy(() =>
  import("./editor/MarkdownSourceEditor").then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);
import { sanitizeAndScopeCss } from "@/lib/css-sandbox";
import { RevisionHistoryDialog } from "./dialogs/RevisionHistoryDialog";
import { ExternalLinkDialog } from "./dialogs/ExternalLinkDialog";
import { MathFormulaDialog } from "./dialogs/MathFormulaDialog";
import { EditorBlockDragHandle } from "./editor/EditorBlockDragHandle";
import {
  applyMathFormula,
  deleteMathFormula,
  resolveMathFormulaTarget,
  selectedTextAsLatex,
  type MathFormulaDraft,
} from "./editor/math-formula";
import { memoShareQueryKey, ShareMemoDialog } from "./dialogs/ShareMemoDialog";
import { ShareNoteImageDialog } from "./dialogs/ShareNoteImageDialog";
import { AiSidebar, readAiSidebarOpen, readAiSidebarWidth, writeAiSidebarOpen } from "./ai-sidebar/AiSidebar";
import { AiSidebarErrorBoundary } from "./ai-sidebar/AiSidebarErrorBoundary";
import { api } from "@/lib/api";
import { isDesktopResourceRuntime, stageDesktopResource, toDesktopResourceDownloadUrl, toDesktopResourceUrl } from "@/lib/desktop-resources";
import { contentReferencesStagedResourceUrl, findMatchingMemoResource, repairMemoStagedResourceUrls, repairTiptapStagedResourceUrls } from "@/lib/staged-resource-repair";
import { cn, parseTagsText } from "@/lib/utils";
import { editorContentColumnMaxWidth, type EditorContentWidth } from "@/lib/editor-content-width";
import {
  EDITOR_ARTICLE_ROW_GAP_PX,
  EDITOR_COMPACT_READING_GUTTER,
  EDITOR_PANE_TIGHT_PX,
  shouldCompactEditorReadingGutter,
} from "@/lib/editor-reading-gutter";
import { EDITOR_OUTLINE_WIDTH } from "@/lib/workspace-ui";
import {
  countMemoCharacters,
  createEdgeEverDocumentExtensions,
  docToMarkdown,
  MEMO_CONTENT_STYLE,
  noteProseCssVariables,
  markdownToDoc,
  normalizeImageGalleries,
  PLUGIN_EMBED_NODE_TYPE,
  pluginEmbedToMarkdown,
  wrapDetailsContentHtml,
  isPdfAttachment,
  resolveMemoContentDoc,
  type Notebook,
  type ResolvedNoteProse,
  type MemoDetail,
  type MemoSummary,
  type MemoEditSession,
  type TiptapDoc,
  createMemoLinkHref,
  getAiDocumentFingerprint,
  isAiSelectionSnapshotCurrent,
  parseMemoLinkHref,
} from "@edgeever/shared";
import { NEW_IMAGE_WIDTH_PERCENT } from "@edgeever/shared/image-display";
import { EdgeEverLink } from "@edgeever/shared/editor-link";
import { createEdgeEverMathematics } from "@edgeever/shared/mathematics";
import { codeBlockLowlight, EdgeEverCodeBlock } from "@/lib/code-block";
import { compressImageForUpload } from "@/lib/image-compression";
import { LOCAL_DATABASE_INTERRUPTED_EVENT, localDb, selectNewestLocalDraft, type MemoUpdateSyncPayload } from "@/lib/local-db";
import { persistEmergencyDraft, readEmergencyDraft, removeEmergencyDraft } from "@/lib/emergency-draft";
import { getMemoUpdateQueueId, isMemoUpdateAlreadyApplied, queueMemoUpdate } from "@/lib/sync-queue";
import {
  getMemoSaveConflictInfoFromQueueItem,
} from "@/lib/memo-save-conflict";
import { copyTextToClipboard } from "@/lib/clipboard";
import { createClientUuid } from "@/lib/client-id";
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
  readEditorPhonePreviewPreference,
  writeDesktopReadingProtectionPreference,
  writeEditorOutlineCollapsedPreference,
  writeEditorPhonePreviewPreference,
  type MemoDocumentActionRequest,
  type ShortcutSettings,
} from "@/lib/app-helpers";
import { ThemeBlock } from "./ThemeBlock";
import { EditorPhonePreview, PhonePreviewGlyph } from "./EditorPhonePreview";
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
import { createFileBatchQueue, processFileUploadBatch } from "@/lib/file-batch";
import { resourceToMarkdown } from "@/lib/markdown-resource-paste";
import { MEMO_ID_REMAPPED_EVENT, MEMO_SYNC_ACKNOWLEDGED_EVENT } from "@/lib/sync-events";
import { useStandaloneMobileEditor } from "@/hooks/useStandaloneMobileEditor";
import { statusSettleMotion } from "@/lib/motion";
import {
  getRichTextAiSelectionContext,
  getRichTextAiSelectionReplacement,
} from "@/lib/ai-selection-replacement";
import {
  AI_SELECTION_MENU_CHANGED_EVENT,
  readAiSelectionMenuPreference,
} from "@/lib/ai-selection-menu-preference";
import {
  clipSelectionForSend,
  translationReplacement,
  type SelectionAiPin,
  type SelectionAiRequest,
} from "@/lib/selection-ai";
import { getAttachmentResourceId } from "@/lib/attachment-links";
import {
  getAttachmentHoverTarget,
  getAttachmentLinkFromEventTarget,
  isInsideAttachmentHoverRegion,
  resolveAttachmentMenuFilename,
} from "./editor/attachment-resource-menu";
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
import { createInlineFieldExtension } from "./editor/InlineField";
import { createPluginEmbedExtension } from "./editor/PluginEmbed";
import { useEditorDocumentActions } from "./editor/useEditorDocumentActions";
import { useEditorSaveStatus } from "./editor/useEditorSaveStatus";
import { getEditorSaveChrome } from "./editor/editor-save-chrome";
import { classifyEditorSaveFailure, shouldLeaveEditorAfterSaveError } from "./editor/editor-save-failure";
import { useEditorSaveConflictActions } from "./editor/useEditorSaveConflictActions";
import { useEditorNoteSearchController } from "./editor/useEditorNoteSearchController";
import { EditorNoteLinkPicker } from "./editor/EditorNoteLinkPicker";
import { EditorResourceDialogs } from "./editor/EditorResourceDialogs";
import { EditorNoteSearchBar } from "./editor/EditorNoteSearchBar";
import { EditorSaveRecoveryBanner } from "./editor/EditorSaveRecoveryBanner";
import {
  EmptyEditorHeader,
  IconTooltip,
  NoteLinkInteractionHint,
  ResourceActionMenu,
  type NoteLinkHintPosition,
} from "./editor/EditorPaneChrome";
import {
  getWritableEditorMemoFields,
  resolveEditorDraftState,
  shouldReplaceEditorDocument,
  type EditorMemoFields,
} from "./editor/editor-draft-state";
import {
  pendingEditorInsertMatchesMemo,
  shouldInsertPendingEditorFiles,
  usablePendingInsertFiles,
} from "./editor/editor-pending-insert";
import type { EdgeEverPluginHost, PluginEditorAdapter } from "@/lib/plugins/plugin-host";
import {
  useEditorResourceActions,
  type AttachmentMenuTarget,
  type ResourceDialogState,
  type ResourceMenuTarget,
} from "./editor/useEditorResourceActions";
import { removeAttachmentAt, renameAttachmentAt } from "./editor/attachment-editor-range";
import {
  createLocalEditSession,
  focusMobilePlainTextElement,
  getEditorNavigableLinkFromEventTarget,
  getMobilePlainTextElementValue,
  getNoteLinkFromEventTarget,
  getNoteLinkHintPosition,
  getResourceFilesFromDataTransfer,
  shouldInsertDroppedResourceFiles,
  isCreatedMemoEditorFocused,
  isEditorReady,
  MemoSaveRequestError,
  releaseEditorMedia,
  resetEditorDocument,
  shouldRetryCreatedMemoFocus,
  MOBILE_DRAFT_PERSIST_DELAY_MS,
  MOBILE_EDITOR_QUERY,
  requiresLocalEditSession,
  setMobilePlainTextElementValue,
  SUPPORTED_PASTE_IMAGE_TYPES,
  syncStatusToSaveState,
  type MobilePlainTextElement,
} from "./editor/editor-pane-helpers";

type EditorPaneProps = {
  memo: MemoDetail | null;
  repository: EdgeEverRepository;
  desktopFocusMode: boolean;
  onToggleDesktopFocusMode: () => void;
  editorContentWidth: EditorContentWidth;
  noteProse: ResolvedNoteProse;
  mobileDefaultEditMemoId: string | null;
  pendingInsertFiles?: { memoId: string; files: File[] } | null;
  onPendingInsertFilesConsumed?: () => void;
  preserveUnsavedContentFromMemoId?: string | null;
  saveBlocked?: boolean;
  isTrashView: boolean;
  notebooks: Notebook[];
  isLoading: boolean;
  contentSearchQuery?: string;
  imageCompressionEnabled: boolean;
  onBackToList: () => void;
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
  companionAvailable?: boolean;
  beforeCompanionApply?: () => Promise<void>;
  onCompanionNotesChanged?: () => Promise<void>;
  onOpenCompanionNote?: (id: string, notebookId: string) => void;
  pluginHost: EdgeEverPluginHost;
  pluginNavigationRequest?: { id: number; noteId: string; search: string } | null;
  onOpenExecutionCenter: () => void;
  demoMode?: boolean;
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
      <div className="flex h-full min-h-0 items-center justify-center bg-transparent text-sm font-medium text-slate-400">
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
  editorContentWidth,
  noteProse,
  mobileDefaultEditMemoId,
  pendingInsertFiles = null,
  onPendingInsertFilesConsumed,
  preserveUnsavedContentFromMemoId: _preserveUnsavedContentFromMemoId,
  saveBlocked: _saveBlocked = false,
  isTrashView,
  notebooks,
  isLoading,
  contentSearchQuery = "",
  imageCompressionEnabled,
  onBackToList,
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
  companionAvailable = false,
  beforeCompanionApply,
  onCompanionNotesChanged,
  onOpenCompanionNote,
  pluginHost,
  pluginNavigationRequest,
  onOpenExecutionCenter,
  demoMode = false,
  onRequestMobileNativeEdit,
}: RichEditorPaneProps) => {
  const { t, i18n } = useTranslation();
  const { markdownTheme } = useMarkdownTheme();
  const queryClient = useQueryClient();
  const resourceInsertionLimit = useMemo(createFileBatchQueue, []);
  const isSelectionMode = Boolean(selectionActionBar);
  // Keep field ownership and values in one React state update. memoRef changes
  // synchronously during hydration, before a new title/tags render can commit.
  const [memoFields, setMemoFields] = useState<EditorMemoFields>({ memoId: null, title: "", tagsText: "" });
  const { memoId: fieldsMemoId, title, tagsText } = memoFields;
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
  const [aiAssistantOpen, setAiAssistantOpenState] = useState(readAiSidebarOpen);
  const setAiSidebarOpen = useCallback((open: boolean) => {
    setAiAssistantOpenState(open);
    writeAiSidebarOpen(open);
  }, []);
  const aiBubbleMenu = useAiBubbleMenu();
  const [selectionPin, setSelectionPin] = useState<SelectionAiPin | null>(null);
  const [selectionRequest, setSelectionRequest] = useState<SelectionAiRequest | null>(null);
  const selectionPinRef = useRef<SelectionAiPin | null>(null);
  selectionPinRef.current = selectionPin;
  const markdownMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const [markdownAiMenu, setMarkdownAiMenu] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const [mobileNotebookSheetOpen, setMobileNotebookSheetOpen] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const handledPluginNavigationRequestRef = useRef(0);
  const openNoteSearchFromSelectionRef = useRef<(text: string, showReplace?: boolean) => void>(() => undefined);
  const closeNoteReplaceRef = useRef<() => void>(() => undefined);
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
  const [mathFormulaOpen, setMathFormulaOpen] = useState(false);
  const [mathFormulaDraft, setMathFormulaDraft] = useState<MathFormulaDraft | null>(null);
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
  const [isDesktopColumn, setIsDesktopColumn] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 1024px)").matches
  );
  const [isMobileEditing, setIsMobileEditing] = useState(false);
  const [desktopReadingProtection, setDesktopReadingProtection] = useState(readDesktopReadingProtectionPreference);
  const [mobilePlainText, setMobilePlainText] = useState("");
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [editorOutlineCollapsed, setEditorOutlineCollapsed] = useState(() =>
    readEditorOutlineCollapsedPreference({ defaultCollapsed: !demoMode })
  );
  const editorColumnRef = useRef<HTMLDivElement>(null);
  // Projected editor-column width. While the sidebar is opening, its width is
  // still animating, so reserve it immediately or the outline and the 6rem
  // gutters keep crushing the article for the whole slide.
  const [editorColumnWidth, setEditorColumnWidth] = useState(0);
  useLayoutEffect(() => {
    const node = editorColumnRef.current;
    if (!node) return;
    const update = () => {
      const column = node.getBoundingClientRect().width;
      const parent = node.parentElement?.getBoundingClientRect().width ?? column;
      const projected = aiAssistantOpen ? Math.max(0, parent - readAiSidebarWidth()) : column;
      setEditorColumnWidth((current) => (Math.abs(current - projected) < 0.5 ? current : projected));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [aiAssistantOpen, isLoading, memo?.id]);
  const [phonePreviewOpen, setPhonePreviewOpen] = useState(readEditorPhonePreviewPreference);
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
  const [editorScrollbarGutter, setEditorScrollbarGutter] = useState(0);
  const [headerTitleSlot, setHeaderTitleSlot] = useState<HTMLDivElement | null>(null);
  const [headerStatusCluster, setHeaderStatusCluster] = useState<HTMLDivElement | null>(null);
  const [titleStatusClearancePx, setTitleStatusClearancePx] = useState(0);
  useLayoutEffect(() => {
    const element = editorScrollContainer;
    if (!element) return;
    const measure = () => {
      const reserved = element.offsetWidth - element.clientWidth;
      setEditorScrollbarGutter(reserved > 1 ? reserved / 2 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [editorScrollContainer]);
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

  const handlePhonePreviewChange = useCallback((open: boolean) => {
    setPhonePreviewOpen(open);
    writeEditorPhonePreviewPreference(open);
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
    setAiSidebarOpen(false);
    closeNoteReplaceRef.current();
    setExternalLinkDialogOpen(false);
    setMathFormulaOpen(false);
    setNoteLinkPickerOpen(false);
  }, [desktopReadingProtection, setAiSidebarOpen]);

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
  const openExternalLinkDialogRef = useRef<() => void>(() => undefined);
  const openMathFormulaRef = useRef<(kind?: "inline" | "block", range?: { from: number; to: number }) => void>(() => undefined);
  const mathFormulaDraftRef = useRef<MathFormulaDraft | null>(null);
  const mathClickRef = useRef<(node: { attrs: Record<string, unknown> }, pos: number, kind: "inline" | "block") => void>(() => undefined);
  const mathematicsExtensionsRef = useRef(createEdgeEverMathematics({
    onInlineClick: (node, pos) => mathClickRef.current(node, pos, "inline"),
    onBlockClick: (node, pos) => mathClickRef.current(node, pos, "block"),
  }));
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
      "heading-4": "",
      "heading-5": "",
      "heading-6": "",
      "bullet-list": "",
      "ordered-list": "",
      "task-list": "",
      blockquote: "",
      "code-block": "",
      divider: "",
      fold: "",
      table: "",
      "inline-math": "",
      "block-math": "",
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
      "heading-4": t("editorToolbar.heading4"),
      "heading-5": t("editorToolbar.heading5"),
      "heading-6": t("editorToolbar.heading6"),
      "bullet-list": t("editorToolbar.bulletList"),
      "ordered-list": t("editorToolbar.orderedList"),
      "task-list": t("editorToolbar.taskList"),
      blockquote: t("editorToolbar.quote"),
      "code-block": t("editorToolbar.codeBlock"),
      divider: t("editorToolbar.horizontalRule"),
      fold: t("editorToolbar.fold"),
      table: t("editorToolbar.table"),
      "inline-math": t("editorToolbar.math"),
      "block-math": t("editorToolbar.blockMath"),
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
      openMathFormula: (kind, range) => openMathFormulaRef.current(kind, range),
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
      setMemoFields((fields) => fields.memoId === previousMemoId
        ? { ...fields, memoId: nextMemoId }
        : fields);
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
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateDesktopColumn = () => setIsDesktopColumn(mediaQuery.matches);
    updateDesktopColumn();
    mediaQuery.addEventListener("change", updateDesktopColumn);
    return () => mediaQuery.removeEventListener("change", updateDesktopColumn);
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
            const hydratedForMemo = isEditorInstanceHydratedForMemo(
              editorInstanceMemoIdentityRef.current,
              hydratedMemoIdRef.current,
              memo.id,
            );
            if (isEditorReady(currentEditor) && hydratedForMemo && currentEditor.isEditable) {
              currentEditor.commands.focus("end");
            }

            if (shouldRetryCreatedMemoFocus({
              attempt,
              editorEditable: Boolean(currentEditor?.isEditable),
              editorFocused: isCreatedMemoEditorFocused(currentEditor),
              editorReady: isEditorReady(currentEditor),
              hydratedForMemo,
            })) {
              focusWhenReady(attempt + 1);
              return;
            }

            // Consuming the create request updates the parent and can
            // briefly blur the editor during that rerender. Desktop sync
            // remapping can also change the memo id before this timeout.
            window.setTimeout(() => {
              if (cancelled) {
                return;
              }

              const activeMemoId = memoRef.current?.id;
              if (
                !activeMemoId
                || !editorInstanceMemoIdentityRef.current.aliases.has(activeMemoId)
                || !editorInstanceMemoIdentityRef.current.aliases.has(memo.id)
              ) {
                return;
              }

              const activeEditor = editorRef.current;
              if (isEditorReady(activeEditor) && activeEditor.isEditable) {
                activeEditor.commands.focus("end");
              }
            }, 0);
            return;
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

  const uploadEditorResource = useCallback(async (targetMemoId: string, uploadFile: File, isImage: boolean) => {
    try {
      const resource = (await repository.uploadMemoResource(targetMemoId, uploadFile)).resource;
      return { ...resource, url: toDesktopResourceUrl(resource.url) };
    } catch (error) {
      if (!isDesktopResourceRuntime()) throw error;
      const listed = await repository.listResources().catch(() => ({ resources: [] as Array<{ memoId?: string; url: string; filename?: string | null; kind?: string | null; mimeType?: string | null; byteSize?: number }> }));
      const existing = findMatchingMemoResource(
        listed.resources.filter((item) => item.memoId === targetMemoId),
        uploadFile.name,
        isImage ? "image" : "attachment",
      );
      if (existing) {
        return {
          kind: isImage ? "image" as const : "attachment" as const,
          filename: existing.filename || uploadFile.name,
          mimeType: existing.mimeType || uploadFile.type || null,
          byteSize: existing.byteSize ?? uploadFile.size,
          url: toDesktopResourceUrl(existing.url),
        };
      }
      const staged = await stageDesktopResource(targetMemoId, uploadFile);
      if (!staged) throw error;
      return {
        kind: isImage ? "image" as const : "attachment" as const,
        filename: uploadFile.name,
        mimeType: uploadFile.type || null,
        byteSize: uploadFile.size,
        url: `edgeever-staged://${staged.id}`,
      };
    }
  }, [repository]);

  const insertResourceFiles = useCallback((files: File[]) => {
    const currentMemo = memoRef.current;
    const currentEditor = editorRef.current;

    if (!currentMemo || currentMemo.isDeleted || !currentEditor || !currentEditor.isEditable || files.length === 0) {
      return false;
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
        const resource = await uploadEditorResource(targetMemoId, uploadFile, isImage);
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
              width: NEW_IMAGE_WIDTH_PERCENT,
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
    return true;
  }, [queryClient, resourceInsertionLimit, t, uploadEditorResource]);

  const pluginEmbedExtension = useMemo(() => createPluginEmbedExtension(pluginHost), [pluginHost]);
  const inlineFieldExtension = useMemo(() => createInlineFieldExtension(i18n.language), [i18n.language]);
  const editor = useEditor({
    extensions: [
      ...createEdgeEverDocumentExtensions({
        mathematics: mathematicsExtensionsRef.current,
        starterKit: {
          codeBlock: false,
          link: false,
          dropcursor: { color: "#16A06E", width: 2 },
        },
        image: false,
        gallery: EditableImageGallery,
        pdf: PdfAttachment,
        file: FileAttachment,
        pluginEmbed: pluginEmbedExtension,
        table: { table: { renderWrapper: true } },
      }),
      EdgeEverLink.configure({ openOnClick: false }),
      inlineFieldExtension,
      EdgeEverCodeBlock.configure({ lowlight: codeBlockLowlight, defaultLanguage: "plaintext" }),
      ThemeBlock,
      ResizableImage.configure({
        allowBase64: false,
        inline: false,
      }),
      ImageUploadPlaceholderExtension,
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
        class: "edgeever-note-rich-editor prose prose-slate max-w-none focus:outline-none min-h-[240px] lg:min-h-[180px]",
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
        openNoteSearchFromSelectionRef.current(selectedText, shortcutKey === "h");
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
      transformPastedHTML: (html) => wrapDetailsContentHtml(html),
      handlePaste: (_view, event) => {
        const files = getResourceFilesFromDataTransfer(event.clipboardData);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();
        insertResourceFiles(files);
        return true;
      },
      handleDrop: (view, event) => {
        if (!shouldInsertDroppedResourceFiles({
          dataTransfer: event.dataTransfer,
          isInternalNodeDrag: Boolean(view.dragging),
        })) {
          return false;
        }

        event.preventDefault();
        insertResourceFiles(getResourceFilesFromDataTransfer(event.dataTransfer));
        return true;
      },
    },
  }, [
    // Keep one TipTap view for the pane lifetime. A newly created memo already
    // reuses this instance across local→durable id remaps; switching notes now
    // also reuses it and resets undo history via resetEditorDocument.
  ]);

  const {
    clearMarkdownSnapshot,
    handleMarkdownModeChange,
    hydrateMarkdownSource,
    isMarkdownMode,
    markdownModeSnapshotRef,
    markdownSource,
    markdownSourceEditorRef,
    resetMarkdownMode,
    setMarkdownSource,
  } = useEditorMarkdownMode({
    editor,
    editorScrollContainerRef,
    // Reading protection is a view, so it must not block switching back to rich text or Markdown.
    effectiveReadOnly: readOnly || (isMobileViewport && !mobileEditingActive),
    getMemoId: () => memoRef.current?.id,
    hydratingRef,
  });
  const useMarkdownSourceEditor = !useMobilePlainTextEditor && isMarkdownMode;

  const uploadMarkdownPasteFiles = useCallback(async (files: File[]) => {
    const targetMemoId = memoRef.current?.id;
    if (!targetMemoId || effectiveReadOnly) return "";
    setImageUploadState("uploading");
    const results = await processFileUploadBatch(files, async (file) => {
      const shouldCompress = SUPPORTED_PASTE_IMAGE_TYPES.has(file.type) && imageCompressionEnabledRef.current;
      if (!shouldCompress) return file;
      setImageUploadState("compressing");
      return (await compressImageForUpload(file)).file;
    }, async (uploadFile, file) => {
      if (memoRef.current?.id !== targetMemoId) throw new Error("The active note changed during upload");
      setImageUploadState("uploading");
      return uploadEditorResource(targetMemoId, uploadFile, SUPPORTED_PASTE_IMAGE_TYPES.has(file.type));
    });
    if (results.some((result) => result.status === "fulfilled")) {
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
    }
    const failed = results.some((result) => result.status === "rejected");
    setImageUploadState(failed ? "error" : "idle");
    if (failed) window.setTimeout(() => setImageUploadState("idle"), 2200);
    return results
      .filter((result) => result.status === "fulfilled")
      .map((result) => resourceToMarkdown(result.value, result.file.name))
      .join("\n\n");
  }, [effectiveReadOnly, queryClient, uploadEditorResource]);

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

  const openMathFormula = useCallback((kind: "inline" | "block" = "inline", range?: { from: number; to: number }) => {
    if (effectiveReadOnly || !isEditorReady(editor) || useMarkdownSourceEditor || useMobilePlainTextEditor) {
      return;
    }

    if (!range) {
      const existing = resolveMathFormulaTarget(editor);
      if (existing) {
        mathFormulaDraftRef.current = existing;
        setMathFormulaDraft(existing);
        setMathFormulaOpen(true);
        return;
      }
    }

    const from = range?.from ?? editor.state.selection.from;
    const to = range?.to ?? editor.state.selection.to;
    const draft: MathFormulaDraft = {
      kind,
      latex: range ? "" : selectedTextAsLatex(editor),
      from,
      to,
    };
    mathFormulaDraftRef.current = draft;
    setMathFormulaDraft(draft);
    setMathFormulaOpen(true);
  }, [editor, effectiveReadOnly, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  openMathFormulaRef.current = openMathFormula;
  mathClickRef.current = (_node, pos, kind) => {
    if (effectiveReadOnly || !isEditorReady(editor) || useMarkdownSourceEditor || useMobilePlainTextEditor) {
      return;
    }
    const existing = resolveMathFormulaTarget(editor, pos) ?? {
      kind,
      latex: String(_node.attrs.latex ?? ""),
      pos,
    };
    mathFormulaDraftRef.current = existing;
    setMathFormulaDraft(existing);
    setMathFormulaOpen(true);
  };

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
    const hover = getAttachmentHoverTarget(target);
    if (!hover) return false;

    const href = hover.link.getAttribute("href") || "";
    cancelResourceMenuHide();
    setNoteLinkHintPosition(null);
    showResourceMenu({
      kind: "attachment",
      element: hover.toolbar ?? undefined,
      url: href,
      filename: resolveAttachmentMenuFilename(hover, href),
      resourceId: getAttachmentResourceId(href),
      position: hover.toolbar ? { left: 0, top: 0, placement: "above" } : getNoteLinkHintPosition(hover.link),
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
    const attachmentHover = getAttachmentHoverTarget(event.target);
    if (attachmentHover) {
      if (isInsideAttachmentHoverRegion(attachmentHover, event.relatedTarget)) return;
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
    if (!pendingInsertFiles || !pendingEditorInsertMatchesMemo(
      pendingInsertFiles,
      memo?.id,
      editorInstanceMemoIdentityRef.current.aliases,
    )) return;
    const files = usablePendingInsertFiles(pendingInsertFiles);
    if (files.length === 0) {
      onPendingInsertFilesConsumed?.();
      return;
    }
    if (!shouldInsertPendingEditorFiles({
      pendingInsertFiles,
      memoId: memo?.id,
      memoAliases: editorInstanceMemoIdentityRef.current.aliases,
      editorHydratedForMemo: editorIsHydratedForCurrentMemo,
      editorReady: isEditorReady(editor),
      readOnly: effectiveReadOnly,
    }) || !isEditorReady(editor)) return;
    // Hydration leaves the editor non-editable until a later effect calls
    // setEditable. That later effect does not re-render, so waiting on
    // editor.isEditable here would drop the screenshot forever.
    if (!editor.isEditable) editor.setEditable(true);
    if (!insertResourceFiles(files)) return;
    onPendingInsertFilesConsumed?.();
  }, [
    editor,
    editorIsHydratedForCurrentMemo,
    effectiveReadOnly,
    hydratedEditorMemoId,
    insertResourceFiles,
    memo?.id,
    onPendingInsertFilesConsumed,
    pendingInsertFiles,
  ]);

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
    closeReplace: closeNoteReplace,
    closeSearch: closeNoteSearch,
    inputRef: noteSearchInputRef,
    matchLabel: noteSearchMatchLabel,
    matches: noteSearchMatches,
    moveMatch: moveNoteSearchMatch,
    openFromSelection: openNoteSearchFromSelection,
    openReplace: openNoteReplace,
    openSearch: openNoteSearch,
    openWithQuery: openNoteSearchWithQuery,
    query: noteSearchQuery,
    replaceAllMatches: replaceAllNoteSearchMatches,
    replaceOpen: noteSearchReplaceOpen,
    replacement: noteSearchReplacement,
    searchOpen: noteSearchOpen,
    setQuery: setNoteSearchQuery,
    setReplacement: setNoteSearchReplacement,
  } = useEditorNoteSearchController({
    contentSearchQuery,
    dirtyVersion,
    editor,
    editorInstanceKey: editorInstanceMemoKey,
    editorScrollContainerRef,
    memoId: memo?.id ?? null,
    readOnly: effectiveReadOnly,
    replaceFocusToken,
    searchFocusToken,
  });
  openNoteSearchFromSelectionRef.current = openNoteSearchFromSelection;
  closeNoteReplaceRef.current = closeNoteReplace;

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
    openNoteSearchWithQuery(pluginNavigationRequest.search);
  }, [editor, hydratedEditorMemoId, memo?.id, openNoteSearchWithQuery, pluginNavigationRequest]);

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
        !getWritableEditorMemoFields(memoFields, currentMemo.id, hydratedMemoIdRef.current, hydratingRef.current) ||
        (!useMobilePlainTextEditor && !isEditorReady(currentEditor))
      ) {
        return Promise.resolve();
      }

      return localDb.drafts.put({
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
    [getMobilePlainTextValue, markdownSource, memoFields, tagsText, title, useMarkdownSourceEditor, useMobilePlainTextEditor]
  );

  const markDirty = useCallback(() => {
    const currentMemo = memoRef.current;
    if (
      hydratingRef.current ||
      currentMemo?.isDeleted ||
      !currentMemo ||
      !getWritableEditorMemoFields(memoFields, currentMemo.id, hydratedMemoIdRef.current, hydratingRef.current)
    ) {
      return;
    }

    markDirtyStatus();
  }, [markDirtyStatus, memoFields]);

  const getCurrentMarkdownForAi = useCallback(() => {
    if (useMobilePlainTextEditor) return getMobilePlainTextValue();
    if (useMarkdownSourceEditor) return markdownSource;
    return isEditorReady(editor)
      ? docToMarkdown(editor.getJSON() as TiptapDoc)
      : memoRef.current?.contentMarkdown ?? "";
  }, [editor, getMobilePlainTextValue, markdownSource, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const openAiAssistant = useCallback(() => {
    if (effectiveReadOnly) return;
    setAiSidebarOpen(true);
  }, [effectiveReadOnly, setAiSidebarOpen]);

  useEffect(() => {
    openAiAssistantRef.current = openAiAssistant;
  }, [openAiAssistant]);

  const selectionMemoIdRef = useRef(memo?.id);
  useEffect(() => {
    if (selectionMemoIdRef.current === memo?.id) return;
    selectionMemoIdRef.current = memo?.id;
    setSelectionPin((current) => !current || current.memoId === memo?.id ? current : null);
    setSelectionRequest(null);
  }, [memo?.id]);

  const requestSelectionAi = useCallback((kind: SelectionAiRequest["kind"]) => {
    if (effectiveReadOnly || useMobilePlainTextEditor) return;
    const currentMemo = memoRef.current;
    if (!currentMemo) return;
    let pin: SelectionAiPin | null = null;
    if (useMarkdownSourceEditor) {
      const sourceEditor = markdownSourceEditorRef.current;
      if (!sourceEditor) return;
      const selection = sourceEditor.getSelection();
      const text = sourceEditor.sliceText(selection.from, selection.to);
      if (!text.trim() || selection.to <= selection.from) return;
      const clipped = clipSelectionForSend(text);
      pin = {
        memoId: currentMemo.id,
        text,
        sentText: clipped.sentText,
        displayText: clipped.sentText,
        truncated: clipped.truncated,
        from: selection.from,
        to: selection.to,
        isInline: true,
        documentFingerprint: "",
        mode: "markdown",
      };
    } else if (isEditorReady(editor)) {
      const context = getRichTextAiSelectionContext(editor.state.doc, editor.state.selection);
      if (!context?.contentMarkdown.trim()) return;
      const clipped = clipSelectionForSend(context.contentMarkdown);
      const plain = editor.state.doc.textBetween(context.from, context.to, "\n");
      const visible = clipSelectionForSend(plain.trim() ? plain : context.contentMarkdown);
      pin = {
        memoId: currentMemo.id,
        text: context.contentMarkdown,
        sentText: clipped.sentText,
        displayText: visible.sentText,
        truncated: visible.truncated,
        from: context.from,
        to: context.to,
        isInline: context.isInline,
        documentFingerprint: getAiDocumentFingerprint(editor.state.doc.toJSON()),
        mode: "rich",
      };
    }
    if (!pin) return;
    setSelectionPin(pin);
    setSelectionRequest({ id: createClientUuid(), kind });
    setAiSidebarOpen(true);
  }, [editor, effectiveReadOnly, setAiSidebarOpen, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  const replacePinnedSelection = useCallback((replacement: string) => {
    const pin = selectionPinRef.current;
    const currentMemo = memoRef.current;
    if (!pin || !currentMemo || pin.memoId !== currentMemo.id) return false;
    const body = translationReplacement(replacement);
    if (!body) return false;
    if (pin.mode === "markdown") {
      const sourceEditor = markdownSourceEditorRef.current;
      if (!sourceEditor) return false;
      if (sourceEditor.sliceText(pin.from, pin.to) !== pin.text) return false;
      const next = `${sourceEditor.sliceText(0, pin.from)}${body}${sourceEditor.sliceText(pin.to, sourceEditor.getDocumentLength())}`;
      sourceEditor.insertText(body, pin.from, pin.to);
      setMarkdownSource(next);
      markDirty();
      setSelectionPin(null);
      return true;
    }
    const currentEditor = editorRef.current;
    if (!isEditorReady(currentEditor)) return false;
    const document = currentEditor.state.doc.toJSON();
    if (!isAiSelectionSnapshotCurrent(
      { from: pin.from, to: pin.to, documentFingerprint: pin.documentFingerprint },
      document,
      currentEditor.state.doc.content.size,
    )) return false;
    const content = getRichTextAiSelectionReplacement(body, pin.isInline);
    const inserted = currentEditor.chain().focus().insertContentAt({ from: pin.from, to: pin.to }, content).run();
    if (!inserted) return false;
    setSelectionPin(null);
    return true;
  }, [markDirty, setMarkdownSource]);

  const syncMarkdownAiMenu = useCallback(() => {
    if (!useMarkdownSourceEditor || effectiveReadOnly || useMobilePlainTextEditor || !readAiSelectionMenuPreference()) {
      setMarkdownAiMenu((current) => current ? null : current);
      return;
    }
    const sourceEditor = markdownSourceEditorRef.current;
    const anchor = markdownMenuAnchorRef.current;
    if (!sourceEditor || !anchor) {
      setMarkdownAiMenu((current) => current ? null : current);
      return;
    }
    const selection = sourceEditor.getSelection();
    const text = sourceEditor.sliceText(selection.from, selection.to);
    const coords = text.trim() ? sourceEditor.getSelectionCoordinates() : null;
    if (!coords) {
      setMarkdownAiMenu((current) => current ? null : current);
      return;
    }
    const bounds = anchor.getBoundingClientRect();
    const above = coords.top - bounds.top;
    const left = Math.min(
      Math.max(0, coords.left - bounds.left),
      Math.max(0, bounds.width - 196),
    );
    const next = {
      top: above < 48 ? coords.bottom - bounds.top + 8 : above,
      left,
      below: above < 48,
    };
    setMarkdownAiMenu((current) => (
      current && current.top === next.top && current.left === next.left && current.below === next.below
        ? current
        : next
    ));
  }, [effectiveReadOnly, useMarkdownSourceEditor, useMobilePlainTextEditor]);

  useEffect(() => {
    if (!useMarkdownSourceEditor) {
      setMarkdownAiMenu(null);
      return;
    }
    let scroller: HTMLElement | null = null;
    const bind = () => {
      const next = markdownSourceEditorRef.current?.getScrollContainer() ?? null;
      if (next === scroller) return;
      scroller?.removeEventListener("scroll", syncMarkdownAiMenu);
      scroller = next;
      scroller?.addEventListener("scroll", syncMarkdownAiMenu, { passive: true });
    };
    bind();
    const timer = window.setInterval(() => {
      bind();
      if (scroller) window.clearInterval(timer);
    }, 200);
    window.addEventListener("resize", syncMarkdownAiMenu);
    window.addEventListener(AI_SELECTION_MENU_CHANGED_EVENT, syncMarkdownAiMenu);
    return () => {
      window.clearInterval(timer);
      scroller?.removeEventListener("scroll", syncMarkdownAiMenu);
      window.removeEventListener("resize", syncMarkdownAiMenu);
      window.removeEventListener(AI_SELECTION_MENU_CHANGED_EVENT, syncMarkdownAiMenu);
    };
  }, [memo?.id, syncMarkdownAiMenu, useMarkdownSourceEditor]);

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
      memoId: fieldsMemoId,
      title,
      tagsText,
      contentJson,
    });
  }, [fieldsMemoId, getCurrentContentJson, tagsText, title]);

  useEffect(() => {
    const handleLocalDatabaseInterrupted = () => {
      const currentMemo = memoRef.current;
      const contentJson = getCurrentContentJson();
      if (currentMemo && contentJson && !currentMemo.isDeleted &&
        getWritableEditorMemoFields(memoFields, currentMemo.id, hydratedMemoIdRef.current, hydratingRef.current)) {
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
  }, [getCurrentContentJson, memoFields, setHasUnsavedChanges, setSaveConflictInfo, setSaveState, tagsText, title]);

  useEffect(() => {
    const currentEditor = editorRef.current;
    let cancelled = false;

    if (!memo) {
      memoRef.current = null;
      editSessionRef.current = null;
      hydratedMemoIdRef.current = null;
      appliedEditorSourceKeyRef.current = null;
      resetMarkdownMode();
      setHydratedEditorMemoId(null);
      editingMemoIdRef.current = null;
      setHasUnsavedChanges(false);
      setMemoFields({ memoId: null, title: "", tagsText: "" });
      setMobilePlainText("");
      setMobilePlainTextElementValue(mobileTextAreaRef.current, "");
      setSaveState("idle");
      setStorageSaveError(false);
      if (isEditorReady(currentEditor)) {
        releaseEditorMedia(currentEditor);
        currentEditor.commands.clearContent();
      }
      return;
    }

    const previousMemo = memoRef.current;
    const sameMemo = editingMemoIdRef.current === memo.id;

    if (!sameMemo) {
      hydratedMemoIdRef.current = null;
      editSessionRef.current = null;
      appliedEditorSourceKeyRef.current = null;
      clearMarkdownSnapshot();
      const immediateDraft = resolveEditorDraftState({ memo, draft: null, queuedUpdate: null });
      editingMemoIdRef.current = memo.id;
      setImagePreview(null);
      setHasUnsavedChanges(false);
      setSaveState("idle");
      setSaveConflictInfo(null);
      setMemoFields({ memoId: memo.id, title: immediateDraft.title, tagsText: immediateDraft.tagsText });
      setMobilePlainText(immediateDraft.contentMarkdown);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, immediateDraft.contentMarkdown);
      hydrateMarkdownSource(memo.id, immediateDraft.contentJson, immediateDraft.contentMarkdown);
      if (isEditorReady(currentEditor)) {
        try {
          resetEditorDocument(currentEditor, immediateDraft.contentJson);
        } catch (err) {
          console.error("Failed to reset TipTap document, falling back to setContent:", err);
          currentEditor.commands.setContent(immediateDraft.contentJson);
        }
      }
      appliedEditorSourceKeyRef.current = immediateDraft.sourceKey;
      hydratedMemoIdRef.current = memo.id;
      setHydratedEditorMemoId(memo.id);
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

      const queuedPayload = queuedUpdate?.kind === "memo.update"
        ? queuedUpdate.payload as MemoUpdateSyncPayload
        : null;
      if (
        isDesktopResourceRuntime()
        && (
          contentReferencesStagedResourceUrl(draft?.contentJson)
          || contentReferencesStagedResourceUrl(queuedPayload?.contentJson)
          || contentReferencesStagedResourceUrl(queuedPayload?.contentMarkdown)
        )
      ) {
        const [listed, staged] = await Promise.all([
          repository.listResources().catch(() => ({ resources: [] as Array<{ memoId?: string; url: string; filename?: string | null; kind?: string | null }> })),
          window.edgeeverDesktop?.listStagedResources?.().catch(() => []) ?? Promise.resolve([]),
        ]);
        if (cancelled) return;
        const liveStagedIds = new Set((staged ?? []).filter((item) => item.memoId === memo.id).map((item) => item.id));
        const memoResources = listed.resources.filter((resource) => resource.memoId === memo.id);
        if (draft && contentReferencesStagedResourceUrl(draft.contentJson)) {
          draft = {
            ...draft,
            contentJson: repairTiptapStagedResourceUrls(draft.contentJson, memoResources, liveStagedIds),
          };
        }
        if (queuedUpdate && queuedPayload) {
          const repairedQueue = repairMemoStagedResourceUrls({
            contentJson: queuedPayload.contentJson,
            contentMarkdown: queuedPayload.contentMarkdown,
          }, memoResources, liveStagedIds);
          queuedUpdate = {
            ...queuedUpdate,
            payload: {
              ...queuedPayload,
              contentJson: repairedQueue.contentJson ?? queuedPayload.contentJson,
              contentMarkdown: repairedQueue.contentMarkdown,
            },
          };
        }
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
      // Draft cleanup is async; the selected memo may have changed meanwhile.
      if (cancelled || editingMemoIdRef.current !== memo.id) return;
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
      const sourceAlreadyApplied = appliedEditorSourceKeyRef.current === sourceKey;

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
      setMemoFields({ memoId: memo.id, title: nextTitle, tagsText: nextTagsText });
      setMobilePlainText(nextMarkdown);
      const keptLiveMarkdown = hydrateMarkdownSource(memo.id, nextContent, nextMarkdown);
      setMobilePlainTextElementValue(mobileTextAreaRef.current, nextMarkdown);

      if (isEditorReady(currentEditor) && shouldReplaceDocument && !keptLiveMarkdown) {
        try {
          if (sameMemo) {
            currentEditor.commands.setContent(nextContent);
          } else {
            resetEditorDocument(currentEditor, nextContent);
          }
        } catch (err) {
          console.error("Failed to set TipTap contentJson, falling back to markdownToDoc:", err);
          releaseEditorMedia(currentEditor);
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

  const handleMarkdownSourceChange = useCallback((value: string) => {
    setMarkdownSource(value);
    markDirty();
  }, [markDirty]);

  const {
    handleCopyToWeChat,
    handleExportHtml,
    handleExportMarkdown,
    handleExportPdf,
    handleOpenImageShare,
    handleSaveAsTemplate,
    imageShareOpen,
    imageShareSource,
    setImageShareOpen,
    setShareOpen,
    shareOpen,
    wechatCopyState,
  } = useEditorDocumentActions({
    canShareMemo: Boolean(memo && !readOnly),
    documentActionRequest,
    editor,
    effectiveReadOnly,
    getMobilePlainTextValue,
    hydratedEditorMemoId,
    markdownSource,
    memo,
    notebookName: notebookOptions.find((notebook) => notebook.id === memo?.notebookId)?.name ?? "",
    onDocumentActionConsumed,
    onSaveAsTemplate,
    tagsText,
    title,
    useMarkdownSourceEditor,
    useMobilePlainTextEditor,
  });

  const handleCopyMemoId = useCallback(async () => {
    if (!memo || isLocalMemoId(memo.id)) {
      return;
    }
    const copied = await copyTextToClipboard(memo.id);
    setMemoIdCopyNotice({ status: copied ? "copied" : "error", id: memo.id });
    window.setTimeout(() => setMemoIdCopyNotice(null), copied ? 2200 : 3000);
  }, [memo]);

  useEffect(() => {
    const persistBeforeSuspend = () => {
      if (hasUnsavedChangesRef.current) {
        void persistCurrentDraft(title, tagsText, getMobilePlainTextValue());
      }
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        persistBeforeSuspend();
      }
    };

    window.addEventListener("pagehide", persistBeforeSuspend);
    document.addEventListener("visibilitychange", persistWhenHidden);
    const stopHibernatePrepare = window.edgeeverDesktop?.onHibernatePrepare?.(async () => {
      await persistCurrentDraft(title, tagsText, getMobilePlainTextValue());
    });

    return () => {
      window.removeEventListener("pagehide", persistBeforeSuspend);
      document.removeEventListener("visibilitychange", persistWhenHidden);
      stopHibernatePrepare?.();
    };
  }, [getMobilePlainTextValue, persistCurrentDraft, tagsText, title]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentMemo = memoRef.current;
      const contentJson = getCurrentContentJson();
      const editSession = editSessionRef.current;
      const writableFields = getWritableEditorMemoFields(
        memoFields,
        currentMemo?.id ?? null,
        hydratedMemoIdRef.current,
        hydratingRef.current,
      );

      if (!currentMemo || !contentJson || !editSession || editSession.memoId !== currentMemo.id ||
        !writableFields) {
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
        title: writableFields.title,
        contentJson,
        contentMarkdown: useMarkdownSourceEditor ? markdownSource : undefined,
        tags: parseTagsText(writableFields.tagsText),
      };
      persistEmergencyDraft({
        memoId: currentMemo.id,
        expectedRevision: currentMemo.revision,
        title: writableFields.title,
        tagsText: writableFields.tagsText,
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
      removeEmergencyDraft(savedMemo.id);
      // A previous note's save may finish after the user switches notes.
      // Update its cache, but leave the active editor and save state alone.
      if (memoRef.current?.id !== savedMemo.id) {
        await onSaved(savedMemo);
        return;
      }
      setStorageSaveError(false);
      memoRef.current = savedMemo;
      const currentEditSession = editSessionRef.current;
      if (currentEditSession?.memoId === savedMemo.id) {
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
      if (memoRef.current?.id !== savedMemo.id) return;

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
      const failure = classifyEditorSaveFailure(error);
      if (failure.kind === "storage") {
        setStorageSaveError(true);
        setSaveConflictInfo(null);
        setSaveState("error");
        return;
      }
      setStorageSaveError(false);

      if (failure.kind === "conflict") {
        setSaveConflictInfo(failure.conflict);
        setSaveState("conflict");
        return;
      }

      if (failure.kind === "queue") {
        await queueMemoUpdate(failure.payload);
        await localDb.drafts.put({
          memoId: failure.payload.memoId,
          title: failure.payload.title,
          tagsText: failure.tagsText,
          contentJson: failure.payload.contentJson,
          updatedAt: new Date().toISOString(),
        });
        removeEmergencyDraft(failure.payload.memoId);

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

    if (desktopReadingProtection) {
      setDesktopReadingProtection(false);
      writeDesktopReadingProtectionPreference(false);
    }
    handleMarkdownModeChange();
  }, [desktopReadingProtection, editorModeToggleToken, editorShortcutBlocked, handleMarkdownModeChange, useMobilePlainTextEditor]);

  const editorView = useMarkdownSourceEditor ? "markdown" : "rich";
  const selectEditorView = useCallback((view: "rich" | "markdown") => {
    if (desktopReadingProtection) {
      setDesktopReadingProtection(false);
      writeDesktopReadingProtectionPreference(false);
    }
    if (view === "markdown" && !isMarkdownMode) handleMarkdownModeChange();
    if (view === "rich" && isMarkdownMode) handleMarkdownModeChange();
  }, [desktopReadingProtection, handleMarkdownModeChange, isMarkdownMode]);

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
    renameAttachmentAt(activeEditor, target, filename, t("editor.attachmentLabel", { filename }));
  }, [t]);

  const removeAttachmentLink = useCallback((target: AttachmentMenuTarget) => {
    const activeEditor = editorRef.current;
    if (!isEditorReady(activeEditor)) return;
    removeAttachmentAt(activeEditor, target);
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
    anchor.href = toDesktopResourceDownloadUrl(target.url, target.filename);
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
    if (hydratingRef.current || currentMemo?.isDeleted ||
      !getWritableEditorMemoFields(memoFields, currentMemo?.id ?? null, hydratedMemoIdRef.current, hydratingRef.current)) {
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
  }, [getMobilePlainTextValue, memoFields, mutateSave, persistCurrentDraft, saveMutationPending, saveState, tagsText, title]);

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

  const adoptCloudMemo = useCallback(async () => {
    const currentMemo = memoRef.current;
    if (!currentMemo) {
      return;
    }

    const { memo: remoteMemo } = await repository.adoptCloudMemo(currentMemo.id);
    await onSaved(remoteMemo);
    if (memoRef.current?.id !== remoteMemo.id) return;

    setHasUnsavedChanges(false);
    setSaveConflictInfo(null);
    setSaveState("idle");

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

    setMemoFields({ memoId: remoteMemo.id, title: nextTitle, tagsText: nextTagsText });
    setMobilePlainText(nextMarkdown);
    hydrateMarkdownSource(remoteMemo.id, nextContent, nextMarkdown, { force: true });
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
  }, [hydrateMarkdownSource, onSaved, queryClient, repository]);

  const {
    conflictActionMessage,
    conflictActionPending,
    handleAdoptCloudAndReload,
    handleCopyLocalDraft,
    saveConflictReason,
  } = useEditorSaveConflictActions({
    adoptCloudMemo,
    getLocalDraftMarkdown,
    saveConflictInfo,
    saveState,
    tagsText,
    title,
  });

  useLayoutEffect(() => {
    const title = headerTitleSlot;
    const status = headerStatusCluster;
    if (!title || !status) return;
    let frame = 0;
    const measure = () => {
      const titleRect = title.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      if (titleRect.width < 1 || statusRect.width < 1) return;
      const paddingRight = Number.parseFloat(getComputedStyle(title).paddingRight) || 0;
      const inputRight = titleRect.right - paddingRight;
      setTitleStatusClearancePx((current) => nextTitleStatusClearance(current, inputRight, statusRect.left));
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(title);
    observer.observe(status);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [characterCount, hasUnsavedChanges, headerStatusCluster, headerTitleSlot, saveState]);

  if (isSelectionMode) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-transparent">
        {selectionActionBar}
      </div>
    );
  }

  if (isLoading && !memo) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-transparent">
        <EmptyEditorHeader />
        {selectionActionBar}
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">{t("editor.loading")}</div>
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-transparent">
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

  const { saveLabel, saveStateClassName } = getEditorSaveChrome({
    hasUnsavedChanges,
    saveState,
    t,
  });

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
        ? "bg-slate-100 text-slate-700"
        : saveStateClassName;

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
        if (memoRef.current?.id === data.memo.id) memoRef.current = data.memo;
        await onSaved(data.memo);
        if (memoRef.current?.id !== data.memo.id) return;
        setSaveState("saved");
        window.setTimeout(() => {
          if (memoRef.current?.id === data.memo.id) setSaveState("idle");
        }, 1200);
      })
      .catch(() => {
        if (memoRef.current?.id === sourceMemo.id) setSaveState("error");
      })
      .finally(() => {
        setNotebookUpdatePending(false);
        if (memoRef.current?.id === sourceMemo.id) setMobileNotebookSheetOpen(false);
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
        if (shouldLeaveEditorAfterSaveError(error)) {
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
        if (shouldLeaveEditorAfterSaveError(error)) {
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

  const editorColumnMatchesArticle = !useMarkdownSourceEditor;
  const contentColumnMode = desktopFocusMode ? "focus" : editorOutlineCollapsed ? "collapsed" : "reading";
  const contentColumnMaxWidth = editorContentColumnMaxWidth(editorContentWidth, contentColumnMode);
  const focusTitleMaxWidth = editorContentColumnMaxWidth(editorContentWidth, "focus");
  const editorPaneTight = editorColumnWidth > 0 && editorColumnWidth < EDITOR_PANE_TIGHT_PX;
  const outlineReservesSpace = !editorPaneTight
    && !isMobileViewport
    && !useMobilePlainTextEditor
    && !useMarkdownSourceEditor
    && !phonePreviewOpen
    && !editorOutlineCollapsed;
  const compactEditorReadingGutter = shouldCompactEditorReadingGutter({
    aiAssistantOpen,
    desktopColumn: isDesktopColumn,
    columnWidth: Math.max(0, editorColumnWidth - editorScrollbarGutter * 2),
    articleMaxWidth: Number.parseInt(contentColumnMaxWidth, 10),
    reservedBesideArticle: outlineReservesSpace
      ? Number.parseInt(EDITOR_OUTLINE_WIDTH, 10) + EDITOR_ARTICLE_ROW_GAP_PX
      : 0,
    focusRow: desktopFocusMode,
  });
  const savedQuietly = saveState !== "saving"
    && saveState !== "error"
    && saveState !== "conflict"
    && saveState !== "queued"
    && !hasUnsavedChanges;
  const saveStatusLabel = `${saveLabel} · ${t("editor.characterCount", { count: characterCount })}`;

  return (
    <div className="relative flex h-full min-w-0 bg-transparent">
      <div ref={editorColumnRef} className="relative flex h-full min-w-0 min-h-0 flex-1 flex-col">
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
      <MathFormulaDialog
        open={mathFormulaOpen}
        draft={mathFormulaDraft}
        onOpenChange={setMathFormulaOpen}
        onApply={(draft) => {
          if (!isEditorReady(editor) || effectiveReadOnly) return;
          const stored = mathFormulaDraftRef.current;
          applyMathFormula(editor, {
            ...draft,
            from: stored?.from ?? draft.from,
            to: stored?.to ?? draft.to,
            pos: stored?.pos ?? draft.pos,
          });
          editor.chain().focus(stored?.from ?? draft.from ?? null, { scrollIntoView: true }).run();
        }}
        onRemove={
          mathFormulaDraft && typeof mathFormulaDraft.pos === "number"
            ? () => {
              if (!isEditorReady(editor) || effectiveReadOnly) return;
              const stored = mathFormulaDraftRef.current;
              const pos = stored?.pos ?? mathFormulaDraft.pos;
              if (typeof pos !== "number") return;
              deleteMathFormula(editor, { kind: stored?.kind ?? mathFormulaDraft.kind, pos });
              editor.chain().focus(pos, { scrollIntoView: true }).run();
            }
            : undefined
        }
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
      <header className="shrink-0 border-b border-[var(--workspace-divider)] bg-transparent">
        <div className={MEMO_EDITOR_TOP_ROW_CLASS_NAME}>
          <div
            className={cn(
              "flex min-w-0 flex-1",
              desktopFocusMode && "mx-auto w-full max-w-[1400px]",
            )}
            style={editorColumnMatchesArticle && editorScrollbarGutter > 0 ? { paddingRight: editorScrollbarGutter } : undefined}
          >
          <div
            className={cn(
              "min-w-0 w-full",
              isDesktopColumn && desktopFocusMode && "mx-auto",
            )}
            style={{
              ...(isDesktopColumn && desktopFocusMode ? { maxWidth: focusTitleMaxWidth } : {}),
              ...(titleStatusClearancePx > 0 ? { paddingRight: titleStatusClearancePx } : {}),
            }}
          >
          <div
            ref={setHeaderTitleSlot}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 sm:flex-nowrap"
          >
          <MemoEditorTopRowLeading
            mobileBackButton={(
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
            )}
            titleInput={(
              <MemoTitleInput
                className="w-full min-w-0 px-2"
                value={title}
                readOnly={effectiveReadOnly}
                onValueChange={(nextTitle) => {
                  setMemoFields((fields) => fields.memoId === memo.id
                    ? { ...fields, title: nextTitle }
                    : fields);
                  persistCurrentDraft(nextTitle, tagsText, getMobilePlainTextValue());
                  markDirty();
                }}
                placeholder={t("common.untitledMemo")}
              />
            )}
          />
          <MemoEditorMetadataRow
            rowClassName={MEMO_EDITOR_METADATA_ROW_CLASS_NAME}
            contentMarkdown={currentMarkdownForAi}
            disabled={effectiveReadOnly}
            mobileNotebookPickerOpen={mobileNotebookSheetOpen}
            notebookOptions={notebookOptions}
            notebookUpdatePending={notebookUpdatePending || saveMutation.isPending}
            repository={repository}
            selectedNotebookId={memo.notebookId}
            tagsText={tagsText}
            title={title}
            onMobileNotebookPickerOpenChange={setMobileNotebookSheetOpen}
            onNotebookChange={handleNotebookChange}
            onTagsChange={(nextTagsText) => {
              setMemoFields((fields) => fields.memoId === memo.id
                ? { ...fields, tagsText: nextTagsText }
                : fields);
              persistCurrentDraft(title, nextTagsText, getMobilePlainTextValue());
              markDirty();
            }}
            trailingActions={(
              <>
                {!readOnly && (
                  <IconTooltip label={`${t(desktopReadingProtection ? "editor.disableReadingProtection" : "editor.enableReadingProtection")} (${formatShortcutBinding(shortcutSettings.toggleReadingProtection)})`}>
                    <Button
                      className={cn(
                        "hidden h-7 w-7 shrink-0 sm:inline-flex",
                        desktopReadingProtection && "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-200 hover:text-slate-900"
                      )}
                      size="icon"
                      variant={desktopReadingProtection ? "soft" : "ghost"}
                      aria-label={`${t(desktopReadingProtection ? "editor.disableReadingProtection" : "editor.enableReadingProtection")} (${formatShortcutBinding(shortcutSettings.toggleReadingProtection)})`}
                      aria-pressed={desktopReadingProtection}
                      onClick={toggleDesktopReadingProtection}
                    >
                      {desktopReadingProtection ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                    </Button>
                  </IconTooltip>
                )}
              </>
            )}
          />
          </div>
          </div>
          </div>

          <div ref={setHeaderStatusCluster} className="absolute right-1 top-0 flex h-full shrink-0 items-center gap-1 sm:right-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="hidden shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-400 sm:inline">
                {t("editor.characterCount", { count: characterCount })}
              </span>
            {imageUploadState !== "idle" && (
              <span
                className={cn(
                  "hidden rounded-md px-2 py-1 text-xs font-medium md:inline-flex",
                  imageUploadState === "error"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-slate-100 text-slate-700"
                )}
              >
                {imageUploadState === "error"
                  ? t("editor.uploadState.fileFailed")
                  : imageUploadState === "compressing"
                    ? t("editor.uploadState.imageCompressing")
                    : t("editor.uploadState.fileUploading")}
              </span>
            )}
            <IconTooltip label={saveConflictReason ? `${saveStatusLabel}. ${saveConflictReason}` : saveStatusLabel}>
            <m.span
              key={`${saveState}-${String(hasUnsavedChanges)}`}
              className={cn(
                "hidden items-center gap-1 rounded-md text-xs font-medium sm:inline-flex",
                savedQuietly ? "px-1 text-slate-400" : cn("px-1.5 py-0.5", saveStateClassName),
              )}
              role="status"
              aria-live="polite"
              aria-label={saveState === "conflict" && saveConflictReason ? `${saveStatusLabel}. ${saveConflictReason}` : saveStatusLabel}
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
              {savedQuietly ? null : saveLabel}
            </m.span>
            </IconTooltip>
            <m.span
              key={`${imageUploadState}-${saveState}-${String(hasUnsavedChanges)}`}
              className={cn("inline-flex max-w-[5.5rem] truncate rounded-full px-2 py-1 text-xs font-medium sm:hidden", mobileStatusClassName)}
              role="status"
              aria-live="polite"
              title={saveConflictReason ?? undefined}
              aria-label={saveState === "conflict" && saveConflictReason ? `${saveLabel}. ${saveConflictReason}` : undefined}
              {...statusSettleMotion}
            >
              {mobileStatusLabel}
            </m.span>
            </div>
            <MemoEditorToolbarDivider className="mx-0.5 hidden h-4 sm:block" />
            <div className="flex items-center gap-0.5">
            <MemoEditorFocusModeButton
              desktopFocusMode={desktopFocusMode}
              onToggleDesktopFocusMode={onToggleDesktopFocusMode}
            />
            {!readOnly && (!mobileEditingActive || isMemoShared) && (
              <IconTooltip label={t(isLocalMemoId(memo.id) ? "sharing.afterSync" : isMemoShared ? "sharing.manage" : "sharing.action")}>
                <Button
                  className={cn(
                    "h-8 w-8",
                    isMemoShared
                      ? "bg-[#d4d4d4] text-[#2a2a2a] hover:bg-[#e4e4e4] hover:text-[#2a2a2a]"
                      : "text-slate-500",
                  )}
                  size="icon"
                  variant="ghost"
                  type="button"
                  aria-pressed={isMemoShared}
                  aria-label={t(isLocalMemoId(memo.id) ? "sharing.afterSync" : isMemoShared ? "sharing.manage" : "sharing.action")}
                  disabled={isLocalMemoId(memo.id)}
                  onClick={() => setShareOpen(true)}
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </IconTooltip>
            )}
            {mobileEditingActive && !readOnly && (
              <button
                className="inline-flex h-8 items-center justify-center rounded-full bg-slate-700 px-3 text-xs font-semibold text-slate-50 transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 sm:hidden"
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
            <MemoEditorHeaderActions
              moreButtonClassName={cn(!mobileEditingActive && !readOnly && "hidden sm:inline-flex")}
              moreMenuClassName="w-56 rounded-md"
              onOpenExecutionCenter={onOpenExecutionCenter}
              onSearch={() => openNoteSearch()}
              textNoteMenuItems={(
                <>
                  {!isMobileViewport && !useMobilePlainTextEditor && !useMarkdownSourceEditor && (
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                      onClick={() => handlePhonePreviewChange(!phonePreviewOpen)}
                    >
                      <PhonePreviewGlyph className="h-4 w-4 text-slate-500" />
                      {phonePreviewOpen ? t("editor.hidePhonePreview") : t("editor.showPhonePreview")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    disabled={!editor || useMobilePlainTextEditor || wechatCopyState === "copying"}
                    onClick={() => void handleCopyToWeChat()}
                  >
                    {wechatCopyState === "copying" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin text-slate-500" />
                    ) : wechatCopyState === "copied" ? (
                      <Check className="h-4 w-4 text-slate-500" />
                    ) : wechatCopyState === "error" ? (
                      <CircleAlert className="h-4 w-4 text-rose-600" />
                    ) : (
                      <WeChatIcon className="h-4 w-4 text-slate-500" />
                    )}
                    {t(wechatCopyState === "copying" ? "editor.copyingToWeChat" : wechatCopyState === "copied" ? "editor.copiedToWeChat" : wechatCopyState === "error" ? "editor.copyToWeChatFailed" : "editor.copyToWeChat")}
                  </DropdownMenuItem>
                </>
              )}
              moreMenuItems={(
                <>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  disabled={isLocalMemoId(memo.id)}
                  onClick={() => void handleCopyMemoId()}
                >
                  <Copy className="h-4 w-4 text-slate-500" />
                  {t(isLocalMemoId(memo.id) ? "editor.copyNoteIdAfterSync" : "editor.copyNoteId")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={openNoteReplace}
                  disabled={effectiveReadOnly}
                >
                  <ReplaceAll className="h-4 w-4 text-slate-500" />
                  {t("editor.replaceCurrentMemo")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
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
                      "flex h-9 w-full items-center gap-2 px-3 text-left text-xs hover:bg-slate-50 cursor-pointer outline-none",
                      isMemoShared ? "bg-workspace-selection text-slate-950" : "text-slate-700",
                    )}
                    disabled={isLocalMemoId(memo.id)}
                    onClick={() => setShareOpen(true)}
                  >
                    <Share2 className={cn("h-4 w-4", isMemoShared ? "text-slate-950" : "text-slate-500")} />
                    {t(isLocalMemoId(memo.id) ? "sharing.afterSync" : isMemoShared ? "sharing.manage" : "sharing.action")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={handleExportMarkdown}
                >
                  <FileDown className="h-4 w-4 text-slate-500" />
                  {t("editor.exportMarkdown")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={() => void handleExportHtml()}
                >
                  <FileCode2 className="h-4 w-4 text-slate-500" />
                  {t("editor.exportHtml")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={() => handleExportPdf()}
                >
                  <Printer className="h-4 w-4 text-slate-500" />
                  {t("editor.exportPdf")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={handleOpenImageShare}
                >
                  <ImageIcon className="h-4 w-4 text-slate-500" />
                  {t("editor.imageShare.action")}
                </DropdownMenuItem>
                {readOnly ? (
                  <>
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                      onClick={() => void onRestored(memo.id)}
                    >
                      <RotateCcw className="h-4 w-4 text-slate-500" />
                      {t("editor.restoreMemo")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                      onClick={() => void onPermanentDeleted(memo.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("editor.deleteForever")}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                      onClick={handleSaveAsTemplate}
                      disabled={effectiveReadOnly}
                    >
                      <Pencil className="h-4 w-4 text-slate-500" />
                      {t("templates.saveAsTemplate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                      onClick={() => void onDeleted(memo.id)}
                      disabled={effectiveReadOnly}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("editor.deleteMemo")}
                    </DropdownMenuItem>
                  </>
                )}
                </>
              )}
            />
            </div>
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
            viewSwitchDisabled={readOnly}
            markdownMode={useMarkdownSourceEditor}
            editorView={editorView}
            onEditorViewChange={isMobileViewport ? undefined : selectEditorView}
            onMarkdownModeChange={handleMarkdownModeChange}
            markdownModeShortcut={shortcutSettings.toggleEditorMode}
            onPickAttachment={() => fileInputRef.current?.click()}
            onPickExternalLink={openExternalLinkDialog}
            externalLinkActive={externalLinkActive}
            onPickNoteLink={() => setNoteLinkPickerOpen(true)}
            onPickMathFormula={() => openMathFormula()}
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
        data-editor-theme="default"
        data-note-palette={noteProse.palette}
        style={{
          ...noteProseCssVariables(noteProse),
          "--memo-content-divider-spacing": `${MEMO_CONTENT_STYLE.divider.marginVertical}px`,
        } as CSSProperties}
        className={cn(
          "edgeever-editor relative min-h-0 flex-1 bg-transparent",
          MEMO_EDITOR_READING_GUTTER_PROPERTIES_CLASS_NAME,
          useMobilePlainTextEditor
            ? "overflow-visible"
            : useMarkdownSourceEditor
              // Source mode: fill the pane and scroll inside the textarea (not a 300px card).
              ? "flex flex-col overflow-hidden"
              : "overflow-y-auto lg:[scrollbar-gutter:stable_both-edges]"
        )}
      >
        {noteProse.customCss.trim() ? (
            <style
              data-theme-custom-css
              data-original-css={noteProse.customCss}
              dangerouslySetInnerHTML={{ __html: sanitizeAndScopeCss(noteProse.customCss) }}
            />
          ) : null}
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
              : cn("min-h-full items-start py-2", MEMO_EDITOR_READING_GUTTER_CLASS_NAME),
            desktopFocusMode
              ? "mx-auto w-full max-w-[1400px] justify-center"
              : isDesktopColumn
                ? "w-full justify-center"
                : "w-full"
          )}
          style={(editorPaneTight || compactEditorReadingGutter) && !useMarkdownSourceEditor
            ? { "--editor-reading-gutter": EDITOR_COMPACT_READING_GUTTER } as CSSProperties
            : undefined}
        >
          <div
            className={cn(
              "min-w-0 flex-1 transition-[max-width] duration-200",
              useMarkdownSourceEditor && "flex h-full min-h-0 flex-col",
              isDesktopColumn && "mx-auto",
            )}
            style={isDesktopColumn ? { maxWidth: contentColumnMaxWidth } : undefined}
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
                  className="block min-h-[60dvh] w-full resize-none border border-slate-200 bg-card px-4 py-3 pr-32 text-base leading-7 text-slate-950 outline-none placeholder:text-slate-400 sm:px-7"
                  placeholder={t("editor.placeholder")}
                  style={{
                    WebkitUserSelect: "text",
                    userSelect: "text",
                    caretColor: "auto",
                    fontSize: `${noteProse.fontSize}px`,
                    lineHeight: String(noteProse.lineHeight),
                  }}
                />
                <div className="absolute right-3 top-3 flex gap-2">
                  <button
                    className="rounded-full border border-slate-700 bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-50 shadow-sm"
                    type="button"
                    onClick={() => void handleMobileClipboardInput()}
                  >
                      {t("editor.paste")}
                  </button>
                  <button
                    className="rounded-full border border-slate-200 bg-card px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm"
                    type="button"
                    onClick={handleMobilePromptInput}
                  >
                      {t("editor.typeInput")}
                  </button>
                </div>
              </>
            ) : useMarkdownSourceEditor ? (
              <div ref={markdownMenuAnchorRef} className="relative min-h-0 flex-1">
                <Suspense fallback={<div className="h-full w-full" />}>
                  <MarkdownSourceEditor
                    ref={markdownSourceEditorRef}
                    memoId={memo?.id ?? ""}
                    value={markdownSource}
                    onChange={handleMarkdownSourceChange}
                    onPasteFiles={uploadMarkdownPasteFiles}
                    themeName={markdownTheme}
                    readOnly={effectiveReadOnly}
                    placeholder={`# ${t("editor.placeholder")}`}
                    ariaLabel={t("editor.markdownSourceAria")}
                    onSlashCommandTrigger={() => {
                      openAiAssistant();
                    }}
                    onLinkShortcut={openExternalLinkDialog}
                    onSelectionChange={syncMarkdownAiMenu}
                    className="absolute inset-0 h-full w-full"
                  />
                </Suspense>
                {markdownAiMenu ? (
                  <div
                    className="absolute z-40"
                    style={{
                      top: markdownAiMenu.top,
                      left: markdownAiMenu.left,
                      transform: markdownAiMenu.below ? undefined : "translateY(calc(-100% - 8px))",
                    }}
                  >
                    <SelectionAiActions
                      onExplain={() => requestSelectionAi("explain")}
                      onTranslate={() => requestSelectionAi("translate")}
                      onAsk={() => requestSelectionAi("ask")}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className="relative"
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
                  <SelectionAiActions
                    onExplain={() => requestSelectionAi("explain")}
                    onTranslate={() => requestSelectionAi("translate")}
                    onAsk={() => requestSelectionAi("ask")}
                  />
                </BubbleMenu>
                {!isMobileViewport && !effectiveReadOnly && isEditorReady(editor) ? (
                  <EditorBlockDragHandle editor={editor} />
                ) : null}
                <EditorContent editor={editor} />
              </div>
            )}
          </div>
          {!isMobileViewport && !useMobilePlainTextEditor && !useMarkdownSourceEditor && phonePreviewOpen && (
            <EditorPhonePreview
              editor={editor}
              title={getEditableMemoTitle(memo?.title)}
              scrollContainer={editorScrollContainer}
              noteProse={noteProse}
            />
          )}
          {!editorPaneTight && !isMobileViewport && !useMobilePlainTextEditor && !useMarkdownSourceEditor && !phonePreviewOpen && (
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

      {wechatCopyState === "copying" && <WeChatCopyProgress />}

      {(wechatCopyState === "copied" || wechatCopyState === "error") && (
        <ClipboardCopyNotice status={wechatCopyState === "copied" ? "copied" : "error"}>
          {t(wechatCopyState === "copied" ? "editor.copiedToWeChat" : "editor.copyToWeChatFailed")}
        </ClipboardCopyNotice>
      )}

      {!effectiveReadOnly && !aiAssistantOpen ? (
        <IconTooltip
          side="left"
          label={`${t("aiAssistant.open")} (${formatShortcutBinding(shortcutSettings.openAiAssistant)})`}
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            data-ai-assistant-launcher=""
            className={cn(
              "absolute z-30 size-11 rounded-full border-slate-200 bg-card text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.14)] hover:bg-card hover:text-slate-950",
              // The phone note view already has an edit button in this corner.
              isMobileViewport && !mobileEditingActive
                ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4"
                : "bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5",
            )}
            aria-label={t("aiAssistant.open")}
            onClick={openAiAssistant}
          >
            <Sparkles className="size-5" strokeWidth={1.75} />
          </Button>
        </IconTooltip>
      ) : null}

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

      <ShareMemoDialog memoId={memo.id} open={shareOpen} onOpenChange={setShareOpen} />

      {imageShareSource && (
        <ShareNoteImageDialog
          open={imageShareOpen}
          source={imageShareSource}
          onOpenChange={setImageShareOpen}
        />
      )}
      </div>
      <AiSidebarErrorBoundary open={aiAssistantOpen} onOpenChange={setAiSidebarOpen}>
        <AiSidebar
          open={aiAssistantOpen}
          onOpenChange={setAiSidebarOpen}
          companionAvailable={companionAvailable}
          selectionMarkdown={selectionPin?.memoId === memo.id ? selectionPin.sentText : ""}
          selectionPin={selectionPin?.memoId === memo.id ? selectionPin : null}
          selectionRequest={selectionRequest}
          onDismissSelectionPin={() => setSelectionPin(null)}
          onReplaceSelection={replacePinnedSelection}
          contentMarkdown={currentMarkdownForAi}
          memoId={memo.id}
          notebookId={memo.notebookId}
          notebookTitle={notebookOptions.find((notebook) => notebook.id === memo.notebookId)?.name}
          noteTitle={title}
          beforeCompanionApply={beforeCompanionApply}
          onCompanionNotesChanged={onCompanionNotesChanged}
          onOpenCompanionNote={onOpenCompanionNote}
        />
      </AiSidebarErrorBoundary>
    </div>
  );
};
