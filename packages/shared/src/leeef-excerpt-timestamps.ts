import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MERGE_DIVIDER_NODE_TYPE } from "./merge-divider";

const timestampPattern = /^(?:摘录于 )?(\d{4}-\d{2}-\d{2})$/;
const legacyPrefix = "摘录于 ";
const key = new PluginKey<DecorationSet>("leeefExcerptTimestamps");

export const isLeeefExcerptTimestamp = (text: string) => timestampPattern.test(text);

// Leeef Reader stores the date as plain text so older editors can still display it.
// The footer is one prose size smaller than the quote. Notes synced before the
// prefix was removed still start with "摘录于 "; that prefix stays in the document
// until the next sync and is hidden here.
const excerptTimestamps = (doc: ProseMirrorNode) => {
  const decorations: Decoration[] = [];
  let section: Decoration[] | undefined;
  doc.forEach((node, offset, index) => {
    if (node.type.name === MERGE_DIVIDER_NODE_TYPE) {
      const previous = doc.maybeChild(index - 1);
      if (section && previous?.type.name === "paragraph" && previous.textContent === "来自 Leeef Reader") {
        for (const decoration of section) decorations.push(decoration);
      }
      const next = doc.maybeChild(index + 1);
      section = next?.type.name === "heading" && next.attrs.level === 2 && next.textContent === "书摘"
        ? []
        : undefined;
      return;
    }
    if (!section || node.type.name !== "blockquote" || node.childCount < 2) return;
    const footer = node.lastChild;
    if (footer?.type.name !== "paragraph" || !timestampPattern.test(footer.textContent)) return;
    const end = offset + node.nodeSize - 1;
    const footerStart = end - footer.nodeSize;
    section.push(Decoration.node(footerStart, end, {
      "data-leeef-excerpt-timestamp": "",
      style: "font-size: 0.875em; opacity: 0.75; margin-bottom: 0",
    }));
    if (footer.textContent.startsWith(legacyPrefix)) {
      const textStart = footerStart + 1;
      section.push(Decoration.inline(textStart, textStart + legacyPrefix.length, {
        style: "display: none",
      }));
    }
  });
  return DecorationSet.create(doc, decorations);
};

export const LeeefExcerptTimestamps = Extension.create({
  name: "leeefExcerptTimestamps",
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: (_, state) => excerptTimestamps(state.doc),
        apply: (transaction, previous) => transaction.docChanged ? excerptTimestamps(transaction.doc) : previous,
      },
      props: { decorations: (state) => key.getState(state) },
    })];
  },
});
