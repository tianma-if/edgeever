import { parse, postprocess, preprocess } from "micromark";
import { parseDocument } from "htmlparser2";
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
  // Inline tokens identify real tags outside code. HTML parsing supplies exact
  // element boundaries and raw-text semantics that Markdown flow tokens lack.
  const hasMediaBlock = events.some(([action, token, context]) => action === "enter" && token.type === "htmlFlow" && mediaTag.test(context.sliceSerialize(token)));
  const inlineEvents = hasMediaBlock ? markdownEvents(body, true) : events;
  const tagStarts = new Set(inlineEvents.filter(([action, token]) => action === "enter" && token.type === "htmlText").map(([, token]) => token.start.offset!));
  const literalRanges = inlineEvents.filter(([action, token]) => action === "enter" && ["codeText", "codeFenced", "codeIndented", "characterEscape"].includes(token.type)).map(([, token]) => ({ start: token.start.offset!, end: token.end.offset! }));
  let literalIndex = 0;
  let flow: { start: number; end: number; text: string; masked: string; segments: Array<{ offset: number; source: number }> } | undefined;
  for (const [action, token, context] of events) {
    if (action === "enter" && token.type === "htmlFlow") {
      flow = { start: token.start.offset!, end: token.end.offset!, text: "", masked: "", segments: [] };
      blocks.push({ start: flow.start, end: flow.end });
    } else if (flow && action === "enter" && (token.type === "htmlFlowData" || token.type === "lineEnding")) {
      // Token serialization removes quote/list prefixes. Keep a source map so
      // replacements preserve the original prefixes and adjacent Markdown.
      flow.segments.push({ offset: flow.text.length, source: token.start.offset! });
      const text = context.sliceSerialize(token);
      flow.text += text;
      let masked = text;
      while (literalRanges[literalIndex] && literalRanges[literalIndex]!.end <= token.start.offset!) literalIndex++;
      for (let i = literalIndex; literalRanges[i] && literalRanges[i]!.start < token.end.offset!; i++) {
        const range = literalRanges[i]!;
        const start = Math.max(0, range.start - token.start.offset!);
        const end = Math.min(text.length, range.end - token.start.offset!);
        masked = masked.slice(0, start) + masked.slice(start, end).replace(/[^\r\n]/g, " ") + masked.slice(end);
      }
      // Preserve offsets while hiding code and escaped delimiters from the HTML parser.
      flow.masked += masked;
    } else if (flow && action === "exit" && token.type === "htmlFlow") {
      const { text: html, segments } = flow;
      if (mediaTag.test(html)) {
        let segmentIndex = 0;
        const sourceOffset = (offset: number) => {
          while (segments[segmentIndex + 1] && segments[segmentIndex + 1]!.offset <= offset) segmentIndex++;
          const segment = segments[segmentIndex]!;
          return segment.source + offset - segment.offset;
        };
        for (const node of parseDocument(flow.masked, { withStartIndices: true, withEndIndices: true }).children) {
          if (node.type !== "tag" || node.startIndex === null || node.endIndex === null) continue;
          const start = sourceOffset(node.startIndex);
          const htmlEnd = Math.min(node.endIndex + 1, html.length);
          const end = sourceOffset(htmlEnd);
          if (!tagStarts.has(start)) continue;
          const text = convertMedia(html.slice(node.startIndex, htmlEnd));
          if (text === undefined) continue;
          const lineStart = Math.max(body.lastIndexOf("\n", start - 1), body.lastIndexOf("\r", start - 1)) + 1;
          const indent = body.slice(lineStart, start).replace(/[^>\t ]/g, " ");
          replacements.push({ start, end, text: text.replaceAll("\n", `\n${indent}`) });
        }
      }
      flow = undefined;
    }
  }
  let blockIndex = 0;
  for (const [action, token, context] of inlineEvents) {
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
