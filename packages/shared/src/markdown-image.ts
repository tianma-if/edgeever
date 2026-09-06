import { markdownToDoc } from "./content";

export type MarkdownImageAttributes = {
  src: string;
  alt: string | null;
  title: string | null;
};

export type MarkdownImagePasteItem = {
  markdown: string;
  attributes: MarkdownImageAttributes;
};

const INTERNAL_IMAGE_SOURCE_PREFIXES = [
  "/api/v1/resources/",
  "edgeever-resource://",
  "edgeever-staged://",
];

export const isSupportedMarkdownImageSource = (source: string): boolean => {
  const trimmed = source.trim();
  if (!trimmed) {
    return false;
  }

  if (INTERNAL_IMAGE_SOURCE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const stringAttribute = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * Parses clipboard text only when every non-empty line is a standalone
 * Markdown image. This strict boundary prevents ordinary prose containing an
 * image-like fragment from being rewritten by a rich-text paste rule.
 */
export const parseMarkdownImagePaste = (clipboardText: string): MarkdownImagePasteItem[] | null => {
  const lines = clipboardText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const items: MarkdownImagePasteItem[] = [];
  for (const markdown of lines) {
    const doc = markdownToDoc(markdown);
    if (doc.content.length !== 1 || doc.content[0]?.type !== "image") {
      return null;
    }

    const attributes = doc.content[0].attrs;
    const src = stringAttribute(attributes?.src);
    if (!src || !isSupportedMarkdownImageSource(src)) {
      return null;
    }

    items.push({
      markdown,
      attributes: {
        src,
        alt: stringAttribute(attributes?.alt),
        title: stringAttribute(attributes?.title),
      },
    });
  }

  return items;
};
