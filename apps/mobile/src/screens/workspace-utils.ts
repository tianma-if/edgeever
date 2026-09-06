import { DEFAULT_MEMO_TITLE, type MemoSummary, type Notebook } from "@edgeever/shared";
import type { MobileLocalePreference } from "../lib/preferences";

export type NotebookOption = {
  notebook: Notebook;
  depth: number;
};

export const parseTags = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );

const compareNotebooksManual = (left: Notebook, right: Notebook) =>
  left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id);

export const flattenNotebooks = (notebooks: Notebook[]) => {
  const byParent = new Map<string | null, Notebook[]>();
  const byId = new Set(notebooks.map((notebook) => notebook.id));
  const result: NotebookOption[] = [];

  for (const notebook of notebooks) {
    const parentId = notebook.parentId && byId.has(notebook.parentId) ? notebook.parentId : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(notebook);
    byParent.set(parentId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort(compareNotebooksManual);
  }

  const walk = (parentId: string | null, depth: number) => {
    for (const notebook of byParent.get(parentId) ?? []) {
      result.push({ notebook, depth });
      walk(notebook.id, depth + 1);
    }
  };

  walk(null, 0);
  return result;
};

export const filterNotebookOptions = (options: NotebookOption[], searchText: string) => {
  const query = searchText.trim().toLowerCase();

  if (!query) {
    return options;
  }

  return options.filter(({ notebook }) => notebook.name.toLowerCase().includes(query) || (notebook.slug || "").toLowerCase().includes(query));
};

export const filterNotebookOptionsById = (options: NotebookOption[], visibleIds: ReadonlySet<string>) =>
  options.filter(({ notebook }) => visibleIds.has(notebook.id));

export const getNotebookParentIdSet = (notebooks: Notebook[]) => {
  const notebookIds = new Set(notebooks.map((notebook) => notebook.id));
  const parentIds = new Set<string>();

  for (const notebook of notebooks) {
    if (notebook.parentId && notebookIds.has(notebook.parentId)) {
      parentIds.add(notebook.parentId);
    }
  }

  return parentIds;
};

export const getNotebookAncestorIds = (notebooks: Notebook[], notebookId: string) => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const ancestorIds = new Set<string>();
  let current = byId.get(notebookId);

  while (current?.parentId) {
    if (ancestorIds.has(current.parentId)) {
      break;
    }
    ancestorIds.add(current.parentId);
    current = byId.get(current.parentId);
  }

  return ancestorIds;
};

export const filterCollapsedNotebookOptions = (options: NotebookOption[], collapsedNotebookIds: Set<string>) => {
  if (collapsedNotebookIds.size === 0) {
    return options;
  }

  const visibleOptions: NotebookOption[] = [];
  let hiddenDepth: number | null = null;

  for (const option of options) {
    if (hiddenDepth !== null && option.depth > hiddenDepth) {
      continue;
    }

    hiddenDepth = null;
    visibleOptions.push(option);

    if (collapsedNotebookIds.has(option.notebook.id)) {
      hiddenDepth = option.depth;
    }
  }

  return visibleOptions;
};

export const getResolvedMobileLocale = (localePreference: MobileLocalePreference) =>
  localePreference === "system" ? Intl.DateTimeFormat().resolvedOptions().locale || "zh-CN" : localePreference;

export const isEnglishMobileLocale = (localePreference: MobileLocalePreference) =>
  getResolvedMobileLocale(localePreference).startsWith("en");

export const formatDate = (value: string, localePreference: MobileLocalePreference = "system") =>
  new Intl.DateTimeFormat(getResolvedMobileLocale(localePreference), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const formatMemoPreviewDate = (value: string, localePreference: MobileLocalePreference = "system") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const memoDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const locale = getResolvedMobileLocale(localePreference);
  if (memoDay === today) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (memoDay === today - 24 * 60 * 60 * 1000) {
    return isEnglishMobileLocale(localePreference) ? "Yesterday" : "昨天";
  }
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" }).format(date);
};

export const formatMemoDetailDate = (value: string, locale: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const sortMemoSummaries = (memos: MemoSummary[], sortMode: unknown) =>
  [...memos].sort((left, right) => {
    if (sortMode === "title-asc") {
      return (left.title || DEFAULT_MEMO_TITLE).localeCompare(right.title || DEFAULT_MEMO_TITLE);
    }
    if (sortMode === "created-desc") {
      return right.createdAt.localeCompare(left.createdAt);
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });

export const markdownToLocalText = (markdown: string) =>
  markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const getTextSearchMatches = (text: string, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const normalizedText = text.toLowerCase();
  const matches: Array<{ end: number; start: number }> = [];
  let cursor = 0;

  while (cursor < normalizedText.length) {
    const start = normalizedText.indexOf(normalizedQuery, cursor);

    if (start === -1) {
      break;
    }

    const end = start + normalizedQuery.length;
    matches.push({ end, start });
    cursor = end;
  }

  return matches;
};

export const formatRevisionActor = (actor: string) => {
  if (actor.startsWith("user:")) {
    return "user";
  }

  if (actor.startsWith("agent:")) {
    return "agent";
  }

  return actor || "system";
};
