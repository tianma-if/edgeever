import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MERGE_DIVIDER_NODE_TYPE } from "./merge-divider";

const timestampPattern = /^摘录于 \d{4}-\d{2}-\d{2}$/;
const key = new PluginKey<DecorationSet>("leeefExcerptTimestamps");

// Leeef Reader stores the footer as text so older editors can still display it.
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
    section.push(Decoration.node(end - footer.nodeSize, end, {
      "data-leeef-excerpt-timestamp": "",
      style: "font-size: 0.8em; opacity: 0.75; margin-bottom: 0",
    }));
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
