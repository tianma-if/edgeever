import { useCallback, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { getImageReferrerPolicy } from "@edgeever/shared";
import {
  DEFAULT_IMAGE_WIDTH_PERCENT,
  IMAGE_WIDTH_PRESETS,
  clampImageWidth,
  parseImageWidth,
} from "@edgeever/shared/image-display";
import { getAttachmentResourceId } from "@/lib/attachment-links";
import { cn } from "@/lib/utils";

export type ImageMenuRequestDetail = {
  element: HTMLElement;
  url: string;
  filename: string;
  resourceId: string | null;
  updateAttributes: (attributes: Record<string, unknown>) => void;
  deleteNode: () => void;
};

export const IMAGE_MENU_SHOW_EVENT = "edgeever:image-menu-show";
export const IMAGE_MENU_HIDE_EVENT = "edgeever:image-menu-hide";

const ResizableImageNodeView = ({
  editor,
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
  const editable = editor.isEditable;
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";

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

  const updateWidth = useCallback((nextWidth: number) => {
    updateAttributes({ width: clampImageWidth(nextWidth) });
  }, [updateAttributes]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editable) return;

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
  }, [editable, nodeWidth, updateWidth]);

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
      />
      {editable && selected && (
        <div className="edgeever-image-controls" contentEditable={false}>
          <div className="edgeever-image-presets" aria-label={t("editor.imageScale")}>
            {IMAGE_WIDTH_PRESETS.map((preset) => (
              <button
                key={preset.width}
                type="button"
                className={cn("edgeever-image-preset", width === preset.width && "is-active")}
                title={t(preset.labelKey)}
                aria-label={t(preset.labelKey)}
                onClick={() => updateWidth(preset.width)}
              >
                <span>{t(preset.labelKey)}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="edgeever-image-resize-handle"
            title={t("editor.resizeImage")}
            aria-label={t("editor.resizeImage")}
            onPointerDown={startResize}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const ResizableImage = Image.extend({
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
