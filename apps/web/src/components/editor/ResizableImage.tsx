import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from "@tiptap/react";
import { AlignLeft, AlignCenter, AlignRight, Maximize2, MoveHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getImageReferrerPolicy, IMAGE_GALLERY_NODE_TYPE, imageAlignmentMargins, parseImageAlignment, type ImageAlignment } from "@edgeever/shared";
import {
  IMAGE_WIDTH_PRESETS,
  NEW_IMAGE_WIDTH_PERCENT,
  clampImageWidth,
  parseImageWidth,
} from "@edgeever/shared/image-display";
import { getAttachmentResourceId } from "@/lib/attachment-links";
import { createMarkdownImagePasteRule } from "@/lib/markdown-image-paste";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isImageInGallery } from "./image-editing-context";
import { createImageSelectionPlugin, imageSelectionKey } from "./image-selection";
import { createImageDragPlugin } from "./image-drag";
import { getImageUploadPreview, releaseImageUploadPreview } from "./image-upload-preview";

export type ImageMenuRequestDetail = {
  element: HTMLElement;
  actionsElement: HTMLElement | null;
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
  const imageRef = useRef<HTMLImageElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const nodeWidth = parseImageWidth(node.attrs.width) ?? NEW_IMAGE_WIDTH_PERCENT;
  const width = previewWidth ?? nodeWidth;
  const explicitAlignment = parseImageAlignment(node.attrs.alignment);
  const alignment = explicitAlignment ?? "left";
  const { editable, inGallery, explicitlySelected } = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => ({
      editable: activeEditor.isEditable,
      inGallery: isImageInGallery(activeEditor.state.doc, getPos()),
      explicitlySelected: imageSelectionKey.getState(activeEditor.state) === getPos(),
    }),
  });
  const showImageControls = selected && explicitlySelected && !inGallery;
  const showSizeControls = editable && showImageControls;
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const uploadPreview = loadedSource === src ? undefined : getImageUploadPreview(editor, src);

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

  useEffect(() => () => {
    const image = imageRef.current;
    if (!image) return;
    const src = image.getAttribute("src") || image.src;
    image.removeAttribute("src");
    image.src = "";
    if (src.startsWith("blob:")) {
      URL.revokeObjectURL(src);
    }
  }, []);

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
        actionsElement: actionsRef.current,
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

  useEffect(() => {
    if (!showImageControls) return;
    requestImageMenu();
    return hideImageMenu;
  }, [hideImageMenu, requestImageMenu, showImageControls]);

  useEffect(() => {
    if (!showImageControls) return;
    const dismiss = () => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(imageSelectionKey, null));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        editor.view.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [editor, showImageControls]);

  const selectImage = () => {
    if (inGallery) return;
    const position = getPos();
    if (typeof position !== "number") return;
    editor.chain().focus().setNodeSelection(position).command(({ tr }) => {
      tr.setMeta(imageSelectionKey, position);
      return true;
    }).run();
  };

  const requestImagePreview = useCallback(() => {
    if (!src) return;
    hideImageMenu();
    editor.view.dispatch(editor.state.tr.setMeta(imageSelectionKey, null));
    window.dispatchEvent(new CustomEvent<ImagePreviewRequestDetail>(IMAGE_PREVIEW_SHOW_EVENT, {
      detail: {
        url: src,
        alt: title || alt,
      },
    }));
  }, [alt, editor, hideImageMenu, src, title]);

  const updateWidth = useCallback((nextWidth: number) => {
    if (!editor.isEditable || isImageInGallery(editor.state.doc, getPos())) return;
    updateAttributes({ width: clampImageWidth(nextWidth) });
  }, [editor, getPos, updateAttributes]);

  const updateAlignment = (next: ImageAlignment) => {
    if (!editor.isEditable || isImageInGallery(editor.state.doc, getPos())) return;
    updateAttributes({ alignment: next });
  };

  const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editable || isImageInGallery(editor.state.doc, getPos())) return;

    const wrapper = wrapperRef.current;
    const parent = wrapper?.parentElement;
    if (!wrapper || !parent) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const parentBounds = parent.getBoundingClientRect();
    const parentWidth = parentBounds.width;
    if (parentWidth <= 0) return;

    let pendingWidth = nodeWidth;
    const startX = event.clientX;
    const previewFromPointer = (clientX: number) => {
      // Resizing is relative to the initial width: centered/right-aligned boxes
      // move their left edge as they resize, so measuring that edge causes jumps.
      pendingWidth = clampImageWidth(nodeWidth + ((clientX - startX) / parentWidth) * 100);
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
      className={cn("edgeever-image-node", showImageControls && "is-selected")}
      style={{ width: `${width}%`, ...(explicitAlignment ? imageAlignmentMargins(explicitAlignment) : {}) }}
      data-width={width}
      data-image-align={alignment}
      onMouseLeave={inGallery ? hideImageMenu : undefined}
      onContextMenu={(event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        if (inGallery || showImageControls) requestImageMenu();
        else selectImage();
      }}
    >
      {uploadPreview && (
        <img
          src={uploadPreview}
          alt=""
          aria-hidden="true"
          data-upload-preview="true"
          draggable={false}
          onClick={(event) => { event.preventDefault(); selectImage(); }}
          onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); requestImagePreview(); }}
        />
      )}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={editable}
        data-drag-handle={editable ? "" : undefined}
        referrerPolicy={getImageReferrerPolicy(src)}
        data-upload-loading={uploadPreview ? "true" : undefined}
        style={uploadPreview ? { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0 } : undefined}
        onLoad={() => {
          setLoadedSource(src);
          releaseImageUploadPreview(editor, src);
        }}
        onClick={(event) => {
          // A positioned figure does not occupy the full block wrapper. Select
          // its node explicitly instead of relying on coordinate hit testing.
          event.preventDefault();
          selectImage();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          requestImagePreview();
        }}
      />
      {showImageControls && (
        <div className="edgeever-image-panel" contentEditable={false} onMouseDown={(event) => event.preventDefault()}>
          <div className="edgeever-image-controls">
            {previewButton}
            {showSizeControls && (<>
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
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                <div className="edgeever-image-alignments" role="group" aria-label={t("editor.imageAlignment")}>
                  {([
                    { value: "left", Icon: AlignLeft },
                    { value: "center", Icon: AlignCenter },
                    { value: "right", Icon: AlignRight },
                  ] as const).map(({ value, Icon }) => (
                    <Tooltip key={value}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn("edgeever-image-alignment", alignment === value && "is-active")}
                          aria-label={t(`editor.imageAlignments.${value}`)}
                          aria-pressed={alignment === value}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => updateAlignment(value)}
                        >
                          <Icon aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t(`editor.imageAlignments.${value}`)}</TooltipContent>
                    </Tooltip>
                  ))}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="edgeever-image-resize-handle"
                        aria-label={t("editor.resizeImage")}
                        onPointerDown={startResize}
                      >
                        <MoveHorizontal aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t("editor.resizeImage")}</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
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
            </>)}
          </div>
          <div ref={actionsRef} className="edgeever-image-resource-actions" />
        </div>
      )}
      {!showImageControls && (
        <div className="edgeever-image-preview-control" contentEditable={false}>
          {previewButton}
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const ResizableImage = Image.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createImageSelectionPlugin(), createImageDragPlugin()];
  },
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
