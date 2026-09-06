import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Strikethrough,
  Code2,
  List,
  ListTodo,
  ListOrdered,
  Quote,
  SquareCode,
  ChartNoAxesCombined,
  Minus,
  Paperclip,
  Link,
  Link2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatShortcutBinding,
  getActiveBlockValue,
  readEditorToolbarExpandedPreference,
  writeEditorToolbarExpandedPreference,
  type ShortcutBinding,
} from "@/lib/app-helpers";
import { CODE_BLOCK_LANGUAGES, getCodeBlockLanguageValue } from "@/lib/code-block";
import { EditorTableMenu } from "@/components/EditorTableMenu";
import { wrapIndentedParagraphInList } from "@/lib/editor-shortcuts";

const EditorToolbarButton = ({
  active = false,
  children,
  disabled = false,
  onClick,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-slate-700 transition disabled:pointer-events-none disabled:opacity-40",
          active
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-transparent bg-transparent hover:border-slate-200 hover:bg-slate-50"
        )}
        type="button"
        aria-label={title}
        aria-pressed={active || undefined}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent>{title}</TooltipContent>
  </Tooltip>
);

const ToolbarDivider = () => <div className="hidden h-6 w-px shrink-0 bg-slate-200 sm:block" />;

const isToolbarEditorReady = (editor: Editor | null): editor is Editor =>
  Boolean(editor && !editor.isDestroyed && (editor as { extensionManager?: unknown }).extensionManager);

const toggleCodeBlock = (editor: Editor) => {
  const { from, to, empty } = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(from, to, "\n", "\n");

  if (empty || !selectedText.includes("\n")) {
    editor.chain().focus().toggleCodeBlock().run();
    return;
  }

  editor
    .chain()
    .focus()
    .insertContentAt(
      { from, to },
      {
        type: "codeBlock",
        content: selectedText ? [{ type: "text", text: selectedText }] : undefined,
      }
    )
    .run();
};

const insertMermaidDiagram = (editor: Editor) => {
  if (editor.isActive("codeBlock")) {
    editor.chain().focus().updateAttributes("codeBlock", { language: "mermaid" }).run();
    return;
  }

  const { from, to } = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(from, to, "\n", "\n").trim();
  const source = selectedText || "flowchart LR\n  A[Start] --> B[End]";

  editor
    .chain()
    .focus()
    .insertContentAt(
      { from, to },
      {
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [{ type: "text", text: source }],
      }
    )
    .run();
};

const toggleListAtSelection = (editor: Editor, listType: "bulletList" | "orderedList" | "taskList") => {
  editor.commands.focus();
  if (wrapIndentedParagraphInList(editor.state, editor.view.dispatch, listType)) {
    return;
  }

  if (listType === "bulletList") {
    editor.commands.toggleBulletList();
  } else if (listType === "orderedList") {
    editor.commands.toggleOrderedList();
  } else {
    editor.commands.toggleTaskList();
  }
};

