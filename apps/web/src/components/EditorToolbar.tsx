import type { ReactNode } from "react";
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
  ListOrdered,
  Quote,
  SquareCode,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getActiveBlockValue } from "@/lib/app-helpers";
import { CODE_BLOCK_LANGUAGES, getCodeBlockLanguageValue } from "@/lib/code-block";

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

const ToolbarDivider = () => <div className="h-6 w-px shrink-0 bg-slate-200" />;

const isToolbarEditorReady = (editor: Editor | null): editor is Editor =>
  Boolean(editor && !editor.isDestroyed && (editor as { extensionManager?: unknown }).extensionManager);

const editorHasCodeBlock = (editor: Editor) => {
  let found = false;

  editor.state.doc.descendants((node) => {
    if (node.type.name === "codeBlock") {
      found = true;
      return false;
    }

    return true;
  });

  return found;
};

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

export const EditorToolbar = ({ editor, readOnly }: { editor: Editor | null; readOnly: boolean }) => {
  const { t } = useTranslation();
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
  const showCodeLanguageSelector = editorReady && editorHasCodeBlock(editor);
  const codeBlockLanguage = editorReady
    ? getCodeBlockLanguageValue(editor.getAttributes("codeBlock").language)
    : "plaintext";

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
    <TooltipProvider delayDuration={250} skipDelayDuration={100}>
      <div className="relative border-t border-slate-200 bg-white">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4 bg-gradient-to-r from-white to-transparent sm:hidden" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-4 bg-gradient-to-l from-white to-transparent sm:hidden" />
        <div
          className="flex min-h-12 items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden"
          role="toolbar"
          aria-label={t("editorToolbar.toolbar")}
        >
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
            title={t("editorToolbar.bulletList")}
            active={isActive("bulletList")}
            disabled={disabled}
            onClick={() => run((current) => current.chain().focus().toggleBulletList().run())}
          >
            <List className="h-4 w-4" />
          </EditorToolbarButton>
          <EditorToolbarButton
            title={t("editorToolbar.orderedList")}
            active={isActive("orderedList")}
            disabled={disabled}
            onClick={() => run((current) => current.chain().focus().toggleOrderedList().run())}
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
            title={t("editorToolbar.horizontalRule")}
            disabled={disabled}
            onClick={() => run((current) => current.chain().focus().setHorizontalRule().run())}
          >
            <Minus className="h-4 w-4" />
          </EditorToolbarButton>
        </div>
      </div>
    </TooltipProvider>
  );
};
