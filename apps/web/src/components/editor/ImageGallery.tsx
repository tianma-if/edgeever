import { useCallback } from "react";
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

const ImageGalleryNodeView = ({ editor, node, selected, updateAttributes }: NodeViewProps) => {
  const { t } = useTranslation();
  const layout = resolveImageGalleryLayout(node.attrs.layout);
  const fit = resolveImageGalleryFit(node.attrs.fit);
  const isEditable = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => activeEditor.isEditable,
  });

  const setGalleryAttributes = useCallback((attributes: { layout?: ImageGalleryLayout; fit?: ImageGalleryFit }) => {
    updateAttributes(attributes);
    editor.commands.focus(undefined, { scrollIntoView: false });
  }, [editor, updateAttributes]);

  return (
    <NodeViewWrapper
      className={cn("edgeever-image-gallery", selected && "is-selected")}
      data-edgeever-image-gallery="true"
      data-image-count={node.childCount}
      data-image-gallery-layout={layout}
      data-image-gallery-fit={fit}
    >
      {isEditable ? (
        <div
          className="edgeever-image-gallery__toolbar"
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
