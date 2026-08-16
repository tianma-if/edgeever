'use dom';

import "mermaid/dist/mermaid.min.js";
import "katex/dist/katex.min.css";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import Image from "@tiptap/extension-image";
import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as Clipboard from "expo-clipboard";
import {
  AI_SELECTED_TEXT_ACTIONS,
  AI_TARGET_LANGUAGES,
  AI_TONES,
  AI_WHOLE_NOTE_ACTIONS,
  canReplaceAiSource,
  docToMarkdown,
  getDefaultAiTargetLanguage,
  getAiDocumentFingerprint,
  isAiSelectionSnapshotCurrent,
  markdownToDoc,
  MEMO_CONTENT_STYLE,
  MergeDivider,
  getImageReferrerPolicy,
  getResourceIdFromUrl,
  type AiAction,
  type AiPromptParameterKind,
  type AiPromptResultMode,
  type AiPromptTemplate,
  type AiStreamEvent,
  type AiTargetLanguage,
  type AiTone,
  type TiptapDoc,
} from "@edgeever/shared";
import { createEdgeEverMathematics } from "@edgeever/shared/mathematics";
import {
  DEFAULT_IMAGE_WIDTH_PERCENT,
  IMAGE_WIDTH_PRESETS,
  clampImageWidth,
  parseImageWidth,
} from "@edgeever/shared/image-display";
import {
  MOBILE_EDITOR_ACTIVE_FLAGS,
  MOBILE_EDITOR_TOOLBAR_ACTIONS,
  getMobileEditorInputAttributes,
  getMobileEditorImageScaleLabel,
  getMobileEditorImageWidthPresetLabel,
  getMobileEditorPlaceholder,
  getMobileEditorToolbarActionLabel,
  getMobileEditorToolbarLabel,
  type MobileEditorToolbarActionId,
} from "@edgeever/shared/mobile-editor";
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from "expo/dom";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type Ref, type SetStateAction } from "react";
import {
  createMobileImageUploadPlaceholderSource,
  isMobileImageUploadPlaceholderSource,
  stripMobileImageUploadPlaceholders,
} from "../lib/mobile-image-upload-placeholder";
import { getMobileAiSourceRange } from "../lib/mobile-ai-selection";
import {
  MOBILE_NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY,
  createMobileNoteSearchHighlightPlugin,
  getMobileNoteSearchMatches,
} from "../lib/mobile-note-search";
import { toProtectedResourceLoadPath } from "../lib/mobile-protected-resources";

type EditorDoc = TiptapDoc;

type DOMValue = Parameters<DOMImperativeFactory[string]>[0];

export interface LocalTiptapEditorRef extends DOMImperativeFactory {
  beginImageUpload: (uploadId: DOMValue, previewDataUrl: DOMValue) => void;
  cancelImageUpload: (uploadId: DOMValue) => void;
  completeImageUpload: (uploadId: DOMValue, imageUrl: DOMValue, alt: DOMValue) => void;
  appendAttachment: (attachmentUrl: DOMValue, filename: DOMValue) => void;
  removeResource: (targetJson: DOMValue) => void;
  renameResource: (targetJson: DOMValue, filename: DOMValue) => void;
  /** Replace body without remounting the DomWebView (JSON string of TipTap doc). */
  setContent: (contentJsonSerialized: DOMValue) => void;
  flush: () => void;
  focusEnd: () => void;
  replaceAll: (query: DOMValue, replacement: DOMValue) => void;
  search: (query: DOMValue, index: DOMValue) => void;
  pushAiStreamEvent: (payloadJson: DOMValue) => void;
}

type LocalTiptapEditorSharedProps = {
  baseUrl: string;
  content: EditorDoc;
  dom?: DOMProps;
  onLoadResource: (source: string) => Promise<string | null>;
  onResourcePress?: (targetJson: string) => Promise<void>;
  onReady?: (startupMs: number) => Promise<void>;
  onSearchResult?: (count: number, index: number, query: string) => Promise<void>;
  ref: Ref<LocalTiptapEditorRef>;
  locale: "zh-CN" | "en-US";
  theme: "light" | "dark";
};

/** Editable note body with toolbar (create / rich edit). */
type LocalTiptapEditorModeProps = LocalTiptapEditorSharedProps & {
  mode?: "editor";
  aiPromptsJson?: string;
  autoFocus?: boolean;
  onChange: (content: EditorDoc) => Promise<void>;
  onPickImage: () => Promise<void>;
  onAiRequest?: (requestJson: string) => Promise<void>;
  onAiCancel?: (requestId: string) => Promise<void>;
  onReady: (startupMs: number) => Promise<void>;
};

/**
 * Read-only note body that reuses the same TipTap schema / image loading as the
 * editor. Used by the native memo detail chrome (scheme C).
 */
type LocalTiptapViewerModeProps = LocalTiptapEditorSharedProps & {
  mode: "viewer";
  /** JSON: `{ alt: string; source: string }` for fullscreen image preview. */
  onImagePreview?: (payloadJson: string) => Promise<void>;
};

type LocalTiptapEditorProps = LocalTiptapEditorModeProps | LocalTiptapViewerModeProps;

type MermaidRendererProps = {
  diagramsJson: string;
  dom?: DOMProps;
  mode: "mermaid-renderer";
  onRendered: (resultsJson: string) => Promise<void>;
  theme: "light" | "dark";
};

const CHANGE_IDLE_MS = 500;
const TRANSIENT_IMAGE_UPLOAD_META = "edgeeverImageUploadPlaceholder";
const ignoreSearchResult = async () => undefined;
const ignoreAiRequest = async () => undefined;
const AI_PROMPT_OPTION_PREFIX = "prompt:";

const fallbackPromptParameterKind = (action: AiAction): AiPromptParameterKind =>
  action === "translate" ? "target-language" : action === "change-tone" ? "tone" : "none";

const fallbackPromptResultMode = (action: AiAction): AiPromptResultMode =>
  canReplaceAiSource(action) ? "both" : "append";

type MobileAiSelection = {
  from: number;
  to: number;
  wholeNote: boolean;
  markdown: string;
  documentFingerprint: string;
};

type MobileAiPanelState = {
  selection: MobileAiSelection;
  action: AiAction;
  promptId: string | null;
  parameterKind: AiPromptParameterKind;
  resultMode: AiPromptResultMode;
  targetLanguage: AiTargetLanguage;
  tone: AiTone;
  customInstruction: string;
  refineInstruction: string;
  output: string;
  error: string | null;
  generating: boolean;
  requestId: string | null;
};

type MobileAiBridgePayload = {
  requestId: string;
  event: AiStreamEvent;
};

type EditorResourceTarget = {
  filename: string;
  href: string;
  kind: "attachment" | "image";
  resourceId: string;
};

const parseMobileResourceTarget = (value: string): EditorResourceTarget | null => {
  try {
    const parsed = JSON.parse(value) as Partial<EditorResourceTarget>;
    if (typeof parsed.href !== "string" || typeof parsed.filename !== "string") return null;
    if (parsed.kind !== "attachment" && parsed.kind !== "image") return null;
    const resourceId = getResourceIdFromUrl(parsed.href);
    if (!resourceId || (parsed.resourceId && parsed.resourceId !== resourceId)) return null;
    return { filename: parsed.filename, href: parsed.href, kind: parsed.kind, resourceId };
  } catch {
    return null;
  }
};

const normalizeEditorAttachmentFilename = (label: string, resourceId: string) =>
  label.replace(/^\s*(?:附件[：:]|Attachment:)\s*/i, "").trim() || resourceId;

