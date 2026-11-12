import { parse, postprocess, preprocess } from "micromark";
import { createDocument } from "@mixmark-io/domino";
import { convertImportHtml } from "./html";
import { splitMarkdownFrontMatter } from "../front-matter";

const mediaTag = /<(?:img|audio|video|source)(?=[\s/>])/i;
const openingMediaTag = new RegExp(`^${mediaTag.source}`, "i");
const closingMediaTag = /^<\/(?:audio|video)\s*>$/i;
const markdownEvents = (body: string, inlineHtml = false) => postprocess(parse({
  extensions: inlineHtml ? [{ disable: { null: ["htmlFlow"] } }] : [],
}).document().write(preprocess()(body, undefined, true)));

const convertMedia = (html: string) => {
  const document = createDocument(html);
  const root = document.body;
  const media = Array.from(root.querySelectorAll("img[src],audio,video,source[src]"));
  if (!media.length) return;
  for (const node of Array.from(root.querySelectorAll("script,style,iframe,object,embed"))) node.remove();
  for (const node of media) {
    const href = node.getAttribute("src");
    if (href === null) continue;
    if (/^\s*(?:javascript|vbscript|data):/i.test(href)) { node.remove(); continue; }
    // Keep existing escapes and encode characters that delimit Markdown URLs.
    const target = href.replace(/[\s()]/g, char => encodeURIComponent(char).replace("(", "%28").replace(")", "%29"));
    if (node.nodeName === "IMG") node.setAttribute("src", target);
    else {
      const link = document.createElement("a");
      link.setAttribute("href", target);
      link.textContent = href.split("/").at(-1) || "Media";
      node.parentNode?.replaceChild(link, node);
    }
  }
  return convertImportHtml(root.innerHTML);
};

/** Normalize exported HTML media without consuming adjacent Markdown or code. */
export const normalizeExportMedia = (markdown: string) => {
  const body = splitMarkdownFrontMatter(markdown, { maxSourceLength: Infinity })?.body ?? markdown;
  const offset = markdown.length - body.length;
  const events = markdownEvents(body);
  const blocks: Array<{ start: number; end: number }> = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  let hasBareMediaBlock = false;
  for (const [action, token, context] of events) {
    if (action !== "enter" || token.type !== "htmlFlow") continue;
    const html = context.sliceSerialize(token);
    const start = token.start.offset!;
    const end = token.end.offset!;
    if (openingMediaTag.test(html)) {
      // CommonMark can put later lines of Markdown in the same HTML flow as a
      // bare <img>. Reparse such markup as inline tags for exact boundaries.
      hasBareMediaBlock = true;
      continue;
    }
    blocks.push({ start, end });
    if (!mediaTag.test(html)) continue;
    const text = convertMedia(html);
    if (text === undefined) continue;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    const indent = body.slice(lineStart, start).replace(/[^>\t ]/g, " ");
    replacements.push({ start, end, text: text.replaceAll("\n", `\n${indent}`) });
  }
  let blockIndex = 0;
  for (const [action, token, context] of hasBareMediaBlock ? markdownEvents(body, true) : events) {
    if (action !== "enter" || token.type !== "htmlText") continue;
    const start = token.start.offset!;
    const end = token.end.offset!;
    while (blocks[blockIndex] && blocks[blockIndex]!.end <= start) blockIndex++;
    const block = blocks[blockIndex];
    if (block && start >= block.start) continue;
    const html = context.sliceSerialize(token);
    const text = closingMediaTag.test(html) ? "" : openingMediaTag.test(html) ? convertMedia(html) : undefined;
    if (text !== undefined) replacements.push({ start, end, text });
  }
  for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
    markdown = markdown.slice(0, offset + start) + text + markdown.slice(offset + end);
  }
  return markdown;
};
