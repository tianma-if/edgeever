'use dom';

import "mermaid/dist/mermaid.min.js";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import Image from "@tiptap/extension-image";
import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as Clipboard from "expo-clipboard";
import type { TiptapDoc } from "@edgeever/shared";
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
  getMobileEditorTableMenuCopy,
  getMobileEditorToolbarActionLabel,
  getMobileEditorToolbarLabel,
  isMobileEditorActionDisabledInTableHeader,
  type MobileEditorTableActionId,
  type MobileEditorToolbarActionId,
} from "@edgeever/shared/mobile-editor";
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from "expo/dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  createMobileImageUploadPlaceholderSource,
  isMobileImageUploadPlaceholderSource,
  stripMobileImageUploadPlaceholders,
} from "../lib/mobile-image-upload-placeholder";

type EditorDoc = TiptapDoc;

type DOMValue = Parameters<DOMImperativeFactory[string]>[0];

export interface LocalTiptapEditorRef extends DOMImperativeFactory {
  beginImageUpload: (uploadId: DOMValue, previewDataUrl: DOMValue) => void;
  cancelImageUpload: (uploadId: DOMValue) => void;
  completeImageUpload: (uploadId: DOMValue, imageUrl: DOMValue, alt: DOMValue) => void;
  appendAttachment: (attachmentUrl: DOMValue, filename: DOMValue) => void;
  flush: () => void;
  focusEnd: () => void;
  replaceAll: (query: DOMValue, replacement: DOMValue) => void;
  search: (query: DOMValue, index: DOMValue) => void;
}

type LocalTiptapEditorProps = {
  mode?: "editor";
  autoFocus?: boolean;
  baseUrl: string;
  content: EditorDoc;
  dom?: DOMProps;
  onChange: (content: EditorDoc) => Promise<void>;
  onLoadResource: (source: string) => Promise<string | null>;
  onPickImage: () => Promise<void>;
  onReady: (startupMs: number) => Promise<void>;
  onSearchResult?: (count: number, index: number) => Promise<void>;
  ref: Ref<LocalTiptapEditorRef>;
  locale: "zh-CN" | "en-US";
  theme: "light" | "dark";
};

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

