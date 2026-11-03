import TurndownService from "turndown";
import { createDocument } from "@mixmark-io/domino";
import { tables, taskListItems } from "@joplin/turndown-plugin-gfm";
import type { ImportResource } from "@edgeever/shared/note-import/types";
import { resourceLinkToMarkdown, resourceNodeToMarkdown } from "../../../../../packages/shared/src/resource-links";

const hasStyleFlag = (node: Element, name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*true\\s*(?:;|$)`, "i").test(node.getAttribute("style") ?? "");

/** Normalize Evernote's current ENML to the HTML semantics Turndown supports. */
const prepareEnml = (source: string, resources: readonly ImportResource[]) => {
  const document = createDocument(source);
  const root = document.body;
  for (const node of Array.from(root.querySelectorAll("div[style]"))) {
    const style = node.getAttribute("style") ?? "";
    if (/(?:^|;)\s*--en-chs\s*:/i.test(style) && /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/i.test(style)) {
      node.remove();
    } else if (hasStyleFlag(node, "--en-codeblock")) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = Array.from(node.childNodes, line => line.textContent ?? "").join("\n");
      pre.appendChild(code);
      node.parentNode!.replaceChild(pre, node);
    }
  }
  for (const list of Array.from(root.querySelectorAll("ul[style]"))) if (hasStyleFlag(list, "--en-todo")) {
    for (const item of Array.from(list.children)) if (item.nodeName === "LI") {
      const label = item.firstElementChild;
      if (label?.nodeName === "DIV") {
        while (label.firstChild) item.insertBefore(label.firstChild, label);
        label.remove();
      }
      const checkbox = document.createElement("input");
      checkbox.setAttribute("type", "checkbox");
      if (hasStyleFlag(item, "--en-checked")) checkbox.setAttribute("checked", "");
      item.insertBefore(checkbox, item.firstChild);
    }
  }
  for (const table of Array.from(root.querySelectorAll("table"))) {
    const row = table.querySelector("tr");
    if (!row?.children.length || row.parentElement?.nodeName === "THEAD" || Array.from(row.children).some(cell => cell.nodeName !== "TH")) continue;
    const head = document.createElement("thead");
    table.insertBefore(head, row.parentElement === table ? row : row.parentElement);
    head.appendChild(row);
  }
  for (const node of Array.from(root.querySelectorAll("en-media"))) {
    const hash = node.getAttribute("hash") || "missing";
    const label = (node.getAttribute("alt") || resources.find(resource => resource.hash === hash)?.filename || "Attachment").replace(/[\r\n]+/g, " ");
    const image = node.getAttribute("type")?.startsWith("image/");
    const media = document.createElement(image ? "img" : "a");
    media.setAttribute(image ? "src" : "href", `evernote-resource:${hash}`);
    if (image) media.setAttribute("alt", label);
    else media.textContent = label;
    const replacement = image && node.closest("a") ? media : document.createElement("div");
    if (replacement !== media) replacement.appendChild(media);
    node.parentNode!.replaceChild(replacement, node);
  }
  return root;
};

/** Parse in an inert DOM; no imported HTML is inserted into the application. */
export const convertImportEnml = (enml: string, resources: readonly ImportResource[] = []) => {
  const converter = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*" });
  converter.use([tables, taskListItems]);
  converter.remove(["script", "style", "iframe", "object", "embed"]);
  converter.addRule("evernote-media", {
    filter: node => (node.nodeName === "IMG" && node.getAttribute("src")?.startsWith("evernote-resource:"))
      || (node.nodeName === "A" && node.getAttribute("href")?.startsWith("evernote-resource:")) || false,
    replacement: (_, node) => node.nodeName === "IMG"
      ? resourceNodeToMarkdown({ type: "image", url: node.getAttribute("src")!, alt: node.getAttribute("alt") ?? "" })
      : resourceLinkToMarkdown(node.textContent ?? "", node.getAttribute("href")!),
  });
  converter.addRule("evernote-todo", { filter: "en-todo" as never, replacement: (_, node) => node.getAttribute("checked") === "true" ? "- [x] " : "- [ ] " });
  converter.addRule("evernote-crypt", { filter: "en-crypt" as never, replacement: (_, node) => `\n\n[Encrypted Evernote content]\n\n\`\`\`text\n${node.textContent?.replaceAll("```", "` ` `") ?? ""}\n\`\`\`\n\n` });
  converter.addRule("unsafe-links", { filter: node => node.nodeName === "A" && /^\s*(?:javascript|vbscript|file):/i.test(node.getAttribute("href") ?? ""), replacement: content => content });
  const source = enml.replace(/<\?xml[\s\S]*?\?>/gi, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<en-todo([^>]*?)(?:\/>|>\s*<\/en-todo>)/gi, "<en-todo$1>_</en-todo>")
    .replace(/<en-media([^>]*?)(?:\/>|>\s*<\/en-media>)/gi, "<en-media$1>_</en-media>");
  return converter.turndown(prepareEnml(source, resources));
};
