import Link from "@tiptap/extension-link";

/**
 * Keep text entered at the end of a link outside that link while preserving
 * TipTap's automatic URL detection and link-on-paste behavior.
 */
export const EdgeEverLink = Link.extend({
  inclusive: false,
});
