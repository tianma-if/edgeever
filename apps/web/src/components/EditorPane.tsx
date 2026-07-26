import { useRef, useState, useEffect, useCallback, useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { NodeViewWrapper, ReactNodeViewRenderer, useEditor, EditorContent, type Editor, type NodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitHubRepositoryLink } from "@/components/GitHubRepositoryLink";
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
import { EditorToolbar } from "./EditorToolbar";
import { EditorOutline } from "./EditorOutline";
import { WeChatIcon } from "./WeChatIcon";
import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "./ThemeProvider";
import { RevisionHistoryDialog } from "./dialogs/RevisionHistoryDialog";
import { api } from "@/lib/api";
import { consumeStandaloneMobileEditorReturn, openStandaloneMobileEditor } from "@/lib/mobile-editor";
import { cn, formatDateTime, parseTagsText } from "@/lib/utils";
import {
  countMemoCharacters,
  docToMarkdown,
  markdownToDoc,
  resolveMemoContentDoc,
  type Notebook,
  type MemoDetail,
  type MemoEditSession,
  type TiptapDoc,
} from "@edgeever/shared";
import {
  DEFAULT_IMAGE_WIDTH_PERCENT,
  IMAGE_WIDTH_PRESETS,
  clampImageWidth,
  parseImageWidth,
} from "@edgeever/shared/image-display";
import { codeBlockLowlight, EdgeEverCodeBlock } from "@/lib/code-block";
import { compressImageForUpload } from "@/lib/image-compression";
import { localDb, type MemoUpdateSyncPayload } from "@/lib/local-db";
import { getMemoUpdateQueueId, isMemoUpdateAlreadyApplied, queueMemoUpdate, shouldQueueMemoSaveError } from "@/lib/sync-queue";
import {
  getEditableMemoTitle,
  getNotebookMoveOptions,
} from "@/lib/app-helpers";
import { copyEditorToWeChat, copyMarkdownToWeChat } from "@/lib/wechat-copy";
import { ThemeBlock } from "./ThemeBlock";
import { SystemInfoDialog } from "./SystemInfoDialog";
import { fetchLatestRelease, isVersionOutdated } from "@/lib/version-check";
import { RELEASE_STATUS_EVENT } from "@/lib/release-notice";

const SUPPORTED_PASTE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const MOBILE_EDITOR_QUERY = "(max-width: 639px)";
const EDITOR_AUTO_SAVE_DELAY_MS = 1200;
const MOBILE_DRAFT_PERSIST_DELAY_MS = 800;
const NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY = new PluginKey("edgeever-note-search-highlight");

const IconTooltip = ({ label, children }: { label: string; children: ReactNode }) => (
  <TooltipProvider delayDuration={0} skipDelayDuration={0}>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

type NoteSearchMatch = {
  from: number;
  to: number;
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

const getSearchMatchesFromDocument = (doc: Editor["state"]["doc"], query: string): NoteSearchMatch[] => {
  const needle = query.trim().toLocaleLowerCase();

  if (needle.length === 0) {
    return [];
  }

  const characters: Array<{ char: string; pos: number }> = [];
  let previousTextEnd: number | null = null;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }

    if (previousTextEnd !== null && pos > previousTextEnd) {
      characters.push({ char: "\u0000", pos: -1 });
    }

    for (let index = 0; index < node.text.length; index += 1) {
      characters.push({ char: node.text[index] ?? "", pos: pos + index });
    }

    previousTextEnd = pos + node.text.length;
  });

  const haystack = characters.map((item) => item.char).join("").toLocaleLowerCase();
  const matches: NoteSearchMatch[] = [];
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    const start = characters[index];
    const end = characters[index + needle.length - 1];

    if (start && end && start.pos >= 0 && end.pos >= 0) {
      matches.push({ from: start.pos, to: end.pos + 1 });
    }

    index = haystack.indexOf(needle, index + needle.length);
  }

  return matches;
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

