import { useCallback, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from "@tiptap/react";
import { Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getImageReferrerPolicy, IMAGE_GALLERY_NODE_TYPE } from "@edgeever/shared";
import {
  DEFAULT_IMAGE_WIDTH_PERCENT,
  IMAGE_WIDTH_PRESETS,
  clampImageWidth,
  parseImageWidth,
} from "@edgeever/shared/image-display";
import { getAttachmentResourceId } from "@/lib/attachment-links";
import { createMarkdownImagePasteRule } from "@/lib/markdown-image-paste";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isImageInGallery } from "./image-editing-context";

export type ImageMenuRequestDetail = {
  element: HTMLElement;
  url: string;
  filename: string;
  resourceId: string | null;
  updateAttributes: (attributes: Record<string, unknown>) => void;
  deleteNode: () => void;
};

export type ImagePreviewRequestDetail = {
  url: string;
  alt: string;
};

export const IMAGE_MENU_SHOW_EVENT = "edgeever:image-menu-show";
export const IMAGE_MENU_HIDE_EVENT = "edgeever:image-menu-hide";
export const IMAGE_PREVIEW_SHOW_EVENT = "edgeever:image-preview-show";

const ResizableImageNodeView = ({
  editor,
  getPos,
  node,
  selected,
  updateAttributes,
  deleteNode,
}: NodeViewProps) => {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const nodeWidth = parseImageWidth(node.attrs.width) ?? DEFAULT_IMAGE_WIDTH_PERCENT;
  const width = previewWidth ?? nodeWidth;
  const { editable, inGallery } = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => ({
      editable: activeEditor.isEditable,
      inGallery: isImageInGallery(activeEditor.state.doc, getPos()),
    }),
  });
  const showSizeControls = editable && selected && !inGallery;
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";

  const getAdjacentImageGroup = useCallback(() => {
    const position = getPos();
    if (typeof position !== "number") return null;

    const resolved = editor.state.doc.resolve(position);
    const parent = resolved.parent;
    const index = resolved.index();
    // Only standalone top-level images can be grouped. Offering this action to
    // images already inside a gallery can empty the parent gallery, which the
    // schema then fills with a default image whose src is null.
    if (parent.type.name !== "doc" || parent.child(index)?.type.name !== "image") return null;

    let startIndex = index;
    let endIndex = index;
    while (startIndex > 0 && parent.child(startIndex - 1).type.name === "image") {
      startIndex -= 1;
    }
    while (endIndex + 1 < parent.childCount && parent.child(endIndex + 1).type.name === "image") {
      endIndex += 1;
    }
    if (startIndex === endIndex) return null;

    let from = resolved.start();
    for (let childIndex = 0; childIndex < startIndex; childIndex += 1) {
      from += parent.child(childIndex).nodeSize;
    }
    let to = from;
    const images = [];
    for (let childIndex = startIndex; childIndex <= endIndex; childIndex += 1) {
      const image = parent.child(childIndex);
      images.push(image);
      to += image.nodeSize;
    }
    return { from, to, images };
  }, [editor, getPos]);

  const canGroupAdjacentImages = selected && Boolean(getAdjacentImageGroup());

  const groupAdjacentImages = useCallback(() => {
    const group = getAdjacentImageGroup();
    const galleryType = editor.state.schema.nodes[IMAGE_GALLERY_NODE_TYPE];
    if (!group || !galleryType) return;

    editor.view.dispatch(
      editor.state.tr.replaceWith(
        group.from,
        group.to,
        galleryType.create({ layout: "auto" }, group.images),
      ),
    );
    editor.commands.focus(group.from + 1);
  }, [editor, getAdjacentImageGroup]);

  const requestImageMenu = useCallback(() => {
    const element = wrapperRef.current;
    if (!element || !src) return;
    window.dispatchEvent(new CustomEvent<ImageMenuRequestDetail>(IMAGE_MENU_SHOW_EVENT, {
      detail: {
        element,
        url: src,
        filename: title || alt || getAttachmentResourceId(src) || "image",
        resourceId: getAttachmentResourceId(src),
        updateAttributes,
        deleteNode,
      },
    }));
  }, [alt, deleteNode, src, title, updateAttributes]);

  const hideImageMenu = useCallback(() => {
    window.dispatchEvent(new CustomEvent(IMAGE_MENU_HIDE_EVENT));
  }, []);

  const requestImagePreview = useCallback(() => {
    if (!src) return;
    hideImageMenu();
    window.dispatchEvent(new CustomEvent<ImagePreviewRequestDetail>(IMAGE_PREVIEW_SHOW_EVENT, {
      detail: {
        url: src,
        alt: title || alt,
      },
    }));
  }, [alt, hideImageMenu, src, title]);

  const updateWidth = useCallback((nextWidth: number) => {
    if (!editor.isEditable || isImageInGallery(editor.state.doc, getPos())) return;
    updateAttributes({ width: clampImageWidth(nextWidth) });
  }, [editor, getPos, updateAttributes]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editable || isImageInGallery(editor.state.doc, getPos())) return;

    const wrapper = wrapperRef.current;
    const parent = wrapper?.parentElement;
    if (!wrapper || !parent) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const parentWidth = parent.getBoundingClientRect().width;
    if (parentWidth <= 0) return;

    let pendingWidth = nodeWidth;
    const previewFromPointer = (clientX: number) => {
      const wrapperLeft = wrapper.getBoundingClientRect().left;
      pendingWidth = clampImageWidth(((clientX - wrapperLeft) / parentWidth) * 100);
      setPreviewWidth(pendingWidth);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => previewFromPointer(moveEvent.clientX);
    const stopResize = (commit: boolean) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      setPreviewWidth(null);
      if (commit && pendingWidth !== nodeWidth) updateWidth(pendingWidth);
    };
    const handlePointerUp = () => stopResize(true);
    const handlePointerCancel = () => stopResize(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    previewFromPointer(event.clientX);
  }, [editable, editor, getPos, nodeWidth, updateWidth]);

  const previewButton = (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="edgeever-image-preview-button"
            aria-label={t("editor.previewImage")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              requestImagePreview();
            }}
          >
            <Maximize2 aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{t("editor.previewImage")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      as="figure"
      className={cn("edgeever-image-node", selected && "is-selected")}
      style={{ width: `${width}%` }}
      data-width={width}
      onMouseEnter={requestImageMenu}
      onMouseLeave={hideImageMenu}
      onContextMenu={(event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        requestImageMenu();
      }}
    >
      <img
        src={src}
        alt={alt}
        title={title || undefined}
        draggable={false}
        referrerPolicy={getImageReferrerPolicy(src)}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          requestImagePreview();
        }}
      />
      {showSizeControls && (
        <div className="edgeever-image-controls" contentEditable={false}>
          {previewButton}
          <div className="edgeever-image-presets" aria-label={t("editor.imageScale")}>
            {IMAGE_WIDTH_PRESETS.map((preset) => (
              <button
                key={preset.width}
                type="button"
                className={cn("edgeever-image-preset", width === preset.width && "is-active")}
                aria-label={t(preset.labelKey)}
                aria-pressed={width === preset.width}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => updateWidth(preset.width)}
              >
                <span>{t(preset.labelKey)}</span>
              </button>
            ))}
          </div>
          {canGroupAdjacentImages ? (
            <button
              type="button"
              className="edgeever-image-preset"
              aria-label={t("editor.imageGallery.group")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={groupAdjacentImages}
            >
              <span>{t("editor.imageGallery.group")}</span>
            </button>
          ) : null}
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="edgeever-image-resize-handle"
                  aria-label={t("editor.resizeImage")}
                  onPointerDown={startResize}
                />
              </TooltipTrigger>
              <TooltipContent side="top">{t("editor.resizeImage")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
      {!showSizeControls && (
        <div className="edgeever-image-preview-control" contentEditable={false}>
          {previewButton}
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const ResizableImage = Image.extend({
  addPasteRules() {
    return [createMarkdownImagePasteRule(this.type)];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => parseImageWidth(
          element.getAttribute("data-width") ?? element.getAttribute("width") ?? element.style.width,
        ),
        renderHTML: (attributes) => {
          const width = parseImageWidth(attributes.width);
          return width ? { "data-width": String(width), style: `width: ${width}%` } : {};
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageNodeView);
  },
  renderHTML({ HTMLAttributes }) {
    const referrerPolicy = getImageReferrerPolicy(HTMLAttributes.src);
    return [
      "img",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        referrerPolicy ? { referrerpolicy: referrerPolicy } : {},
      ),
    ];
  },
});
