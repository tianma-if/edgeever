import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/button";
import { useAiBubbleMenu } from "@/components/editor/useAiBubbleMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BubbleMenuTransactionRegression = () => {
  const [transactionCount, setTransactionCount] = useState(0);
  const aiBubbleMenu = useAiBubbleMenu(false);
  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p>Bubble menu regression</p>",
  }, []);

  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => setTransactionCount((count) => count + 1);
    editor.on("transaction", handleTransaction);
    const frame = window.requestAnimationFrame(() => {
      editor.commands.setTextSelection({ from: 1, to: 7 });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);

  return (
    <div
      data-bubble-menu-regression-ready={transactionCount > 0 ? "true" : "false"}
      data-bubble-menu-transaction-count={transactionCount}
    >
      <BubbleMenu
        editor={editor}
        shouldShow={aiBubbleMenu.shouldShow}
        options={aiBubbleMenu.options}
      >
        <span>Selection action</span>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
};

const useDiagramEditorRegressionReady = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void import("@/components/DiagramEditorPane").then(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return ready;
};

const DesktopRendererTest = () => {
  const diagramEditorReady = useDiagramEditorRegressionReady();

  return (
    <main
      data-desktop-renderer-test-ready
      data-diagram-editor-regression-ready={diagramEditorReady ? "true" : "false"}
    >
      <BubbleMenuTransactionRegression />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="More actions" title="More actions">
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Select defaultValue="notebook-one">
        <SelectTrigger aria-label="Notebook">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="notebook-one">Notebook one</SelectItem>
          <SelectItem value="notebook-two">Notebook two</SelectItem>
        </SelectContent>
      </Select>
    </main>
  );
};

const root = document.getElementById("desktop-renderer-test-root");

if (!root) {
  throw new Error("Desktop renderer test root not found");
}

createRoot(root).render(
  <React.StrictMode>
    <DesktopRendererTest />
  </React.StrictMode>
);