const ResizableImageNodeView = ({ editor, node, selected, updateAttributes }: NodeViewProps) => {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const nodeWidth = parseImageWidth(node.attrs.width) ?? DEFAULT_IMAGE_WIDTH_PERCENT;
  const width = previewWidth ?? nodeWidth;
  const editable = editor.isEditable;
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";

  const updateWidth = useCallback(
    (nextWidth: number) => {
      updateAttributes({ width: clampImageWidth(nextWidth) });
    },
    [updateAttributes]
  );

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!editable) {
        return;
      }

      const wrapper = wrapperRef.current;
      const parent = wrapper?.parentElement;
      if (!wrapper || !parent) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const parentWidth = parent.getBoundingClientRect().width;
      if (parentWidth <= 0) {
        return;
      }

      let pendingWidth = nodeWidth;
      const previewFromPointer = (clientX: number) => {
        const wrapperLeft = wrapper.getBoundingClientRect().left;
        pendingWidth = clampImageWidth(((clientX - wrapperLeft) / parentWidth) * 100);
        setPreviewWidth(pendingWidth);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => previewFromPointer(moveEvent.clientX);
      const stopResize = (commit: boolean) => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        setPreviewWidth(null);
        if (commit && pendingWidth !== nodeWidth) {
          updateWidth(pendingWidth);
        }
      };
      const handlePointerUp = () => stopResize(true);
      const handlePointerCancel = () => stopResize(false);

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      previewFromPointer(event.clientX);
    },
    [editable, nodeWidth, updateWidth]
  );

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      as="figure"
      className={cn("edgeever-image-node", selected && "is-selected")}
      style={{ width: `${width}%` }}
      data-width={width}
    >
      <img src={src} alt={alt} title={title || undefined} draggable={false} />
      {editable && selected && (
        <div className="edgeever-image-controls" contentEditable={false}>
          <div className="edgeever-image-presets" aria-label={t("editor.imageScale")}>
            {IMAGE_WIDTH_PRESETS.map((preset) => (
              <button
                key={preset.width}
                type="button"
                className={cn("edgeever-image-preset", width === preset.width && "is-active")}
                title={t("editor.scaleTo", { percent: preset.width })}
                aria-label={`${t(preset.labelKey)}，${t("editor.scaleTo", { percent: preset.width })}`}
                onClick={() => updateWidth(preset.width)}
              >
                <span>{t(preset.labelKey)}</span>
                <span className="edgeever-image-preset-percent">{preset.width}%</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="edgeever-image-resize-handle"
            title={t("editor.resizeImage")}
            aria-label={t("editor.resizeImage")}
            onPointerDown={startResize}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
};

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          parseImageWidth(element.getAttribute("data-width") ?? element.getAttribute("width") ?? element.style.width),
        renderHTML: (attributes) => {
          const width = parseImageWidth(attributes.width);
          return width ? { "data-width": String(width), style: `width: ${width}%` } : {};
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageNodeView);
  },
});

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
  selectionActionBar?: ReactNode;
};

type RichEditorPaneProps = EditorPaneProps & {
  onRequestMobileNativeEdit?: () => void;
};

