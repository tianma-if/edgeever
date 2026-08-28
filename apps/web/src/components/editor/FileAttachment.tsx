import {
  FileAttachment as BaseFileAttachment,
  formatAttachmentMetadata,
  getAttachmentFilenameFromLabel,
} from "@edgeever/shared";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Download, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AttachmentFileIcon } from "@/components/attachments/AttachmentFileIcon";
import { COMPACT_ATTACHMENT_WIDTH_CLASS } from "@/components/attachments/attachment-layout";
import { ButtonTooltip } from "@/components/ui/button-tooltip";
import { isDesktopResourceRuntime, toApiResourceUrl } from "@/lib/desktop-resources";
import { cn } from "@/lib/utils";

const FileAttachmentNodeView = ({ node }: NodeViewProps) => {
  const { t } = useTranslation();
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "Attachment";
  const filename = typeof node.attrs.filename === "string" && node.attrs.filename
    ? node.attrs.filename
    : getAttachmentFilenameFromLabel(label);
  const mimeType = typeof node.attrs.mimeType === "string" ? node.attrs.mimeType : "";
  const metadata = formatAttachmentMetadata(mimeType, filename || label, node.attrs.byteSize);
  const resolvedUrl = isDesktopResourceRuntime() ? url : toApiResourceUrl(url);

  return (
    <NodeViewWrapper as="span" className="edgeever-file-attachment-node" contentEditable={false}>
      <span className={cn("edgeever-file-viewer flex min-h-12 items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 shadow-sm", COMPACT_ATTACHMENT_WIDTH_CLASS)}>
        <a
          href={resolvedUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2 text-left no-underline"
        >
          <AttachmentFileIcon mimeType={mimeType} filename={filename || label} className="h-5 w-5 shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-slate-800">{label}</span>
            <span className="truncate text-xs font-medium text-slate-500">{metadata}</span>
          </span>
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
