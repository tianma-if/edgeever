import Link from "@tiptap/extension-link";
import { EMPTY_EXTERNAL_LINK_NODE_TYPE } from "./empty-external-link";

// Linkify accepts Unicode hostnames, so adjacent prose can become part of a
// bare ASCII domain. Keep internationalized URLs available via explicit schemes
// and leave fully non-ASCII domain labels and email addresses alone.
function bareDomainProseLength(text: string): number {
  if (/^[a-z][a-z\d+.-]*:/i.test(text) || text.includes("@")) return 0;
  const label = text.split(".", 1)[0];
  const prefix = label.match(/^.*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}](?=[a-z\d-]+$)/u);
  return prefix?.[0].length ?? 0;
}

/**
 * Keep text entered at the end of a link outside that link while preserving
 * TipTap's automatic URL detection and link-on-paste behavior.
 */
export const EdgeEverLink = Link.extend({
  inclusive: false,
  addPasteRules() {
    const rules = this.parent?.() ?? [];
    for (const rule of rules) {
      const find = rule.find;
      if (typeof find !== "function") continue;
      rule.find = (text, event) => (find(text, event) ?? []).flatMap(match => {
        // Explicit Markdown links must retain their authored label and URL.
        if (match.replaceWith !== undefined) return [match];
        const offset = bareDomainProseLength(match.text);
        if (!offset) return [match];
        return (find(match.text.slice(offset), event) ?? []).map(link => ({
          ...link,
          index: match.index + offset + link.index,
        }));
      });
    }
    return rules;
  },
  parseMarkdown(token, helpers) {
    if (!token.tokens?.length && token.text === "" && typeof token.href === "string" && token.href) {
      return {
        type: EMPTY_EXTERNAL_LINK_NODE_TYPE,
        attrs: { href: token.href, title: token.title || null },
      };
    }
    const link = {
      href: token.href,
      title: token.title || null,
    };
    const content = helpers.parseInline(token.tokens || []).map(node =>
      node.type === "image" ? { ...node, attrs: { ...node.attrs, link } } : node,
    );
    return helpers.applyMark("link", content, link);
  },
});
