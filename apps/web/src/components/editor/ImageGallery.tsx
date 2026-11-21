import { useCallback, useEffect, useState } from "react";
import { autoUpdate, useFloating } from "@floating-ui/react-dom";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  ImageGallery,
  IMAGE_GALLERY_LAYOUTS,
  IMAGE_GALLERY_FITS,
  resolveImageGalleryFit,
  resolveImageGalleryLayout,
  type ImageGalleryFit,
  type ImageGalleryLayout,
} from "@edgeever/shared";
import { cn } from "@/lib/utils";
import { imageGalleryToolbarPosition } from "./image-gallery-toolbar-position";

const ImageGalleryNodeView = ({ editor, node, selected, updateAttributes }: NodeViewProps) => {
  const { t } = useTranslation();
  const layout = resolveImageGalleryLayout(node.attrs.layout);
  const fit = resolveImageGalleryFit(node.attrs.fit);
  const isEditable = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => activeEditor.isEditable,
  });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [clicked, setClicked] = useState(false);
  const active = isEditable && (hovered || focused || clicked);
  const { refs, floatingStyles, placement, middlewareData, isPositioned } = useFloating<HTMLDivElement>({
    ...imageGalleryToolbarPosition,
    open: active,
    whileElementsMounted: active ? autoUpdate : undefined,
  });
  const visible = active && isPositioned && !middlewareData.hide?.referenceHidden;

  useEffect(() => {
    if (!isEditable) {
      setClicked(false);
      return;
    }
    const gallery = refs.reference.current;
    if (!clicked || !gallery) return;

    const dismissOnOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !gallery.contains(event.target)) setClicked(false);
    };
    const ownerDocument = gallery.ownerDocument;
    ownerDocument.addEventListener("pointerdown", dismissOnOutsidePointerDown, true);
    return () => ownerDocument.removeEventListener("pointerdown", dismissOnOutsidePointerDown, true);
  }, [clicked, isEditable, refs.reference]);

  const setGalleryAttributes = useCallback((attributes: { layout?: ImageGalleryLayout; fit?: ImageGalleryFit }) => {
    updateAttributes(attributes);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper
      ref={refs.setReference}
      className={cn("edgeever-image-gallery", selected && "is-selected")}
      data-edgeever-image-gallery="true"
      data-image-count={node.childCount}
      data-image-gallery-layout={layout}
      data-image-gallery-fit={fit}
      tabIndex={isEditable ? 0 : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        if (isEditable && event.target instanceof HTMLImageElement) setClicked(true);
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event: React.FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {isEditable ? (
        <div
          ref={refs.setFloating}
          className="edgeever-image-gallery__toolbar"
          data-placement={placement}
          data-visible={visible}
          style={floatingStyles}
          contentEditable={false}
          aria-label={t("editor.imageGallery.toolbar")}
          role="toolbar"
        >
          <div className="edgeever-image-gallery__group" role="group" aria-label={t("editor.imageGallery.toolbar")}>
            {IMAGE_GALLERY_LAYOUTS.map((item) => (
              <button
                key={item}
                type="button"
                className={cn(
                  "edgeever-image-gallery__button",
                  layout === item && "is-active",
                )}
                aria-pressed={layout === item}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setGalleryAttributes({ layout: item })}
              >
                {t(`editor.imageGallery.layouts.${item}`)}
              </button>
            ))}
          </div>
          <div className="edgeever-image-gallery__group" role="group" aria-label={t("editor.imageGallery.fitLabel")}>
            {IMAGE_GALLERY_FITS.map((item) => (
              <button
                key={item}
                type="button"
                className={cn("edgeever-image-gallery__button", fit === item && "is-active")}
                aria-pressed={fit === item}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setGalleryAttributes({ fit: item })}
              >
                {t(`editor.imageGallery.fits.${item}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <NodeViewContent className="edgeever-image-gallery__content" />
    </NodeViewWrapper>
  );
};

export const EditableImageGallery = ImageGallery.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageGalleryNodeView);
  },
});