const MobileNativeEditorPane = ({
  memo,
  notebooks,
  isTrashView,
  onBackToList,
  onSaved,
  onMobileDefaultEditConsumed,
  onExitMobileNativeEdit,
}: EditorPaneProps & { onExitMobileNativeEdit: () => void }) => {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const tagsRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const memoRef = useRef<MemoDetail | null>(memo);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const editingMemoIdRef = useRef<string | null>(memo?.id ?? null);
  const hasUnsavedChangesRef = useRef(false);
  const hydratingRef = useRef(false);
  const savingRef = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "queued" | "error" | "conflict">("idle");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [mobileNotebookSheetOpen, setMobileNotebookSheetOpen] = useState(false);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const readOnly = isTrashView || Boolean(memo?.isDeleted);
  const currentNotebookLabel = notebookOptions.find((notebook) => notebook.id === memo?.notebookId)?.name ?? t("editor.notebookFallback");

  const getTitleValue = useCallback(() => titleRef.current?.value ?? "", []);
  const getTagsValue = useCallback(() => tagsRef.current?.value ?? "", []);
  const getBodyValue = useCallback(() => bodyRef.current?.value ?? "", []);

  const clearTimers = useCallback(() => {
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const persistDraft = useCallback(() => {
    const currentMemo = memoRef.current;
    if (!currentMemo || currentMemo.isDeleted || editingMemoIdRef.current !== currentMemo.id) {
      return;
    }

    void localDb.drafts.put({
      memoId: currentMemo.id,
      title: getTitleValue(),
      tagsText: getTagsValue(),
      contentJson: markdownToDoc(getBodyValue()),
      updatedAt: new Date().toISOString(),
    });
  }, [getBodyValue, getTagsValue, getTitleValue]);

  const currentSnapshot = useCallback(() => {
    const currentMemo = memoRef.current;
    if (!currentMemo) {
      return null;
    }

    return JSON.stringify({
      memoId: currentMemo.id,
      title: getTitleValue(),
      tagsText: getTagsValue(),
      body: getBodyValue(),
    });
  }, [getBodyValue, getTagsValue, getTitleValue]);

  const saveCurrent = useCallback(async () => {
    const currentMemo = memoRef.current;
    const snapshot = currentSnapshot();

    const editSession = editSessionRef.current;
    if (
      !currentMemo ||
      currentMemo.isDeleted ||
      editingMemoIdRef.current !== currentMemo.id ||
      !snapshot ||
      savingRef.current ||
      !editSession
    ) {
      return false;
    }

    clearTimers();
    savingRef.current = true;
    setSaveState("saving");

    const contentJson = markdownToDoc(getBodyValue());
    const payload: MemoUpdateSyncPayload = {
      memoId: currentMemo.id,
      expectedRevision: currentMemo.revision,
      expectedContentHash: currentMemo.contentHash,
      editSessionId: editSession.id,
      title: getTitleValue(),
      contentJson,
      tags: parseTagsText(getTagsValue()),
    };

    try {
      const data = await api.updateMemo(currentMemo.id, {
        expectedRevision: payload.expectedRevision,
        expectedContentHash: payload.expectedContentHash,
        editSessionId: payload.editSessionId,
        title: payload.title,
        contentJson: payload.contentJson,
        tags: payload.tags,
      });

      memoRef.current = data.memo;
      editSessionRef.current = {
        ...editSession,
        baseRevision: data.memo.revision,
        baseContentHash: data.memo.contentHash,
      };
      await onSaved(data.memo);

      if (currentSnapshot() === snapshot) {
        hasUnsavedChangesRef.current = false;
        setHasUnsavedChanges(false);
        await localDb.drafts.delete(data.memo.id);
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1200);
      } else {
        persistDraft();
        hasUnsavedChangesRef.current = true;
        setHasUnsavedChanges(true);
        setSaveState("idle");
      }

      return true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;

      if (code === "revision_conflict") {
        setSaveState("conflict");
        return false;
      }

      if (shouldQueueMemoSaveError(error)) {
        await queueMemoUpdate(payload);
        await localDb.drafts.put({
          memoId: payload.memoId,
          title: payload.title,
          tagsText: getTagsValue(),
          contentJson: payload.contentJson,
          updatedAt: new Date().toISOString(),
        });
        hasUnsavedChangesRef.current = false;
        setHasUnsavedChanges(false);
        setSaveState("queued");
        return true;
      }

      setSaveState("error");
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [clearTimers, currentSnapshot, getBodyValue, getTagsValue, getTitleValue, onSaved, persistDraft]);

  const markDirty = useCallback(() => {
    const currentMemo = memoRef.current;
    if (hydratingRef.current || currentMemo?.isDeleted || !currentMemo || editingMemoIdRef.current !== currentMemo.id) {
      return;
    }

    if (!hasUnsavedChangesRef.current) {
      hasUnsavedChangesRef.current = true;
      setHasUnsavedChanges(true);
    }
    setSaveState((current) => (current === "conflict" ? current : "idle"));

    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
    }
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      persistDraft();
    }, MOBILE_DRAFT_PERSIST_DELAY_MS);

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      if (hasUnsavedChangesRef.current) {
        void saveCurrent();
      }
    }, EDITOR_AUTO_SAVE_DELAY_MS);
  }, [persistDraft, saveCurrent]);

  useEffect(() => {
    document.documentElement.classList.add("edgeever-mobile-native-editing");
    document.body.classList.add("edgeever-mobile-native-editing");

    return () => {
      document.documentElement.classList.remove("edgeever-mobile-native-editing");
      document.body.classList.remove("edgeever-mobile-native-editing");
    };
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) {
      return;
    }

    element.addEventListener("input", markDirty);
    return () => element.removeEventListener("input", markDirty);
  }, [markDirty]);

  useEffect(() => {
    if (!memo) {
      memoRef.current = null;
      editSessionRef.current = null;
      return;
    }

    let cancelled = false;
    const sameMemo = editingMemoIdRef.current === memo.id;
    memoRef.current = memo;

    if (sameMemo && hasUnsavedChangesRef.current && !memo.isDeleted) {
      return;
    }

    void (async () => {
      let [draft, queuedUpdate, editSessionResponse] = memo.isDeleted
        ? [null, null, null]
        : await Promise.all([
            localDb.drafts.get(memo.id),
            localDb.syncQueue.get(getMemoUpdateQueueId(memo.id)),
            api.createMemoEditSession(memo.id),
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

      const draftUpdatedAt = draft ? Date.parse(draft.updatedAt) : 0;
      const remoteUpdatedAt = Date.parse(memo.updatedAt);
      const useDraft = Boolean(draft && (queuedUpdate || draftUpdatedAt >= remoteUpdatedAt));
      const nextTitle = useDraft && draft ? draft.title : getEditableMemoTitle(memo.title);
      const nextTagsText = useDraft && draft ? draft.tagsText : memo.tags.join(", ");
      const nextContent = useDraft && draft
        ? draft.contentJson
        : resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
      editSessionRef.current = editSessionResponse?.editSession ?? null;

      hydratingRef.current = true;
      editingMemoIdRef.current = memo.id;
      if (titleRef.current) {
        titleRef.current.value = nextTitle;
      }
      if (tagsRef.current) {
        tagsRef.current.value = nextTagsText;
      }
      if (bodyRef.current) {
        bodyRef.current.value = docToMarkdown(nextContent);
      }
      hasUnsavedChangesRef.current = Boolean(useDraft && !queuedUpdate);
      setHasUnsavedChanges(hasUnsavedChangesRef.current);
      setSaveState(queuedUpdate ? syncStatusToSaveState(queuedUpdate.status) : "idle");
      window.setTimeout(() => {
        hydratingRef.current = false;
        bodyRef.current?.focus({ preventScroll: true });
      }, 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [memo]);

  useEffect(() => {
    const persistBeforeSuspend = () => {
      if (hasUnsavedChangesRef.current) {
        persistDraft();
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
  }, [persistDraft]);

  const finishEditing = async (goBack: boolean) => {
    if (!readOnly && hasUnsavedChangesRef.current) {
      const saved = await saveCurrent();
      if (!saved && saveState !== "queued") {
        return;
      }
    }

    onMobileDefaultEditConsumed();
    onExitMobileNativeEdit();
    if (goBack) {
      onBackToList();
    }
  };

  const updateMemoNotebook = (notebookId: string, sourceMemo: MemoDetail = memoRef.current ?? memo!) => {
    if (readOnly || !sourceMemo || notebookId === sourceMemo.notebookId || notebookUpdatePending) {
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
    if (!hasUnsavedChangesRef.current) {
      updateMemoNotebook(notebookId);
      return;
    }

    void saveCurrent().then((saved) => {
      if (saved) {
        updateMemoNotebook(notebookId);
      }
    });
  };

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
        ? "bg-amber-50 text-amber-700"
        : saveState === "saving" || hasUnsavedChanges
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-500";

  if (!memo) {
    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white text-sm text-slate-500 sm:hidden">
          {t("editor.loading")}
        </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-white text-slate-950 sm:hidden" data-edgeever-mobile-native-editor>
      <header className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 py-2">
        <Button
          size="icon"
          variant="ghost"
          title={hasUnsavedChanges && !readOnly ? t("editor.saveAndBack") : t("editor.backToList")}
          aria-label={hasUnsavedChanges && !readOnly ? t("editor.saveAndBack") : t("editor.backToList")}
          disabled={savingRef.current || notebookUpdatePending}
          onClick={() => void finishEditing(true)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 justify-end gap-2">
          <span className={cn("inline-flex max-w-[5.5rem] truncate rounded-full px-2 py-1 text-[11px] font-medium", saveStateClassName)}>
            {saveLabel}
          </span>
          <button
            className="inline-flex h-8 items-center justify-center rounded-full bg-slate-950 px-3 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
            type="button"
            disabled={savingRef.current || notebookUpdatePending}
            onClick={() => void finishEditing(false)}
          >
            {saveState === "saving" ? t("editor.saveState.saving") : t("editor.done")}
          </button>
        </div>
      </header>

      <main className="bg-white">
        <div className="space-y-3 px-4 pb-4 pt-4">
          <input
            ref={titleRef}
            defaultValue={getEditableMemoTitle(memo.title)}
            readOnly={readOnly}
            onInput={markDirty}
            className="block w-full border-0 bg-transparent text-2xl font-bold leading-tight text-slate-950 outline-none placeholder:text-slate-300"
            placeholder={t("common.untitledMemo")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="flex h-8 min-w-0 max-w-full items-center gap-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-slate-600 outline-none disabled:opacity-50"
              type="button"
              disabled={readOnly || notebookUpdatePending}
              title={t("editor.currentNotebook")}
              aria-label={t("editor.currentNotebookAria", { name: currentNotebookLabel })}
              onClick={() => setMobileNotebookSheetOpen(true)}
            >
              <span className="min-w-0 truncate">{currentNotebookLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
            <label className="flex h-8 min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-sm text-slate-500">
              <Tags className="h-4 w-4" />
              <input
                ref={tagsRef}
                defaultValue={memo.tags.join(", ")}
                readOnly={readOnly}
                onInput={markDirty}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
                placeholder={t("editor.tagPlaceholder")}
              />
            </label>
          </div>
        </div>

        <textarea
          ref={bodyRef}
          defaultValue={docToMarkdown(resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown))}
          autoCapitalize="sentences"
          autoComplete="on"
          autoCorrect="on"
          enterKeyHint="enter"
          inputMode="text"
          name="memo-body-native"
          spellCheck
          readOnly={readOnly}
          aria-label={t("editor.noteBodyAria")}
          placeholder={t("editor.placeholder")}
          className="block min-h-[70dvh] w-full resize-none border-0 bg-white px-4 py-4 text-base leading-7 text-slate-900 outline-none placeholder:text-slate-400"
          style={{ WebkitUserSelect: "text", userSelect: "text", caretColor: "auto" }}
        />
      </main>

      {mobileNotebookSheetOpen && (
        <MobileNotebookSelectSheet
          isUpdating={notebookUpdatePending || saveState === "saving"}
          options={notebookOptions}
          selectedNotebookId={memo.notebookId}
          onClose={() => setMobileNotebookSheetOpen(false)}
          onSelect={handleNotebookChange}
        />
      )}
    </div>
  );
};

export const EditorPane = (props: EditorPaneProps) => {
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(MOBILE_EDITOR_QUERY).matches
  );
  const [mobileNativeEditMemoId, setMobileNativeEditMemoId] = useState<string | null>(null);
  const standaloneOpenMemoIdRef = useRef<string | null>(null);
  const { t } = useTranslation();
  const readOnly = props.isTrashView || Boolean(props.memo?.isDeleted);
  const mobileDefaultEditRequested = Boolean(
    props.memo?.id && props.memo.id === props.mobileDefaultEditMemoId && !readOnly
  );
  const mobileNativeEditingActive = Boolean(
    isMobileViewport &&
      props.memo &&
      !readOnly &&
      (mobileDefaultEditRequested || mobileNativeEditMemoId === props.memo.id)
  );

  useEffect(() => {
    if (isMobileViewport && mobileDefaultEditRequested && props.memo?.id) {
      if (consumeStandaloneMobileEditorReturn(props.memo.id)) {
        props.onMobileDefaultEditConsumed();
        setMobileNativeEditMemoId(null);
        props.onBackToList();
        return;
      }

      if (standaloneOpenMemoIdRef.current === props.memo.id) {
        return;
      }

      standaloneOpenMemoIdRef.current = props.memo.id;
      props.onMobileDefaultEditConsumed();
      openStandaloneMobileEditor(props.memo.id);
    }
  }, [isMobileViewport, mobileDefaultEditRequested, props.memo?.id, props.onBackToList, props.onMobileDefaultEditConsumed]);

  useEffect(() => {
    const clearReturnedStandaloneEditor = () => {
      if (!consumeStandaloneMobileEditorReturn(props.memo?.id ?? null)) {
        return;
      }

      props.onMobileDefaultEditConsumed();
      setMobileNativeEditMemoId(null);
      props.onBackToList();
    };

    clearReturnedStandaloneEditor();
    window.addEventListener("pageshow", clearReturnedStandaloneEditor);
    document.addEventListener("visibilitychange", clearReturnedStandaloneEditor);

    return () => {
      window.removeEventListener("pageshow", clearReturnedStandaloneEditor);
      document.removeEventListener("visibilitychange", clearReturnedStandaloneEditor);
    };
  }, [props.memo?.id, props.onBackToList, props.onMobileDefaultEditConsumed]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_EDITOR_QUERY);
    const updateMobileViewport = () => setIsMobileViewport(mediaQuery.matches);

    updateMobileViewport();
    mediaQuery.addEventListener("change", updateMobileViewport);

    return () => mediaQuery.removeEventListener("change", updateMobileViewport);
  }, []);

  useEffect(() => {
    setMobileNativeEditMemoId(null);
  }, [props.memo?.id]);

  if (mobileNativeEditingActive) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-white text-sm font-medium text-slate-400">
        {t("editor.openEditor")}
      </div>
    );
  }

  return (
    <RichEditorPane
      {...props}
      mobileDefaultEditMemoId={null}
      onRequestMobileNativeEdit={() => {
        if (props.memo?.id && !readOnly) {
          setMobileNativeEditMemoId(props.memo.id);
          openStandaloneMobileEditor(props.memo.id);
        }
      }}
    />
  );
};

const RichEditorPane = ({
  memo,
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
  selectionActionBar,
  onRequestMobileNativeEdit,
}: RichEditorPaneProps) => {
  const { t } = useTranslation();
  const { customEditorTheme, editorTheme } = useTheme();
  const queryClient = useQueryClient();
  const isSelectionMode = Boolean(selectionActionBar);
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "queued" | "error" | "conflict">("idle");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const [, setEditorStateVersion] = useState(0);
  const [editorContentVersion, setEditorContentVersion] = useState(0);
  const [imageUploadState, setImageUploadState] = useState<"idle" | "compressing" | "uploading" | "error">("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [mobileNotebookSheetOpen, setMobileNotebookSheetOpen] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [noteSearchOpen, setNoteSearchOpen] = useState(false);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSearchReplaceOpen, setNoteSearchReplaceOpen] = useState(false);
  const [noteSearchReplacement, setNoteSearchReplacement] = useState("");
  const [noteSearchIndex, setNoteSearchIndex] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(MOBILE_EDITOR_QUERY).matches
  );
  const [isMobileEditing, setIsMobileEditing] = useState(false);
  const [mobilePlainText, setMobilePlainText] = useState("");
  const [markdownSource, setMarkdownSource] = useState("");
  const [isMarkdownMode, setIsMarkdownMode] = useState(false);
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [mobileImeDebugOpen, setMobileImeDebugOpen] = useState(false);
  const [mobileImeDebugActiveElement, setMobileImeDebugActiveElement] = useState(getActiveElementLabel);
  const [mobileImeDebugEvents, setMobileImeDebugEvents] = useState<MobileImeDebugEntry[]>([]);
  const [wechatCopyState, setWechatCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [editorScrollContainer, setEditorScrollContainer] = useState<HTMLDivElement | null>(null);
  const setEditorScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    editorScrollContainerRef.current = element;
    setEditorScrollContainer(element);
  }, []);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const readOnly = isTrashView || Boolean(memo?.isDeleted);
  const mobileDefaultEditRequested = Boolean(memo?.id && memo.id === mobileDefaultEditMemoId && !readOnly);
  const mobileEditingActive = isMobileEditing || mobileDefaultEditRequested;

  useEffect(() => {
    const controller = new AbortController();
    void fetchLatestRelease(controller.signal)
      .then((release) => setUpdateAvailable(isVersionOutdated(__EDGEEVER_APP_VERSION__, release.tagName)))
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
  const hydratingRef = useRef(false);
  const hydratedMemoIdRef = useRef<string | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const editingMemoIdRef = useRef<string | null>(memo?.id ?? null);
  const imageCompressionEnabledRef = useRef(imageCompressionEnabled);

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
          if (!isMobileViewport && isEditorReady(currentEditor)) {
            currentEditor.commands.focus("end");
            return;
          }

          if (attempt < 10) {
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

      try {
        for (const file of files) {
          const isImage = SUPPORTED_PASTE_IMAGE_TYPES.has(file.type);
          const shouldCompress = isImage && imageCompressionEnabledRef.current;
          setImageUploadState(shouldCompress ? "compressing" : "uploading");
          const uploadFile = shouldCompress ? (await compressImageForUpload(file)).file : file;

          setImageUploadState("uploading");
          const { resource } = await api.uploadMemoResource(targetMemoId, uploadFile);
          void queryClient.invalidateQueries({ queryKey: ["resources"] });

          const activeEditor = editorRef.current;
          if (memoRef.current?.id !== targetMemoId || !isEditorReady(activeEditor)) {
            setImageUploadState("idle");
            return;
          }

          if (resource.kind === "image") {
            activeEditor
              .chain()
              .focus()
              .setImage({
                src: resource.url,
                alt: file.name,
                title: file.name,
                width: DEFAULT_IMAGE_WIDTH_PERCENT,
              })
              .run();
          } else {
            activeEditor
              .chain()
              .focus()
              .insertContent({
                type: "paragraph",
                content: [{
                  type: "text",
                  text: t("editor.attachmentLabel", { filename: resource.filename || file.name }),
                  marks: [{
                    type: "link",
                    attrs: { href: resource.url, target: "_blank", class: "edgeever-attachment-link" },
                  }],
                }],
              })
              .run();
          }
        }

        setImageUploadState("idle");
      } catch {
        setImageUploadState("error");
        window.setTimeout(() => setImageUploadState("idle"), 2200);
      }
    })();
  }, [queryClient, t]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      EdgeEverCodeBlock.configure({ lowlight: codeBlockLowlight, defaultLanguage: "plaintext" }),
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
    editable: Boolean(memo && !effectiveReadOnly),
    editorProps: {
      attributes: {
        class: "prose prose-slate max-w-none focus:outline-none min-h-[300px] px-4 py-3 sm:px-7",
      },
      handleKeyDown: (view, event) => {
        const shortcutKey = event.key.toLowerCase();
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
  });

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

    const searchHighlightPlugin = new Plugin({
      key: NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY,
      props: {
        decorations: (state) => {
          const currentQuery = noteSearchOpen ? noteSearchQuery : contentSearchQuery;
          const currentMatches = getSearchMatchesFromDocument(state.doc, currentQuery);

          if (currentMatches.length === 0) {
            return DecorationSet.empty;
          }

          return DecorationSet.create(
            state.doc,
            currentMatches.map((match, index) =>
              Decoration.inline(match.from, match.to, {
                class: index === (noteSearchOpen ? noteSearchIndex : 0)
                  ? "edgeever-search-match edgeever-search-match-active"
                  : "edgeever-search-match",
              })
            )
          );
        },
      },
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
        const next = (current + direction + noteSearchMatches.length) % noteSearchMatches.length;
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

    hasUnsavedChangesRef.current = true;
    setHasUnsavedChanges(true);
    setDirtyVersion((version) => version + 1);
    setSaveState((current) => (current === "conflict" ? current : "idle"));
  }, []);

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
      editingMemoIdRef.current = null;
      hasUnsavedChangesRef.current = false;
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

    const sameMemo = editingMemoIdRef.current === memo.id;
    memoRef.current = memo;

    if (!sameMemo) {
      hydratedMemoIdRef.current = null;
    }

    if (sameMemo && hasUnsavedChangesRef.current && !memo.isDeleted) {
      return;
    }

    void (async () => {
      let [draft, queuedUpdate, editSessionResponse] = memo.isDeleted
        ? [null, null, null]
        : await Promise.all([
            localDb.drafts.get(memo.id),
            localDb.syncQueue.get(getMemoUpdateQueueId(memo.id)),
            api.createMemoEditSession(memo.id),
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

      const draftUpdatedAt = draft ? Date.parse(draft.updatedAt) : 0;
      const remoteUpdatedAt = Date.parse(memo.updatedAt);
      const useDraft = Boolean(draft && (queuedUpdate || draftUpdatedAt >= remoteUpdatedAt));
      const nextTitle = useDraft && draft ? draft.title : getEditableMemoTitle(memo.title);
      const nextTagsText = useDraft && draft ? draft.tagsText : memo.tags.join(", ");
      const nextContent = useDraft && draft
        ? draft.contentJson
        : resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
      const nextMarkdown = docToMarkdown(nextContent);
      const nextHasUnsavedChanges = Boolean(useDraft && !queuedUpdate);

      hydratingRef.current = true;
      editingMemoIdRef.current = memo.id;
      hasUnsavedChangesRef.current = nextHasUnsavedChanges;
      setHasUnsavedChanges(nextHasUnsavedChanges);
      setSaveState(queuedUpdate ? syncStatusToSaveState(queuedUpdate.status) : "idle");
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
      }

      hydratedMemoIdRef.current = memo.id;
      editSessionRef.current = editSessionResponse?.editSession ?? null;

      window.setTimeout(() => {
        hydratingRef.current = false;
      }, 0);
    })();

    return () => {
      cancelled = true;
    };
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
      editor.setEditable(Boolean(memo && !effectiveReadOnly));
    }
  }, [editor, effectiveReadOnly, memo]);

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
      let data;

      try {
        data = await api.updateMemo(currentMemo.id, {
          expectedRevision: payload.expectedRevision,
          expectedContentHash: payload.expectedContentHash,
          editSessionId: payload.editSessionId,
          title: payload.title,
          contentJson: payload.contentJson,
          contentMarkdown: payload.contentMarkdown,
          tags: payload.tags,
        });
      } catch (error) {
        throw new MemoSaveRequestError(error, payload, tagsText);
      }

      return { memo: data.memo, snapshot };
    },
    onMutate: () => setSaveState("saving"),
    onSuccess: async ({ memo: savedMemo, snapshot }) => {
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
        hasUnsavedChangesRef.current = false;
        setHasUnsavedChanges(false);
        await localDb.drafts.delete(savedMemo.id);
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1400);
        return;
      }

      persistCurrentDraft();
      hasUnsavedChangesRef.current = true;
      setHasUnsavedChanges(true);
      setSaveState("idle");
    },
    onError: async (error) => {
      const sourceError = error instanceof MemoSaveRequestError ? error.originalError : error;
      const code =
        sourceError && typeof sourceError === "object" && "code" in sourceError
          ? String(sourceError.code)
          : null;

      if (code === "revision_conflict") {
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

        hasUnsavedChangesRef.current = false;
        setHasUnsavedChanges(false);
        setSaveState("queued");
        return;
      }

      setSaveState("error");
    },
  });

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
      hasUnsavedChangesRef.current = true;
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
        saveMutation.isPending ||
        saveState === "conflict"
      ) {
        return;
      }

      saveMutation.mutate();
    }, EDITOR_AUTO_SAVE_DELAY_MS);
  }, [getMobilePlainTextValue, persistCurrentDraft, saveMutation, saveState, tagsText, title]);

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
      saveMutation.isPending ||
      saveState === "conflict"
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      saveMutation.mutate();
    }, EDITOR_AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [dirtyVersion, editor, hasUnsavedChanges, memo, saveMutation, saveState, useMobilePlainTextEditor]);

  if (isSelectionMode) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-white">
        {selectionActionBar}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-white">
        {selectionActionBar}
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">{t("editor.loading")}</div>
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-white">
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
        ? "bg-amber-50 text-amber-700"
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

  const mobileDoneDisabled =
    saveMutation.isPending ||
    notebookUpdatePending ||
    imageUploadState === "compressing" ||
    imageUploadState === "uploading";
  const noteSearchMatchLabel = noteSearchQuery.trim()
    ? `${noteSearchMatches.length > 0 ? noteSearchIndex + 1 : 0}/${noteSearchMatches.length}`
    : "0/0";
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

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-white">
      {selectionActionBar}
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
            <span className={cn("hidden rounded-md px-2 py-1 text-xs font-medium sm:inline-flex", saveStateClassName)}>
              {saveLabel}
            </span>
            <span className={cn("inline-flex max-w-[5.5rem] truncate rounded-full px-2 py-1 text-[11px] font-medium sm:hidden", mobileStatusClassName)}>
              {mobileStatusLabel}
            </span>
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
            <TooltipProvider delayDuration={0} skipDelayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className={cn(
                      "hidden h-8 w-8 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-slate-300 sm:inline-flex",
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
              <Button className="hidden h-8 w-8 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-slate-300 sm:inline-flex" size="icon" variant="ghost" aria-label={t("editor.versionHistory")} onClick={() => setHistoryOpen(true)}>
                <History className="h-5 w-5" strokeWidth={2.25} />
              </Button>
            </IconTooltip>
            <GitHubRepositoryLink className="hidden h-8 w-8 justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 lg:inline-flex" iconClassName="h-5 w-5" />
            <IconTooltip label={t("systemInfo.title")}>
              <Button className="relative hidden h-8 w-8 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-500/70 sm:inline-flex" size="icon" variant="ghost" aria-label={t("systemInfo.title")} onClick={() => setSystemInfoOpen(true)}>
                <Info className="h-5 w-5" strokeWidth={2.25} />
                {updateAvailable ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-white" /> : null}
              </Button>
            </IconTooltip>
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
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={() => openNoteSearch()}
                >
                  <Search className="h-4 w-4 text-slate-500" />
                  {t("editor.searchCurrentMemo")}
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
                      onClick={() => {
                        const name = window.prompt(t("templates.templateNamePrompt"), memo.title || "");
                        if (name?.trim()) {
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
                        }
                      }}
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
            className="block w-full rounded-md border-0 bg-transparent text-2xl font-bold leading-tight text-slate-950 outline-none transition placeholder:text-slate-300 focus-visible:bg-slate-50 focus-visible:shadow-[inset_3px_0_0_var(--brand-green)] sm:text-3xl"
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
                  <SelectValue placeholder={t("editor.notebookPlaceholder")} />
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
            <label className="flex h-8 min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-sm text-slate-500 transition focus-within:border-slate-200 focus-within:bg-slate-50 focus-within:ring-2 focus-within:ring-emerald-500/15">
              <Tags className="h-4 w-4" />
              <input
                value={tagsText}
                readOnly={effectiveReadOnly}
                onChange={(event) => {
                  setTagsText(event.target.value);
                  persistCurrentDraft(title, event.target.value, getMobilePlainTextValue());
                  markDirty();
                }}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
                placeholder={t("editor.tagPlaceholder")}
              />
            </label>
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
          />
        )}
      </header>

      <div
        ref={setEditorScrollContainerRef}
        data-editor-theme={editorTheme}
        style={editorTheme === "custom" ? {
          "--editor-theme-bg": customEditorTheme.background,
          "--editor-theme-text": customEditorTheme.text,
          "--editor-theme-heading": customEditorTheme.heading,
          "--editor-theme-accent": customEditorTheme.accent,
          "--editor-theme-soft": customEditorTheme.soft,
          "--editor-theme-border": customEditorTheme.border,
        } as CSSProperties : undefined}
        className={cn(
          "edgeever-editor relative min-h-0 flex-1 bg-white",
          useMobilePlainTextEditor ? "overflow-visible" : "overflow-y-auto"
        )}
      >
        <div
          className={cn(
            "flex min-h-full items-start gap-8 px-6 py-6 sm:px-10 transition-all duration-200",
            desktopFocusMode
              ? "mx-auto w-full max-w-[1400px] justify-center"
              : "w-full justify-start"
          )}
        >
          <div
            className={cn(
              "min-w-0 flex-1 transition-[max-width] duration-200",
              desktopFocusMode
                ? "max-w-[960px]"
                : "max-w-[var(--editor-content-max-width,880px)]"
            )}
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
              <textarea
                value={markdownSource}
                onChange={(event) => handleMarkdownSourceChange(event.target.value)}
                readOnly={effectiveReadOnly}
                spellCheck={false}
                aria-label={t("editor.markdownSourceAria")}
                className="block min-h-[300px] h-full w-full resize-none border-0 bg-slate-950 px-4 py-3 font-mono text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 sm:px-7"
                placeholder={`# ${t("editor.placeholder")}`}
              />
            ) : (
              <EditorContent editor={editor} />
            )}
          </div>
          {!isMobileViewport && !useMobilePlainTextEditor && !useMarkdownSourceEditor && (
            <EditorOutline editor={editor} scrollContainer={editorScrollContainer} />
          )}
        </div>
      </div>

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
          onClose={() => setHistoryOpen(false)}
          onRestored={async (restoredMemo) => {
            await localDb.drafts.delete(restoredMemo.id);
            hasUnsavedChangesRef.current = false;
            setHasUnsavedChanges(false);
            await onSaved(restoredMemo);
            setHistoryOpen(false);
          }}
        />
      )}

      <SystemInfoDialog open={systemInfoOpen} onOpenChange={setSystemInfoOpen} />

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