function LocalTiptapEditorImpl(props: LocalTiptapEditorProps) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const startedAtRef = useRef(performance.now());
  const changeTimerRef = useRef<number | null>(null);
  const imageUploadInFlightRef = useRef(false);
  const pendingImageSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const onChangeRef = useRef(props.onChange);
  const onLoadResourceRef = useRef(props.onLoadResource);
  const onPickImageRef = useRef(props.onPickImage);
  const onReadyRef = useRef(props.onReady);
  const onSearchResultRef = useRef(props.onSearchResult ?? ignoreSearchResult);

  onChangeRef.current = props.onChange;
  onLoadResourceRef.current = props.onLoadResource;
  onPickImageRef.current = props.onPickImage;
  onReadyRef.current = props.onReady;
  onSearchResultRef.current = props.onSearchResult ?? ignoreSearchResult;
  const protectedImageExtension = useMemo(
    () => createProtectedImageExtension(props.baseUrl, props.locale, (source) => onLoadResourceRef.current(source)),
    [props.baseUrl, props.locale]
  );
  const mermaidCodeBlockExtension = useMemo(
    () => createMobileCodeBlockExtension(props.locale, props.theme),
    [props.locale, props.theme]
  );

  const editor = useEditor({
    autofocus: props.autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      mermaidCodeBlockExtension,
      protectedImageExtension,
      TableKit.configure({
        table: { renderWrapper: true },
      }),
      Placeholder.configure({
        placeholder: getMobileEditorPlaceholder(props.locale),
      }),
    ],
    content: resolveImageSources(props.content, props.baseUrl),
    editorProps: {
      attributes: getMobileEditorInputAttributes("edgeever-editor-content"),
    },
    onUpdate: ({ editor: activeEditor, transaction }) => {
      if (transaction.getMeta(TRANSIENT_IMAGE_UPLOAD_META)) {
        return;
      }
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
      }
      changeTimerRef.current = window.setTimeout(() => {
        changeTimerRef.current = null;
        void onChangeRef.current(getPersistableEditorDoc(activeEditor.getJSON() as EditorDoc, props.baseUrl));
      }, CHANGE_IDLE_MS);
    },
  });

  const flush = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    if (changeTimerRef.current !== null) {
      window.clearTimeout(changeTimerRef.current);
      changeTimerRef.current = null;
    }
    void onChangeRef.current(getPersistableEditorDoc(editor.getJSON() as EditorDoc, props.baseUrl));
  }, [editor, props.baseUrl]);

  const search = useCallback((query: DOMValue, requestedIndex: DOMValue) => {
    const matches = getEditorSearchMatches(editor, typeof query === "string" ? query : "");
    const requestedMatchIndex = typeof requestedIndex === "number" ? requestedIndex : 0;
    const index = matches.length > 0
      ? Math.min(Math.max(requestedMatchIndex, 0), matches.length - 1)
      : 0;
    const match = matches[index];
    if (editor && !editor.isDestroyed && match) {
      editor.commands.setTextSelection({ from: match.from, to: match.to });
    }
    void onSearchResultRef.current(matches.length, index);
  }, [editor]);

  const replaceAll = useCallback((query: DOMValue, replacement: DOMValue) => {
    const normalizedQuery = typeof query === "string" ? query : "";
    const normalizedReplacement = typeof replacement === "string" ? replacement : "";
    const matches = getEditorSearchMatches(editor, normalizedQuery);
    if (!editor || editor.isDestroyed || matches.length === 0) {
      void onSearchResultRef.current(0, 0);
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
    if (!editor || typeof uploadIdValue !== "string" || typeof previewDataUrlValue !== "string") {
      return;
    }
    insertImageUploadPlaceholder(
      editor,
      createMobileImageUploadPlaceholderSource(uploadIdValue),
      props.locale === "en-US" ? "Uploading image…" : "图片上传中…",
      previewDataUrlValue,
      pendingImageSelectionRef.current
    );
  }, [editor, props.locale]);

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
        text: `附件：${filenameValue}`,
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
  }, [editor, props.baseUrl]);

  useDOMImperativeHandle(
    props.ref,
    () => ({
      beginImageUpload,
      cancelImageUpload,
      completeImageUpload,
      appendAttachment,
      flush,
      focusEnd: () => editor?.commands.focus("end"),
      replaceAll,
      search,
    }),
    [appendAttachment, beginImageUpload, cancelImageUpload, completeImageUpload, editor, flush, replaceAll, search]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    void onReadyRef.current(Math.round(performance.now() - startedAtRef.current));
    let focusFrame = 0;
    let focusRetry: number | null = null;
    if (props.autoFocus) {
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
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (focusRetry !== null) {
        window.clearTimeout(focusRetry);
      }
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
      }
    };
  }, [editor, flush, props.autoFocus]);

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) =>
      (activeEditor?.isActive("bold") ? MOBILE_EDITOR_ACTIVE_FLAGS.bold : 0) |
      (activeEditor?.isActive("codeBlock", { language: "mermaid" }) ? MOBILE_EDITOR_ACTIVE_FLAGS.mermaid : 0) |
      (activeEditor?.isActive("bulletList") ? MOBILE_EDITOR_ACTIVE_FLAGS.bulletList : 0) |
      (activeEditor?.isActive("blockquote") ? MOBILE_EDITOR_ACTIVE_FLAGS.blockquote : 0) |
      (activeEditor?.isActive("table") ? MOBILE_EDITOR_ACTIVE_FLAGS.table : 0) |
      (activeEditor?.isActive("tableHeader") ? MOBILE_EDITOR_ACTIVE_FLAGS.tableHeader : 0),
  });
  const tableMenuCopy = getMobileEditorTableMenuCopy(props.locale);

  useEffect(() => {
    if (!(toolbarState & MOBILE_EDITOR_ACTIVE_FLAGS.table)) {
      setTableMenuOpen(false);
    }
  }, [toolbarState]);

  const insertImage = async () => {
    if (!editor || imageUploadInFlightRef.current) {
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

  const runTableAction = (action: MobileEditorTableActionId) => {
    const chain = editor?.chain().focus();
    if (!chain) {
      return;
    }

    switch (action) {
      case "insertTable":
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        return;
      case "addTableRow":
        chain.addRowAfter().run();
        return;
      case "deleteTableRow":
        if (!editor?.isActive("tableHeader")) {
          chain.deleteRow().run();
        }
        return;
      case "addTableColumn":
        chain.addColumnAfter().run();
        return;
      case "deleteTableColumn":
        chain.deleteColumn().run();
        return;
      case "toggleTableHeader":
        chain.toggleHeaderRow().run();
        return;
      case "deleteTable":
        chain.deleteTable().run();
    }
  };

  const toolbarIcons: Record<MobileEditorToolbarActionId, ReactNode> = {
    image: <ImagePlusIcon />,
    mermaid: <DiagramIcon />,
    bold: <BoldIcon />,
    bulletList: <ListIcon />,
    increaseListIndent: <ListIndentIncreaseIcon />,
    decreaseListIndent: <ListIndentDecreaseIcon />,
    blockquote: <QuoteIcon />,
    horizontalRule: <MinusIcon />,
    insertTable: <TableGridIcon />,
    addTableRow: null,
    deleteTableRow: null,
    addTableColumn: null,
    deleteTableColumn: null,
    toggleTableHeader: null,
    deleteTable: null,
  };
  const toolbarHandlers: Record<MobileEditorToolbarActionId, () => void> = {
    image: () => void insertImage(),
    mermaid: () => {
      if (!editor) {
        return;
      }
      if (editor.isActive("codeBlock")) {
        editor.chain().focus().updateAttributes("codeBlock", { language: "mermaid" }).run();
        return;
      }
      editor.chain().focus().insertContent({
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [{ type: "text", text: "flowchart LR\n  A[Start] --> B[End]" }],
      }).run();
    },
    bold: () => editor?.chain().focus().toggleBold().run(),
    bulletList: () => editor?.chain().focus().toggleBulletList().run(),
    increaseListIndent: () => editor?.chain().focus().sinkListItem("listItem").run(),
    decreaseListIndent: () => editor?.chain().focus().liftListItem("listItem").run(),
    blockquote: () => editor?.chain().focus().toggleBlockquote().run(),
    horizontalRule: () => editor?.chain().focus().setHorizontalRule().run(),
    insertTable: () => runTableAction("insertTable"),
    addTableRow: () => runTableAction("addTableRow"),
    deleteTableRow: () => runTableAction("deleteTableRow"),
    addTableColumn: () => runTableAction("addTableColumn"),
    deleteTableColumn: () => runTableAction("deleteTableColumn"),
    toggleTableHeader: () => runTableAction("toggleTableHeader"),
    deleteTable: () => runTableAction("deleteTable"),
  };

  return (
    <div className="edgeever-editor-shell">
      <style>{getEditorStyles(props.theme)}</style>
      <div aria-label={getMobileEditorToolbarLabel(props.locale)} className="edgeever-editor-toolbar" role="toolbar">
        {MOBILE_EDITOR_TOOLBAR_ACTIONS
          .filter((action) => !action.requiresTable
            && (!(toolbarState & MOBILE_EDITOR_ACTIVE_FLAGS.table) || action.id !== "insertTable"))
          .map((action) => (
            <ToolbarButton
              key={action.id}
              active={action.activeFlag > 0 && Boolean(toolbarState & action.activeFlag)}
              disabled={(action.id === "insertTable" && Boolean(toolbarState & MOBILE_EDITOR_ACTIVE_FLAGS.table))
                || (action.id === "increaseListIndent"
                  && !Boolean(editor?.can().chain().focus().sinkListItem("listItem").run()))
                || (action.id === "decreaseListIndent"
                  && !Boolean(editor?.can().chain().focus().liftListItem("listItem").run()))}
              icon={toolbarIcons[action.id]}
              label={getMobileEditorToolbarActionLabel(action.id, props.locale)}
              onRun={toolbarHandlers[action.id]}
            />
          ))}
        {Boolean(toolbarState & MOBILE_EDITOR_ACTIVE_FLAGS.table) && (
          <button
            aria-label={tableMenuCopy.title}
            className="edgeever-table-menu-trigger"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setTableMenuOpen(true)}
            type="button"
          >
            <TableGridIcon />
            <span>{tableMenuCopy.title}</span>
          </button>
        )}
      </div>
      {Boolean(toolbarState & MOBILE_EDITOR_ACTIVE_FLAGS.table) && tableMenuOpen && (
        <div className="edgeever-table-menu-backdrop" role="presentation" onMouseDown={() => setTableMenuOpen(false)}>
          <section
            aria-label={tableMenuCopy.title}
            aria-modal="true"
            className="edgeever-table-menu-sheet"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="edgeever-table-menu-handle" aria-hidden="true" />
            <div className="edgeever-table-menu-header">
              <strong>{tableMenuCopy.title}</strong>
              <button type="button" onClick={() => setTableMenuOpen(false)}>{tableMenuCopy.close}</button>
            </div>
            <div className="edgeever-table-menu-actions">
              {MOBILE_EDITOR_TOOLBAR_ACTIONS.filter((action) => action.requiresTable).map((action) => (
                <button
                  key={action.id}
                  className={action.id === "deleteTable" ? "is-destructive" : undefined}
                  disabled={isMobileEditorActionDisabledInTableHeader(action.id)
                    && Boolean(toolbarState & MOBILE_EDITOR_ACTIVE_FLAGS.tableHeader)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setTableMenuOpen(false);
                    toolbarHandlers[action.id]();
                  }}
                  type="button"
                >
                  {getMobileEditorToolbarActionLabel(action.id, props.locale)}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      <EditorContent editor={editor} />
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

type EditorSearchMatch = { from: number; to: number };

const getEditorSearchMatches = (editor: ReturnType<typeof useEditor>, query: string): EditorSearchMatch[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (!editor || editor.isDestroyed || needle.length === 0) {
    return [];
  }

  const characters: Array<{ char: string; pos: number }> = [];
  let previousTextEnd: number | null = null;
  editor.state.doc.descendants((node, pos) => {
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

const DiagramIcon = () => (
  <EditorIcon size={18} strokeWidth={2}>
    <rect height="5" rx="1" width="7" x="2" y="3" />
    <rect height="5" rx="1" width="7" x="15" y="16" />
    <path d="M9 5.5h3a3 3 0 0 1 3 3v5a3 3 0 0 0 3 3" />
    <path d="m15 13 3 3-3 3" />
  </EditorIcon>
);

const ListIcon = () => (
  <EditorIcon size={18} strokeWidth={2.2}>
    <path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13" />
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

const TableGridIcon = () => (
  <EditorIcon size={18} strokeWidth={2}>
    <rect height="16" rx="1" width="18" x="3" y="4" />
    <path d="M3 10h18M9 4v16M15 4v16" />
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

const normalizeProtectedResourceSource = (source: string, baseUrl: string) => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const relativeSource = source.startsWith(`${normalizedBaseUrl}/`) ? source.slice(normalizedBaseUrl.length) : source;
  return relativeSource.startsWith("/api/v1/resources/") ? relativeSource : null;
};

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
    button.setAttribute("aria-label", `${label}，${preset.width}%`);
    button.setAttribute("aria-pressed", "false");

    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const percentNode = document.createElement("span");
    percentNode.className = "edgeever-image-size-percent";
    percentNode.textContent = `${preset.width}%`;
    button.append(labelNode, percentNode);

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
  loadResource: (source: string) => Promise<string | null>
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
      const updateWidth = (width: number) => {
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
              if (activeRequestId === requestId) {
                revealLoadedImage(dataUrl ?? resolveUrl(source, baseUrl), attributes, activeRequestId);
              }
            })
            .catch(() => {
              if (activeRequestId === requestId) {
                revealLoadedImage(resolveUrl(source, baseUrl), attributes, activeRequestId);
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
      wrapper.className = "edgeever-image-node";
      wrapper.contentEditable = "false";
      const image = document.createElement("img");
      wrapper.append(image, sizeControls.dom);
      const imageType = node.type;
      let requestId = 0;

      const clearRequest = () => {
        requestId += 1;
      };

      const renderNode = (attributes: Record<string, unknown>) => {
        clearRequest();
        sizeControls.setActiveWidth(applyImageWidth(wrapper, attributes));
        const source = String(attributes.src ?? "");
        const alt = String(attributes.alt ?? "");
        const title = String(attributes.title ?? "");
        image.alt = alt;
        if (title) {
          image.title = title;
        } else {
          image.removeAttribute("title");
        }

        const protectedSource = normalizeProtectedResourceSource(source, baseUrl);
        if (!protectedSource) {
          image.src = resolveUrl(source, baseUrl);
          return;
        }

        image.removeAttribute("src");
        const activeRequestId = requestId;
        void loadResource(protectedSource)
          .then((dataUrl) => {
            if (activeRequestId === requestId) {
              image.src = dataUrl ?? resolveUrl(source, baseUrl);
            }
          })
          .catch(() => {
            if (activeRequestId === requestId) {
              image.src = resolveUrl(source, baseUrl);
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
          sizeControls.setVisible(true);
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

const getEditorStyles = (theme: "light" | "dark") => `
  :root { color-scheme: ${theme}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body, #root { width: 100%; height: 100%; margin: 0; background: ${theme === "dark" ? "#0f172a" : "#fff"}; }
  body { overflow: hidden; color: ${theme === "dark" ? "#f8fafc" : "#0f172a"}; }
  .edgeever-editor-shell { display: flex; height: 100%; min-height: 100%; flex-direction: column; background: ${theme === "dark" ? "#0f172a" : "#fff"}; }
  .edgeever-editor-toolbar { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; min-height: 38px; overflow-x: auto; padding: 6px 12px; border-block: 1px solid ${theme === "dark" ? "#334155" : "#f1f5f9"}; background: ${theme === "dark" ? "#0f172a" : "#fff"}; scrollbar-width: none; }
  .edgeever-editor-toolbar::-webkit-scrollbar { display: none; }
  .edgeever-editor-toolbar button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 36px; min-height: 32px; padding: 0; border: 1px solid transparent; border-radius: 999px; background: transparent; color: ${theme === "dark" ? "#cbd5e1" : "#64748b"}; }
  .edgeever-editor-toolbar button:active, .edgeever-editor-toolbar button.is-active { border-color: ${theme === "dark" ? "#166534" : "#bbf7d0"}; background: ${theme === "dark" ? "#14532d" : "#ecfdf5"}; color: ${theme === "dark" ? "#86efac" : "#047857"}; }
  .edgeever-editor-toolbar button:disabled { opacity: 0.38; }
  .edgeever-editor-toolbar .edgeever-table-menu-trigger { gap: 6px; width: auto; padding-inline: 10px; font-size: 13px; font-weight: 700; }
  .edgeever-table-menu-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; background: ${theme === "dark" ? "rgba(2, 6, 23, 0.62)" : "rgba(15, 23, 42, 0.22)"}; }
  .edgeever-table-menu-sheet { width: 100%; border-radius: 18px 18px 0 0; padding: 8px 0 max(10px, env(safe-area-inset-bottom)); background: ${theme === "dark" ? "#1e293b" : "#fff"}; box-shadow: 0 -18px 45px rgba(15, 23, 42, 0.16); }
  .edgeever-table-menu-handle { width: 38px; height: 4px; margin: 2px auto 8px; border-radius: 999px; background: #cbd5e1; }
  .edgeever-table-menu-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid ${theme === "dark" ? "#334155" : "#f1f5f9"}; padding: 0 16px 10px; }
  .edgeever-table-menu-header strong { color: ${theme === "dark" ? "#f8fafc" : "#0f172a"}; font-size: 16px; }
  .edgeever-table-menu-header button { min-height: 32px; border: 0; border-radius: 999px; padding: 6px 10px; background: ${theme === "dark" ? "#334155" : "#f8fafc"}; color: ${theme === "dark" ? "#cbd5e1" : "#64748b"}; font: inherit; font-size: 14px; font-weight: 650; }
  .edgeever-table-menu-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; }
  .edgeever-table-menu-actions button { min-height: 48px; border: 0; border-radius: 10px; padding: 8px; background: ${theme === "dark" ? "#334155" : "#f8fafc"}; color: ${theme === "dark" ? "#e2e8f0" : "#334155"}; font: inherit; font-size: 15px; font-weight: 650; }
  .edgeever-table-menu-actions button:active { background: ${theme === "dark" ? "#14532d" : "#ecfdf5"}; color: ${theme === "dark" ? "#86efac" : "#047857"}; }
  .edgeever-table-menu-actions button:disabled { color: #94a3b8; opacity: 0.55; }
  .edgeever-table-menu-actions button.is-destructive { background: ${theme === "dark" ? "#4c0519" : "#fff1f2"}; color: ${theme === "dark" ? "#fda4af" : "#be123c"}; }
  .tiptap { min-height: 100%; outline: none; }
  .edgeever-editor-shell > div:last-child { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .edgeever-editor-content { min-height: 100%; padding: 18px 12px 32px; font-size: 17px; line-height: 1.7; word-break: break-word; caret-color: #0f766e; }
  .edgeever-editor-content > :first-child { margin-top: 0; }
  .edgeever-editor-content p.is-editor-empty:first-child::before { float: left; height: 0; color: #94a3b8; content: attr(data-placeholder); pointer-events: none; }
  .edgeever-editor-content h1, .edgeever-editor-content h2, .edgeever-editor-content h3 { line-height: 1.3; }
  .edgeever-editor-content blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #5eead4; color: ${theme === "dark" ? "#cbd5e1" : "#475569"}; }
  .edgeever-editor-content pre { overflow-x: auto; border-radius: 10px; padding: 14px 90px 14px 14px; background: #0f172a; color: #e2e8f0; }
  .edgeever-editor-content code { border-radius: 4px; padding: 2px 4px; background: ${theme === "dark" ? "#1e293b" : "#f1f5f9"}; }
  .edgeever-editor-content pre code { padding: 0; background: transparent; }
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
  .edgeever-editor-content .tableWrapper { --mobile-table-column-width: clamp(5.5rem, calc((100vw - 3rem) / 3), 14rem); width: 100%; max-width: 100%; overflow-x: auto; margin-top: 20px; margin-right: auto; margin-bottom: 20px; margin-left: 0; border: 1px solid ${theme === "dark" ? "#334155" : "#d8d8d8"}; border-radius: 2px; background: ${theme === "dark" ? "#0f172a" : "#fff"}; overscroll-behavior-inline: contain; scrollbar-color: rgba(100, 116, 139, 0.28) transparent; }
  .edgeever-editor-content table { width: max-content; min-width: 100% !important; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
  .edgeever-editor-content table col { width: var(--mobile-table-column-width) !important; }
  .edgeever-editor-content th, .edgeever-editor-content td { position: relative; width: var(--mobile-table-column-width); min-width: var(--mobile-table-column-width); border: 0; border-right: 1px solid ${theme === "dark" ? "#334155" : "#dedede"}; border-bottom: 1px solid ${theme === "dark" ? "#334155" : "#dedede"}; padding: 7px 12px; text-align: left; vertical-align: top; overflow-wrap: anywhere; line-height: 1.4; transition: background-color 120ms ease; }
  .edgeever-editor-content th { background: ${theme === "dark" ? "#27303f" : "#f0f0f0"}; color: ${theme === "dark" ? "#f8fafc" : "#111827"}; font-size: 14px; font-weight: 700; }
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
  .edgeever-image-node > img, .edgeever-image-upload-result > img { width: 100%; margin: 0; }
  .edgeever-image-node.is-selected > img, .edgeever-image-upload-result.is-selected > img { outline: 2px solid #0f766e; outline-offset: 3px; }
  .edgeever-image-size-controls { position: absolute; left: 50%; bottom: 8px; z-index: 2; display: flex; width: max-content; max-width: calc(100vw - 40px); align-items: center; gap: 3px; transform: translateX(-50%); border: 1px solid ${theme === "dark" ? "#475569" : "#bbf7d0"}; border-radius: 9px; padding: 4px; background: ${theme === "dark" ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.96)"}; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2); line-height: 1.15; }
  .edgeever-image-size-controls[hidden] { display: none; }
  .edgeever-image-size-button { display: inline-flex; min-width: 52px; min-height: 44px; appearance: none; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 0; border-radius: 7px; padding: 4px 7px; background: transparent; color: ${theme === "dark" ? "#cbd5e1" : "#475569"}; font: inherit; font-size: 12px; font-weight: 700; }
  .edgeever-image-size-button.is-active { background: ${theme === "dark" ? "#134e4a" : "#ccfbf1"}; color: ${theme === "dark" ? "#99f6e4" : "#0f766e"}; }
  .edgeever-image-size-percent { color: ${theme === "dark" ? "#94a3b8" : "#94a3b8"}; font-size: 10px; font-weight: 600; }
  .edgeever-image-size-button.is-active .edgeever-image-size-percent { color: inherit; }
  .edgeever-image-upload-spinner { width: 18px; height: 18px; border: 2px solid ${theme === "dark" ? "#475569" : "#cbd5e1"}; border-top-color: #0f766e; border-radius: 999px; animation: edgeever-image-upload-spin 0.8s linear infinite; }
  @keyframes edgeever-image-upload-spin { to { transform: rotate(360deg); } }
  .edgeever-editor-content hr { margin: 24px 0; border: 0; border-top: 1px solid #cbd5e1; }
`;
