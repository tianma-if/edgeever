import {
  FileAttachment as BaseFileAttachment,
  getAttachmentFilenameFromLabel,
} from "@edgeever/shared";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Download, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AttachmentFileIcon } from "@/components/attachments/AttachmentFileIcon";
import { ButtonTooltip } from "@/components/ui/button-tooltip";
import { isDesktopResourceRuntime, toApiResourceUrl } from "@/lib/desktop-resources";

const FileAttachmentNodeView = ({ node }: NodeViewProps) => {
  const { t } = useTranslation();
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "Attachment";
  const filename = typeof node.attrs.filename === "string" && node.attrs.filename
    ? node.attrs.filename
    : getAttachmentFilenameFromLabel(label);
  const mimeType = typeof node.attrs.mimeType === "string" ? node.attrs.mimeType : "";
  const resolvedUrl = isDesktopResourceRuntime() ? url : toApiResourceUrl(url);

  return (
    <NodeViewWrapper as="span" className="edgeever-file-attachment-node" contentEditable={false}>
      <span className="edgeever-file-viewer flex min-h-12 w-full items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 shadow-sm">
        <a
          href={resolvedUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-slate-800 no-underline"
        >
          <AttachmentFileIcon mimeType={mimeType} filename={filename || label} className="h-4 w-4" />
          <span className="min-w-0 truncate">{label}</span>
        </a>
        <ButtonTooltip title={t("pdfViewer.download")}>
          <a className="pdf-viewer-action" href={resolvedUrl} download={filename || label} aria-label={t("pdfViewer.download")}>
            <Download aria-hidden="true" />
          </a>
        </ButtonTooltip>
        <ButtonTooltip title={t("pdfViewer.openExternal")}>
          <a className="pdf-viewer-action" href={resolvedUrl} target="_blank" rel="noreferrer" aria-label={t("pdfViewer.openExternal")}>
            <ExternalLink aria-hidden="true" />
          </a>
        </ButtonTooltip>
      </span>
    </NodeViewWrapper>
  );
};

export const FileAttachment = BaseFileAttachment.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentNodeView);
  },
});
