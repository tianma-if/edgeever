import { parse, postprocess, preprocess } from "micromark";
import { createDocument } from "@mixmark-io/domino";
import { convertImportHtml } from "./html";
import { splitMarkdownFrontMatter } from "../front-matter";

/** Normalize exported HTML media without touching Markdown code examples. */
export const normalizeExportMedia = (markdown: string) => {
  const body = splitMarkdownFrontMatter(markdown, { maxSourceLength: Infinity })?.body ?? markdown;
  const offset = markdown.length - body.length;
  const events = postprocess(parse().document().write(preprocess()(body, undefined, true)));
  const ranges = events.filter(([action, token]) => action === "enter" && (token.type === "htmlFlow" || token.type === "htmlText"))
    .map(([, token]) => [offset + token.start.offset!, offset + token.end.offset!] as const);
  for (const [start, end] of ranges.reverse()) {
    const html = markdown.slice(start, end);
    if (!/<(?:img|audio|video|source)\b/i.test(html)) continue;
    const document = createDocument(html);
    const root = document.body;
    for (const node of Array.from(root.querySelectorAll("script,style,iframe,object,embed"))) node.remove();
    for (const node of Array.from(root.querySelectorAll("img[src],audio[src],video[src],source[src]"))) {
      const href = node.getAttribute("src") ?? "";
      if (/^\s*(?:javascript|vbscript|data):/i.test(href)) { node.remove(); continue; }
      // Markdown destinations must encode spaces and parentheses; retain
      // existing percent escapes for the shared resolver to decode once.
      const target = href.replace(/[\s()]/g, char => encodeURIComponent(char).replace("(", "%28").replace(")", "%29"));
      if (node.nodeName === "IMG") node.setAttribute("src", target);
      else {
        const link = document.createElement("a");
        link.setAttribute("href", target);
        link.textContent = href.split("/").at(-1) || "Media";
        node.parentNode?.replaceChild(link, node);
      }
    }
    markdown = markdown.slice(0, start) + convertImportHtml(root.innerHTML) + (html.endsWith("\n") ? "\n\n" : "") + markdown.slice(end);
  }
  return markdown;
};
