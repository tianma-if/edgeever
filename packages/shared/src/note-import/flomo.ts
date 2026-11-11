import { createDocument } from "@mixmark-io/domino";
import { convertImportHtml } from "./html";
import { findImportReferences } from "./references";
import type { ImportNote, ImportResource, SourceEntry } from "./types";
import { basename, dirname, normalPath } from "./sources";
import { mimeFromName } from "./metadata";
import { resolvePlayableMediaMimeType } from "../attachment-kind";

export const parseFlomoLocalTime = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("invalidFlomoTime");
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year!, month! - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) throw new Error("invalidFlomoTime");
  return date.toISOString();
};

const textWithBreaks = (node: Node): string => {
  if (node.nodeType === 3) return node.textContent ?? "";
  return Array.from(node.childNodes, textWithBreaks).join("") + (/^(P|DIV|LI|BR|PRE|BLOCKQUOTE)$/.test(node.nodeName) ? "\n" : "");
};
const child = (node: Element, name: string) => Array.from(node.children).find(item => item.classList.contains(name));
export type FlomoDocument = { note: ImportNote; contentMarkdown: string; error?: string };

/** Runs inside the import worker. Domino never fetches resources or executes HTML. */
export async function* readFlomo(
  html: string, entry: SourceEntry, resourceEntry: (path: string) => Promise<SourceEntry | undefined>, signal?: AbortSignal,
): AsyncGenerator<FlomoDocument> {
  const document = createDocument(html);
  const root = document.querySelector(".memos");
  if (!root) throw new Error("invalidFlomo");
  let ordinal = 0;
  for (const memo of Array.from(root.children)) {
    if (!memo.classList.contains("memo")) continue;
    signal?.throwIfAborted();
    const note: ImportNote = { key: "", path: `${entry.path} / ${++ordinal}`, entryKey: entry.key, notebookKey: "flomo", title: "", tags: [], resources: [], references: [] };
    try {
      note.createdAt = parseFlomoLocalTime(child(memo, "time")?.textContent ?? "");
      const content = child(memo, "content");
      if (!content) throw new Error("invalidFlomo");
      for (const node of Array.from(memo.querySelectorAll("script,style,iframe,object,embed"))) node.remove();
      for (const link of Array.from(memo.querySelectorAll("a[href]"))) {
        // oxlint-disable-next-line no-control-regex -- normalize control characters before checking executable URL schemes
        const href = (link.getAttribute("href") ?? "").replace(/[\u0000-\u0020]/g, "");
        if (/^(?:javascript|vbscript|data|file):/i.test(href)) link.removeAttribute("href");
      }
      const text = textWithBreaks(content).replace(/https?:\/\/[^\s<)）]+/g, "");
      note.tags = [...new Set(Array.from(text.matchAll(/#(?!️⃣)([^\s<#]+)/gu), match => match[1]!.replace(/\/$/, "")).filter(Boolean))];
      const body = document.createElement("div");
      body.appendChild(content.cloneNode(true));
      const files = child(memo, "files");
      if (files) body.appendChild(files.cloneNode(true));
      const paths = new Map<string, ImportResource>();
      const placeholders = new Map<string, string>();
      const references = new Map<string, string>();
      for (const node of Array.from(body.querySelectorAll("img[src],audio[src],video[src],source[src],.files a[href]"))) {
        signal?.throwIfAborted();
        const tag = node.nodeName.toLowerCase();
        const attribute = tag === "a" ? "href" : "src";
        const raw = decodeURIComponent(node.getAttribute(attribute) ?? "");
        if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(raw) || raw.includes("\\")) throw new Error("outsideRoot");
        const path = normalPath([dirname(entry.path), raw].filter(Boolean).join("/"));
        let resource = paths.get(path);
        if (!resource) {
          const file = await resourceEntry(path);
          if (!file) throw new Error(`missingResource: ${raw}`);
          resource = { key: file.key, entryKey: file.key, filename: basename(file.path), byteSize: file.size, mimeType: resolvePlayableMediaMimeType(null, file.path) ?? mimeFromName(file.path) };
          placeholders.set(path, `flomo-resource:${paths.size}`);
          paths.set(path, resource);
        }
        const placeholder = placeholders.get(path)!;
        references.set(placeholder, resource.key);
        node.setAttribute(attribute, placeholder);
        if (!["img", "a"].includes(tag) || (tag === "img" && /^(audio|video)\//.test(resource.mimeType))) {
          const link = document.createElement("a");
          link.setAttribute("href", placeholder); link.textContent = resource.filename;
          node.parentNode!.replaceChild(link, node);
        }
      }
      const contentMarkdown = convertImportHtml(body.innerHTML);
      note.resources = [...paths.values()];
      note.references = findImportReferences(contentMarkdown).map(ref => ({ ...ref, resourceKey: references.get(ref.href) }));
      yield { note, contentMarkdown };
    } catch (error) {
      signal?.throwIfAborted();
      yield { note, contentMarkdown: "", error: error instanceof Error ? error.message : String(error) };
    } finally { memo.remove(); }
  }
}
