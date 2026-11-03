import {
  FileAttachment as BaseFileAttachment,
  formatAttachmentMetadata,
  getAttachmentFilenameFromLabel,
  resolveAttachmentKind,
  resolveFileDisplayMode,
} from "@edgeever/shared";
import { useContext, useState } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChevronDown, ChevronUp, Download, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AttachmentExternalLink } from "@/components/attachments/AttachmentExternalLink";
import { AttachmentFileIcon } from "@/components/attachments/AttachmentFileIcon";
import { AudioAttachmentPlayer } from "@/components/attachments/AudioAttachmentPlayer";
import { DocxAttachmentPreview } from "@/components/attachments/DocxAttachmentPreview";
import { COMPACT_ATTACHMENT_WIDTH_CLASS } from "@/components/attachments/attachment-layout";
import { isPreviewableDocx, MAX_INLINE_DOCX_BYTES } from "@/components/attachments/docx-preview-source";
import { VideoAttachmentPlayer } from "@/components/attachments/VideoAttachmentPlayer";
import { ButtonTooltip } from "@/components/ui/button-tooltip";
import { useAttachmentByteSize } from "@/hooks/useAttachmentByteSize";
import { isDesktopResourceRuntime, toApiResourceUrl, toDesktopResourceDownloadUrl } from "@/lib/desktop-resources";
import { cn } from "@/lib/utils";
import { AttachmentTranscriptContext } from "./AttachmentTranscriptContext";
import { AttachmentTranscriptInline } from "./AttachmentTranscriptInline";

const FileAttachmentNodeView = ({ node, updateAttributes }: NodeViewProps) => {
  const { t } = useTranslation();
  const [viewerElement, setViewerElement] = useState<HTMLSpanElement | null>(null);
  const [docxExpanded, setDocxExpanded] = useState(false);
  const transcriptContext = useContext(AttachmentTranscriptContext);
  const activeTranscript = transcriptContext?.transcript?.target.element
    && viewerElement?.contains(transcriptContext.transcript.target.element)
    ? transcriptContext.transcript : null;
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "Attachment";
  const filename = typeof node.attrs.filename === "string" && node.attrs.filename
    ? node.attrs.filename
    : getAttachmentFilenameFromLabel(label);
  const mimeType = typeof node.attrs.mimeType === "string" ? node.attrs.mimeType : "";
  const resolvedUrl = isDesktopResourceRuntime() ? url : toApiResourceUrl(url);
  const downloadUrl = toDesktopResourceDownloadUrl(resolvedUrl, filename || label);
  const byteSize = useAttachmentByteSize(resolvedUrl, node.attrs.byteSize);
  const metadata = formatAttachmentMetadata(mimeType, filename || label, byteSize);
  const attachmentKind = resolveAttachmentKind(mimeType, filename || label);
  const isAudio = attachmentKind === "audio";
  const isVideo = attachmentKind === "video";
  const isDocx = isPreviewableDocx(filename || label, resolvedUrl);
  const docxPreviewAllowed = isDocx && (byteSize === null || byteSize <= MAX_INLINE_DOCX_BYTES);
  const videoExpanded = isVideo && resolveFileDisplayMode(node.attrs.displayMode) === "inline";
  const expandable = isVideo || docxPreviewAllowed;
  const expanded = isVideo ? videoExpanded : docxExpanded;
  const setVideoExpanded = (expanded: boolean) => {
    updateAttributes({ displayMode: expanded ? "inline" : "compact" });
  };
  const toggleExpanded = () => isVideo ? setVideoExpanded(!videoExpanded) : setDocxExpanded(!docxExpanded);

  const identity = (
    <>
      <AttachmentFileIcon mimeType={mimeType} filename={filename || label} className="h-5 w-5 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-slate-800">{label}</span>
        <span className="truncate text-xs font-medium text-slate-500">
          {isDocx && !docxPreviewAllowed ? `${metadata} · ${t("wordViewer.previewTooLarge")}` : metadata}
        </span>
      </span>
    </>
  );

  return (
    <NodeViewWrapper
      as="span"
      className="edgeever-file-attachment-node"
      data-file-name={filename || label}
      data-file-url={url}
      contentEditable={false}
    >
      <span ref={setViewerElement} className={cn("edgeever-file-viewer flex min-h-12 flex-col overflow-hidden rounded-xl border border-slate-200 bg-card shadow-sm", COMPACT_ATTACHMENT_WIDTH_CLASS)}>
        <span data-edgeever-resource-toolbar className="flex min-h-12 items-center gap-2 px-3">
          {expandable ? (
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              aria-expanded={expanded}
              onClick={toggleExpanded}
            >
              {identity}
            </button>
          ) : (
            <AttachmentExternalLink
              href={resolvedUrl}
              filename={filename || label}
              className="flex min-w-0 flex-1 items-center gap-2 text-left no-underline"
            >
              {identity}
            </AttachmentExternalLink>
          )}
          <ButtonTooltip title={t("editor.resourceActions.download")}>
            <a className="pdf-viewer-action" href={downloadUrl} download={filename || label} aria-label={t("editor.resourceActions.download")}>
              <Download aria-hidden="true" />
            </a>
          </ButtonTooltip>
          <ButtonTooltip title={t(isDesktopResourceRuntime() ? "attachmentOpen.copyHint" : "pdfViewer.openExternal")}>
            <AttachmentExternalLink className="pdf-viewer-action" href={resolvedUrl} filename={filename || label} iconOnly aria-label={t("pdfViewer.openExternal")}>
              <ExternalLink aria-hidden="true" />
            </AttachmentExternalLink>
          </ButtonTooltip>
          {expandable ? (
            <ButtonTooltip title={expanded ? t("pdfViewer.collapse") : t("pdfViewer.expand")}>
              <button
                type="button"
                className="pdf-viewer-action"
                aria-label={expanded ? t("pdfViewer.collapse") : t("pdfViewer.expand")}
                aria-expanded={expanded}
                onClick={toggleExpanded}
              >
                {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
            </ButtonTooltip>
          ) : null}
        </span>
        {isAudio && resolvedUrl ? (
          <span className="border-t border-slate-200 px-3 py-2">
            <AudioAttachmentPlayer
              key={resolvedUrl}
              src={resolvedUrl}
              label={t("audioPlayer.label", { filename: filename || label })}
              unavailableMessage={t("audioPlayer.unavailable")}
            />
          </span>
        ) : null}
        {isVideo && videoExpanded && resolvedUrl ? (
          <span className="border-t border-slate-200">
            <VideoAttachmentPlayer
              key={resolvedUrl}
              src={resolvedUrl}
              label={t("videoPlayer.label", { filename: filename || label })}
              unavailableMessage={t("videoPlayer.unavailable")}
            />
          </span>
        ) : null}
        {docxPreviewAllowed && docxExpanded && resolvedUrl ? (
          <span className="border-t border-slate-200">
            <DocxAttachmentPreview url={resolvedUrl} filename={filename || label} />
          </span>
        ) : null}
      </span>
      {activeTranscript && transcriptContext ? (
        <span className={cn("block", COMPACT_ATTACHMENT_WIDTH_CLASS)}>
          <AttachmentTranscriptInline {...transcriptContext} transcript={activeTranscript} />
        </span>
      ) : null}
    </NodeViewWrapper>
  );
};

export const FileAttachment = BaseFileAttachment.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentNodeView);
  },
});
