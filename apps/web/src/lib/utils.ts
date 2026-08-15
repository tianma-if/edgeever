import type { Notebook } from "@edgeever/shared";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type NotebookNode = Notebook & {
  children: NotebookNode[];
};

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export type NotebookNodeComparator = (first: NotebookNode, second: NotebookNode) => number;

const compareNotebookOrder: NotebookNodeComparator = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export const buildNotebookTree = (notebooks: Notebook[], compareNodes: NotebookNodeComparator = compareNotebookOrder): NotebookNode[] => {
  const nodes = new Map<string, NotebookNode>();

  for (const notebook of notebooks) {
    nodes.set(notebook.id, { ...notebook, children: [] });
  }

  const roots: NotebookNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const rollUpAndSortNodes = (items: NotebookNode[]) => {
    for (const item of items) {
      rollUpAndSortNodes(item.children);

      for (const child of item.children) {
        item.memoCount += child.memoCount;

        if (child.lastMemoUpdatedAt && (!item.lastMemoUpdatedAt || child.lastMemoUpdatedAt > item.lastMemoUpdatedAt)) {
          item.lastMemoUpdatedAt = child.lastMemoUpdatedAt;
        }
      }
    }

    items.sort(compareNodes);
  };

  rollUpAndSortNodes(roots);
  return roots;
};

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const parseTagsText = (value: string) =>
  value
    .split(/[,，\n]+/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
