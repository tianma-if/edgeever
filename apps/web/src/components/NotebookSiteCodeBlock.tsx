import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { FRONT_MATTER_LANGUAGE } from "@edgeever/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { copyTextToClipboard } from "@/lib/clipboard";
import { Button } from "./ui/button";
import { ButtonTooltip } from "./ui/button-tooltip";
import { MermaidCodeBlock } from "./MermaidCodeBlock";
import { NoteProperties } from "./editor/NoteProperties";

export const NotebookSiteCodeBlock = (props: NodeViewProps) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "error">("idle");
  const language = String(props.node.attrs.language || "plaintext");
  if (language === FRONT_MATTER_LANGUAGE) return <NoteProperties {...props} />;
  if (language === "mermaid") return <MermaidCodeBlock {...props} />;
  const copyLabel = t(copied === "ok" ? "editorToolbar.codeCopied" : copied === "error" ? "editorToolbar.codeCopyFailed" : "editorToolbar.copyCode");
  const collapseLabel = t(collapsed ? "notebookSite.expand" : "notebookSite.collapse");
  return <NodeViewWrapper className="edgeever-notebook-code not-prose my-5 overflow-hidden rounded-lg border">
    <div contentEditable={false} className="flex items-center justify-between gap-3 border-b bg-muted px-3 py-1.5 text-xs">
      <span aria-label={t("notebookSite.language")}>{language}</span>
      <div className="flex gap-2"><ButtonTooltip title={copyLabel}><Button variant="ghost" size="sm" onClick={() => { void copyTextToClipboard(props.node.textContent).then((ok) => setCopied(ok ? "ok" : "error")); }}>{copyLabel}</Button></ButtonTooltip><ButtonTooltip title={collapseLabel}><Button variant="ghost" size="sm" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapseLabel}</Button></ButtonTooltip></div>
    </div>
    <pre style={{ display: collapsed ? "none" : undefined }}><code><NodeViewContent /></code></pre>
  </NodeViewWrapper>;
};