/** Accept both `/api/v1/resources/:id/blob` and bare `/api/v1/resources/:id` image srcs. */
const getMobileImageResourceId = (href: string): string | null => {
  const fromBlob = getResourceIdFromUrl(href);
  if (fromBlob) return fromBlob;
  try {
    const parsed = new URL(href, "http://edgeever.local");
    const match = parsed.pathname.match(/^\/api\/v1\/resources\/([^/]+)\/?$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
};

const normalizeMobileResourceHref = (href: string, resourceId: string) => {
  if (getResourceIdFromUrl(href)) return href;
  if (href.startsWith("/api/v1/resources/")) {
    return `/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;
  }
  return href;
};

const buildImageResourceTargetJson = (figure: HTMLElement): string | null => {
  const href = figure.dataset.resourceHref ?? "";
  const resourceId = getMobileImageResourceId(href);
  if (!resourceId) return null;
  return JSON.stringify({
    filename: figure.dataset.resourceFilename || `image-${resourceId}`,
    href: normalizeMobileResourceHref(href, resourceId),
    kind: "image",
    resourceId,
  } satisfies EditorResourceTarget);
};

const handleMobileResourceEvent = (
  event: Event,
  onResourcePress?: (targetJson: string) => Promise<void>,
  options?: { allowImagePreview?: boolean; onImagePreview?: (payloadJson: string) => Promise<void> }
) => {
  const element = event.target instanceof Element ? event.target : null;
  const link = element?.closest<HTMLAnchorElement>('a.edgeever-attachment-link, a[href*="/api/v1/resources/"]');
  const href = link?.getAttribute("href") ?? "";
  const resourceId = getResourceIdFromUrl(href) ?? getMobileImageResourceId(href);
  if (link && resourceId && onResourcePress) {
    event.preventDefault();
    event.stopPropagation();
    void onResourcePress(JSON.stringify({
      filename: normalizeEditorAttachmentFilename(link.textContent ?? "", resourceId),
      href: normalizeMobileResourceHref(href, resourceId),
      kind: "attachment",
      resourceId,
    } satisfies EditorResourceTarget));
    return true;
  }

  const imageFigure = element?.closest<HTMLElement>("figure.edgeever-image-node");
  const imageHref = imageFigure?.dataset.resourceHref ?? "";
  if (!imageFigure || !imageHref) return false;

  const imageActionRequested = event.type === "contextmenu" || Boolean(element?.closest(".edgeever-image-actions"));
  if (imageActionRequested && onResourcePress) {
    const targetJson = buildImageResourceTargetJson(imageFigure);
    if (!targetJson) return false;
    event.preventDefault();
    event.stopPropagation();
    void onResourcePress(targetJson);
    return true;
  }

  // Viewer: plain image tap opens native fullscreen preview.
  if (options?.allowImagePreview && options.onImagePreview && !imageActionRequested) {
    event.preventDefault();
    event.stopPropagation();
    void options.onImagePreview(JSON.stringify({
      alt: imageFigure.dataset.resourceFilename || "",
      source: imageHref,
    }));
    return true;
  }

  return false;
};

const getMobileMermaidTheme = (theme: "light" | "dark") => THEMES[theme === "dark" ? "zinc-dark" : "zinc-light"];

const renderWithBeautifulMermaid = (source: string, theme: "light" | "dark") => {
  try {
    return renderMermaidSVG(source, {
      ...getMobileMermaidTheme(theme),
      transparent: true,
      font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      padding: 24,
    });
  } catch {
    return null;
  }
};

export default function LocalTiptapEditor(props: LocalTiptapEditorProps | MermaidRendererProps) {
  return props.mode === "mermaid-renderer"
    ? <MermaidRenderRuntime {...props} />
    : <LocalTiptapEditorImpl {...props} />;
}

const MermaidRenderRuntime = (props: MermaidRendererProps) => {
  useEffect(() => {
    let cancelled = false;

    const renderDiagrams = async () => {
      let sources: string[] = [];
      try {
        const parsed = JSON.parse(props.diagramsJson) as unknown;
        sources = Array.isArray(parsed)
          ? parsed.filter((source): source is string => typeof source === "string" && source.trim().length > 0)
          : [];
      } catch {
        sources = [];
      }

      const mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        themeVariables: getMobileMermaidThemeVariables(props.theme),
        flowchart: { htmlLabels: false },
      });

      const results: Array<{ source: string; svg: string | null }> = [];
      for (const source of sources) {
        try {
          const beautifulSvg = renderWithBeautifulMermaid(source, props.theme);
          if (beautifulSvg) {
            results.push({ source, svg: inlineMermaidSvgStyles(beautifulSvg) });
            continue;
          }
          const valid = await mermaid.parse(source, { suppressErrors: true });
          if (!valid) {
            throw new Error("Invalid Mermaid diagram");
          }
          mermaidRenderSequence += 1;
          const { svg } = await mermaid.render(`edgeever-mobile-mermaid-${mermaidRenderSequence}`, source);
          results.push({ source, svg: inlineMermaidSvgStyles(svg) });
        } catch {
          results.push({ source, svg: null });
        }
      }

      if (!cancelled) {
        await props.onRendered(JSON.stringify(results));
      }
    };

    void renderDiagrams().catch(() => {
      if (!cancelled) {
        void props.onRendered("[]");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.diagramsJson, props.onRendered, props.theme]);

  return null;
};

const inlineMermaidSvgStyles = (svg: string) => {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:-10000px;visibility:hidden;";
  container.innerHTML = svg;
  document.body.append(container);

  const root = container.querySelector("svg");
  if (!root) {
    container.remove();
    return svg;
  }

  for (const foreignObject of root.querySelectorAll("foreignObject")) {
    const label = foreignObject.textContent?.replace(/\s+/g, " ").trim();
    if (!label) {
      foreignObject.remove();
      continue;
    }
    const x = Number.parseFloat(foreignObject.getAttribute("x") ?? "0");
    const y = Number.parseFloat(foreignObject.getAttribute("y") ?? "0");
    const width = Number.parseFloat(foreignObject.getAttribute("width") ?? "0");
    const height = Number.parseFloat(foreignObject.getAttribute("height") ?? "0");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x + width / 2));
    text.setAttribute("y", String(y + height / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-size", "16px");
    text.textContent = label;
    foreignObject.replaceWith(text);
  }

  const properties = [
    "color",
    "fill",
    "fill-opacity",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "opacity",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-opacity",
    "stroke-width",
    "text-anchor",
  ] as const;

  for (const element of root.querySelectorAll<SVGElement>("*")) {
    const computed = getComputedStyle(element);
    for (const property of properties) {
      const value = computed.getPropertyValue(property);
      if (value) {
        element.setAttribute(property, value);
      }
    }
  }

  const serialized = new XMLSerializer().serializeToString(root);
  container.remove();
  return serialized;
};

const getEditorScrollContainer = (editor: Editor) =>
  editor.view.dom.closest<HTMLElement>(".edgeever-editor-scroll");

const updateEditorKeyboardInset = (editor: Editor) => {
  const scrollContainer = getEditorScrollContainer(editor);
  if (!scrollContainer) {
    return;
  }
  const visualViewport = window.visualViewport;
  const visibleBottom = visualViewport
    ? visualViewport.offsetTop + visualViewport.height
    : window.innerHeight;
  const keyboardInset = Math.max(0, window.innerHeight - visibleBottom);
  scrollContainer.style.setProperty("--edgeever-keyboard-inset", `${Math.round(keyboardInset)}px`);
};

const scrollEditorPositionIntoView = (
  editor: Editor,
  position: number,
  options: { behavior?: ScrollBehavior; center?: boolean } = {}
) => {
  const scrollContainer = getEditorScrollContainer(editor);
  if (!scrollContainer) {
    return;
  }
  try {
    const containerRect = scrollContainer.getBoundingClientRect();
    const positionRect = editor.view.coordsAtPos(position);
    const visualViewport = window.visualViewport;
    const visibleTop = Math.max(containerRect.top, visualViewport?.offsetTop ?? containerRect.top);
    const visibleBottom = Math.min(
      containerRect.bottom,
      visualViewport ? visualViewport.offsetTop + visualViewport.height : containerRect.bottom
    );
    const padding = 24;
    const isAbove = positionRect.top < visibleTop + padding;
    const isBelow = positionRect.bottom > visibleBottom - padding;
    if (!isAbove && !isBelow) {
      return;
    }
    const targetTop = options.center
      ? scrollContainer.scrollTop + positionRect.top - visibleTop
        - (visibleBottom - visibleTop - Math.max(positionRect.bottom - positionRect.top, 1)) / 2
      : scrollContainer.scrollTop + (isAbove
        ? positionRect.top - visibleTop - padding
        : positionRect.bottom - visibleBottom + padding);
    scrollContainer.scrollTo({
      behavior: options.behavior ?? "auto",
      top: Math.max(0, targetTop),
    });
  } catch {
    // The selection can disappear while content is being replaced. The next
    // selection/viewport update will retry with a valid document position.
  }
};

function LocalTiptapEditorImpl(props: LocalTiptapEditorProps) {
  const isViewer = props.mode === "viewer";
  const autoFocus = props.mode === "viewer" ? false : Boolean(props.autoFocus);
  const aiPromptsJson = props.mode === "viewer" ? "[]" : (props.aiPromptsJson ?? "[]");
  const aiPrompts = useMemo(() => {
    try {
      const parsed = JSON.parse(aiPromptsJson) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((prompt): prompt is AiPromptTemplate =>
        Boolean(prompt)
        && typeof prompt === "object"
        && typeof (prompt as Partial<AiPromptTemplate>).id === "string"
        && typeof (prompt as Partial<AiPromptTemplate>).name === "string"
        && typeof (prompt as Partial<AiPromptTemplate>).action === "string");
    } catch {
      return [];
    }
  }, [aiPromptsJson]);
  const startedAtRef = useRef(performance.now());
  const changeTimerRef = useRef<number | null>(null);
  const imageUploadInFlightRef = useRef(false);
  const pendingImageSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const onChangeRef = useRef(props.mode === "viewer" ? undefined : props.onChange);
  const onLoadResourceRef = useRef(props.onLoadResource);
  const onResourcePressRef = useRef(props.onResourcePress);
  const onImagePreviewRef = useRef(props.mode === "viewer" ? props.onImagePreview : undefined);
  const onPickImageRef = useRef(props.mode === "viewer" ? undefined : props.onPickImage);
  const onAiRequestRef = useRef(props.mode === "viewer" ? undefined : props.onAiRequest);
  const onAiCancelRef = useRef(props.mode === "viewer" ? undefined : props.onAiCancel);
  const onReadyRef = useRef(props.onReady ?? (async () => undefined));
  const onSearchResultRef = useRef(props.onSearchResult ?? ignoreSearchResult);
  const searchStateRef = useRef({ activeIndex: -1, query: "" });
  const [aiPanel, setAiPanel] = useState<MobileAiPanelState | null>(null);
  const [aiSelectionHint, setAiSelectionHint] = useState(false);
  const aiSelectionHintTimerRef = useRef<number | null>(null);
  const [aiUndoFingerprint, setAiUndoFingerprint] = useState<string | null>(null);
  const aiUndoTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setAiPanel((current) => {
      if (!current) return current;
      if (current.promptId) {
        const selected = aiPrompts.find((prompt) => prompt.id === current.promptId);
        if (!selected) {
          return {
            ...current,
            action: "custom",
            promptId: null,
            parameterKind: "none",
            resultMode: "both",
            output: "",
            error: props.locale === "en-US"
              ? "The selected prompt no longer exists. Choose another prompt."
              : "所选指令已不存在，请重新选择。",
          };
        }
        return {
          ...current,
          action: selected.action,
          parameterKind: selected.parameterKind,
          resultMode: selected.resultMode,
        };
      }
      if (current.action === "custom" || aiPrompts.length === 0) return current;
      const preferred = aiPrompts.find((prompt) => prompt.seedKey === current.action)
        ?? aiPrompts[0];
      return preferred ? {
        ...current,
        action: preferred.action,
        promptId: preferred.id,
        parameterKind: preferred.parameterKind,
        resultMode: preferred.resultMode,
      } : current;
    });
  }, [aiPrompts, props.locale]);

  onChangeRef.current = props.mode === "viewer" ? undefined : props.onChange;
  onLoadResourceRef.current = props.onLoadResource;
  onResourcePressRef.current = props.onResourcePress;
  onImagePreviewRef.current = props.mode === "viewer" ? props.onImagePreview : undefined;
  onPickImageRef.current = props.mode === "viewer" ? undefined : props.onPickImage;
  onAiRequestRef.current = props.mode === "viewer" ? undefined : props.onAiRequest;
  onAiCancelRef.current = props.mode === "viewer" ? undefined : props.onAiCancel;
  onReadyRef.current = props.onReady ?? (async () => undefined);
  onSearchResultRef.current = props.onSearchResult ?? ignoreSearchResult;
  const protectedImageExtension = useMemo(
    () => createProtectedImageExtension(
      props.baseUrl,
      props.locale,
      (source) => onLoadResourceRef.current(source),
      {
        readOnly: isViewer,
        // NodeView binds ⋯ / image taps directly — Android WebView often drops
        // click after pointerdown preventDefault, so PM handleClick is not enough.
        onResourcePress: (targetJson) => onResourcePressRef.current?.(targetJson),
        onImagePreview: (payloadJson) => onImagePreviewRef.current?.(payloadJson),
      }
    ),
    [isViewer, props.baseUrl, props.locale]
  );
  const mermaidCodeBlockExtension = useMemo(
    () => createMobileCodeBlockExtension(props.locale, props.theme),
    [props.locale, props.theme]
  );
  const searchHighlightExtension = useMemo(
    () => Extension.create({
      name: "edgeeverMobileNoteSearchHighlight",
      addProseMirrorPlugins() {
        return [createMobileNoteSearchHighlightPlugin({
          getActiveIndex: () => searchStateRef.current.activeIndex,
          getQuery: () => searchStateRef.current.query,
        })];
      },
    }),
    []
  );

  const editor = useEditor({
    editable: !isViewer,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      MergeDivider,
      ...createEdgeEverMathematics(),
      mermaidCodeBlockExtension,
      protectedImageExtension,
      searchHighlightExtension,
      TableKit.configure({
        table: { renderWrapper: true },
      }),
      ...(isViewer
        ? []
        : [Placeholder.configure({
            placeholder: getMobileEditorPlaceholder(props.locale),
          })]),
    ],
    content: resolveImageSources(props.content, props.baseUrl),
    editorProps: {
      attributes: getMobileEditorInputAttributes(
        isViewer ? "edgeever-editor-content edgeever-viewer-content" : "edgeever-editor-content"
      ),
      handleClick: (_view, _pos, event) => handleMobileResourceEvent(event, onResourcePressRef.current, {
        allowImagePreview: isViewer,
        onImagePreview: onImagePreviewRef.current,
      }),
      handleDOMEvents: {
        contextmenu: (_view, event) => handleMobileResourceEvent(event, onResourcePressRef.current, {
          allowImagePreview: false,
          onImagePreview: onImagePreviewRef.current,
        }),
      },
    },
    onUpdate: ({ editor: activeEditor, transaction }) => {
      if (isViewer || !onChangeRef.current) {
        return;
      }
      if (transaction.getMeta(TRANSIENT_IMAGE_UPLOAD_META)) {
        return;
      }
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
      }
      changeTimerRef.current = window.setTimeout(() => {
        changeTimerRef.current = null;
        void onChangeRef.current?.(getPersistableEditorDoc(activeEditor.getJSON() as EditorDoc, props.baseUrl));
      }, CHANGE_IDLE_MS);
    },
  });

  const flush = useCallback(() => {
    if (isViewer || !editor || editor.isDestroyed || !onChangeRef.current) {
      return;
    }
    if (changeTimerRef.current !== null) {
      window.clearTimeout(changeTimerRef.current);
      changeTimerRef.current = null;
    }
    void onChangeRef.current(getPersistableEditorDoc(editor.getJSON() as EditorDoc, props.baseUrl));
  }, [editor, isViewer, props.baseUrl]);

  const setContent = useCallback((contentJsonSerialized: DOMValue) => {
    if (!editor || editor.isDestroyed || typeof contentJsonSerialized !== "string") {
      return;
    }
    try {
      const parsed = JSON.parse(contentJsonSerialized) as EditorDoc;
      const next = resolveImageSources(parsed, props.baseUrl);
      // Do not focus while replacing content. Callers decide when the editor should
      // take focus and place the caret via focusEnd().
      // This command synchronizes native-owned state (draft restore/template/new
      // composer reset). Callers already own persistence for that state, so an
      // emitted update would create a delayed stale write during screen teardown.
      editor.commands.setContent(next, { emitUpdate: false });
    } catch {
      // Ignore malformed payloads from the native bridge.
    }
  }, [editor, props.baseUrl]);

  const search = useCallback((query: DOMValue, requestedIndex: DOMValue) => {
    const normalizedQuery = typeof query === "string" ? query : "";
    const matches = editor && !editor.isDestroyed
      ? getMobileNoteSearchMatches(editor.state.doc, normalizedQuery)
      : [];
    const requestedMatchIndex = typeof requestedIndex === "number" ? requestedIndex : 0;
    const index = matches.length > 0
      ? requestedMatchIndex < 0
        ? -1
        : Math.min(Math.max(requestedMatchIndex, 0), matches.length - 1)
      : 0;
    searchStateRef.current = {
      activeIndex: matches.length > 0 ? index : -1,
      query: normalizedQuery,
    };
    const match = index >= 0 ? matches[index] : undefined;
    if (editor && !editor.isDestroyed) {
      if (match) {
        editor.chain().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();
        window.requestAnimationFrame(() => {
          scrollEditorPositionIntoView(editor, match.from, { behavior: "smooth", center: true });
        });
      } else {
        editor.view.dispatch(editor.state.tr.setMeta(MOBILE_NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY, true));
      }
    }
    void onSearchResultRef.current(matches.length, index, normalizedQuery);
  }, [editor]);

  const replaceAll = useCallback((query: DOMValue, replacement: DOMValue) => {
    const normalizedQuery = typeof query === "string" ? query : "";
    const normalizedReplacement = typeof replacement === "string" ? replacement : "";
    const matches = editor && !editor.isDestroyed
      ? getMobileNoteSearchMatches(editor.state.doc, normalizedQuery)
      : [];
    if (!editor || editor.isDestroyed || matches.length === 0) {
      void onSearchResultRef.current(0, 0, normalizedQuery);
      return;
    }
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        for (const match of [...matches].reverse()) {
          tr.insertText(normalizedReplacement, match.from, match.to);
        }
        dispatch?.(tr);
        return true;
      })
      .run();
    window.requestAnimationFrame(() => search(normalizedQuery, 0));
  }, [editor, search]);

  const beginImageUpload = useCallback((uploadIdValue: DOMValue, previewDataUrlValue: DOMValue) => {
    if (isViewer || !editor || typeof uploadIdValue !== "string" || typeof previewDataUrlValue !== "string") {
      return;
    }
    insertImageUploadPlaceholder(
      editor,
      createMobileImageUploadPlaceholderSource(uploadIdValue),
      props.locale === "en-US" ? "Uploading image…" : "图片上传中…",
      previewDataUrlValue,
      pendingImageSelectionRef.current
    );
  }, [editor, isViewer, props.locale]);

  const cancelImageUpload = useCallback((uploadIdValue: DOMValue) => {
    if (!editor || typeof uploadIdValue !== "string") {
      return;
    }
    removeImageUploadPlaceholder(editor, createMobileImageUploadPlaceholderSource(uploadIdValue));
  }, [editor]);

  const completeImageUpload = useCallback((uploadIdValue: DOMValue, imageUrlValue: DOMValue, altValue: DOMValue) => {
    if (!editor || typeof uploadIdValue !== "string" || typeof imageUrlValue !== "string") {
      return;
    }
    replaceImageUploadPlaceholder(
      editor,
      createMobileImageUploadPlaceholderSource(uploadIdValue),
      resolveUrl(imageUrlValue, props.baseUrl),
      typeof altValue === "string" ? altValue : ""
    );
  }, [editor, props.baseUrl]);

  const appendAttachment = useCallback((attachmentUrlValue: DOMValue, filenameValue: DOMValue) => {
    if (!editor || typeof attachmentUrlValue !== "string" || typeof filenameValue !== "string") {
      return;
    }

    editor.chain().focus().insertContent({
      type: "paragraph",
      content: [{
        type: "text",
        text: `${props.locale === "en-US" ? "Attachment: " : "附件："}${filenameValue}`,
        marks: [{
          type: "link",
          attrs: {
            href: resolveUrl(attachmentUrlValue, props.baseUrl),
            target: "_blank",
            class: "edgeever-attachment-link",
          },
        }],
      }],
    }).run();
  }, [editor, props.baseUrl, props.locale]);

  const renameResource = useCallback((targetJsonValue: DOMValue, filenameValue: DOMValue) => {
    if (!editor || typeof targetJsonValue !== "string" || typeof filenameValue !== "string") return;
    const target = parseMobileResourceTarget(targetJsonValue);
    if (!target) return;
    if (target.kind === "image") {
      const match = findMobileImageRange(editor, target.resourceId);
      if (!match) return;
      const imageNode = editor.state.doc.nodeAt(match.pos);
      if (!imageNode) return;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(match.pos, imageNode.type, {
        ...imageNode.attrs,
        alt: filenameValue,
        title: filenameValue,
      }));
      return;
    }
    const range = findMobileAttachmentRange(editor, target.resourceId);
    if (!range) return;
    const linkMark = editor.schema.marks.link?.create(range.linkAttrs);
    if (!linkMark) return;
    editor.view.dispatch(editor.state.tr.replaceWith(
      range.from,
      range.to,
      editor.schema.text(`${props.locale === "en-US" ? "Attachment: " : "附件："}${filenameValue}`, [linkMark])
    ));
  }, [editor, props.locale]);

  const removeResource = useCallback((targetJsonValue: DOMValue) => {
    if (!editor || typeof targetJsonValue !== "string") return;
    const target = parseMobileResourceTarget(targetJsonValue);
    if (!target) return;
    if (target.kind === "image") {
      const match = findMobileImageRange(editor, target.resourceId);
      if (match) editor.view.dispatch(editor.state.tr.delete(match.pos, match.pos + match.nodeSize));
      return;
    }
    const range = findMobileAttachmentRange(editor, target.resourceId);
    if (!range) return;
    const resolved = editor.state.doc.resolve(range.from);
    let from = range.from;
    let to = range.to;
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const node = resolved.node(depth);
      if (node.type.name !== "paragraph") continue;
      const nodeFrom = resolved.before(depth);
      if (range.from === nodeFrom + 1 && range.to === nodeFrom + node.nodeSize - 1) {
        from = nodeFrom;
        to = nodeFrom + node.nodeSize;
      }
      break;
    }
    editor.view.dispatch(editor.state.tr.delete(from, to));
  }, [editor]);

  const openAiForSelection = useCallback(() => {
    if (isViewer || !editor || editor.isDestroyed || !onAiRequestRef.current) return false;
    const sourceRange = getMobileAiSourceRange(editor.state.selection, editor.state.doc.content.size);
    if (!sourceRange) return false;
    const { from, to, wholeNote } = sourceRange;
    const selectionDoc = getPersistableEditorDoc({
      type: "doc",
      content: editor.state.doc.slice(from, to).content.toJSON(),
    } as EditorDoc, props.baseUrl);
    const markdown = docToMarkdown(selectionDoc).trim();
    if (!markdown) return false;
    const preferredAction = wholeNote ? "summarize" : "improve-writing";
    const preferredPrompt = aiPrompts.find((prompt) => prompt.seedKey === preferredAction)
      ?? aiPrompts[0]
      ?? null;
    const initialAction = preferredPrompt?.action ?? preferredAction;
    setAiPanel({
      selection: {
        from,
        to,
        wholeNote,
        markdown,
        documentFingerprint: getAiDocumentFingerprint(getPersistableEditorDoc(editor.getJSON() as EditorDoc, props.baseUrl)),
      },
      action: initialAction,
      promptId: preferredPrompt?.id ?? null,
      parameterKind: preferredPrompt?.parameterKind ?? fallbackPromptParameterKind(initialAction),
      resultMode: preferredPrompt?.resultMode ?? fallbackPromptResultMode(initialAction),
      targetLanguage: getDefaultAiTargetLanguage(props.locale),
      tone: "professional",
      customInstruction: "",
      refineInstruction: "",
      output: "",
      error: null,
      generating: false,
      requestId: null,
    });
    editor.commands.blur();
    return true;
  }, [aiPrompts, editor, isViewer, props.baseUrl, props.locale]);

  const closeAiPanel = useCallback(() => {
    if (!aiPanel || !editor) return;
    if (aiPanel.requestId) void (onAiCancelRef.current ?? ignoreAiRequest)(aiPanel.requestId);
    const { from, to } = aiPanel.selection;
    setAiPanel(null);
    window.requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      if (aiPanel.selection.wholeNote) {
        editor.chain().focus().selectAll().run();
      } else {
        editor.chain().focus().setTextSelection({ from, to }).run();
      }
    });
  }, [aiPanel, editor]);

  const runAiSelectionRequest = useCallback((refinement?: string) => {
    if (!aiPanel || !onAiRequestRef.current) return;
    const instruction = refinement?.trim();
    const requestId = globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const source = instruction ? aiPanel.output : aiPanel.selection.markdown;
    const action = instruction ? "custom" : aiPanel.action;
    const promptId = instruction ? null : aiPanel.promptId;
    setAiPanel((current) => current ? {
      ...current,
      output: "",
      error: null,
      generating: true,
      requestId,
      refineInstruction: instruction ? "" : current.refineInstruction,
    } : current);
    void onAiRequestRef.current(JSON.stringify({
      requestId,
      action,
      locale: props.locale,
      ...(promptId ? { promptId } : {}),
      contentMarkdown: source,
      ...(aiPanel.parameterKind === "target-language" && !instruction ? { targetLanguage: aiPanel.targetLanguage } : {}),
      ...(aiPanel.parameterKind === "tone" && !instruction ? { tone: aiPanel.tone } : {}),
      ...(!promptId && action === "custom" ? { instruction: instruction ?? aiPanel.customInstruction.trim() } : {}),
    })).catch((requestError) => {
      setAiPanel((current) => current?.requestId === requestId ? {
        ...current,
        generating: false,
        requestId: null,
        error: requestError instanceof Error ? requestError.message : (props.locale === "en-US" ? "AI generation failed." : "AI 生成失败。"),
      } : current);
    });
  }, [aiPanel, props.locale]);

  const pushAiStreamEvent = useCallback((payloadJsonValue: DOMValue) => {
    if (typeof payloadJsonValue !== "string") return;
    try {
      const payload = JSON.parse(payloadJsonValue) as MobileAiBridgePayload;
      if (!payload.requestId || !payload.event) return;
      setAiPanel((current) => {
        if (!current || current.requestId !== payload.requestId) return current;
        if (payload.event.type === "text-delta") {
          return { ...current, output: current.output + payload.event.text };
        }
        if (payload.event.type === "error") {
          return { ...current, generating: false, requestId: null, error: payload.event.message };
        }
        if (payload.event.type === "finish") {
          return { ...current, generating: false, requestId: null };
        }
        return current;
      });
    } catch {
      // Ignore malformed native bridge payloads.
    }
  }, []);

  const stopAiSelectionRequest = useCallback(() => {
    if (!aiPanel?.requestId) return;
    void (onAiCancelRef.current ?? ignoreAiRequest)(aiPanel.requestId);
    setAiPanel((current) => current ? { ...current, generating: false, requestId: null } : current);
  }, [aiPanel?.requestId]);

  const applyAiSelectionDraft = useCallback((mode: "append" | "replace") => {
    if (!aiPanel?.output || !editor || editor.isDestroyed) return;
    const currentDocument = getPersistableEditorDoc(editor.getJSON() as EditorDoc, props.baseUrl);
    if (!isAiSelectionSnapshotCurrent(aiPanel.selection, currentDocument, editor.state.doc.content.size)) {
      setAiPanel((current) => current ? {
        ...current,
        error: props.locale === "en-US"
          ? "The selection expired because the note changed. Select the text again."
          : "笔记内容已变化，选区已失效，请重新选择文本。",
      } : current);
      return;
    }
    if (mode === "append" && aiPanel.resultMode === "replace") return;
    if (mode === "replace" && aiPanel.resultMode === "append") return;
    const parsed = resolveImageSources(markdownToDoc(aiPanel.output), props.baseUrl);
    const content = parsed.content ?? [];
    const range = mode === "append"
      ? { from: aiPanel.selection.to, to: aiPanel.selection.to }
      : { from: aiPanel.selection.from, to: aiPanel.selection.to };
    editor.chain().focus().insertContentAt(range, content).run();
    setAiUndoFingerprint(getAiDocumentFingerprint(getPersistableEditorDoc(editor.getJSON() as EditorDoc, props.baseUrl)));
    if (aiUndoTimerRef.current !== null) window.clearTimeout(aiUndoTimerRef.current);
    aiUndoTimerRef.current = window.setTimeout(() => {
      aiUndoTimerRef.current = null;
      setAiUndoFingerprint(null);
    }, 6500);
    setAiPanel(null);
  }, [aiPanel, editor, props.baseUrl, props.locale]);

  const undoAiSelectionDraft = useCallback(() => {
    if (!aiUndoFingerprint || !editor || editor.isDestroyed) return;
    const currentFingerprint = getAiDocumentFingerprint(getPersistableEditorDoc(editor.getJSON() as EditorDoc, props.baseUrl));
    if (currentFingerprint === aiUndoFingerprint) editor.chain().focus().undo().run();
    setAiUndoFingerprint(null);
    if (aiUndoTimerRef.current !== null) {
      window.clearTimeout(aiUndoTimerRef.current);
      aiUndoTimerRef.current = null;
    }
  }, [aiUndoFingerprint, editor, props.baseUrl]);

  useDOMImperativeHandle(
    props.ref,
    () => ({
      beginImageUpload,
      cancelImageUpload,
      completeImageUpload,
      appendAttachment,
      setContent,
      flush,
      focusEnd: () => {
        if (!isViewer && editor && !editor.isDestroyed) {
          editor.commands.focus("end");
          window.requestAnimationFrame(() => {
            scrollEditorPositionIntoView(editor, editor.state.selection.head);
          });
        }
      },
      removeResource,
      renameResource,
      replaceAll,
      search,
      pushAiStreamEvent,
    }),
    [appendAttachment, beginImageUpload, cancelImageUpload, completeImageUpload, editor, flush, isViewer, pushAiStreamEvent, removeResource, renameResource, replaceAll, search, setContent]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    void onReadyRef.current(Math.round(performance.now() - startedAtRef.current));
    let focusFrame = 0;
    let focusRetry: number | null = null;
    if (autoFocus) {
      const focusAtEnd = () => {
        if (!editor.isDestroyed) {
          editor.commands.focus("end");
        }
      };
      focusFrame = window.requestAnimationFrame(focusAtEnd);
      // The DOM view can report ready one bridge turn before Android attaches
      // its input connection. Keep the HTML selection ready for the native IME
      // handoff without delaying the editor's first visible frame.
      focusRetry = window.setTimeout(focusAtEnd, 120);
    }
    const handlePageHide = () => flush();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    if (!isViewer) {
      window.addEventListener("pagehide", handlePageHide);
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (focusRetry !== null) {
        window.clearTimeout(focusRetry);
      }
      if (!isViewer) {
        window.removeEventListener("pagehide", handlePageHide);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
      }
      if (aiSelectionHintTimerRef.current !== null) {
        window.clearTimeout(aiSelectionHintTimerRef.current);
      }
      if (aiUndoTimerRef.current !== null) {
        window.clearTimeout(aiUndoTimerRef.current);
      }
    };
  }, [autoFocus, editor, flush, isViewer]);

  // Keep the viewer in sync when the parent swaps memo content.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !isViewer) {
      return;
    }
    const next = resolveImageSources(props.content, props.baseUrl);
    const current = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(next);
    if (current !== incoming) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, isViewer, props.baseUrl, props.content]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || isViewer) {
      return;
    }

    let scrollFrame = 0;
    let settledScrollTimer: number | null = null;
    const ensureSelectionVisible = () => {
      updateEditorKeyboardInset(editor);
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        if (!editor.isDestroyed && editor.isFocused) {
          scrollEditorPositionIntoView(editor, editor.state.selection.head);
        }
      });
      if (settledScrollTimer !== null) {
        window.clearTimeout(settledScrollTimer);
      }
      // Android IMEs animate the visible viewport after focus. Recheck once the
      // animation settles so the last line stays above the keyboard.
      settledScrollTimer = window.setTimeout(() => {
        settledScrollTimer = null;
        if (!editor.isDestroyed && editor.isFocused) {
          updateEditorKeyboardInset(editor);
          scrollEditorPositionIntoView(editor, editor.state.selection.head);
        }
      }, 180);
    };

    const handleSelectionUpdate = () => {
      if (editor.isFocused) {
        ensureSelectionVisible();
      }
    };
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", ensureSelectionVisible);
    visualViewport?.addEventListener("resize", ensureSelectionVisible);
    visualViewport?.addEventListener("scroll", ensureSelectionVisible);
    editor.on("focus", ensureSelectionVisible);
    editor.on("selectionUpdate", handleSelectionUpdate);
    updateEditorKeyboardInset(editor);

    return () => {
      window.cancelAnimationFrame(scrollFrame);
      if (settledScrollTimer !== null) {
        window.clearTimeout(settledScrollTimer);
      }
      window.removeEventListener("resize", ensureSelectionVisible);
      visualViewport?.removeEventListener("resize", ensureSelectionVisible);
      visualViewport?.removeEventListener("scroll", ensureSelectionVisible);
      editor.off("focus", ensureSelectionVisible);
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, isViewer]);

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) =>
      (activeEditor?.isActive("bold") ? MOBILE_EDITOR_ACTIVE_FLAGS.bold : 0) |
      (activeEditor?.isActive("bulletList") ? MOBILE_EDITOR_ACTIVE_FLAGS.bulletList : 0) |
      (activeEditor?.isActive("taskList") ? MOBILE_EDITOR_ACTIVE_FLAGS.taskList : 0) |
      (activeEditor?.isActive("blockquote") ? MOBILE_EDITOR_ACTIVE_FLAGS.blockquote : 0),
  });
  const requestOpenAiForSelection = () => {
    if (openAiForSelection()) {
      setAiSelectionHint(false);
      if (aiSelectionHintTimerRef.current !== null) {
        window.clearTimeout(aiSelectionHintTimerRef.current);
        aiSelectionHintTimerRef.current = null;
      }
      return;
    }
    setAiSelectionHint(true);
    if (aiSelectionHintTimerRef.current !== null) window.clearTimeout(aiSelectionHintTimerRef.current);
    aiSelectionHintTimerRef.current = window.setTimeout(() => {
      aiSelectionHintTimerRef.current = null;
      setAiSelectionHint(false);
    }, 2200);
  };

  const insertImage = async () => {
    if (isViewer || !editor || imageUploadInFlightRef.current || !onPickImageRef.current) {
      return;
    }

    imageUploadInFlightRef.current = true;
    pendingImageSelectionRef.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };

    try {
      await onPickImageRef.current();
    } finally {
      pendingImageSelectionRef.current = null;
      imageUploadInFlightRef.current = false;
    }
  };

  const toolbarIcons: Record<MobileEditorToolbarActionId, ReactNode> = {
    image: <ImagePlusIcon />,
    bold: <BoldIcon />,
    bulletList: <ListIcon />,
    taskList: <ListTodoIcon />,
    increaseListIndent: <ListIndentIncreaseIcon />,
    decreaseListIndent: <ListIndentDecreaseIcon />,
    blockquote: <QuoteIcon />,
    horizontalRule: <MinusIcon />,
  };
  const activeListItemType = editor?.isActive("taskItem") ? "taskItem" : "listItem";
  const toolbarHandlers: Record<MobileEditorToolbarActionId, () => void> = {
    image: () => void insertImage(),
    bold: () => editor?.chain().focus().toggleBold().run(),
    bulletList: () => editor?.chain().focus().toggleBulletList().run(),
    taskList: () => editor?.chain().focus().toggleTaskList().run(),
    increaseListIndent: () => editor?.chain().focus().sinkListItem(activeListItemType).run(),
    decreaseListIndent: () => editor?.chain().focus().liftListItem(activeListItemType).run(),
    blockquote: () => editor?.chain().focus().toggleBlockquote().run(),
    horizontalRule: () => editor?.chain().focus().setHorizontalRule().run(),
  };

  return (
    <div className={isViewer ? "edgeever-editor-shell edgeever-viewer-shell" : "edgeever-editor-shell"}>
      <style>{getEditorStyles(props.theme, { viewer: isViewer })}</style>
      {!isViewer ? (
        <div aria-label={getMobileEditorToolbarLabel(props.locale)} className="edgeever-editor-toolbar" role="toolbar">
          {MOBILE_EDITOR_TOOLBAR_ACTIONS.map((action) => (
              <ToolbarButton
                key={action.id}
                active={action.activeFlag > 0 && Boolean(toolbarState & action.activeFlag)}
                disabled={(action.id === "increaseListIndent"
                    && !Boolean(editor?.can().chain().focus().sinkListItem(activeListItemType).run()))
                  || (action.id === "decreaseListIndent"
                    && !Boolean(editor?.can().chain().focus().liftListItem(activeListItemType).run()))}
                icon={toolbarIcons[action.id]}
                label={getMobileEditorToolbarActionLabel(action.id, props.locale)}
                onRun={toolbarHandlers[action.id]}
              />
            ))}
          {onAiRequestRef.current ? (
            <button
              aria-label={props.locale === "en-US" ? "Use AI on the note or selected text" : "用 AI 处理正文或选中内容"}
              className="edgeever-ai-toolbar-button"
              onClick={requestOpenAiForSelection}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <SparklesIcon />
              <span>AI</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <EditorContent className="edgeever-editor-scroll" editor={editor} />
      {aiSelectionHint ? (
        <div aria-live="polite" className="edgeever-ai-selection-hint" role="status">
          {props.locale === "en-US" ? "Add some note content first." : "请先输入正文内容。"}
        </div>
      ) : null}
      {aiUndoFingerprint && !aiPanel ? (
        <div aria-live="polite" className="edgeever-ai-undo" role="status">
          <span>{props.locale === "en-US" ? "AI updated the selection." : "AI 已更新选中内容。"}</span>
          <button onClick={undoAiSelectionDraft} onMouseDown={(event) => event.preventDefault()} type="button">
            {props.locale === "en-US" ? "Undo" : "撤销"}
          </button>
        </div>
      ) : null}
      {aiPanel ? (
        <MobileSelectionAiPanel
          locale={props.locale}
          onApply={applyAiSelectionDraft}
          onChange={setAiPanel}
          onClose={closeAiPanel}
          onGenerate={() => runAiSelectionRequest()}
          onRefine={(instruction) => runAiSelectionRequest(instruction)}
          onStop={stopAiSelectionRequest}
          panel={aiPanel}
          prompts={aiPrompts}
        />
      ) : null}
    </div>
  );
}

const ToolbarButton = ({ active = false, disabled = false, icon, label, onRun }: { active?: boolean; disabled?: boolean; icon: ReactNode; label: string; onRun: () => void }) => (
  <button
    aria-label={label}
    aria-pressed={active}
    className={active ? "is-active" : undefined}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onRun}
    type="button"
  >
    {icon}
  </button>
);

const MobileSelectionAiPanel = ({
  locale,
  onApply,
  onChange,
  onClose,
  onGenerate,
  onRefine,
  onStop,
  panel,
  prompts,
}: {
  locale: "zh-CN" | "en-US";
  onApply: (mode: "append" | "replace") => void;
  onChange: Dispatch<SetStateAction<MobileAiPanelState | null>>;
  onClose: () => void;
  onGenerate: () => void;
  onRefine: (instruction: string) => void;
  onStop: () => void;
  panel: MobileAiPanelState;
  prompts: AiPromptTemplate[];
}) => {
  const english = locale === "en-US";
  const actionLabels: Record<AiAction, string> = {
    summarize: english ? "Summarize" : "总结",
    "extract-key-points": english ? "Key points" : "提炼要点",
    "extract-todos": english ? "Extract tasks" : "提取待办",
    "rewrite-proofread": english ? "Convert to Xiaohongshu style" : "转为小红书风格",
    translate: english ? "Translate" : "翻译",
    "improve-writing": english ? "Improve writing" : "改进写作",
    "fix-spelling-grammar": english ? "Fix spelling & grammar" : "修正拼写与语法",
    "make-shorter": english ? "Make concise" : "精炼表达",
    "make-longer": english ? "Make longer" : "扩写内容",
    "simplify-language": english ? "Convert to X (Twitter) style" : "转为推特风格",
    "change-tone": english ? "Change tone" : "调整语气",
    "continue-writing": english ? "Continue writing" : "继续写作",
    custom: english ? "Custom prompt" : "自定义指令",
  };
  const languageLabels: Record<AiTargetLanguage, string> = {
    en: english ? "English" : "英语",
    "zh-CN": english ? "Simplified Chinese" : "简体中文",
    "zh-TW": english ? "Traditional Chinese" : "繁体中文",
    ja: english ? "Japanese" : "日语",
    ko: english ? "Korean" : "韩语",
    es: english ? "Spanish" : "西班牙语",
    fr: english ? "French" : "法语",
    de: english ? "German" : "德语",
    pt: english ? "Portuguese" : "葡萄牙语",
  };
  const toneLabels: Record<AiTone, string> = {
    professional: english ? "Professional" : "专业",
    friendly: english ? "Friendly" : "友好",
    casual: english ? "Casual" : "轻松",
    direct: english ? "Direct" : "直接",
  };
  const update = (next: Partial<MobileAiPanelState>) => onChange((current) => current ? { ...current, ...next } : current);
  const generateDisabled = panel.generating || (!panel.promptId && panel.action === "custom" && !panel.customInstruction.trim());
  const appendDisabled = panel.generating || !panel.output || panel.resultMode === "replace";
  const replaceDisabled = panel.generating || !panel.output || panel.resultMode === "append";
  const selectedValue = panel.promptId ? `${AI_PROMPT_OPTION_PREFIX}${panel.promptId}` : panel.action;

  const selectPromptOrAction = (value: string) => {
    if (value.startsWith(AI_PROMPT_OPTION_PREFIX)) {
      const promptId = value.slice(AI_PROMPT_OPTION_PREFIX.length);
      const prompt = prompts.find((item) => item.id === promptId);
      if (!prompt) return;
      update({
        action: prompt.action,
        promptId: prompt.id,
        parameterKind: prompt.parameterKind,
        resultMode: prompt.resultMode,
        output: "",
        error: null,
      });
      return;
    }
    const action = value as AiAction;
    update({
      action,
      promptId: null,
      parameterKind: fallbackPromptParameterKind(action),
      resultMode: fallbackPromptResultMode(action),
      output: "",
      error: null,
    });
  };

  return (
    <section
      aria-label={panel.selection.wholeNote
        ? (english ? "AI whole-note assistant" : "AI 全文助手")
        : (english ? "AI selection assistant" : "AI 选区助手")}
      aria-modal="true"
      className="edgeever-ai-panel"
      role="dialog"
    >
      <header className="edgeever-ai-panel-header">
        <div>
          <strong>{panel.selection.wholeNote
            ? (english ? "AI whole-note assistant" : "AI 全文助手")
            : (english ? "AI selection assistant" : "AI 选区助手")}</strong>
          <small>{panel.selection.wholeNote
            ? (english ? "No text selected; the whole note will be processed." : "未选择文字，将处理整篇正文。")
            : (english ? "Only the selected text will be processed." : "只处理当前选中的正文。")}</small>
        </div>
        <button aria-label={english ? "Close" : "关闭"} onClick={onClose} type="button">×</button>
      </header>
      <div className="edgeever-ai-panel-body">
        <label>
          <span>{english ? "Action" : "处理方式"}</span>
          <select
            disabled={panel.generating}
            onChange={(event) => selectPromptOrAction(event.target.value)}
            value={selectedValue}
          >
            {prompts.length > 0
              ? <>
                  {prompts.map((prompt) => <option key={prompt.id} value={`${AI_PROMPT_OPTION_PREFIX}${prompt.id}`}>{prompt.name}</option>)}
                  <option value="custom">{actionLabels.custom}</option>
                </>
              : (panel.selection.wholeNote ? AI_WHOLE_NOTE_ACTIONS : AI_SELECTED_TEXT_ACTIONS)
                .map((action) => <option key={action} value={action}>{actionLabels[action]}</option>)}
          </select>
        </label>
        {panel.parameterKind === "target-language" ? (
          <label>
            <span>{english ? "Target language" : "目标语言"}</span>
            <select disabled={panel.generating} onChange={(event) => update({ targetLanguage: event.target.value as AiTargetLanguage, output: "", error: null })} value={panel.targetLanguage}>
              {AI_TARGET_LANGUAGES.map((language) => <option key={language} value={language}>{languageLabels[language]}</option>)}
            </select>
          </label>
        ) : null}
        {panel.parameterKind === "tone" ? (
          <label>
            <span>{english ? "Tone" : "语气"}</span>
            <select disabled={panel.generating} onChange={(event) => update({ tone: event.target.value as AiTone, output: "", error: null })} value={panel.tone}>
              {AI_TONES.map((tone) => <option key={tone} value={tone}>{toneLabels[tone]}</option>)}
            </select>
          </label>
        ) : null}
        {!panel.promptId && panel.action === "custom" ? (
          <label>
            <span>{english ? "Tell AI what to do" : "告诉 AI 你想怎么处理"}</span>
            <textarea
              disabled={panel.generating}
              maxLength={2000}
              onChange={(event) => update({ customInstruction: event.target.value })}
              placeholder={english ? "For example: Rewrite this as a concise email." : "例如：改写成一封简洁的邮件。"}
              rows={3}
              value={panel.customInstruction}
            />
          </label>
        ) : null}
        <div className="edgeever-ai-result-heading">
          <span>{english ? "AI draft" : "AI 草稿"}</span>
          {panel.generating ? <small>{english ? "Generating…" : "生成中…"}</small> : null}
        </div>
        <div aria-live="polite" className="edgeever-ai-result">
          {panel.output || <span>{english ? "The generated draft will appear here." : "生成的草稿会显示在这里。"}</span>}
        </div>
        {panel.output && !panel.generating ? (
          <label>
            <span>{english ? "Refine result" : "继续调整"}</span>
            <div className="edgeever-ai-refine-row">
              <input
                maxLength={2000}
                onChange={(event) => update({ refineInstruction: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing && panel.refineInstruction.trim()) {
                    event.preventDefault();
                    onRefine(panel.refineInstruction);
                  }
                }}
                placeholder={english ? "Make it more concise" : "例如：再简洁一点"}
                value={panel.refineInstruction}
              />
              <button disabled={!panel.refineInstruction.trim()} onClick={() => onRefine(panel.refineInstruction)} type="button">
                {english ? "Refine" : "调整"}
              </button>
            </div>
          </label>
        ) : null}
        {panel.error ? <p className="edgeever-ai-error" role="alert">{panel.error}</p> : null}
      </div>
      <footer className="edgeever-ai-panel-footer">
        <div>
          <button disabled={appendDisabled} onClick={() => onApply("append")} type="button">
            {english ? "Insert after" : "插入到选区后"}
          </button>
          <button disabled={replaceDisabled} onClick={() => onApply("replace")} type="button">
            {english ? "Replace selection" : "替换选中内容"}
          </button>
        </div>
        {panel.generating ? (
          <button className="is-primary" onClick={onStop} type="button">{english ? "Stop" : "停止"}</button>
        ) : (
          <button className="is-primary" disabled={generateDisabled} onClick={onGenerate} type="button">
            {panel.output ? (english ? "Regenerate" : "重新生成") : (english ? "Generate" : "生成")}
          </button>
        )}
      </footer>
    </section>
  );
};

const EditorIcon = ({ children, size, strokeWidth }: { children: ReactNode; size: number; strokeWidth: number }) => (
  <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} viewBox="0 0 24 24" width={size}>
    {children}
  </svg>
);

// Keep the same Lucide paths as the PWA toolbar without pulling the full icon
// barrel into the standalone DOM bundle (which adds roughly 1.8 MB in Metro).
const ImagePlusIcon = () => (
  <EditorIcon size={18} strokeWidth={2}>
    <path d="M16 5h6" />
    <path d="M19 2v6" />
    <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    <circle cx="9" cy="9" r="2" />
  </EditorIcon>
);

const BoldIcon = () => (
  <EditorIcon size={17} strokeWidth={2.4}>
    <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />
  </EditorIcon>
);

const ListIcon = () => (
  <EditorIcon size={18} strokeWidth={2.2}>
    <path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13" />
  </EditorIcon>
);

const ListTodoIcon = () => (
  <EditorIcon size={18} strokeWidth={2.1}>
    <rect height="6" rx="1" width="6" x="3" y="3" />
    <path d="m4.5 6 1 1 2-2M13 6h8" />
    <rect height="6" rx="1" width="6" x="3" y="15" />
    <path d="M13 18h8" />
  </EditorIcon>
);

const ListIndentIncreaseIcon = () => (
  <EditorIcon size={18} strokeWidth={2.1}>
    <path d="M4 5h16M4 12h10M4 19h16" />
    <path d="m14 9 3 3-3 3" />
  </EditorIcon>
);

const ListIndentDecreaseIcon = () => (
  <EditorIcon size={18} strokeWidth={2.1}>
    <path d="M4 5h16M10 12h10M4 19h16" />
    <path d="m10 9-3 3 3 3" />
  </EditorIcon>
);

const QuoteIcon = () => (
  <EditorIcon size={17} strokeWidth={2.2}>
    <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
    <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
  </EditorIcon>
);

const MinusIcon = () => (
  <EditorIcon size={18} strokeWidth={2.4}>
    <path d="M5 12h14" />
  </EditorIcon>
);

const SparklesIcon = () => (
  <EditorIcon size={16} strokeWidth={2.1}>
    <path d="m12 3-1.9 4.1L6 9l4.1 1.9L12 15l1.9-4.1L18 9l-4.1-1.9Z" />
    <path d="m5 16-.8 1.8L2.5 19l1.7.8L5 21.5l.8-1.7 1.7-.8-1.7-.8Z" />
    <path d="m19 15-.7 1.4L17 17l1.3.6.7 1.4.7-1.4L21 17l-1.3-.6Z" />
  </EditorIcon>
);

const mapImageSources = (doc: EditorDoc, mapSource: (source: string) => string): EditorDoc => {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const node = value as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    if (node.type === "image" && next.attrs && typeof next.attrs === "object") {
      const attrs = next.attrs as Record<string, unknown>;
      if (typeof attrs.src === "string") {
        next.attrs = { ...attrs, src: mapSource(attrs.src) };
      }
    }
    return next;
  };

  return visit(doc) as EditorDoc;
};

const resolveImageSources = (doc: EditorDoc, baseUrl: string) => mapImageSources(doc, (source) => resolveUrl(source, baseUrl));

const normalizeImageSources = (doc: EditorDoc, baseUrl: string) => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return mapImageSources(doc, (source) => source.startsWith(`${normalizedBaseUrl}/`) ? source.slice(normalizedBaseUrl.length) : source);
};

const getPersistableEditorDoc = (doc: EditorDoc, baseUrl: string) =>
  normalizeImageSources(stripMobileImageUploadPlaceholders(doc), baseUrl);

const normalizeProtectedResourceSource = (source: string, baseUrl: string) =>
  // Shared normalizer adds `/blob` so editor loads hit the API blob route even when
  // note content stores the bare `/api/v1/resources/:id` form.
  toProtectedResourceLoadPath(source, baseUrl);

const resolveUrl = (source: string, baseUrl: string) => {
  if (!source.startsWith("/")) {
    return source;
  }
  return `${baseUrl.replace(/\/+$/, "")}${source}`;
};

const applyImageWidth = (
  element: HTMLElement,
  attributes: Record<string, unknown>
): number => {
  const width = parseImageWidth(attributes.width) ?? DEFAULT_IMAGE_WIDTH_PERCENT;
  element.style.width = `${width}%`;
  element.dataset.width = String(width);
  return width;
};

let mermaidRenderSequence = 0;

const getMobileMermaidThemeVariables = (theme: "light" | "dark") => {
  const ink = theme === "dark" ? "#cbd5e1" : "#26384a";
  const surface = theme === "dark" ? "#0f172a" : "#ffffff";
  return {
    background: "transparent",
    primaryColor: surface,
    primaryTextColor: ink,
    primaryBorderColor: ink,
    lineColor: ink,
    textColor: ink,
    mainBkg: surface,
    nodeBorder: ink,
    edgeLabelBackground: surface,
    actorBkg: surface,
    actorBorder: ink,
    actorTextColor: ink,
    signalColor: ink,
    signalTextColor: ink,
  };
};

const loadMermaid = () => {
  const mermaid = (globalThis as typeof globalThis & {
    mermaid?: typeof import("mermaid")["default"];
  }).mermaid;
  if (!mermaid) {
    return Promise.reject(new Error("Mermaid runtime unavailable"));
  }
  return Promise.resolve(mermaid);
};

const createMobileCodeBlockExtension = (
  locale: "zh-CN" | "en-US",
  theme: "light" | "dark"
) => CodeBlock.extend({
  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement("div");
      const preview = document.createElement("div");
      const message = document.createElement("p");
      const svgContainer = document.createElement("div");
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      const copyButton = document.createElement("button");
      let copyResetTimer: number | null = null;
      preview.contentEditable = "false";
      preview.className = "edgeever-mermaid-preview";
      preview.tabIndex = 0;
      preview.setAttribute("role", "button");
      preview.addEventListener("click", () => wrapper.classList.toggle("is-source-visible"));
      preview.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          wrapper.classList.toggle("is-source-visible");
        }
      });
      message.className = "edgeever-mermaid-message";
      svgContainer.className = "edgeever-mermaid-svg";
      svgContainer.setAttribute("role", "img");
      svgContainer.setAttribute("aria-label", locale === "en-US" ? "Mermaid diagram preview" : "Mermaid 图表预览");
      copyButton.type = "button";
      copyButton.className = "edgeever-code-copy-button";
      copyButton.contentEditable = "false";
      copyButton.setAttribute("aria-label", locale === "en-US" ? "Copy code" : "复制代码");
      copyButton.textContent = locale === "en-US" ? "Copy code" : "复制代码";
      copyButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      copyButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void Clipboard.setStringAsync(currentNode.textContent).then(() => {
          copyButton.textContent = locale === "en-US" ? "Copied" : "已复制";
          copyButton.setAttribute("aria-label", locale === "en-US" ? "Copied" : "已复制");
          if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
          copyResetTimer = window.setTimeout(() => {
            copyButton.textContent = locale === "en-US" ? "Copy code" : "复制代码";
            copyButton.setAttribute("aria-label", locale === "en-US" ? "Copy code" : "复制代码");
            copyResetTimer = null;
          }, 1800);
        }).catch(() => {
          copyButton.textContent = locale === "en-US" ? "Copy failed" : "复制失败";
          copyButton.setAttribute("aria-label", locale === "en-US" ? "Copy failed" : "复制失败");
          if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
          copyResetTimer = window.setTimeout(() => {
            copyButton.textContent = locale === "en-US" ? "Copy code" : "复制代码";
            copyButton.setAttribute("aria-label", locale === "en-US" ? "Copy code" : "复制代码");
            copyResetTimer = null;
          }, 1800);
        });
      });
      pre.append(code);
      wrapper.append(copyButton, preview, pre);

      let currentNode = node;
      let renderTimer: number | null = null;
      let renderRequest = 0;

      const clearRender = () => {
        renderRequest += 1;
        if (renderTimer !== null) {
          window.clearTimeout(renderTimer);
          renderTimer = null;
        }
      };

      const renderNode = () => {
        clearRender();
        const language = typeof currentNode.attrs.language === "string"
          ? currentNode.attrs.language.toLowerCase()
          : "plaintext";
        const isMermaid = language === "mermaid";
        wrapper.className = isMermaid ? "edgeever-mermaid-code-block" : "edgeever-code-block";
        wrapper.dataset.language = language;
        preview.hidden = !isMermaid;
        code.setAttribute("aria-label", isMermaid
          ? (locale === "en-US" ? "Mermaid source" : "Mermaid 源码")
          : (locale === "en-US" ? "Code source" : "代码源码"));
        if (!isMermaid) {
          preview.replaceChildren();
          return;
        }

        const source = currentNode.textContent.trim();
        if (!source) {
          message.className = "edgeever-mermaid-message";
          message.textContent = locale === "en-US" ? "Enter Mermaid source below." : "请在下方输入 Mermaid 源码。";
          preview.replaceChildren(message);
          return;
        }

        const activeRequest = renderRequest;
        renderTimer = window.setTimeout(() => {
          message.className = "edgeever-mermaid-message";
          message.textContent = locale === "en-US" ? "Rendering diagram…" : "正在渲染图表…";
          preview.replaceChildren(message);
          void loadMermaid()
            .then(async (mermaid) => {
              const beautifulSvg = renderWithBeautifulMermaid(source, theme);
              if (beautifulSvg) {
                return { svg: beautifulSvg };
              }
              mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                suppressErrorRendering: true,
                theme: "base",
                themeVariables: getMobileMermaidThemeVariables(theme),
              });
              const valid = await mermaid.parse(source, { suppressErrors: true });
              if (!valid) {
                throw new Error("Invalid Mermaid diagram");
              }
              mermaidRenderSequence += 1;
              return mermaid.render(`edgeever-mobile-editor-mermaid-${mermaidRenderSequence}`, source);
            })
            .then(({ svg }) => {
              if (activeRequest !== renderRequest) {
                return;
              }
              svgContainer.innerHTML = svg;
              preview.replaceChildren(svgContainer);
            })
            .catch(() => {
              if (activeRequest !== renderRequest) {
                return;
              }
              message.className = "edgeever-mermaid-error";
              message.textContent = locale === "en-US"
                ? "Unable to render this diagram. Check its syntax."
                : "无法渲染此图表，请检查语法。";
              preview.replaceChildren(message);
            });
        }, 300);
      };

      renderNode();
      return {
        dom: wrapper,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type !== currentNode.type) {
            return false;
          }
          currentNode = updatedNode;
          renderNode();
          return true;
        },
        destroy: () => {
          clearRender();
          if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
        },
      };
    };
  },
});

const createMobileImageSizeControls = (
  locale: "zh-CN" | "en-US",
  updateWidth: (width: number) => void
) => {
  const controls = document.createElement("div");
  controls.className = "edgeever-image-size-controls";
  controls.contentEditable = "false";
  controls.hidden = true;
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", getMobileEditorImageScaleLabel(locale));

  const buttons = IMAGE_WIDTH_PRESETS.map((preset) => {
    const button = document.createElement("button");
    const label = getMobileEditorImageWidthPresetLabel(preset.id, locale);
    button.type = "button";
    button.className = "edgeever-image-size-button";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");

    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    button.append(labelNode);

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      updateWidth(preset.width);
    });
    controls.append(button);
    return { button, width: preset.width };
  });

  return {
    dom: controls,
    setActiveWidth: (width: number) => {
      for (const item of buttons) {
        const active = item.width === width;
        item.button.classList.toggle("is-active", active);
        item.button.setAttribute("aria-pressed", String(active));
      }
    },
    setVisible: (visible: boolean) => {
      controls.hidden = !visible;
    },
  };
};

const createProtectedImageExtension = (
  baseUrl: string,
  locale: "zh-CN" | "en-US",
  loadResource: (source: string) => Promise<string | null>,
  options?: {
    readOnly?: boolean;
    onResourcePress?: (targetJson: string) => void | Promise<void>;
    onImagePreview?: (payloadJson: string) => void | Promise<void>;
  }
) => Image.extend({
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
    return ({ editor, getPos, node }) => {
      const readOnly = Boolean(options?.readOnly) || !editor.isEditable;
      const updateWidth = (width: number) => {
        if (readOnly) {
          return;
        }
        const position = getPos();
        if (typeof position !== "number") {
          return;
        }
        editor
          .chain()
          .focus()
          .setNodeSelection(position)
          .updateAttributes("image", { width: clampImageWidth(width) })
          .run();
      };
      const sizeControls = createMobileImageSizeControls(locale, updateWidth);
      if (readOnly) {
        sizeControls.setVisible(false);
      }

      const emitImageResourcePress = (figure: HTMLElement) => {
        const targetJson = buildImageResourceTargetJson(figure);
        if (!targetJson || !options?.onResourcePress) return false;
        void options.onResourcePress(targetJson);
        return true;
      };

      const emitImagePreview = (figure: HTMLElement) => {
        if (!options?.onImagePreview) return false;
        const source = figure.dataset.resourceHref ?? "";
        if (!source) return false;
        void options.onImagePreview(JSON.stringify({
          alt: figure.dataset.resourceFilename || "",
          source,
        }));
        return true;
      };

      const bindImageActionButton = (figure: HTMLElement, button: HTMLButtonElement) => {
        // Only stop bubbling so the editor doesn't steal focus/selection.
        // preventDefault on pointerdown suppresses click on Android WebView.
        button.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          emitImageResourcePress(figure);
        });
      };

      if (isMobileImageUploadPlaceholderSource(node.attrs.src)) {
        const placeholder = document.createElement("div");
        placeholder.className = "edgeever-image-upload-placeholder";
        placeholder.contentEditable = "false";
        placeholder.setAttribute("role", "status");
        placeholder.setAttribute("aria-live", "polite");

        const preview = document.createElement("img");
        preview.className = "edgeever-image-upload-preview";
        preview.alt = "";
        const previewSource = String(node.attrs.title ?? "");
        if (previewSource) {
          const previewReferrerPolicy = getImageReferrerPolicy(previewSource);
          if (previewReferrerPolicy) {
            preview.referrerPolicy = previewReferrerPolicy;
          }
          preview.src = previewSource;
        }

        const overlay = document.createElement("div");
        overlay.className = "edgeever-image-upload-overlay";
        const spinner = document.createElement("span");
        spinner.className = "edgeever-image-upload-spinner";
        spinner.setAttribute("aria-hidden", "true");
        overlay.append(spinner, locale === "en-US" ? "Uploading image…" : "图片上传中…");
        if (previewSource) {
          placeholder.append(preview);
        }
        placeholder.append(overlay, sizeControls.dom);
        sizeControls.setActiveWidth(applyImageWidth(placeholder, node.attrs));

        let requestId = 0;
        let renderedSource = String(node.attrs.src ?? "");
        let completed = false;
        let selected = false;

        const applyImageAttributes = (attributes: Record<string, unknown>) => {
          preview.alt = String(attributes.alt ?? "");
          const title = String(attributes.title ?? "");
          if (title && !title.startsWith("data:")) {
            preview.title = title;
          } else {
            preview.removeAttribute("title");
          }
        };

        const revealLoadedImage = (
          displaySource: string,
          attributes: Record<string, unknown>,
          activeRequestId: number
        ) => {
          const preload = document.createElement("img");
          const preloadReferrerPolicy = getImageReferrerPolicy(displaySource);
          if (preloadReferrerPolicy) {
            preload.referrerPolicy = preloadReferrerPolicy;
          }
          preload.onload = () => {
            if (activeRequestId !== requestId) {
              return;
            }
            applyImageAttributes(attributes);
            preview.src = displaySource;
            preview.className = "";
            overlay.remove();
            placeholder.className = "edgeever-image-upload-result";
            completed = true;
            if (selected) {
              placeholder.classList.add("is-selected");
              sizeControls.setVisible(true);
            }
            placeholder.removeAttribute("role");
            placeholder.removeAttribute("aria-live");
          };
          // Keep the upload preview until decode succeeds — never swap to a
          // 401-prone bare resource URL that flashes a broken icon.
          preload.onerror = () => {
            if (activeRequestId !== requestId) {
              return;
            }
            overlay.textContent = locale === "en-US" ? "Image failed to load" : "图片加载失败";
          };
          preload.src = displaySource;
        };

        const loadCompletedImage = (attributes: Record<string, unknown>) => {
          requestId += 1;
          const activeRequestId = requestId;
          const source = String(attributes.src ?? "");
          renderedSource = source;
          const protectedSource = normalizeProtectedResourceSource(source, baseUrl);
          if (!protectedSource) {
            revealLoadedImage(resolveUrl(source, baseUrl), attributes, activeRequestId);
            return;
          }

          void loadResource(protectedSource)
            .then((dataUrl) => {
              if (activeRequestId !== requestId) {
                return;
              }
              if (dataUrl) {
                revealLoadedImage(dataUrl, attributes, activeRequestId);
                return;
              }
              overlay.textContent = locale === "en-US" ? "Image failed to load" : "图片加载失败";
            })
            .catch(() => {
              if (activeRequestId === requestId) {
                overlay.textContent = locale === "en-US" ? "Image failed to load" : "图片加载失败";
              }
            });
        };

        return {
          dom: placeholder,
          update: (updatedNode) => {
            if (updatedNode.type !== node.type) {
              return false;
            }
            const source = String(updatedNode.attrs.src ?? "");
            sizeControls.setActiveWidth(applyImageWidth(placeholder, updatedNode.attrs));
            if (isMobileImageUploadPlaceholderSource(source)) {
              return true;
            }
            if (source === renderedSource) {
              applyImageAttributes(updatedNode.attrs);
              return true;
            }
            loadCompletedImage(updatedNode.attrs);
            return true;
          },
          selectNode: () => {
            selected = true;
            if (completed) {
              placeholder.classList.add("is-selected");
              sizeControls.setVisible(true);
            }
          },
          deselectNode: () => {
            selected = false;
            placeholder.classList.remove("is-selected");
            sizeControls.setVisible(false);
          },
          destroy: () => {
            requestId += 1;
          },
        };
      }

      const wrapper = document.createElement("figure");
      wrapper.className = "edgeever-image-node is-loading";
      wrapper.contentEditable = "false";
      wrapper.setAttribute("role", "img");
      wrapper.setAttribute("aria-busy", "true");

      const loading = document.createElement("div");
      loading.className = "edgeever-image-loading";
      loading.setAttribute("aria-hidden", "true");
      const spinner = document.createElement("span");
      spinner.className = "edgeever-image-upload-spinner";
      loading.append(spinner);

      const image = document.createElement("img");
      // Never leave <img> without a successful src — empty/401 src paints the
      // browser broken-image glyph before the authenticated data URL arrives.
      image.hidden = true;

      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "edgeever-image-actions";
      actionButton.contentEditable = "false";
      actionButton.hidden = true;
      actionButton.setAttribute("aria-label", locale === "en-US" ? "Image actions" : "图片操作");
      actionButton.textContent = "⋯";
      bindImageActionButton(wrapper, actionButton);
      if (readOnly) {
        image.style.cursor = "zoom-in";
        image.addEventListener("click", (event) => {
          // Ignore taps that originated on the ⋯ control (event target would be button).
          if (event.target instanceof Element && event.target.closest(".edgeever-image-actions")) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          emitImagePreview(wrapper);
        });
      }
      wrapper.append(loading, image, actionButton, sizeControls.dom);
      const imageType = node.type;
      let requestId = 0;
      let renderedSource = "";
      let displayReady = false;

      const clearRequest = () => {
        requestId += 1;
      };

      const setImagePhase = (phase: "loading" | "ready" | "failed") => {
        wrapper.classList.toggle("is-loading", phase === "loading");
        wrapper.classList.toggle("is-failed", phase === "failed");
        wrapper.setAttribute("aria-busy", phase === "loading" ? "true" : "false");
        loading.hidden = phase === "ready";
        image.hidden = phase !== "ready";
        actionButton.hidden = phase !== "ready";
        if (phase === "failed") {
          loading.replaceChildren();
          const label = document.createElement("span");
          label.className = "edgeever-image-loading-label";
          label.textContent = locale === "en-US" ? "Image failed to load" : "图片加载失败";
          loading.append(label);
          loading.hidden = false;
        } else if (phase === "loading") {
          loading.replaceChildren(spinner);
        }
      };

      const applyImageMeta = (attributes: Record<string, unknown>) => {
        const alt = String(attributes.alt ?? "");
        const title = String(attributes.title ?? "");
        const source = String(attributes.src ?? "");
        wrapper.dataset.resourceHref = source;
        wrapper.dataset.resourceFilename = alt || title;
        image.alt = alt;
        if (alt) {
          wrapper.setAttribute("aria-label", alt);
        } else {
          wrapper.removeAttribute("aria-label");
        }
        const referrerPolicy = getImageReferrerPolicy(source);
        if (referrerPolicy) {
          image.referrerPolicy = referrerPolicy;
        } else {
          image.removeAttribute("referrerpolicy");
        }
        if (title) {
          image.title = title;
        } else {
          image.removeAttribute("title");
        }
      };

      /** Decode off-DOM first so the visible <img> never paints a broken glyph. */
      const revealDisplaySource = (displaySource: string, activeRequestId: number) => {
        const preload = document.createElement("img");
        const preloadReferrerPolicy = getImageReferrerPolicy(displaySource);
        if (preloadReferrerPolicy) {
          preload.referrerPolicy = preloadReferrerPolicy;
        }
        preload.onload = () => {
          if (activeRequestId !== requestId) {
            return;
          }
          image.src = displaySource;
          displayReady = true;
          setImagePhase("ready");
        };
        preload.onerror = () => {
          if (activeRequestId !== requestId) {
            return;
          }
          displayReady = false;
          image.removeAttribute("src");
          setImagePhase("failed");
        };
        preload.src = displaySource;
      };

      const renderNode = (attributes: Record<string, unknown>) => {
        sizeControls.setActiveWidth(applyImageWidth(wrapper, attributes));
        applyImageMeta(attributes);
        const source = String(attributes.src ?? "");

        // Width / alt-only updates must not tear down a successfully loaded image.
        if (source === renderedSource && displayReady && image.getAttribute("src")) {
          return;
        }

        clearRequest();
        renderedSource = source;
        displayReady = false;
        image.removeAttribute("src");
        setImagePhase("loading");

        const activeRequestId = requestId;
        const protectedSource = normalizeProtectedResourceSource(source, baseUrl);
        if (!protectedSource) {
          revealDisplaySource(resolveUrl(source, baseUrl), activeRequestId);
          return;
        }

        void loadResource(protectedSource)
          .then((dataUrl) => {
            if (activeRequestId !== requestId) {
              return;
            }
            // Do not fall back to an unauthenticated absolute URL — that 401s and
            // briefly shows the broken-image icon before any error UI.
            if (!dataUrl) {
              setImagePhase("failed");
              return;
            }
            revealDisplaySource(dataUrl, activeRequestId);
          })
          .catch(() => {
            if (activeRequestId === requestId) {
              setImagePhase("failed");
            }
          });
      };

      renderNode(node.attrs);

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type !== imageType) {
            return false;
          }
          renderNode(updatedNode.attrs);
          return true;
        },
        selectNode: () => {
          wrapper.classList.add("is-selected");
          sizeControls.setVisible(!readOnly && displayReady);
        },
        deselectNode: () => {
          wrapper.classList.remove("is-selected");
          sizeControls.setVisible(false);
        },
        destroy: clearRequest,
      };
    };
  },
}).configure({
  allowBase64: false,
  inline: false,
});

type TiptapEditor = NonNullable<ReturnType<typeof useEditor>>;
type ImageUploadPlaceholderMatch = { nodeSize: number; pos: number };
type AttachmentRange = { from: number; linkAttrs: Record<string, unknown>; to: number };

const findMobileAttachmentRange = (editor: TiptapEditor, resourceId: string): AttachmentRange | null => {
  let match: AttachmentRange | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const resourceLink = node.marks.find((mark) =>
      mark.type.name === "link" &&
      typeof mark.attrs.href === "string" &&
      getResourceIdFromUrl(mark.attrs.href) === resourceId
    );
    if (!resourceLink) return;
    match = { from: pos, linkAttrs: resourceLink.attrs, to: pos + node.nodeSize };
    return false;
  });
  return match;
};

const findMobileImageRange = (editor: TiptapEditor, resourceId: string): ImageUploadPlaceholderMatch | null => {
  let match: ImageUploadPlaceholderMatch | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && typeof node.attrs.src === "string" && getResourceIdFromUrl(node.attrs.src) === resourceId) {
      match = { nodeSize: node.nodeSize, pos };
      return false;
    }
  });
  return match;
};

const findImageUploadPlaceholder = (
  editor: TiptapEditor,
  source: string
): ImageUploadPlaceholderMatch | null => {
  let match: ImageUploadPlaceholderMatch | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === source) {
      match = { nodeSize: node.nodeSize, pos };
      return false;
    }
  });
  return match as ImageUploadPlaceholderMatch | null;
};

const insertImageUploadPlaceholder = (
  editor: TiptapEditor,
  source: string,
  alt: string,
  previewDataUrl: string,
  selection: { from: number; to: number } | null
) => {
  const imageType = editor.schema.nodes.image;
  if (!imageType) {
    return;
  }
  editor.chain().command(({ tr, dispatch }) => {
    const from = Math.min(selection?.from ?? tr.selection.from, tr.doc.content.size);
    const to = Math.min(Math.max(selection?.to ?? tr.selection.to, from), tr.doc.content.size);
    tr.replaceRangeWith(from, to, imageType.create({
      alt,
      src: source,
      title: previewDataUrl,
      width: DEFAULT_IMAGE_WIDTH_PERCENT,
    }));
    tr.setMeta(TRANSIENT_IMAGE_UPLOAD_META, true);
    dispatch?.(tr);
    return true;
  }).run();
};

const replaceImageUploadPlaceholder = (
  editor: TiptapEditor,
  placeholderSource: string,
  imageSource: string,
  alt: string
) => {
  const match = findImageUploadPlaceholder(editor, placeholderSource);
  if (!match) {
    return;
  }
  editor.chain().command(({ tr, dispatch }) => {
    const node = tr.doc.nodeAt(match.pos);
    if (!node) {
      return false;
    }
    tr.setNodeMarkup(match.pos, node.type, { ...node.attrs, alt, src: imageSource, title: null });
    dispatch?.(tr);
    return true;
  }).run();
};

const removeImageUploadPlaceholder = (editor: TiptapEditor, source: string) => {
  const match = findImageUploadPlaceholder(editor, source);
  if (!match) {
    return;
  }
  editor.chain().command(({ tr, dispatch }) => {
    tr.delete(match.pos, match.pos + match.nodeSize);
    tr.setMeta(TRANSIENT_IMAGE_UPLOAD_META, true);
    dispatch?.(tr);
    return true;
  }).run();
};

const getEditorStyles = (theme: "light" | "dark", options?: { viewer?: boolean }) => {
  const bodyFontSize = MEMO_CONTENT_STYLE.body.fontSize;
  const bodyLineHeight = MEMO_CONTENT_STYLE.body.lineHeight / MEMO_CONTENT_STYLE.body.fontSize;
  const paragraphSpacing = MEMO_CONTENT_STYLE.body.paragraphSpacing;
  return `
  :root {
    color-scheme: ${theme};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    /* Match PC/Web memo body (MEMO_CONTENT_STYLE) so notes don't feel oversized on phone. */
    --editor-body-font-size: ${bodyFontSize}px;
    --editor-body-line-height: ${bodyLineHeight};
    --editor-paragraph-spacing: ${paragraphSpacing}px;
  }
  * { box-sizing: border-box; }
  /* Cap layout to the WebView viewport. Wide tables/attachments must scroll
     inside their own wrappers — never expand the page and clip on the right. */
  html, body, #root {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: 100%;
    margin: 0;
    background: ${theme === "dark" ? "#0f172a" : "#fff"};
  }
  html { font-size: var(--editor-body-font-size); }
  body { overflow: hidden; color: ${theme === "dark" ? "#f8fafc" : "#0f172a"}; font-size: 1rem; }
  .edgeever-editor-shell {
    position: relative;
    display: flex;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 100%;
    flex-direction: column;
    background: ${theme === "dark" ? "#0f172a" : "#fff"};
    overflow: hidden;
  }
  .edgeever-viewer-shell { -webkit-user-select: text; user-select: text; }
  .edgeever-editor-toolbar { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; min-height: 38px; overflow-x: auto; padding: 6px 12px; border-block: 1px solid ${theme === "dark" ? "#334155" : "#f1f5f9"}; background: ${theme === "dark" ? "#0f172a" : "#fff"}; scrollbar-width: none; }
  .edgeever-editor-toolbar::-webkit-scrollbar { display: none; }
  .edgeever-editor-toolbar button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 36px; min-height: 32px; padding: 0; border: 1px solid transparent; border-radius: 999px; background: transparent; color: ${theme === "dark" ? "#cbd5e1" : "#64748b"}; }
  .edgeever-editor-toolbar button:active, .edgeever-editor-toolbar button.is-active { border-color: ${theme === "dark" ? "#166534" : "#bbf7d0"}; background: ${theme === "dark" ? "#14532d" : "#ecfdf5"}; color: ${theme === "dark" ? "#86efac" : "#047857"}; }
  .edgeever-editor-toolbar button:disabled { opacity: 0.38; }
  .edgeever-editor-toolbar .edgeever-ai-toolbar-button { width: auto; gap: 4px; padding: 0 10px; border-color: ${theme === "dark" ? "#166534" : "#bbf7d0"}; background: ${theme === "dark" ? "#052e24" : "#ecfdf5"}; color: ${theme === "dark" ? "#6ee7b7" : "#047857"}; font-weight: 750; }
  .tiptap { min-height: 100%; max-width: 100%; min-width: 0; outline: none; }
  .edgeever-editor-scroll {
    --edgeever-keyboard-inset: 0px;
    min-height: 0;
    min-width: 0;
    flex: 1;
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .edgeever-ai-selection-hint { position: absolute; z-index: 15; top: 64px; left: 50%; max-width: calc(100% - 32px); transform: translateX(-50%); padding: 9px 13px; border-radius: 999px; background: ${theme === "dark" ? "#1e293b" : "#0f172a"}; color: #fff; font-size: 13px; font-weight: 650; box-shadow: 0 8px 24px rgb(15 23 42 / 24%); }
  .edgeever-ai-undo { position: absolute; z-index: 15; top: 64px; right: 14px; left: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 10px 9px 13px; border-radius: 10px; background: ${theme === "dark" ? "#1e293b" : "#0f172a"}; color: #fff; font-size: 13px; font-weight: 650; box-shadow: 0 8px 24px rgb(15 23 42 / 24%); }
  .edgeever-ai-undo button { min-height: 32px; padding: 0 11px; border: 1px solid rgb(255 255 255 / 28%); border-radius: 8px; background: transparent; color: #6ee7b7; font: inherit; font-weight: 750; }
  .edgeever-ai-panel { position: absolute; z-index: 20; inset: 0; display: flex; min-width: 0; flex-direction: column; background: ${theme === "dark" ? "#0f172a" : "#f8fafc"}; color: ${theme === "dark" ? "#f8fafc" : "#0f172a"}; }
  .edgeever-ai-panel button, .edgeever-ai-panel input, .edgeever-ai-panel select, .edgeever-ai-panel textarea { font: inherit; }
  .edgeever-ai-panel-header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; min-height: 58px; padding: 10px 14px; border-bottom: 1px solid ${theme === "dark" ? "#334155" : "#e2e8f0"}; background: ${theme === "dark" ? "#111c18" : "#fff"}; }
  .edgeever-ai-panel-header div { display: grid; min-width: 0; gap: 2px; }
  .edgeever-ai-panel-header strong { font-size: 16px; }
  .edgeever-ai-panel-header small { color: ${theme === "dark" ? "#94a3b8" : "#64748b"}; font-size: 12px; }
  .edgeever-ai-panel-header > button { width: 36px; height: 36px; border: 0; border-radius: 999px; background: transparent; color: ${theme === "dark" ? "#cbd5e1" : "#475569"}; font-size: 25px; }
  .edgeever-ai-panel-body { display: grid; min-height: 0; flex: 1 1 auto; align-content: start; gap: 14px; overflow-y: auto; padding: 14px; }
  .edgeever-ai-panel label { display: grid; gap: 6px; color: ${theme === "dark" ? "#e2e8f0" : "#334155"}; font-size: 13px; font-weight: 700; }
  .edgeever-ai-panel select, .edgeever-ai-panel input, .edgeever-ai-panel textarea { width: 100%; border: 1px solid ${theme === "dark" ? "#475569" : "#cbd5e1"}; border-radius: 9px; outline: none; background: ${theme === "dark" ? "#111c18" : "#fff"}; color: ${theme === "dark" ? "#f8fafc" : "#0f172a"}; font-size: 15px; font-weight: 500; }
  .edgeever-ai-panel select, .edgeever-ai-panel input { min-height: 44px; padding: 0 11px; }
  .edgeever-ai-panel textarea { min-height: 78px; resize: vertical; padding: 10px 11px; }
  .edgeever-ai-panel select:focus, .edgeever-ai-panel input:focus, .edgeever-ai-panel textarea:focus { border-color: #16a06e; box-shadow: 0 0 0 2px rgb(22 160 110 / 14%); }
  .edgeever-ai-result-heading { display: flex; align-items: center; justify-content: space-between; color: ${theme === "dark" ? "#e2e8f0" : "#334155"}; font-size: 13px; font-weight: 750; }
  .edgeever-ai-result-heading small { color: #16a06e; }
  .edgeever-ai-result { min-height: 170px; max-height: min(42vh, 360px); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 12px; border: 1px solid ${theme === "dark" ? "#334155" : "#dbe4df"}; border-radius: 10px; background: ${theme === "dark" ? "#17251f" : "#fff"}; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.55; }
  .edgeever-ai-result > span { color: ${theme === "dark" ? "#94a3b8" : "#64748b"}; }
  .edgeever-ai-refine-row { display: flex; gap: 8px; }
  .edgeever-ai-refine-row input { min-width: 0; flex: 1; }
  .edgeever-ai-refine-row button, .edgeever-ai-panel-footer button { min-height: 40px; padding: 0 12px; border: 1px solid ${theme === "dark" ? "#475569" : "#cbd5e1"}; border-radius: 9px; background: ${theme === "dark" ? "#111c18" : "#fff"}; color: ${theme === "dark" ? "#f8fafc" : "#0f172a"}; font-weight: 700; }
  .edgeever-ai-panel button:disabled { opacity: 0.42; }
  .edgeever-ai-error { margin: 0; color: ${theme === "dark" ? "#fda4af" : "#be123c"}; font-size: 13px; line-height: 1.45; }
  .edgeever-ai-panel-footer { display: grid; flex: 0 0 auto; gap: 9px; padding: 10px 12px max(10px, env(safe-area-inset-bottom)); border-top: 1px solid ${theme === "dark" ? "#334155" : "#e2e8f0"}; background: ${theme === "dark" ? "#111c18" : "#fff"}; }
  .edgeever-ai-panel-footer > div { display: flex; gap: 8px; }
  .edgeever-ai-panel-footer > div button { min-width: 0; flex: 1; }
  .edgeever-ai-panel-footer .is-primary { border-color: #16a06e; background: #16a06e; color: #fff; }
  .edgeever-editor-content {
    min-height: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 18px 12px calc(32px + var(--edgeever-keyboard-inset));
    scroll-padding-bottom: calc(32px + var(--edgeever-keyboard-inset));
    font-size: 1rem;
    line-height: var(--editor-body-line-height);
    overflow-wrap: anywhere;
    word-break: break-word;
    caret-color: ${options?.viewer ? "transparent" : "#0f766e"};
  }
  .edgeever-viewer-content { -webkit-user-select: text; user-select: text; cursor: text; }
  .edgeever-search-match {
    border-radius: 0.2rem;
    background-color: rgb(254 240 138 / 0.8);
    box-shadow: 0 0 0 1px rgb(234 179 8 / 0.25);
  }
  .edgeever-search-match-active {
    background-color: rgb(251 191 36 / 0.9);
    box-shadow: 0 0 0 2px rgb(217 119 6 / 0.45);
  }
  .edgeever-editor-content > :first-child { margin-top: 0; }
  .edgeever-editor-content p {
    margin: 0 0 var(--editor-paragraph-spacing) 0;
    padding: 0;
    max-width: 100%;
    font-size: 1rem;
    line-height: var(--editor-body-line-height);
  }
  .edgeever-editor-content p.is-editor-empty:first-child::before { float: left; height: 0; color: #94a3b8; content: attr(data-placeholder); pointer-events: none; }
  .edgeever-editor-content h1,
  .edgeever-editor-content h2,
  .edgeever-editor-content h3 {
    max-width: 100%;
    overflow-wrap: anywhere;
    line-height: 1.3;
    font-weight: 800;
  }
  .edgeever-editor-content h1 { margin: 0.7em 0 0.4em; font-size: 1.6rem; }
  .edgeever-editor-content h2 { margin: 0.85em 0 0.35em; font-size: 1.35rem; }
  .edgeever-editor-content h3 { margin: 0.75em 0 0.3em; font-size: 1.15rem; }
  .edgeever-editor-content ul[data-type="taskList"] { margin: 0 0 var(--editor-paragraph-spacing); padding-left: 0; list-style: none; }
  .edgeever-editor-content ul[data-type="taskList"] li[data-checked] { display: flex; align-items: flex-start; gap: 9px; margin: 4px 0; }
  .edgeever-editor-content ul[data-type="taskList"] li[data-checked] > label { display: inline-flex; flex: 0 0 auto; align-items: center; margin-top: 3px; user-select: none; }
  .edgeever-editor-content ul[data-type="taskList"] li[data-checked] > label input { width: 18px; height: 18px; margin: 0; accent-color: #16a06e; }
  .edgeever-editor-content ul[data-type="taskList"] li[data-checked] > div { min-width: 0; flex: 1 1 auto; }
  .edgeever-editor-content ul[data-type="taskList"] li[data-checked] > div > p { margin-bottom: 0; }
  .edgeever-editor-content ul[data-type="taskList"] ul[data-type="taskList"] { margin: 4px 0 0; padding-left: 24px; }
  .edgeever-editor-content blockquote { margin-left: 0; max-width: 100%; padding-left: 14px; border-left: 3px solid #5eead4; color: ${theme === "dark" ? "#cbd5e1" : "#475569"}; }
  .edgeever-editor-content pre { max-width: 100%; overflow-x: auto; border-radius: 10px; padding: 14px 90px 14px 14px; background: #0f172a; color: #e2e8f0; font-size: 0.9rem; }
  .edgeever-editor-content code { border-radius: 4px; padding: 2px 4px; background: ${theme === "dark" ? "#1e293b" : "#f1f5f9"}; font-size: 0.9em; }
  .edgeever-editor-content pre code { padding: 0; background: transparent; font-size: inherit; }
  .edgeever-editor-content .tiptap-mathematics-render[data-type="block-math"] { max-width: 100%; margin: 16px 0; overflow-x: auto; overflow-y: hidden; padding: 4px 0; text-align: center; -webkit-overflow-scrolling: touch; }
  .edgeever-editor-content .inline-math-error, .edgeever-editor-content .block-math-error { color: ${theme === "dark" ? "#fda4af" : "#be123c"}; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  /* External hyperlinks (match Web default ProseMirror). Attachment chips override below. */
  .edgeever-editor-content a {
    color: ${theme === "dark" ? "#86efac" : "#00751f"};
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: ${theme === "dark" ? "rgba(134, 239, 172, 0.45)" : "rgba(0, 117, 31, 0.45)"};
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .edgeever-editor-content a:active {
    color: ${theme === "dark" ? "#4ade80" : "#00a82d"};
    text-decoration-color: ${theme === "dark" ? "#4ade80" : "#00a82d"};
  }
  /* Compact attachment chips: still ≥48px touch height, less vertical bulk than 58px. */
  .edgeever-editor-content a.edgeever-attachment-link, .edgeever-editor-content a[href*="/api/v1/resources/"] {
    display: flex;
    min-width: 0;
    max-width: 100%;
    min-height: 48px;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
    border: 1px solid ${theme === "dark" ? "#334155" : "#cbd5e1"};
    border-radius: 10px;
    padding: 7px 10px;
    background: ${theme === "dark" ? "#172033" : "#f8fafc"};
    color: ${theme === "dark" ? "#f1f5f9" : "#1e293b"};
    font-size: 0.93rem;
    font-weight: 700;
    line-height: 1.3;
    text-decoration: none;
    overflow: hidden;
  }
  .edgeever-editor-content a.edgeever-attachment-link::before, .edgeever-editor-content a[href*="/api/v1/resources/"]::before {
    display: inline-flex;
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: ${theme === "dark" ? "#134e4a" : "#ecfdf5"};
    content: "📎";
    font-size: 15px;
  }
  .edgeever-editor-content a.edgeever-attachment-link::after, .edgeever-editor-content a[href*="/api/v1/resources/"]::after {
    margin-left: auto;
    flex: 0 0 auto;
    color: ${theme === "dark" ? "#94a3b8" : "#64748b"};
    content: "⋯";
    font-size: 18px;
    font-weight: 700;
  }
  .edgeever-code-block, .edgeever-mermaid-code-block { position: relative; margin: 18px 0; overflow: visible; background: transparent; }
  .edgeever-code-copy-button { position: absolute; top: 8px; right: 8px; z-index: 1; border: 1px solid ${theme === "dark" ? "#475569" : "#cbded1"}; border-radius: 6px; padding: 5px 8px; background: ${theme === "dark" ? "rgba(30, 41, 59, 0.94)" : "rgba(247, 251, 248, 0.94)"}; color: ${theme === "dark" ? "#cbd5e1" : "#475569"}; font: inherit; font-size: 12px; line-height: 1.35; }
  .edgeever-code-copy-button:active { border-color: #0f766e; color: ${theme === "dark" ? "#86efac" : "#0f766e"}; }
  .edgeever-mermaid-code-block > pre { display: none; margin: 8px 0 0; }
  .edgeever-mermaid-code-block.is-source-visible > pre { display: block; }
  .edgeever-mermaid-preview { display: flex; min-height: 104px; align-items: center; justify-content: center; overflow-x: auto; padding: 16px 4px; background: transparent; }
  .edgeever-mermaid-preview[hidden] { display: none; }
  .edgeever-mermaid-svg { width: 100%; text-align: center; }
  .edgeever-mermaid-svg svg { display: block; width: auto; max-width: 100%; height: auto; max-height: 440px; margin: auto; }
  .edgeever-mermaid-message, .edgeever-mermaid-error { margin: 0; font-size: 14px; line-height: 1.5; text-align: center; }
  .edgeever-mermaid-message { color: ${theme === "dark" ? "#94a3b8" : "#64748b"}; }
  .edgeever-mermaid-error { color: ${theme === "dark" ? "#fda4af" : "#be123c"}; }
  .edgeever-editor-content img { display: block; max-width: 100%; height: auto; margin: 14px auto; border-radius: 10px; }
  /* Shared by preview + edit (same LocalTiptapEditor styles).
     Prefer shrinking columns to the content box (≈4 equal cols on a phone) with
     text wrap; when n * col-width still exceeds the wrapper, scroll inside
     .tableWrapper only — never widen the page via 100vw / desktop col widths. */
  .edgeever-editor-content .tableWrapper {
    /* ~24% of wrapper → 4 cols fit; more cols overflow and scroll */
    --mobile-table-column-width: clamp(4.25rem, 24cqi, 10rem);
    container-type: inline-size;
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    margin-top: 20px;
    margin-right: 0;
    margin-bottom: 20px;
    margin-left: 0;
    border: 1px solid ${theme === "dark" ? "#334155" : "#d8d8d8"};
    border-radius: 2px;
    background: ${theme === "dark" ? "#0f172a" : "#fff"};
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(100, 116, 139, 0.45) transparent;
  }
  .edgeever-editor-content .tableWrapper::-webkit-scrollbar {
    height: 6px;
  }
  .edgeever-editor-content .tableWrapper::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(100, 116, 139, 0.4);
  }
  .edgeever-editor-content table {
    width: max-content;
    max-width: none;
    min-width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }
  /* Override TipTap/desktop col widths with the mobile equal-ish column budget. */
  .edgeever-editor-content table col {
    width: var(--mobile-table-column-width) !important;
    min-width: var(--mobile-table-column-width) !important;
  }
  .edgeever-editor-content th, .edgeever-editor-content td {
    position: relative;
    width: var(--mobile-table-column-width);
    min-width: var(--mobile-table-column-width);
    max-width: var(--mobile-table-column-width);
    border: 0;
    border-right: 1px solid ${theme === "dark" ? "#334155" : "#dedede"};
    border-bottom: 1px solid ${theme === "dark" ? "#334155" : "#dedede"};
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.4;
    transition: background-color 120ms ease;
  }
  .edgeever-editor-content th { background: ${theme === "dark" ? "#27303f" : "#f0f0f0"}; color: ${theme === "dark" ? "#f8fafc" : "#111827"}; font-size: 0.93rem; font-weight: 700; }
  .edgeever-editor-content th:last-child, .edgeever-editor-content td:last-child { border-right: 0; }
  .edgeever-editor-content tr:last-child td { border-bottom: 0; }
  .edgeever-editor-content tbody tr:nth-child(even) td { background: ${theme === "dark" ? "#182235" : "#f8f8f8"}; }
  .edgeever-editor-content tbody tr:hover td { background: ${theme === "dark" ? "#202b3d" : "#f3f4f6"}; }
  .edgeever-editor-content th p, .edgeever-editor-content td p { margin: 0; }
  .edgeever-editor-content .selectedCell::after { position: absolute; inset: 0; content: ""; pointer-events: none; background: rgba(16, 185, 129, 0.14); }
  .edgeever-image-upload-placeholder { position: relative; max-width: 100%; min-height: 112px; margin: 14px auto; overflow: hidden; border-radius: 10px; background: ${theme === "dark" ? "#1e293b" : "#f1f5f9"}; }
  .edgeever-image-upload-preview { display: block; width: 100%; max-height: 360px; margin: 0 !important; object-fit: contain; border-radius: 10px; }
  .edgeever-image-upload-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; border-radius: 10px; background: rgba(15, 23, 42, 0.38); color: #fff; font-size: 14px; font-weight: 600; text-shadow: 0 1px 2px rgba(15, 23, 42, 0.45); }
  .edgeever-image-node, .edgeever-image-upload-result { position: relative; display: block; max-width: 100%; margin: 14px auto; line-height: 0; }
  .edgeever-image-node.is-loading, .edgeever-image-node.is-failed { min-height: 120px; overflow: hidden; border-radius: 10px; background: ${theme === "dark" ? "#1e293b" : "#f1f5f9"}; }
  .edgeever-image-loading { display: flex; min-height: 120px; align-items: center; justify-content: center; gap: 10px; padding: 16px; color: ${theme === "dark" ? "#94a3b8" : "#64748b"}; font-size: 13px; font-weight: 600; line-height: 1.3; }
  .edgeever-image-loading[hidden] { display: none; }
  .edgeever-image-loading-label { text-align: center; }
  .edgeever-image-node > img, .edgeever-image-upload-result > img { display: block; width: 100%; margin: 0; border-radius: 10px; }
  .edgeever-image-node > img[hidden] { display: none; }
  .edgeever-image-node.is-selected > img, .edgeever-image-upload-result.is-selected > img { outline: 2px solid #0f766e; outline-offset: 3px; }
  .edgeever-image-actions { position: absolute; right: 8px; bottom: 8px; z-index: 3; display: inline-flex; width: 42px; height: 42px; appearance: none; align-items: center; justify-content: center; border: 1px solid ${theme === "dark" ? "#475569" : "#cbd5e1"}; border-radius: 999px; background: ${theme === "dark" ? "rgba(15, 23, 42, 0.9)" : "rgba(255, 255, 255, 0.92)"}; color: ${theme === "dark" ? "#e2e8f0" : "#334155"}; font-size: 24px; font-weight: 700; line-height: 1; box-shadow: 0 3px 12px rgba(15, 23, 42, 0.2); }
  .edgeever-image-actions[hidden] { display: none; }
  .edgeever-image-size-controls { position: absolute; top: 8px; left: 50%; z-index: 2; display: flex; width: max-content; max-width: calc(100vw - 40px); align-items: center; gap: 3px; transform: translateX(-50%); border: 1px solid ${theme === "dark" ? "#475569" : "#bbf7d0"}; border-radius: 9px; padding: 4px; background: ${theme === "dark" ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.96)"}; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2); line-height: 1.15; }
  .edgeever-image-size-controls[hidden] { display: none; }
  .edgeever-image-size-button { display: inline-flex; min-width: 52px; min-height: 38px; appearance: none; align-items: center; justify-content: center; border: 0; border-radius: 7px; padding: 4px 7px; background: transparent; color: ${theme === "dark" ? "#cbd5e1" : "#475569"}; font: inherit; font-size: 12px; font-weight: 700; }
  .edgeever-image-size-button.is-active { background: ${theme === "dark" ? "#134e4a" : "#ccfbf1"}; color: ${theme === "dark" ? "#99f6e4" : "#0f766e"}; }
  .edgeever-image-upload-spinner { width: 18px; height: 18px; border: 2px solid ${theme === "dark" ? "#475569" : "#cbd5e1"}; border-top-color: #0f766e; border-radius: 999px; animation: edgeever-image-upload-spin 0.8s linear infinite; }
  @keyframes edgeever-image-upload-spin { to { transform: rotate(360deg); } }
  .edgeever-editor-content hr { margin: 24px 0; border: 0; border-top: 1px solid #cbd5e1; }
`;
};