export const EditorToolbar = ({
  editor,
  readOnly,
  markdownMode = false,
  onMarkdownModeChange,
  markdownModeShortcut,
  onPickAttachment,
  onPickExternalLink,
  onPickNoteLink,
  externalLinkActive = false,
}: {
  editor: Editor | null;
  readOnly: boolean;
  markdownMode?: boolean;
  onMarkdownModeChange?: () => void;
  markdownModeShortcut?: ShortcutBinding;
  onPickAttachment?: () => void;
  /** Insert or edit an external hyperlink (not a note reference). */
  onPickExternalLink?: () => void;
  onPickNoteLink?: () => void;
  externalLinkActive?: boolean;
}) => {
  const { t } = useTranslation();
  const controlsRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(readEditorToolbarExpandedPreference);
  const [hasOverflow, setHasOverflow] = useState(false);
  const markdownModeShortcutLabel = markdownModeShortcut ? formatShortcutBinding(markdownModeShortcut) : null;
  const editorReady = isToolbarEditorReady(editor);
  const disabled = readOnly || !editorReady;
  const blockValue = getActiveBlockValue(editor);
  const isActive = (name: string) => {
    if (!editorReady) {
      return false;
    }

    try {
      return editor.isActive(name);
    } catch {
      return false;
    }
  };
  const codeBlockActive = isActive("codeBlock");
  const showCodeLanguageSelector = codeBlockActive;
  const codeBlockLanguage = editorReady
    ? getCodeBlockLanguageValue(editor.getAttributes("codeBlock").language)
    : "plaintext";

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const updateOverflow = () => {
      const style = window.getComputedStyle(controls);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) * 2;
      const visibleItems = Array.from(controls.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && child.offsetWidth > 0
      );
      const requiredWidth = visibleItems.reduce((width, item) => width + item.offsetWidth, 0)
        + Math.max(0, visibleItems.length - 1) * gap;
      const availableWidth = Math.max(0, controls.clientWidth - horizontalPadding);
      const next = requiredWidth > availableWidth + 1;
      const firstRowTop = Math.min(...visibleItems.map((item) => item.offsetTop));

      visibleItems.forEach((item) => {
        item.inert = !expanded && next && item.offsetTop > firstRowTop + 1;
      });

      setHasOverflow((current) => {
        return current === next ? current : next;
      });
    };

    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(controls);
    Array.from(controls.children).forEach((child) => observer.observe(child));
    return () => {
      observer.disconnect();
      Array.from(controls.children).forEach((child) => {
        if (child instanceof HTMLElement) child.inert = false;
      });
    };
  });

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    writeEditorToolbarExpandedPreference(next);
  };

  const canRun = (command: (editor: Editor) => boolean) => {
    if (!isToolbarEditorReady(editor) || readOnly) {
      return false;
    }

    try {
      return command(editor);
    } catch {
      return false;
    }
  };

  const run = (command: (editor: Editor) => void) => {
    if (!isToolbarEditorReady(editor) || readOnly) {
      return;
    }

    try {
      command(editor);
    } catch {
      return;
    }
  };

  const setBlock = (value: string) => {
    run((current) => {
      const chain = current.chain().focus();

      if (value === "paragraph") {
        chain.setParagraph().run();
        return;
      }

      if (value === "heading-1") {
        chain.setHeading({ level: 1 }).run();
        return;
      }

      if (value === "heading-2") {
        chain.setHeading({ level: 2 }).run();
        return;
      }

      if (value === "heading-3") {
        chain.setHeading({ level: 3 }).run();
      }
    });
  };

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <div
        className="relative min-w-0 max-w-full border-t border-slate-100 bg-white"
        role="toolbar"
        aria-label={t("editorToolbar.toolbar")}
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4 bg-gradient-to-r from-white to-transparent sm:hidden" />
        <div
          ref={controlsRef}
          className={cn(
            "flex min-w-0 max-w-full flex-wrap items-center gap-1 px-3 py-2 sm:px-5",
            hasOverflow && "pr-14 sm:pr-16",
            !expanded && "max-h-12 overflow-hidden"
          )}
        >
          {onMarkdownModeChange && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
                      markdownMode
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200/80 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    )}
                    type="button"
                    aria-label={markdownMode ? t("editorToolbar.richText") : t("editorToolbar.markdown")}
                    aria-pressed={markdownMode}
                    disabled={readOnly}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onMarkdownModeChange}
                  >
                    {markdownMode ? t("editorToolbar.switchToRichText") : t("editorToolbar.switchToMarkdown")}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex items-center gap-2">
                  <span>{markdownMode ? t("editorToolbar.richText") : t("editorToolbar.markdown")}</span>
                  {markdownModeShortcutLabel && (
                    <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none">
                      {markdownModeShortcutLabel}
                    </kbd>
                  )}
                </TooltipContent>
              </Tooltip>
              <ToolbarDivider />
            </>
          )}
          {onPickAttachment && (
            <>
              <EditorToolbarButton
                title={t("editorToolbar.attachment")}
                disabled={readOnly}
                onClick={onPickAttachment}
              >
                <Paperclip className="h-4 w-4" />
              </EditorToolbarButton>
              <ToolbarDivider />
            </>
          )}
          {onPickExternalLink && (
            <>
              <EditorToolbarButton
                title={
                  externalLinkActive
                    ? t("editorToolbar.externalLinkEdit")
                    : t("editorToolbar.externalLinkShortcut")
                }
                active={externalLinkActive}
                disabled={readOnly}
                onClick={onPickExternalLink}
              >
                <Link className="h-4 w-4" />
              </EditorToolbarButton>
              <ToolbarDivider />
            </>
          )}
          {onPickNoteLink && (
            <>
              <EditorToolbarButton
                title={t("editorToolbar.noteLink")}
                disabled={readOnly}
                onClick={onPickNoteLink}
              >
                <Link2 className="h-4 w-4" />
              </EditorToolbarButton>
              <ToolbarDivider />
            </>
          )}
          {markdownMode ? (
            <span className="shrink-0 text-xs text-slate-500">{t("editorToolbar.markdownSource")}</span>
          ) : (
            <>
          <Select
            value={blockValue}
            disabled={disabled}
            onValueChange={(value) => setBlock(value)}
          >
            <SelectTrigger className="h-8 w-20 shrink-0 whitespace-nowrap border-slate-200 bg-white text-xs text-slate-800 [&>span]:truncate [&>span]:whitespace-nowrap">
              <SelectValue placeholder={t("editorToolbar.paragraph")} />
            </SelectTrigger>
            <SelectContent className="bg-white border border-slate-200 rounded-md py-1 shadow-md">
              <SelectItem value="paragraph">{t("editorToolbar.paragraph")}</SelectItem>
              <SelectItem value="heading-1">{t("editorToolbar.heading1")}</SelectItem>
              <SelectItem value="heading-2">{t("editorToolbar.heading2")}</SelectItem>
              <SelectItem value="heading-3">{t("editorToolbar.heading3")}</SelectItem>
            </SelectContent>
          </Select>

          <ToolbarDivider />
          <EditorToolbarButton
            title={t("editorToolbar.undo")}
            disabled={!canRun((current) => current.can().chain().focus().undo().run())}
            onClick={() => run((current) => current.chain().focus().undo().run())}
          >
            <Undo2 className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.redo")}
            disabled={!canRun((current) => current.can().chain().focus().redo().run())}
            onClick={() => run((current) => current.chain().focus().redo().run())}
          >
            <Redo2 className="h-4 w-4" />
          </EditorToolbarButton>

          <ToolbarDivider />
          <EditorToolbarButton
            title={t("editorToolbar.bold")}
            active={isActive("bold")}
            disabled={!canRun((current) => current.can().chain().focus().toggleBold().run())}
            onClick={() => run((current) => current.chain().focus().toggleBold().run())}
          >
            <Bold className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.italic")}
            active={isActive("italic")}
            disabled={!canRun((current) => current.can().chain().focus().toggleItalic().run())}
            onClick={() => run((current) => current.chain().focus().toggleItalic().run())}
          >
            <Italic className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.strike")}
            active={isActive("strike")}
            disabled={!canRun((current) => current.can().chain().focus().toggleStrike().run())}
            onClick={() => run((current) => current.chain().focus().toggleStrike().run())}
          >
            <Strikethrough className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.inlineCode")}
            active={isActive("code")}
            disabled={!canRun((current) => current.can().chain().focus().toggleCode().run())}
            onClick={() => run((current) => current.chain().focus().toggleCode().run())}
          >
            <Code2 className="h-4 w-4" />
          </EditorToolbarButton>

          <ToolbarDivider />
          <EditorToolbarButton
            title={`${t("editorToolbar.bulletList")} · ${t("editorToolbar.listIndentHint")}`}
            active={isActive("bulletList")}
            disabled={disabled}
            onClick={() => run((current) => toggleListAtSelection(current, "bulletList"))}
          >
            <List className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={`${t("editorToolbar.taskList")} · ${t("editorToolbar.listIndentHint")}`}
            active={isActive("taskList")}
            disabled={!canRun((current) => current.can().chain().focus().toggleTaskList().run())}
            onClick={() => run((current) => toggleListAtSelection(current, "taskList"))}
          >
            <ListTodo className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={`${t("editorToolbar.orderedList")} · ${t("editorToolbar.listIndentHint")}`}
            active={isActive("orderedList")}
            disabled={disabled}
            onClick={() => run((current) => toggleListAtSelection(current, "orderedList"))}
          >
            <ListOrdered className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.quote")}
            active={isActive("blockquote")}
            disabled={disabled}
            onClick={() => run((current) => current.chain().focus().toggleBlockquote().run())}
          >
            <Quote className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.codeBlock")}
            active={codeBlockActive}
            disabled={disabled}
            onClick={() => run(toggleCodeBlock)}
          >
            <SquareCode className="h-4 w-4" />
          </EditorToolbarButton>
          {showCodeLanguageSelector && (
            <Select
              value={codeBlockLanguage}
              disabled={disabled || !codeBlockActive}
              onValueChange={(value) =>
                run((current) => current.chain().focus().updateAttributes("codeBlock", { language: value }).run())
              }
            >
              <SelectTrigger
                className="h-8 w-32 shrink-0 whitespace-nowrap border-slate-200 bg-white text-xs text-slate-800 [&>span]:truncate [&>span]:whitespace-nowrap"
                aria-label={t("editorToolbar.codeLanguage")}
              >
                <SelectValue placeholder={t("editorToolbar.plainText")} />
              </SelectTrigger>
              <SelectContent className="bg-white border border-slate-200 rounded-md py-1 shadow-md">
                {CODE_BLOCK_LANGUAGES.map((language) => (
                  <SelectItem key={language.value} value={language.value}>
                    {language.value === "plaintext" ? t("editorToolbar.plainText") : language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <EditorToolbarButton
            title={t("editorToolbar.mermaidDiagram")}
            active={codeBlockActive && codeBlockLanguage === "mermaid"}
            disabled={disabled}
            onClick={() => run(insertMermaidDiagram)}
          >
            <ChartNoAxesCombined className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.horizontalRule")}
            disabled={disabled}
            onClick={() => run((current) => current.chain().focus().setHorizontalRule().run())}
          >
            <Minus className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorTableMenu editor={editor} readOnly={readOnly} />
            </>
          )}
        </div>
        {hasOverflow && (
          <div className="absolute right-3 top-2 z-20 flex h-8 items-center bg-gradient-to-l from-white via-white to-transparent pl-5 sm:right-5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                  type="button"
                  aria-expanded={expanded}
                  aria-label={t(expanded ? "editorToolbar.showLess" : "editorToolbar.showMore")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={toggleExpanded}
                >
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t(expanded ? "editorToolbar.showLess" : "editorToolbar.showMore")}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
