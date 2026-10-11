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
  Sigma,
  ChevronDown,
  ChevronUp,
  FileCode2,
  FileText,
  Heading,
  Palette,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MEMO_EDITOR_TOOLBAR_COLLAPSED_CLASS_NAME } from "@/components/MemoEditorChromeDensity";
import { MemoEditorToolbarDivider, MemoEditorToolbarRow } from "@/components/MemoEditorToolbarChrome";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EDITOR_HEADING_LEVELS,
  formatShortcutBinding,
  getActiveBlockValue,
  parseHeadingBlockValue,
  readEditorToolbarExpandedPreference,
  writeEditorToolbarExpandedPreference,
  type ShortcutBinding,
} from "@/lib/app-helpers";
import { CODE_BLOCK_LANGUAGES, getCodeBlockLanguageValue } from "@/lib/code-block";
import { EditorTableMenu } from "@/components/EditorTableMenu";
import { wrapIndentedParagraphInList } from "@/lib/editor-shortcuts";
import {
  MARKDOWN_THEME_PREFERENCES,
  useMarkdownTheme,
} from "@/components/ThemeProvider";

const EditorToolbarButton = ({
  active = false,
  children,
  disabled = false,
  onClick,
  shortcutLabel,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  shortcutLabel?: string | null;
  title: string;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition disabled:pointer-events-none disabled:opacity-40",
          active
            ? "bg-slate-200/80 text-slate-900"
            : "bg-transparent hover:bg-slate-100 hover:text-slate-800"
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
    <TooltipContent side="bottom" className={shortcutLabel ? "flex items-center gap-2" : undefined}>
      {shortcutLabel ? (
        <>
          <span>{title}</span>
          <kbd className="rounded border border-current/25 bg-current/10 px-1.5 py-0.5 font-mono text-xs leading-none">
            {shortcutLabel}
          </kbd>
        </>
      ) : title}
    </TooltipContent>
  </Tooltip>
);

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

export type EditorViewMode = "rich" | "markdown";

const EDITOR_VIEW_MODES = [
  { value: "rich", labelKey: "editorToolbar.richText", icon: FileText },
  { value: "markdown", labelKey: "editorToolbar.markdown", icon: FileCode2 },
] as const satisfies ReadonlyArray<{ value: EditorViewMode; labelKey: string; icon: typeof FileText }>;

export const EditorToolbar = ({
  editor,
  readOnly,
  markdownMode = false,
  editorView = "rich",
  onEditorViewChange,
  viewSwitchDisabled = false,
  onMarkdownModeChange,
  markdownModeShortcut,
  onPickAttachment,
  onPickExternalLink,
  onPickNoteLink,
  onPickMathFormula,
  externalLinkActive = false,
}: {
  editor: Editor | null;
  readOnly: boolean;
  markdownMode?: boolean;
  editorView?: EditorViewMode;
  onEditorViewChange?: (view: EditorViewMode) => void;
  /** Trash and other hard locks. Reading protection must not disable the view switch. */
  viewSwitchDisabled?: boolean;
  onMarkdownModeChange?: () => void;
  markdownModeShortcut?: ShortcutBinding;
  onPickAttachment?: () => void;
  /** Insert or edit an external hyperlink (not a note reference). */
  onPickExternalLink?: () => void;
  onPickNoteLink?: () => void;
  onPickMathFormula?: () => void;
  externalLinkActive?: boolean;
}) => {
  const { t } = useTranslation();
  const { markdownThemePreference, setMarkdownTheme } = useMarkdownTheme();
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
  const activeEditorView = onEditorViewChange ? editorView : markdownMode ? "markdown" : "rich";
  const showFormattingTools = activeEditorView === "rich";
  const nextEditorViewMode = EDITOR_VIEW_MODES[activeEditorView === "rich" ? 1 : 0];
  const canCycleEditorView = Boolean(onEditorViewChange || onMarkdownModeChange);

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
      const controlHeight = visibleItems.reduce((max, item) => Math.max(max, item.offsetHeight), 0);
      const wrappedRowStart = firstRowTop + controlHeight * 0.75;

      visibleItems.forEach((item) => {
        const wrapped = !expanded && next && item.offsetTop >= wrappedRowStart;
        item.inert = wrapped;
        item.classList.toggle("invisible", wrapped);
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
        if (child instanceof HTMLElement) {
          child.inert = false;
          child.classList.remove("invisible");
        }
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

      const headingLevel = parseHeadingBlockValue(value);
      if (headingLevel) {
        chain.setHeading({ level: headingLevel }).run();
      }
    });
  };

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <div
        className="relative min-w-0 max-w-full border-t border-[var(--workspace-divider)] bg-transparent"
        role="toolbar"
        aria-label={t("editorToolbar.toolbar")}
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4 bg-gradient-to-r from-card to-transparent sm:hidden" />
        <MemoEditorToolbarRow
          ref={controlsRef}
          className={cn(
            hasOverflow && "pr-14 sm:pr-16",
            !expanded && MEMO_EDITOR_TOOLBAR_COLLAPSED_CLASS_NAME
          )}
        >
          {canCycleEditorView ? (
            <>
              <EditorToolbarButton
                title={t(nextEditorViewMode.labelKey)}
                shortcutLabel={markdownModeShortcutLabel}
                disabled={onEditorViewChange ? viewSwitchDisabled : readOnly}
                onClick={() => {
                  if (onEditorViewChange) {
                    onEditorViewChange(nextEditorViewMode.value);
                    return;
                  }
                  onMarkdownModeChange?.();
                }}
              >
                <nextEditorViewMode.icon className="h-4 w-4" />
              </EditorToolbarButton>
              <MemoEditorToolbarDivider className="hidden sm:block" />
            </>
          ) : null}
          {onPickAttachment && (
            <>
              <EditorToolbarButton
                title={t("editorToolbar.attachment")}
                disabled={readOnly}
                onClick={onPickAttachment}
              >
                <Paperclip className="h-4 w-4" />
              </EditorToolbarButton>
              <MemoEditorToolbarDivider className="hidden sm:block" />
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
              <MemoEditorToolbarDivider className="hidden sm:block" />
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
              <MemoEditorToolbarDivider className="hidden sm:block" />
            </>
          )}
          {showFormattingTools && onPickMathFormula && (
            <EditorToolbarButton
              title={t("editorToolbar.math")}
              active={isActive("inlineMath") || isActive("blockMath")}
              disabled={disabled}
              onClick={onPickMathFormula}
            >
              <Sigma className="h-4 w-4" />
            </EditorToolbarButton>
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    type="button"
                    aria-label={markdownMode ? t("editorToolbar.markdownTheme") : t("editorToolbar.blockStyle")}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {markdownMode ? <Palette className="h-4 w-4" /> : <Heading className="h-4 w-4" />}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {markdownMode ? t("editorToolbar.markdownTheme") : t("editorToolbar.blockStyle")}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="max-h-80 w-52 overflow-y-auto border border-slate-200 bg-card py-1 shadow-md">
              {markdownMode ? (
                <>
                  <DropdownMenuLabel className="text-xs text-slate-500">{t("editorToolbar.markdownTheme")}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={markdownThemePreference}
                    onValueChange={(value) => setMarkdownTheme(value as typeof markdownThemePreference)}
                  >
                    {MARKDOWN_THEME_PREFERENCES.map((theme) => (
                      <DropdownMenuRadioItem key={theme} value={theme} className="text-xs leading-5">
                        {t(`settings.markdownThemes.${theme}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              ) : (
                <>
                  <DropdownMenuLabel className="text-xs text-slate-500">{t("editorToolbar.blockStyle")}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={blockValue} onValueChange={(value) => setBlock(value)}>
                    <DropdownMenuRadioItem value="paragraph" className="text-xs leading-5" disabled={disabled}>
                      {t("editorToolbar.paragraph")}
                    </DropdownMenuRadioItem>
                    {EDITOR_HEADING_LEVELS.map((level) => (
                      <DropdownMenuRadioItem key={level} value={`heading-${level}`} className="text-xs leading-5" disabled={disabled}>
                        {t(`editorToolbar.heading${level}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {showFormattingTools ? (
            <>
              <MemoEditorToolbarDivider className="hidden sm:block" />
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

          <MemoEditorToolbarDivider className="hidden sm:block" />
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

          <MemoEditorToolbarDivider className="hidden sm:block" />
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
                className="h-8 w-32 shrink-0 whitespace-nowrap border-slate-200 bg-card text-xs text-slate-800 [&>span]:truncate [&>span]:whitespace-nowrap"
                aria-label={t("editorToolbar.codeLanguage")}
              >
                <SelectValue placeholder={t("editorToolbar.plainText")} />
              </SelectTrigger>
              <SelectContent className="bg-card border border-slate-200 rounded-md py-1 shadow-md">
                {CODE_BLOCK_LANGUAGES.map((language) => (
                  <SelectItem key={language.value} value={language.value} className="text-xs leading-5">
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
          ) : null}
        </MemoEditorToolbarRow>
        {hasOverflow && (
          <div className="absolute right-3 top-2 z-20 flex h-8 items-center bg-gradient-to-l from-card via-card to-transparent pl-5 sm:right-4 sm:top-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-card text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
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
