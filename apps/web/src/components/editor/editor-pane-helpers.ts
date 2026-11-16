import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import type { MemoDetail, MemoEditSession, TiptapDoc } from "@edgeever/shared";
import { releaseHtmlMediaSources } from "@/lib/editor-media-release";
import { isDesktopResourceRuntime } from "@/lib/desktop-resources";
import { isBrowserOffline } from "@/lib/network-status";
import { isLocalMemoId } from "@/lib/local-mirror";
import type { MemoUpdateSyncPayload } from "@/lib/local-db";
import { getAttachmentLinkFromEventTarget } from "./attachment-resource-menu";
import type { NoteLinkHintPosition } from "./EditorPaneChrome";

export { SUPPORTED_IMAGE_MIME_TYPES as SUPPORTED_PASTE_IMAGE_TYPES } from "@edgeever/shared";
export const MOBILE_EDITOR_QUERY = "(max-width: 639px)";
export const MOBILE_DRAFT_PERSIST_DELAY_MS = 800;

export const createLocalEditSession = (memo: MemoDetail): MemoEditSession => ({
  id: `local-edit:${memo.id}`,
  memoId: memo.id,
  baseRevision: memo.revision,
  baseContentHash: memo.contentHash,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

export const requiresLocalEditSession = (memo: MemoDetail) =>
  isDesktopResourceRuntime() ||
  isLocalMemoId(memo.id) ||
  isBrowserOffline();

export type AiSelectionContext = {
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

export type AiInsertionTarget = {
  kind: "markdown" | "plain" | "rich";
  position: number;
};

export const getNoteLinkFromEventTarget = (target: EventTarget | null) =>
  target instanceof Element
    ? target.closest<HTMLAnchorElement>('a.edgeever-note-link, a[href^="#memo="]')
    : null;

/** Any navigable editor link (external or note). Attachment chips have their own menu. */
export const getEditorNavigableLinkFromEventTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return null;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link || getAttachmentLinkFromEventTarget(link)) {
    return null;
  }

  return link;
};

export const getNoteLinkHintPosition = (link: HTMLAnchorElement): NoteLinkHintPosition => {
  const rect = link.getBoundingClientRect();
  const placement = rect.top < 48 ? "below" : "above";

  return {
    left: Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12),
    top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
    placement,
  };
};

export type MobilePlainTextElement = HTMLTextAreaElement | HTMLDivElement;

export const isEditorReady = (editor: Editor | null | undefined): editor is Editor =>
  Boolean(editor && !editor.isDestroyed && (editor as { extensionManager?: unknown }).extensionManager);

export const releaseEditorMedia = (editor: Editor) => {
  releaseHtmlMediaSources(editor.view.dom);
};

/**
 * Replace the document with a fresh EditorState so undo/redo cannot leak
 * across memos. Cheaper than destroying the TipTap view on every switch.
 * Release removed media after updating; unchanged image NodeViews are reused.
 */
export const resetEditorDocument = (editor: Editor, content: TiptapDoc) => {
  const root=editor.view.dom;
  const previousMedia=Array.from(root.querySelectorAll("img, iframe, embed, object, video, audio, source, canvas"));
  editor.view.updateState(EditorState.create({
    schema: editor.schema,
    doc: editor.schema.nodeFromJSON(content),
    plugins: editor.state.plugins,
  }));
  // updateState bypasses TipTap's transaction subscribers. Refresh node-view
  // controls even when the new note reuses the same image and selection.
  editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  releaseHtmlMediaSources({
    querySelectorAll: (selector)=>previousMedia.filter(node=>node.matches(selector) && !root.contains(node)),
  });
};

export const CREATED_MEMO_FOCUS_MAX_ATTEMPTS = 120;

export const isCreatedMemoEditorFocused = (editor: Editor | null | undefined) =>
  isEditorReady(editor) && editor.isEditable && (editor.isFocused || editor.view.hasFocus());

/**
 * Keep retrying create-note autofocus until the editor is actually editable
 * and focused. Hydration sets a ref before React has flipped `editable`, and
 * desktop id remapping can blur a successful first focus.
 */
export const shouldRetryCreatedMemoFocus = ({
  attempt,
  editorEditable,
  editorFocused,
  editorReady,
  hydratedForMemo,
  maxAttempts = CREATED_MEMO_FOCUS_MAX_ATTEMPTS,
}: {
  attempt: number;
  editorEditable: boolean;
  editorFocused: boolean;
  editorReady: boolean;
  hydratedForMemo: boolean;
  maxAttempts?: number;
}) => {
  if (attempt >= maxAttempts) return false;
  if (!editorReady || !hydratedForMemo || !editorEditable) return true;
  return !editorFocused;
};

export const getMobilePlainTextElementValue = (element: MobilePlainTextElement | null) => {
  if (!element) {
    return "";
  }

  return "value" in element ? element.value : element.innerText;
};

export const setMobilePlainTextElementValue = (element: MobilePlainTextElement | null, value: string) => {
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

export const focusMobilePlainTextElement = (element: MobilePlainTextElement | null) => {
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

export const getResourceFilesFromDataTransfer = (dataTransfer: DataTransfer | null) => {
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

/** Block-handle drags set view.dragging; Chrome may also attach a preview image as a file. */
export const shouldInsertDroppedResourceFiles = ({
  dataTransfer,
  isInternalNodeDrag,
}: {
  dataTransfer: DataTransfer | null;
  isInternalNodeDrag: boolean;
}) => !isInternalNodeDrag && getResourceFilesFromDataTransfer(dataTransfer).length > 0;

/** Shared by the ProseMirror surface and its surrounding blank canvas. */
export const handleResourceFileDrop = (
  view: Pick<EditorView, "editable" | "dragging" | "posAtCoords" | "state">,
  event: DragEvent,
  insertFiles: (files: File[], position: number) => boolean,
) => {
  if (event.defaultPrevented || !view.editable || !shouldInsertDroppedResourceFiles({
    dataTransfer: event.dataTransfer,
    isInternalNodeDrag: Boolean(view.dragging),
  })) return false;

  // Never replace the current selection. Blank canvas below the document may
  // have no ProseMirror coordinate, so append at the document boundary instead.
  const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
    ?? view.state.doc.content.size;
  event.preventDefault();
  return insertFiles(getResourceFilesFromDataTransfer(event.dataTransfer), position);
};

export const syncStatusToSaveState = (status: "pending" | "syncing" | "conflict" | "error") => {
  if (status === "conflict") {
    return "conflict";
  }
  if (status === "syncing") {
    return "saving";
  }
  return "queued";
};

export class MemoSaveRequestError extends Error {
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
};
