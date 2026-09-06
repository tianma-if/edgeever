import {
  nodePasteRule,
  type PasteRuleMatch,
} from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import {
  parseMarkdownImagePaste,
  type MarkdownImageAttributes,
} from "@edgeever/shared";

export const findMarkdownImagePasteMatches = (
  textToMatch: string,
  clipboardText: string,
): PasteRuleMatch[] => {
  const images = parseMarkdownImagePaste(clipboardText);
  if (!images) {
    return [];
  }

  const matches: PasteRuleMatch[] = [];
  let searchFrom = 0;
  for (const image of images) {
    const index = textToMatch.indexOf(image.markdown, searchFrom);
    if (index === -1) {
      continue;
    }

    matches.push({
      index,
      text: image.markdown,
      data: image.attributes,
    });
    searchFrom = index + image.markdown.length;
  }

  return matches;
};

export const createMarkdownImagePasteRule = (type: NodeType) => nodePasteRule({
  type,
  find: (text, event) => {
    if (!event?.clipboardData) {
      return [];
    }

    return findMarkdownImagePasteMatches(
      text,
      event.clipboardData.getData("text/plain"),
    );
  },
  getAttributes: (match) => match.data as MarkdownImageAttributes,
});
