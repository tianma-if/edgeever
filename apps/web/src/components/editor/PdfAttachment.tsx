import { PdfAttachment as BasePdfAttachment, resolvePdfDisplayMode } from "@edgeever/shared";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { PdfViewer } from "@/components/pdf/PdfViewer";

const PdfAttachmentNodeView = ({ node, updateAttributes }: NodeViewProps) => {
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "PDF";
  const displayMode = resolvePdfDisplayMode(node.attrs.displayMode);

  return (
    <NodeViewWrapper as="span" className="edgeever-pdf-attachment-node" contentEditable={false}>
      <PdfViewer
        url={url}
        label={label}
        expanded={displayMode === "inline"}
        onExpandedChange={(expanded) => updateAttributes({ displayMode: expanded ? "inline" : "compact" })}
      />
    </NodeViewWrapper>
  );
};

export const PdfAttachment = BasePdfAttachment.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PdfAttachmentNodeView);
  },
});
