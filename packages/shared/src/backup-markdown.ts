import type { MemoDetail, Notebook, Resource } from "./types";
import { mergeMarkdownFrontMatter } from "./front-matter";

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const sanitizeExportPathSegment = (value: string, fallback: string) => {
  const sanitized = value
    // oxlint-disable-next-line no-control-regex -- replaces control characters in export paths
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  const safeValue = sanitized || fallback;
  return WINDOWS_RESERVED_NAME.test(safeValue) ? `_${safeValue}` : safeValue;
};

export const uniqueExportName = (candidate: string, usedNames: Set<string>) => {
  if (!usedNames.has(candidate.toLocaleLowerCase())) {
    usedNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  let suffix = 2;
  while (usedNames.has(`${candidate} (${suffix})`.toLocaleLowerCase())) {
    suffix += 1;
  }

  const unique = `${candidate} (${suffix})`;
  usedNames.add(unique.toLocaleLowerCase());
  return unique;
};

export const buildNotebookExportPaths = (notebooks: Notebook[]) => {
  const notebookById = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const siblingNames = new Map<string, Set<string>>();
  const segmentById = new Map<string, string>();

  for (const notebook of notebooks) {
    const parentKey = notebook.parentId ?? "__root__";
    const usedNames = siblingNames.get(parentKey) ?? new Set<string>();
    siblingNames.set(parentKey, usedNames);
    segmentById.set(
      notebook.id,
      uniqueExportName(sanitizeExportPathSegment(notebook.name, "Untitled notebook"), usedNames)
    );
  }

  const pathById = new Map<string, string>();
  const resolvePath = (notebookId: string, visited = new Set<string>()): string => {
    const cached = pathById.get(notebookId);
    if (cached) {
      return cached;
    }

    const notebook = notebookById.get(notebookId);
    if (!notebook || visited.has(notebookId)) {
      return "Unfiled";
    }

    visited.add(notebookId);
    const segment = segmentById.get(notebookId) ?? "Untitled notebook";
    const path = notebook.parentId && notebookById.has(notebook.parentId)
      ? `${resolvePath(notebook.parentId, visited)}/${segment}`
      : segment;
    pathById.set(notebookId, path);
    return path;
  };

  for (const notebook of notebooks) {
    resolvePath(notebook.id);
  }

  return pathById;
};

export const buildNoteMarkdown = (markdown: string, memo: MemoDetail, notebookPath: string) =>
  mergeMarkdownFrontMatter(markdown, {
    title: memo.title?.trim() || "Untitled note",
    tags: memo.tags,
    notebook: notebookPath,
    created: memo.createdAt,
    updated: memo.updatedAt,
    pinned: memo.isPinned,
    edgeever_id: memo.id,
  });

export const buildMarkdownFrontMatter = (memo: MemoDetail, notebookPath: string) =>
  buildNoteMarkdown("", memo, notebookPath);

export const getExportResourceExtension = (resource: Resource) => {
  const filenameExtension = resource.filename?.match(/\.([a-z0-9]{1,12})$/i)?.[1];
  if (filenameExtension) {
    return filenameExtension.toLowerCase();
  }

  const mimeExtension = resource.mimeType?.split("/")[1]?.split(/[;+]/)[0];
  return mimeExtension ? sanitizeExportPathSegment(mimeExtension, "bin").toLowerCase() : "bin";
};

export const encodeRelativePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export const replaceExportResourceUrl = (markdown: string, resourceUrl: string, relativePath: string, origin?: string) => {
  const encodedPath = encodeRelativePath(relativePath);
  const base = origin ?? (typeof window === "undefined" ? undefined : window.location.origin);
  const absoluteUrl = base ? new URL(resourceUrl, base).toString() : null;
  let result = markdown.split(resourceUrl).join(encodedPath);

  if (absoluteUrl) {
    result = result.split(absoluteUrl).join(encodedPath);
  }

  return result;
};
