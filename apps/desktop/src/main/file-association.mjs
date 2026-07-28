import { extname } from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

export const isSupportedAssociatedFile = (filePath) =>
  typeof filePath === "string" && MARKDOWN_EXTENSIONS.has(extname(filePath).toLowerCase());

export const markdownTitleFromFileName = (fileName) =>
  typeof fileName === "string" ? fileName.trim().replace(/\.(?:md|markdown)$/i, "").trim() : "";
