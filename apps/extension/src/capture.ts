import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

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

const capturePage = (): CapturedPage => {
  const selectionHtml = getSelectionHtml();
  const documentClone = document.cloneNode(true) as Document;
  const article = new Readability(documentClone, {
    charThreshold: 80,
    keepClasses: false,
  }).parse();
  const sourceHtml = selectionHtml || article?.content || document.body?.innerHTML || "";
  const title = article?.title?.trim() || document.title.trim() || location.hostname;
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    linkStyle: "inlined",
  });
  const markdown = normalizeMarkdown(turndown.turndown(sourceHtml));

  return {
    title,
    url: location.href,
    markdown: markdown || "（网页没有可提取的正文内容）",
  };
};

void chrome.runtime.sendMessage({ type: "capturedPage", page: capturePage() });
