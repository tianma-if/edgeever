import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

// This file is injected with chrome.scripting.executeScript({ files }). It
// must remain self-contained because injected files are not loaded as ES
// modules and cannot resolve imports from the extension bundle.
const t = (key: string) => chrome.i18n.getMessage(key) || key;

type CapturedPage = {
  title: string;
  url: string;
  markdown: string;
};

const getSelectionHtml = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) {
    return "";
  }

  const container = document.createElement("div");
  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.appendChild(selection.getRangeAt(index).cloneContents());
  }

  return container.innerHTML.trim();
};

const normalizeMarkdown = (value: string) => value.replace(/\n{3,}/g, "\n\n").trim();

// Dynamic sites can contain very large inline SVGs, scripts, and embedded
// documents. They are not article content, but cloning and parsing them makes
// Readability disproportionately expensive (知乎 pages are a common example).
const prepareDocumentForExtraction = () => {
  const candidate = document.querySelector("article, main, [role='main']");
  const clone = candidate
    ? document.implementation.createHTMLDocument(document.title)
    : (document.cloneNode(true) as Document);
  if (candidate) {
    clone.body.appendChild(candidate.cloneNode(true));
  }
  clone
    .querySelectorAll("script, style, noscript, template, iframe, object, embed, canvas, svg, video, audio, source, link, meta")
    .forEach((element) => element.remove());
  return clone;
};

const textFallback = () => {
  const text = document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
  return text ? text.replace(/([\\`*_{}[\]()#+.!|])/g, "\\$1") : t("emptyPageContent");
};

const capturePage = (): CapturedPage => {
  const selectionHtml = getSelectionHtml();
  let article: ReturnType<Readability["parse"]> = null;
  let sourceHtml = selectionHtml;

  if (!sourceHtml) {
    const documentClone = prepareDocumentForExtraction();
    article = new Readability(documentClone, {
      charThreshold: 80,
      keepClasses: false,
    }).parse();
    sourceHtml = article?.content || document.querySelector("article, main, [role='main']")?.innerHTML || "";
  }

  const title = article?.title?.trim() || document.title.trim() || location.hostname;
  let markdown = "";
  if (sourceHtml) {
    const turndown = new TurndownService({
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      headingStyle: "atx",
      linkStyle: "inlined",
    });
    markdown = normalizeMarkdown(turndown.turndown(sourceHtml));
  }

  return {
    title,
    url: location.href,
    markdown: markdown || textFallback(),
  };
};

try {
  void chrome.runtime.sendMessage({ type: "capturedPage", page: capturePage() });
} catch {
  // Keep the injected script from failing silently if a page exposes an
  // unusual DOM implementation. The background page will show its timeout
  // message, while ordinary pages still use the normal extraction path.
  void chrome.runtime.sendMessage({
    type: "capturedPage",
    page: {
      title: document.title.trim() || location.hostname,
      url: location.href,
      markdown: textFallback(),
    },
  });
}
