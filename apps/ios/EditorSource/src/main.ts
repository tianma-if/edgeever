import "./styles.css";
import "katex/dist/katex.min.css";
import { Editor, mergeAttributes, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlock from "@tiptap/extension-code-block";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import mermaid from "mermaid";
import { toCanvas } from "html-to-image";
import {
  type NoteImageTheme,
  type NoteImageFontStyle,
  type NoteImageFontSize,
  type NoteImageCardWidth,
  NOTE_IMAGE_CARD_WIDTH_PIXELS,
  NOTE_IMAGE_BACKGROUND_COLORS,
  NOTE_IMAGE_THEMES,
  resolveTheme,
  buildImageExportBasename,
  buildNoteImageCardMarkup,
  generateCardCss,
} from "@edgeever/shared/note-image-card";
import { createEdgeEverMathematics } from "./mathematics";

/** Keep in sync with packages/shared MergeDivider (iOS bundle cannot import monorepo shared). */
const MERGE_DIVIDER_MARKDOWN_MARKER = "<!-- edgeever:merge-divider -->";
const MERGE_DIVIDER_TOKENIZER =
  /^<!--\s*edgeever:merge-divider\s*-->\s*(?:\n+---[ \t]*(?:\n+|$)|(?:\n+|$))/;

const MergeDivider = Node.create({
  name: "edgeeverMergeDivider",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: "hr[data-edgeever-merge-divider]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "hr",
      mergeAttributes(HTMLAttributes, {
        "data-edgeever-merge-divider": "true",
        class: "edgeever-merge-divider",
      }),
    ];
  },
  renderMarkdown() {
    return `${MERGE_DIVIDER_MARKDOWN_MARKER}\n\n---`;
  },
  parseMarkdown(_token, helpers) {
    return helpers.createNode("edgeeverMergeDivider");
  },
  markdownTokenizer: {
    name: "edgeeverMergeDivider",
    level: "block",
    start(source: string) {
      return source.indexOf(MERGE_DIVIDER_MARKDOWN_MARKER);
    },
    tokenize(source: string) {
      const match = MERGE_DIVIDER_TOKENIZER.exec(source);
      if (!match) return undefined;
      return {
        type: "edgeeverMergeDivider",
        raw: match[0],
        text: "",
      };
    },
  },
});

type BridgeMessage =
  | { type: "ready"; startupMs: number }
  | { type: "change"; contentMarkdown: string; contentJson: string }
  | { type: "loadResource"; requestId: string; source: string }
  | { type: "resourcePress"; targetJson: string }
  | { type: "imagePreview"; source: string; alt: string }
  | { type: "pickImage" }
  | { type: "searchResult"; count: number; index: number }
  | { type: "imageExportChunk"; requestId: string; chunk: string }
  | {
      type: "imageExportComplete";
      requestId: string;
      filename: string;
      mimeType: string;
      width: number;
      height: number;
      totalImages: number;
      failedImages: number;
    }
  | { type: "imageExportError"; requestId: string; message: string }
  | { type: "activeFlags"; flags: number }
  | { type: "log"; message: string }
  | { type: "error"; message: string };

