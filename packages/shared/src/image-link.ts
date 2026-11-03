import { Extension } from "@tiptap/core";

type ImageLink = { href: string; title: string | null };

export const getImageLink = (value: unknown): ImageLink | null => {
  if (!value || typeof value !== "object" || !("href" in value) || typeof value.href !== "string" || !value.href) return null;
  return { href: value.href, title: "title" in value && typeof value.title === "string" ? value.title : null };
};

// Block images cannot carry link marks in the document schema. Register the
// same optional metadata on custom Web/native image implementations as well.
export const ImageLinkAttributes = Extension.create({
  name: "imageLink",
  addGlobalAttributes() {
    return [{ types: ["image"], attributes: {
      link: {
        default: null,
        parseHTML: (element) => {
          const anchor = element.closest("a[href]");
          return getImageLink({
            href: element.getAttribute("data-image-link-href") ?? anchor?.getAttribute("href"),
            title: element.getAttribute("data-image-link-title") ?? anchor?.getAttribute("title"),
          });
        },
        renderHTML: (attributes) => {
          const link = getImageLink(attributes.link);
          return link ? {
            "data-image-link-href": link.href,
            ...(link.title ? { "data-image-link-title": link.title } : {}),
          } : {};
        },
      },
    } }];
  },
});
