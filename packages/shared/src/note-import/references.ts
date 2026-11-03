import { parse, postprocess, preprocess } from "micromark";
import { gfm } from "micromark-extension-gfm";
import { decodeString } from "micromark-util-decode-string";
import { normalizeIdentifier } from "micromark-util-normalize-identifier";
import { splitMarkdownFrontMatter } from "../front-matter";
import type { ImportReference } from "./types";

type ParseEvent = ReturnType<typeof postprocess>[number];
type Frame = { kind: string; label?: string; reference?: string; inline?: boolean; destination?: ImportReference };
const extensions = [gfm()];
const parseEvents = (body: string) => postprocess(parse({ extensions }).document().write(preprocess()(body, undefined, true)));
const protectedTypes = new Set(["codeFenced", "codeIndented", "codeText", "htmlFlow", "htmlText", "characterEscape", "autolink", "literalAutolink", "resourceDestination", "definitionDestination", "resourceTitle", "definitionTitle"]);

/** Use CommonMark's concrete destination tokens, not whole-link string matches. */
export const findImportReferences = (markdown: string): ImportReference[] => {
  const body = splitMarkdownFrontMatter(markdown)?.body ?? markdown;
  const offset = markdown.length - body.length;
  let events = parseEvents(body);
  const protectedRanges = events.filter(([action, token]) => action === "enter" && protectedTypes.has(token.type)).map(([, token]) => [token.start.offset, token.end.offset]);
  const result = new Map<number, ImportReference>();
  const wikis: Array<[number, number]> = [];
  for (const match of body.matchAll(/!\[\[([^\]\r\n]+)\]\]/g)) {
    const start = match.index, end = start + match[0].length;
    if (protectedRanges.some(([from, to]) => start < to! && end > from!)) continue;
    const [href, label] = match[1]!.split("|");
    wikis.push([start, end]);
    result.set(start + offset, { start: start + offset, end: end + offset, href: href!, label: label || href!, image: true, wiki: true });
  }
  // Wiki embeds are a separate syntax. Hide their contents from CommonMark
  // without changing offsets or introducing whitespace/block constructs.
  if (wikis.length) {
    const parts: string[] = [];
    let from = 0;
    for (const [start, end] of wikis) { parts.push(body.slice(from, start), "x".repeat(end - start)); from = end; }
    parts.push(body.slice(from));
    events = parseEvents(parts.join(""));
  }
  const destination = (token: ParseEvent[1], context: ParseEvent[2], image: boolean, email = false): ImportReference | undefined => {
    const href = (email ? "mailto:" : "") + decodeString(context.sliceSerialize(token));
    if (!href) return;
    return { start: offset + token.start.offset!, end: offset + token.end.offset!, href, label: "", image, wiki: false, targetOnly: true };
  };
  const frames: Frame[] = [];
  const definitions = new Map<string, ImportReference | undefined>(), used = new Set<string>();
  for (const [action, token, context] of events) {
    if (action === "enter") {
      if (token.type === "link" || token.type === "image" || token.type === "definition") frames.push({ kind: token.type });
      const frame = frames.at(-1);
      if (frame && token.type === "resource") frame.inline = true;
      if (frame && (token.type === "resourceDestinationString" || token.type === "definitionDestinationString")) frame.destination = destination(token, context, frame.kind === "image");
      if (token.type === "autolinkProtocol" || token.type === "autolinkEmail") {
        const ref = destination(token, context, false, token.type === "autolinkEmail");
        if (ref) result.set(ref.start, ref);
      }
    } else {
      const frame = frames.at(-1);
      if (!frame) continue;
      if (token.type === "labelText" || token.type === "definitionLabelString") frame.label = normalizeIdentifier(context.sliceSerialize(token));
      if (token.type === "referenceString") frame.reference = normalizeIdentifier(context.sliceSerialize(token));
      if (token.type === "link" || token.type === "image" || token.type === "definition") {
        frames.pop();
        if (frame.kind === "definition") {
          if (frame.label && !definitions.has(frame.label)) definitions.set(frame.label, frame.destination);
        } else if (frame.destination) result.set(frame.destination.start, frame.destination);
        else if (!frame.inline && (frame.reference || frame.label)) used.add((frame.reference || frame.label)!);
      }
    }
  }
  for (const id of used) { const ref = definitions.get(id); if (ref) result.set(ref.start, ref); }
  return [...result.values()].sort((a, b) => a.start - b.start);
};
export const rewriteImportMarkdown = (markdown: string, refs: ImportReference[], urls: Record<string, string>) => {
  for (const ref of [...refs].sort((a, b) => b.start - a.start)) {
    const url = ref.resourceKey && Object.hasOwn(urls, ref.resourceKey) ? urls[ref.resourceKey] : undefined;
    if (!url) continue;
    const suffix = (ref.suffix ?? "").replace(/[()]/g, char => char === "(" ? "%28" : "%29");
    const target = `${url}${suffix}`;
    const label = ref.label.replace(/(?<!\\)\]/g, "\\]");
    const replacement = ref.targetOnly ? target : `${ref.image ? "!" : ""}[${label}](${target})`;
    markdown = markdown.slice(0, ref.start) + replacement + markdown.slice(ref.end);
  }
  return markdown;
};