/** Match shared `getResourceIdFromUrl` — never return bare `blob`. */
function getResourceIdFromHref(href: string): string | null {
  try {
    const parsed = new URL(href, "http://edgeever.local");
    const match = parsed.pathname.match(/^\/api\/v1\/resources\/([^/]+)(?:\/blob)?\/?$/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    /* ignore */
  }
  const loose = href.match(/\/api\/v1\/resources\/([^/?#]+)/);
  if (loose?.[1] && loose[1] !== "blob") return decodeURIComponent(loose[1]);
  return null;
}

function normalizeResourceHref(href: string, resourceId: string): string {
  if (/\/blob(?:$|[?#])/.test(href) || href.includes(`/resources/${resourceId}/blob`)) return href;
  if (href.startsWith("/api/v1/resources/") || href.includes("/api/v1/resources/")) {
    return `/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;
  }
  return href;
}

function buildImageTargetJson(src: string, filename: string): string | null {
  const resourceId = getResourceIdFromHref(src);
  if (!resourceId) return null;
  return JSON.stringify({
    kind: "image",
    href: normalizeResourceHref(src, resourceId),
    filename: filename.trim() || `image-${resourceId}`,
    resourceId,
  });
}

function buildAttachmentTargetJson(href: string, label: string): string | null {
  const resourceId = getResourceIdFromHref(href);
  if (!resourceId) return null;
  const filename =
    label.replace(/^\s*(?:附件[：:]|Attachment:)\s*/i, "").trim() || resourceId;
  return JSON.stringify({
    kind: "attachment",
    href: normalizeResourceHref(href, resourceId),
    filename,
    resourceId,
  });
}

type ConfigureOptions = {
  mode?: "viewer" | "editor";
  locale?: string;
  theme?: "light" | "dark";
  placeholder?: string;
};

const startedAt = performance.now();
const IMAGE_EXPORT_WIDTH = 768;
const IMAGE_EXPORT_PIXEL_RATIO = 1.5;
const IMAGE_EXPORT_CHUNK_SIZE = 256 * 1024;

type ImageExportRequest = {
  requestId: string;
  format: "jpeg" | "png";
  title: string;
  fallbackTitle: string;
  notebook?: string;
  tags?: string[];
  updatedAt?: string;
  background?: "mint" | "slate" | "warm" | NoteImageTheme;
  theme?: NoteImageTheme;
  fontStyle?: NoteImageFontStyle;
  fontSize?: NoteImageFontSize;
  cardWidth?: NoteImageCardWidth;
  showTitle?: boolean;
  showNotebook?: boolean;
  showTags?: boolean;
  showUpdatedAt?: boolean;
  branding?: boolean;
};
let mode: "viewer" | "editor" = "viewer";
let locale = "zh-CN";
let currentPlaceholder = "开始输入…";
let suppressChange = false;
const resourceResolvers = new Map<string, (dataUrl: string | null) => void>();
let resourceSeq = 0;

function post(msg: BridgeMessage) {
  try {
    (window as unknown as { webkit?: { messageHandlers?: { edgeever?: { postMessage: (m: unknown) => void } } } })
      .webkit?.messageHandlers?.edgeever?.postMessage(msg);
  } catch {
    // native host unavailable (browser preview)
  }
}

function sanitizeImageExportBasename(title: string, fallback: string) {
  return title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim().slice(0, 100) || fallback;
}

async function blobToBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function isProtectedResource(src: string): boolean {
  return src.startsWith("/api/") || src.includes("/api/v1/resources/");
}

/** file:// editor pages often cannot load remote/protected img srcs; native must rewrite them. */
function needsNativeHydration(src: string): boolean {
  if (!src || src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("edgeever-res:")) {
    return false;
  }
  // Protected API paths always need auth + rewrite.
  if (isProtectedResource(src)) return true;
  // Absolute remote images also need rewrite under file:// packaging.
  if (src.startsWith("http://") || src.startsWith("https://")) return true;
  // Root-relative non-api assets resolved via native base URL.
  if (src.startsWith("/")) return true;
  return false;
}

function requestResource(source: string): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = `r${++resourceSeq}`;
    resourceResolvers.set(requestId, resolve);
    post({ type: "loadResource", requestId, source });
    // Timeout so broken resources don't hang forever.
    setTimeout(() => {
      if (resourceResolvers.delete(requestId)) resolve(null);
    }, 30_000);
  });
}

async function hydrateProtectedImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[src]"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!needsNativeHydration(src)) return;
      if (!img.dataset.originalSrc) img.dataset.originalSrc = src;
      // Avoid re-requesting while a previous hydrate is in flight for the same original.
      if (img.dataset.hydrating === "1") return;
      img.dataset.hydrating = "1";
      try {
        const dataUrl = await requestResource(src);
        if (dataUrl) img.setAttribute("src", dataUrl);
      } finally {
        delete img.dataset.hydrating;
      }
    })
  );
}

async function renderMermaidBlocks(root: HTMLElement, theme: "light" | "dark") {
  const codeBlocks = Array.from(root.querySelectorAll("pre code.language-mermaid, pre code[class*='mermaid']"));
  // Also treat fenced mermaid paragraphs produced as codeBlock with language attr via data
  const preBlocks = Array.from(root.querySelectorAll("pre")).filter((pre) => {
    const text = pre.textContent || "";
    return pre.querySelector("code") && /^(graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|flowchart)/m.test(text.trim());
  });

  const targets = new Set([...codeBlocks.map((c) => c.parentElement!).filter(Boolean), ...preBlocks]);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
  });

  let i = 0;
  for (const pre of targets) {
    const source = (pre.textContent || "").trim();
    if (!source) continue;
    try {
      const id = `mmd-${Date.now()}-${i++}`;
      const { svg } = await mermaid.render(id, source);
      const wrap = document.createElement("div");
      wrap.className = "edgeever-mermaid";
      wrap.innerHTML = svg;
      pre.replaceWith(wrap);
    } catch {
      // leave code block as-is
    }
  }
}

const IMAGE_WIDTH_PRESETS = [
  { label: "25%", width: 25 },
  { label: "50%", width: 50 },
  { label: "75%", width: 75 },
  { label: "100%", width: 100 },
] as const;

function parseImageWidth(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw).replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(10, Math.round(n)));
}

function clampImageWidth(n: number): number {
  return Math.min(100, Math.max(10, Math.round(n)));
}

/**
 * Image width is a % of the editor content column.
 * Apply to the figure itself (not only the <img>) so the layout box shrinks
 * with the picture — otherwise WKWebView keeps a full-width slot and paints
 * a pale selection wash in the empty half.
 */
function applyFigureWidth(el: HTMLElement, width: number | null) {
  const w = width == null ? null : clampImageWidth(width);
  if (w == null) {
    el.style.removeProperty("width");
    el.style.removeProperty("max-width");
    el.style.removeProperty("--ee-image-width");
    delete el.dataset.width;
    el.classList.remove("has-width");
    return;
  }
  const pct = `${w}%`;
  el.dataset.width = String(w);
  el.classList.add("has-width");
  el.style.setProperty("--ee-image-width", pct);
  // Inline styles beat any generic img/figure rules; max-width keeps us inside the column.
  el.style.setProperty("width", pct);
  el.style.setProperty("max-width", pct);
  el.style.setProperty("margin-left", "auto");
  el.style.setProperty("margin-right", "auto");
  el.style.setProperty("box-sizing", "border-box");
  el.style.setProperty("display", "block");
}

/**
 * iOS WKWebView + ProseMirror: control taps must:
 * 1) preventDefault on pointerdown so PM does not steal NodeSelection
 * 2) run the action on pointerup (click is suppressed after preventDefault)
 * Desktop still gets a debounced click fallback.
 */
function bindImageControlTap(el: HTMLElement, action: () => void) {
  let lastRun = 0;
  const block = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  };
  const run = (event: Event) => {
    block(event);
    const now = Date.now();
    if (now - lastRun < 350) return;
    lastRun = now;
    action();
  };
  el.addEventListener("pointerdown", block);
  el.addEventListener("mousedown", block);
  el.addEventListener("touchstart", block, { passive: false });
  el.addEventListener("pointerup", run);
  el.addEventListener("click", run);
}

/**
 * Android LocalTiptapEditor image node parity:
 * - figure wrapper + ⋯ action button
 * - viewer: tap image → fullscreen preview; ⋯ → resource sheet
 * - editor: tap image → select + show width bar (25/50/75/100%); ⋯ → resource sheet
 */
function createEdgeEverImageExtension() {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        width: {
          default: null,
          parseHTML: (element) =>
            parseImageWidth(
              element.getAttribute("data-width") ?? element.getAttribute("width") ?? (element as HTMLElement).style.width
            ),
          renderHTML: (attributes) => {
            const width = parseImageWidth(attributes.width);
            return width ? { "data-width": String(width), style: `width: ${width}%` } : {};
          },
        },
      };
    },
    addNodeView() {
      return ({ editor: ed, getPos, node }) => {
        let currentNode = node;
        const wrapper = document.createElement("figure");
        wrapper.className = "edgeever-image-node is-loading";
        wrapper.contentEditable = "false";
        wrapper.setAttribute("role", "img");

        const loading = document.createElement("div");
        loading.className = "edgeever-image-loading";
        const spinner = document.createElement("span");
        spinner.className = "edgeever-image-upload-spinner";
        loading.append(spinner);

        const image = document.createElement("img");
        image.draggable = false;
        image.hidden = true;

        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = "edgeever-image-actions";
        actionButton.contentEditable = "false";
        actionButton.hidden = true;
        actionButton.setAttribute("aria-label", "图片操作");
        actionButton.textContent = "⋯";

        const sizeControls = document.createElement("div");
        sizeControls.className = "edgeever-image-size-controls";
        sizeControls.contentEditable = "false";
        sizeControls.hidden = true;
        sizeControls.setAttribute("role", "group");
        sizeControls.setAttribute("aria-label", "图片宽度");

        const applyWidthAtPos = (width: number) => {
          const pos = getPos();
          if (typeof pos !== "number") return;
          const n = ed.state.doc.nodeAt(pos);
          if (!n || n.type.name !== "image") return;
          const nextWidth = clampImageWidth(width);
          // Avoid chain().focus() — iOS WKWebView often drops NodeSelection mid-gesture.
          let tr = ed.state.tr.setNodeMarkup(pos, undefined, {
            ...n.attrs,
            width: nextWidth,
          });
          try {
            tr = tr.setSelection(NodeSelection.create(tr.doc, pos));
          } catch {
            /* keep markup update even if selection fails */
          }
          ed.view.dispatch(tr);
          applyFigureWidth(wrapper, nextWidth);
          setActiveWidth(nextWidth);
        };

        const sizeButtons: Array<{ button: HTMLButtonElement; width: number }> = [];
        for (const preset of IMAGE_WIDTH_PRESETS) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "edgeever-image-size-button";
          btn.textContent = preset.label;
          btn.setAttribute("aria-label", preset.label);
          btn.setAttribute("aria-pressed", "false");
          bindImageControlTap(btn, () => applyWidthAtPos(preset.width));
          sizeButtons.push({ button: btn, width: preset.width });
          sizeControls.append(btn);
        }

        const setActiveWidth = (width: number | null) => {
          for (const item of sizeButtons) {
            const active = width != null && item.width === width;
            item.button.classList.toggle("is-active", active);
            item.button.setAttribute("aria-pressed", String(active));
          }
        };

        const setPhase = (phase: "loading" | "ready" | "failed") => {
          wrapper.classList.toggle("is-loading", phase === "loading");
          wrapper.classList.toggle("is-failed", phase === "failed");
          loading.hidden = phase === "ready";
          image.hidden = phase !== "ready";
          actionButton.hidden = phase !== "ready";
          if (phase === "failed") {
            loading.replaceChildren();
            const label = document.createElement("span");
            label.className = "edgeever-image-loading-label";
            label.textContent = "图片加载失败";
            loading.append(label);
            loading.hidden = false;
          } else if (phase === "loading") {
            loading.replaceChildren(spinner);
          }
        };

        const resourceHrefFromAttrs = (attrs: Record<string, unknown>) => {
          const src = String(attrs.src ?? "");
          // Prefer protected API path over display data:/edgeever-res:
          if (isProtectedResource(src) || getResourceIdFromHref(src)) return src;
          return wrapper.dataset.resourceHref || src;
        };

        const emitActions = () => {
          const href =
            wrapper.dataset.resourceHref ||
            image.dataset.originalSrc ||
            resourceHrefFromAttrs(currentNode.attrs as Record<string, unknown>);
          const json = buildImageTargetJson(href, String(currentNode.attrs.alt ?? "image"));
          if (json) {
            post({ type: "resourcePress", targetJson: json });
            return;
          }
          // Still notify native with best-effort payload when id parse fails.
          post({
            type: "log",
            message: `image actions: no resource id for href=${href.slice(0, 120)}`,
          });
        };

        const emitPreview = () => {
          const href =
            wrapper.dataset.resourceHref ||
            image.dataset.originalSrc ||
            resourceHrefFromAttrs(currentNode.attrs as Record<string, unknown>) ||
            image.getAttribute("src") ||
            "";
          if (!href) return;
          post({
            type: "imagePreview",
            source: href,
            alt: String(currentNode.attrs.alt ?? ""),
          });
        };

        bindImageControlTap(actionButton, emitActions);

        // Android parity:
        // - viewer: tap image → fullscreen preview
        // - editor: tap image → select node (shows 25/50/75/100% width bar); ⋯ → action sheet
        // Image body: only stopPropagation on pointerdown (keeps scroll working).
        let lastImageActivate = 0;
        const onImageActivate = (event: Event) => {
          if (event.target instanceof Element && event.target.closest(".edgeever-image-actions")) {
            return;
          }
          const now = Date.now();
          if (now - lastImageActivate < 350) return;
          lastImageActivate = now;
          event.stopPropagation();
          if (mode === "viewer" || !ed.isEditable) {
            event.preventDefault();
            emitPreview();
            return;
          }
          event.preventDefault();
          const pos = getPos();
          if (typeof pos === "number") {
            ed.chain().setNodeSelection(pos).run();
          }
        };
        image.addEventListener("pointerdown", (event) => event.stopPropagation());
        image.addEventListener("click", onImageActivate);
        image.addEventListener("pointerup", (event) => {
          // iOS sometimes skips click after PM handles pointer; activate on short taps.
          if (event.pointerType === "touch" || event.pointerType === "pen") {
            onImageActivate(event);
          }
        });

        wrapper.append(loading, image, actionButton, sizeControls);

        let requestId = 0;
        let renderedSource = "";
        let selected = false;

        const applyMeta = (attrs: Record<string, unknown>) => {
          const alt = String(attrs.alt ?? "");
          image.alt = alt;
          const width = parseImageWidth(attrs.width);
          applyFigureWidth(wrapper, width);
          setActiveWidth(width);
          const src = String(attrs.src ?? "");
          const rid = getResourceIdFromHref(src);
          if (rid) {
            wrapper.dataset.resourceHref = normalizeResourceHref(src, rid);
            image.dataset.originalSrc = wrapper.dataset.resourceHref;
          }
        };

        const loadImage = (attrs: Record<string, unknown>) => {
          requestId += 1;
          const active = requestId;
          const src = String(attrs.src ?? "");
          renderedSource = src;
          applyMeta(attrs);
          setPhase("loading");
          sizeControls.hidden = true;

          const finish = (display: string) => {
            if (active !== requestId) return;
            image.onload = () => {
              if (active !== requestId) return;
              setPhase("ready");
              image.style.cursor = mode === "viewer" || !ed.isEditable ? "zoom-in" : "pointer";
              if (selected && ed.isEditable && mode === "editor") {
                sizeControls.hidden = false;
              }
            };
            image.onerror = () => {
              if (active !== requestId) return;
              setPhase("failed");
            };
            image.src = display;
          };

          if (!src) {
            setPhase("failed");
            return;
          }
          if (src.startsWith("data:") || src.startsWith("edgeever-res:") || src.startsWith("blob:")) {
            finish(src);
            return;
          }
          if (needsNativeHydration(src)) {
            void requestResource(src).then((dataUrl) => {
              if (active !== requestId) return;
              if (dataUrl) finish(dataUrl);
              else setPhase("failed");
            });
            return;
          }
          finish(src);
        };

        loadImage(node.attrs as Record<string, unknown>);

        return {
          dom: wrapper,
          update: (updated) => {
            if (updated.type.name !== "image") return false;
            currentNode = updated;
            const nextSrc = String(updated.attrs.src ?? "");
            applyMeta(updated.attrs as Record<string, unknown>);
            if (nextSrc !== renderedSource) {
              loadImage(updated.attrs as Record<string, unknown>);
            } else {
              setActiveWidth(parseImageWidth(updated.attrs.width));
              applyFigureWidth(wrapper, parseImageWidth(updated.attrs.width));
            }
            return true;
          },
          selectNode: () => {
            selected = true;
            wrapper.classList.add("is-selected");
            // Re-assert layout width so selection never leaves a full-width empty slot.
            const selWidth =
              parseImageWidth(
                (ed.state.selection as { node?: { attrs?: { width?: unknown } } }).node?.attrs?.width
              ) ?? parseImageWidth(wrapper.dataset.width) ?? parseImageWidth(currentNode.attrs.width);
            applyFigureWidth(wrapper, selWidth);
            // Width bar only in editor when the image is the active node selection.
            if (ed.isEditable && mode === "editor" && !image.hidden) {
              sizeControls.hidden = false;
              setActiveWidth(selWidth);
            }
          },
          deselectNode: () => {
            selected = false;
            wrapper.classList.remove("is-selected");
            sizeControls.hidden = true;
          },
          destroy: () => {
            requestId += 1;
          },
        };
      };
    },
  }).configure({
    inline: false,
    allowBase64: true,
  });
}

function buildExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      codeBlock: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    MergeDivider,
    ...createEdgeEverMathematics(),
    CodeBlock.configure({
      languageClassPrefix: "language-",
    }),
    createEdgeEverImageExtension(),
    TableKit.configure({
      table: { resizable: false },
    }),
    Placeholder.configure({
      placeholder,
    }),
    Markdown.configure({
      markedOptions: { gfm: true },
    }),
  ];
}

const editorEl = document.getElementById("editor")!;
const toolbarEl = document.getElementById("toolbar")!;

const editor = new Editor({
  element: editorEl,
  extensions: buildExtensions("开始书写…"),
  editable: false,
  content: { type: "doc", content: [{ type: "paragraph" }] },
  onUpdate: ({ editor: ed }) => {
    refreshToolbarState();
    if (suppressChange || mode !== "editor") return;
    emitChange(ed);
  },
  onSelectionUpdate: () => refreshToolbarState(),
  editorProps: {
    attributes: {
      class: "edgeever-prose",
      spellcheck: "true",
    },
    handleClick(_view, _pos, event) {
      return handleResourcePointer(event as MouseEvent, "click");
    },
    handleDOMEvents: {
      contextmenu(_view, event) {
        return handleResourcePointer(event, "contextmenu");
      },
    },
  },
});

/**
 * Android parity:
 * - attachment link → always resource action sheet
 * - viewer image click → fullscreen preview
 * - viewer image long-press / contextmenu → resource action sheet
 * - editor image click inside nodeView → select + width bar (owned by nodeView)
 * - editor image ⋯ → resource action sheet (owned by nodeView)
 */
function handleResourcePointer(event: Event, kind: "click" | "contextmenu"): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;

  // Size / ⋯ controls own their gestures — never intercept from PM handleClick.
  if (
    target.closest(".edgeever-image-size-controls") ||
    target.closest(".edgeever-image-actions") ||
    target.closest(".edgeever-image-size-button")
  ) {
    return true;
  }

  const link = target.closest("a");
  if (link instanceof HTMLAnchorElement) {
    const href = link.getAttribute("href") || "";
    if (isProtectedResource(href) || getResourceIdFromHref(href)) {
      const json = buildAttachmentTargetJson(href, link.textContent || "");
      if (json) {
        event.preventDefault();
        event.stopPropagation();
        post({ type: "resourcePress", targetJson: json });
        return true;
      }
    }
  }

  const img = target.closest("img");
  if (img instanceof HTMLImageElement) {
    // Custom image nodeView owns image taps (select/preview/⋯).
    if (img.closest("figure.edgeever-image-node") && kind === "click") {
      return false;
    }

    const src = img.dataset.originalSrc || img.getAttribute("src") || "";
    const protectedSrc =
      img.dataset.originalSrc ||
      (isProtectedResource(src) || getResourceIdFromHref(src) ? src : "");
    if (!protectedSrc && !getResourceIdFromHref(src)) {
      // Non-protected image — still allow preview of data: display src in viewer.
      if (mode === "viewer" && kind === "click" && src) {
        event.preventDefault();
        post({
          type: "imagePreview",
          source: src,
          alt: img.getAttribute("alt") || "",
        });
        return true;
      }
      return false;
    }
    const hrefForMenu = protectedSrc || src;
    const filename = img.getAttribute("alt") || "image";

    // Long-press / context menu → resource actions (editor + viewer).
    if (kind === "contextmenu") {
      const json = buildImageTargetJson(hrefForMenu, filename);
      if (json) {
        event.preventDefault();
        event.stopPropagation();
        post({ type: "resourcePress", targetJson: json });
        return true;
      }
    }

    // Viewer plain tap on bare <img> (no nodeView) → preview.
    if (mode === "viewer" && kind === "click") {
      event.preventDefault();
      event.stopPropagation();
      post({
        type: "imagePreview",
        source: hrefForMenu,
        alt: filename,
      });
      return true;
    }
  }

  return false;
}

// Long-press on images (mobile WebView often does not fire contextmenu reliably).
(() => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startImg: HTMLImageElement | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    startImg = null;
  };
  editorEl.addEventListener(
    "touchstart",
    (event) => {
      const img = (event.target as HTMLElement | null)?.closest("img");
      if (!(img instanceof HTMLImageElement)) return;
      startImg = img;
      timer = setTimeout(() => {
        if (!startImg) return;
        const src = startImg.dataset.originalSrc || startImg.getAttribute("src") || "";
        const json = buildImageTargetJson(src, startImg.getAttribute("alt") || "image");
        if (json) {
          post({ type: "resourcePress", targetJson: json });
        }
        clear();
      }, 480);
    },
    { passive: true }
  );
  editorEl.addEventListener("touchend", clear, { passive: true });
  editorEl.addEventListener("touchmove", clear, { passive: true });
  editorEl.addEventListener("touchcancel", clear, { passive: true });
})();

const LITERAL_DOLLAR_PLACEHOLDER = "\uE000edgeever-dollar\uE001";

const protectLiteralDollarPairs = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === "text" && typeof node.text === "string") {
    const dollarCount = Array.from(node.text).filter((character) => character === "$").length;
    return dollarCount >= 2
      ? { ...node, text: node.text.replaceAll("$", LITERAL_DOLLAR_PLACEHOLDER) }
      : value;
  }
  return Array.isArray(node.content)
    ? { ...node, content: node.content.map(protectLiteralDollarPairs) }
    : value;
};

const serializeEditorMarkdown = (ed: Editor) => {
  const manager = (ed.storage as { markdown?: { manager?: { serialize?: (doc: unknown) => string } } })
    .markdown?.manager;
  if (manager?.serialize) {
    return manager.serialize(protectLiteralDollarPairs(ed.getJSON())).replaceAll(LITERAL_DOLLAR_PLACEHOLDER, "\\$");
  }
  return typeof ed.getMarkdown === "function"
    ? ed.getMarkdown()
    : ed.getText({ blockSeparator: "\n\n" });
};

let pendingAiSelection: { from: number; to: number; isInline: boolean; documentFingerprint: string } | null = null;

const serializeSelectionMarkdown = (ed: Editor, from: number, to: number) => {
  const manager = (ed.storage as { markdown?: { manager?: { serialize?: (doc: unknown) => string } } })
    .markdown?.manager;
  const content = ed.state.doc.slice(from, to).content.toJSON();
  if (manager?.serialize) {
    return manager
      .serialize(protectLiteralDollarPairs({ type: "doc", content }))
      .replaceAll(LITERAL_DOLLAR_PLACEHOLDER, "\\$");
  }
  return ed.state.doc.textBetween(from, to, "\n\n");
};

type AiSelectionContext = {
  from: number;
  to: number;
  isInline: boolean;
  markdown: string;
  text: string;
};

type ParsedMarkdownNode = {
  type?: string;
  text?: string;
  content?: ParsedMarkdownNode[];
  [key: string]: unknown;
};

const AI_INLINE_SENTINEL = "edgeever-inline-sentinel";

const serializeInlineSelectionMarkdown = (ed: Editor, content: unknown[], fallback: string) => {
  const manager = (ed.storage as { markdown?: { manager?: { serialize?: (doc: unknown) => string } } })
    .markdown?.manager;
  if (!manager?.serialize) return fallback;
  return manager
    .serialize(protectLiteralDollarPairs({ type: "doc", content: [{ type: "paragraph", content }] }))
    .replaceAll(LITERAL_DOLLAR_PLACEHOLDER, "\\$");
};

const getAiSelectionContext = (ed: Editor): AiSelectionContext | null => {
  const selection = ed.state.selection;
  if (selection.empty || selection.from >= selection.to) return null;

  const selectedTextblocks: Array<{
    node: ProseMirrorNode;
    contentFrom: number;
    contentTo: number;
    from: number;
    to: number;
  }> = [];
  ed.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isTextblock) return true;
    const contentFrom = pos + 1;
    const contentTo = contentFrom + node.content.size;
    const from = Math.max(selection.from, contentFrom);
    const to = Math.min(selection.to, contentTo);
    if (to > from) selectedTextblocks.push({ node, contentFrom, contentTo, from, to });
    return false;
  });

  if (selectedTextblocks.length === 1) {
    const block = selectedTextblocks[0];
    const selectedBlock = block.node.cut(
      block.from - block.contentFrom,
      block.to - block.contentFrom,
    ).toJSON() as { content?: unknown[] };
    const text = ed.state.doc.textBetween(block.from, block.to, "\n");
    const markdown = serializeInlineSelectionMarkdown(ed, selectedBlock.content ?? [], text).trim();
    return markdown
      ? { from: block.from, to: block.to, isInline: true, markdown, text }
      : null;
  }

  const markdown = serializeSelectionMarkdown(ed, selection.from, selection.to).trim();
  return markdown
    ? {
        from: selection.from,
        to: selection.to,
        isInline: false,
        markdown,
        text: ed.state.doc.textBetween(selection.from, selection.to, "\n\n"),
      }
    : null;
};

const parseAiSelectionReplacement = (ed: Editor, draft: string, isInline: boolean): unknown[] => {
  const manager = (ed.storage as { markdown?: { manager?: { parse?: (value: string) => { content?: unknown[] } } } })
    .markdown?.manager;
  const normalizedDraft = draft.trim();
  const blockContent = manager?.parse?.(normalizedDraft).content ?? [{ type: "text", text: normalizedDraft }];
  if (!isInline) return blockContent;

  const inlineDraft = normalizedDraft.replace(/\s*\n+\s*/g, " ");
  const inlineContent = manager?.parse?.(`${AI_INLINE_SENTINEL}${inlineDraft}`).content;
  const paragraph = inlineContent?.length === 1 ? inlineContent[0] as ParsedMarkdownNode : null;
  const paragraphContent = paragraph?.type === "paragraph" ? paragraph.content ?? [] : [];
  const firstNode = paragraphContent[0];
  if (firstNode?.type !== "text" || typeof firstNode.text !== "string" || !firstNode.text.startsWith(AI_INLINE_SENTINEL)) {
    return [{ type: "text", text: inlineDraft }];
  }

  const firstText = firstNode.text.slice(AI_INLINE_SENTINEL.length);
  return [
    ...(firstText ? [{ ...firstNode, text: firstText }] : []),
    ...paragraphContent.slice(1),
  ];
};

function emitChange(ed: Editor) {
  try {
    const contentJson = JSON.stringify(ed.getJSON());
    const contentMarkdown = serializeEditorMarkdown(ed);
    post({ type: "change", contentMarkdown, contentJson });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

type EditorSearchMatch = { from: number; to: number };

function getEditorSearchMatches(ed: Editor, query: string): EditorSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [];

  const characters: Array<{ char: string; pos: number }> = [];
  let previousTextEnd: number | null = null;
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    if (previousTextEnd !== null && pos > previousTextEnd) {
      characters.push({ char: "\u0000", pos: -1 });
    }
    for (let index = 0; index < node.text.length; index += 1) {
      characters.push({ char: node.text[index] ?? "", pos: pos + index });
    }
    previousTextEnd = pos + node.text.length;
  });

  const haystack = characters.map((item) => item.char).join("").toLocaleLowerCase();
  const matches: EditorSearchMatch[] = [];
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
}

const activeListItemType = () => editor.isActive("taskItem") ? "taskItem" : "listItem";

function setToolbarVisible(visible: boolean) {
  toolbarEl.classList.toggle("editor-mode", visible);
  toolbarEl.innerHTML = "";
  if (!visible) return;
  const actions: Array<{ id: string; label: string; run: () => void }> = [
    {
      id: "image",
      label: "▧+",
      run: () => post({ type: "pickImage" }),
    },
    { id: "bold", label: "B", run: () => editor.chain().focus().toggleBold().run() },
    {
      id: "bullet",
      label: "•",
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "task",
      label: "☑",
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      id: "indent",
      label: "⇥",
      run: () => editor.chain().focus().sinkListItem(activeListItemType()).run(),
    },
    {
      id: "outdent",
      label: "⇤",
      run: () => editor.chain().focus().liftListItem(activeListItemType()).run(),
    },
    {
      id: "quote",
      label: "❝",
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "hr",
      label: "—",
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.dataset.action = action.id;
    const labels: Record<string, [string, string]> = {
      image: ["插入图片", "Insert image"],
      bold: ["粗体", "Bold"],
      bullet: ["项目符号列表", "Bullet list"],
      task: ["任务清单", "Task list"],
      indent: ["增加列表缩进", "Increase list indent"],
      outdent: ["减少列表缩进", "Decrease list indent"],
      quote: ["引用", "Block quote"],
      hr: ["分隔线", "Horizontal rule"],
    };
    btn.setAttribute("aria-label", labels[action.id]?.[locale === "en-US" ? 1 : 0] ?? action.id);
    btn.addEventListener("click", () => {
      action.run();
      if (action.id !== "image") emitChange(editor);
      refreshToolbarState();
    });
    toolbarEl.appendChild(btn);
  }
  refreshToolbarState();
}

function refreshToolbarState() {
  const active: Record<string, boolean> = {
    bold: editor.isActive("bold"),
    bullet: editor.isActive("bulletList"),
    task: editor.isActive("taskList"),
    quote: editor.isActive("blockquote"),
  };
  toolbarEl.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
    button.classList.toggle("is-active", active[button.dataset.action ?? ""] ?? false);
  });
}

async function afterContentSet(theme: "light" | "dark" = "light") {
  editorEl.querySelectorAll<HTMLElement>("[data-placeholder]").forEach((element) => {
    element.dataset.placeholder = currentPlaceholder;
  });
  await hydrateProtectedImages(editorEl);
  if (mode === "viewer") {
    await renderMermaidBlocks(editorEl, theme);
  }
}

async function exportNoteImage(request: ImageExportRequest) {
  if (!request.requestId || (request.format !== "png" && request.format !== "jpeg")) return;
  const resolvedTheme = resolveTheme(request.background, request.theme);
  const fontStyle = request.fontStyle ?? "serif";
  const fontSize = request.fontSize ?? "lg";
  const cardWidth = request.cardWidth ?? "standard";
  const targetWidth = NOTE_IMAGE_CARD_WIDTH_PIXELS[cardWidth] || 680;
  const themeCfg = NOTE_IMAGE_THEMES[resolvedTheme] || NOTE_IMAGE_THEMES.slate;

  const editorClone = editor.view.dom.cloneNode(true) as HTMLElement;
  editorClone.removeAttribute("contenteditable");
  editorClone.querySelectorAll("button, [contenteditable='true']").forEach((element) => {
    element.removeAttribute("contenteditable");
    if (element instanceof HTMLButtonElement) element.remove();
  });

  const bodyHtml = editorClone.innerHTML;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${targetWidth}px;pointer-events:none;`;
  const style = document.createElement("style");
  style.textContent = generateCardCss({ theme: resolvedTheme, fontStyle, fontSize, cardWidth });

  const cardMarkup = buildNoteImageCardMarkup({
    title: request.title || request.fallbackTitle,
    notebook: request.notebook,
    tags: request.tags,
    updatedAt: request.updatedAt,
    bodyHtml,
    theme: resolvedTheme,
    fontStyle,
    showTitle: request.showTitle ?? true,
    showNotebook: request.showNotebook ?? false,
    showTags: request.showTags ?? false,
    showUpdatedAt: request.showUpdatedAt ?? true,
    showBranding: request.branding ?? true,
  });

  host.appendChild(style);
  host.insertAdjacentHTML("beforeend", cardMarkup);
  const documentRoot = host.lastElementChild as HTMLElement;
  documentRoot.style.width = `${targetWidth}px`;
  documentRoot.style.maxWidth = "none";
  documentRoot.style.margin = "0";

  document.body.appendChild(host);

  try {
    await document.fonts?.ready;
    await Promise.all(Array.from(documentRoot.querySelectorAll("img")).map(async (image) => {
      if (image.complete) return;
      try { await image.decode(); } catch { /* Export the readable remainder. */ }
    }));
    const exportedImages = Array.from(
      documentRoot.querySelectorAll<HTMLImageElement>(".edgeever-card-body img"),
    );
    const failedImages = exportedImages.filter((image) => !image.complete || image.naturalWidth === 0).length;
    const totalHeight = Math.max(1, Math.ceil(documentRoot.getBoundingClientRect().height));
    const backgroundColor = NOTE_IMAGE_BACKGROUND_COLORS[resolvedTheme] || themeCfg.canvasBg;

    const canvas = await toCanvas(documentRoot, {
      backgroundColor,
      cacheBust: false,
      height: totalHeight,
      pixelRatio: 2,
      skipFonts: true,
      width: targetWidth,
    });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("Image renderer returned an empty file")),
        request.format === "jpeg" ? "image/jpeg" : "image/png",
        request.format === "jpeg" ? 0.92 : 1,
      );
    });

    const extension = request.format === "jpeg" ? "jpg" : "png";
    const basename = buildImageExportBasename(request.title, request.fallbackTitle);
    const bytes = await blobToBytes(blob);
    const filename = `${basename}.${extension}`;
    const mimeType = request.format === "jpeg" ? "image/jpeg" : "image/png";
    const base64 = bytesToBase64(bytes);
    for (let offset = 0; offset < base64.length; offset += IMAGE_EXPORT_CHUNK_SIZE) {
      post({ type: "imageExportChunk", requestId: request.requestId, chunk: base64.slice(offset, offset + IMAGE_EXPORT_CHUNK_SIZE) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    post({
      type: "imageExportComplete",
      requestId: request.requestId,
      filename,
      mimeType,
      width: canvas.width,
      height: canvas.height,
      totalImages: exportedImages.length,
      failedImages,
    });
  } catch (error) {
    post({ type: "imageExportError", requestId: request.requestId, message: error instanceof Error ? error.message : "Image export failed" });
  } finally {
    host.remove();
  }
}

export type EdgeEverEditorAPI = {
  configure: (opts: ConfigureOptions) => void;
  setMarkdown: (md: string) => void;
  setDocumentFromJSON: (json: string) => void;
  resolveResource: (requestId: string, dataUrl: string | null) => void;
  getMarkdown: () => string;
  getDocument: () => string;
  captureSelection: () => string | null;
  applySelectionDraft: (markdown: string, mode: "append" | "replace") => boolean;
  undo: () => boolean;
  focusEnd: () => void;
  flush: () => void;
  exec: (actionId: string) => void;
  beginImageUpload: (uploadId: string, previewDataUrl: string) => void;
  completeImageUpload: (uploadId: string, imageUrl: string, alt: string) => void;
  cancelImageUpload: (uploadId: string) => void;
  search: (query: string, requestedIndex: number) => void;
  exportImage: (request: ImageExportRequest) => void;
};

const api: EdgeEverEditorAPI = {
  exportImage(request) {
    void exportNoteImage(request);
  },
  configure(opts) {
    const nextMode = opts.mode === "editor" ? "editor" : "viewer";
    const modeChanged = nextMode !== mode;
    mode = nextMode;
    locale = opts.locale === "en-US" ? "en-US" : "zh-CN";
    editor.setEditable(mode === "editor");
    setToolbarVisible(mode === "editor");
    document.documentElement.dataset.theme = opts.theme || "light";
    document.body.classList.toggle("viewer-mode", mode === "viewer");
    document.body.classList.toggle("editor-mode", mode === "editor");
    if (opts.placeholder) {
      currentPlaceholder = opts.placeholder;
      editorEl.querySelectorAll<HTMLElement>("[data-placeholder]").forEach((element) => {
        element.dataset.placeholder = currentPlaceholder;
      });
    }
    // Match Evernote-style edit entry: focus the surface when entering editor mode.
    // Combined with setContent's default end selection, caret lands at document end.
    if (mode === "editor" && modeChanged) {
      requestAnimationFrame(() => {
        try {
          editor.commands.focus("end");
        } catch {
          /* ignore */
        }
      });
    }
    void afterContentSet(opts.theme || "light");
  },

  setMarkdown(md) {
    suppressChange = true;
    try {
      editor.commands.setContent(md || "", { contentType: "markdown" } as never);
    } catch {
      try {
        const manager = (editor.storage as { markdown?: { manager?: { parse: (s: string) => unknown } } }).markdown
          ?.manager;
        if (manager) {
          editor.commands.setContent(manager.parse(md || "") as never);
        } else {
          throw new Error("no markdown manager");
        }
      } catch {
        editor.commands.setContent({
          type: "doc",
          content: [{ type: "paragraph", content: md ? [{ type: "text", text: md }] : [] }],
        });
      }
    }
    // Keep editability. Do NOT focus("end") here — native re-pushes content on SwiftUI
    // updates while typing; focusing would yank the caret to the document bottom mid-edit.
    editor.setEditable(mode === "editor");
    suppressChange = false;
    void afterContentSet((document.documentElement.dataset.theme as "light" | "dark") || "light");
  },

  setDocumentFromJSON(json) {
    suppressChange = true;
    try {
      const doc = JSON.parse(json);
      editor.commands.setContent(doc);
    } catch {
      editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    }
    editor.setEditable(mode === "editor");
    suppressChange = false;
    void afterContentSet((document.documentElement.dataset.theme as "light" | "dark") || "light");
  },

  resolveResource(requestId, dataUrl) {
    const resolver = resourceResolvers.get(requestId);
    if (resolver) {
      resourceResolvers.delete(requestId);
      resolver(dataUrl);
    }
  },

  getMarkdown() {
    return serializeEditorMarkdown(editor);
  },

  getDocument() {
    return JSON.stringify(editor.getJSON());
  },

  captureSelection() {
    const context = getAiSelectionContext(editor);
    if (!context) {
      pendingAiSelection = null;
      return null;
    }
    pendingAiSelection = {
      from: context.from,
      to: context.to,
      isInline: context.isInline,
      documentFingerprint: JSON.stringify(editor.getJSON()),
    };
    return JSON.stringify({
      from: context.from,
      to: context.to,
      markdown: context.markdown,
      text: context.text,
    });
  },

  applySelectionDraft(markdown, applyMode) {
    const range = pendingAiSelection;
    if (!range || !markdown.trim()) return false;
    if (JSON.stringify(editor.getJSON()) !== range.documentFingerprint) {
      pendingAiSelection = null;
      return false;
    }
    const docSize = editor.state.doc.content.size;
    const from = Math.min(Math.max(range.from, 0), docSize);
    const to = Math.min(Math.max(range.to, from), docSize);
    try {
      const manager = (editor.storage as { markdown?: { manager?: { parse?: (value: string) => { content?: unknown[] } } } })
        .markdown?.manager;
      const parsed = manager?.parse?.(markdown);
      const content = applyMode === "replace"
        ? parseAiSelectionReplacement(editor, markdown, range.isInline)
        : parsed?.content ?? markdown;
      const insertRange = applyMode === "append" ? { from: to, to } : { from, to };
      editor.chain().focus().insertContentAt(insertRange, content as never).run();
      pendingAiSelection = null;
      emitChange(editor);
      return true;
    } catch {
      return false;
    }
  },

  undo() {
    if (!editor.can().undo()) return false;
    const changed = editor.commands.undo();
    if (changed) emitChange(editor);
    return changed;
  },

  focusEnd() {
    try {
      editor.commands.focus("end");
    } catch {
      /* ignore */
    }
    // iOS WKWebView: TipTap selection alone may not move DOM focus to the contenteditable.
    // Explicitly focus ProseMirror so the software keyboard can attach after native first-responder.
    try {
      const dom = editor.view?.dom as HTMLElement | undefined;
      if (dom && typeof dom.focus === "function") {
        dom.focus({ preventScroll: true });
      }
    } catch {
      /* ignore */
    }
  },

  flush() {
    emitChange(editor);
  },

  exec(actionId) {
    const map: Record<string, () => void> = {
      bold: () => editor.chain().focus().toggleBold().run(),
      bulletList: () => editor.chain().focus().toggleBulletList().run(),
      taskList: () => editor.chain().focus().toggleTaskList().run(),
      blockquote: () => editor.chain().focus().toggleBlockquote().run(),
      horizontalRule: () => editor.chain().focus().setHorizontalRule().run(),
      heading2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      codeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
    };
    map[actionId]?.();
    emitChange(editor);
  },

  beginImageUpload(uploadId, previewDataUrl) {
    editor
      .chain()
      .focus()
      .setImage({ src: previewDataUrl, alt: uploadId })
      .run();
    // mark last image
    const imgs = editorEl.querySelectorAll("img");
    const last = imgs[imgs.length - 1] as HTMLImageElement | undefined;
    if (last) last.dataset.uploadId = uploadId;
    emitChange(editor);
  },

  completeImageUpload(uploadId, imageUrl, alt) {
    // Always mutate ProseMirror via setImage — DOM-only attr writes do not persist.
    // Native hydrate rewrites display src under file:// after emitChange.
    editor
      .chain()
      .focus()
      .setImage({ src: imageUrl, alt: alt || uploadId || "" })
      .run();
    const imgs = editorEl.querySelectorAll("img");
    const last = imgs[imgs.length - 1] as HTMLImageElement | undefined;
    if (last) {
      last.dataset.originalSrc = imageUrl;
      delete last.dataset.uploadId;
    }
    emitChange(editor);
  },

  cancelImageUpload(uploadId) {
    const img = editorEl.querySelector(`img[data-upload-id="${uploadId}"]`);
    img?.remove();
    emitChange(editor);
  },

  search(query, requestedIndex) {
    const matches = getEditorSearchMatches(editor, query);
    const index = matches.length > 0
      ? Math.min(Math.max(Number.isFinite(requestedIndex) ? requestedIndex : 0, 0), matches.length - 1)
      : 0;
    const match = matches[index];
    if (match) {
      editor.commands.setTextSelection({ from: match.from, to: match.to });
      try {
        const dom = editor.view.domAtPos(match.from).node;
        const element = dom instanceof Element ? dom : dom.parentElement;
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        /* ignore */
      }
    }
    post({ type: "searchResult", count: matches.length, index });
  },
};

(window as unknown as { EdgeEverEditor: EdgeEverEditorAPI }).EdgeEverEditor = api;
setToolbarVisible(false);
post({ type: "ready", startupMs: Math.round(performance.now() - startedAt) });
