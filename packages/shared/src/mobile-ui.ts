export const MOBILE_UI_METRICS = {
  bottomNavigationHeight: 52,
  compactControlHeight: 36,
  floatingCreateButtonLift: 16,
  floatingCreateButtonSize: 52,
  floatingSheetCornerRadius: 10,
  minimumTouchTarget: 44,
} as const;

export type MobileMemoFilterMode = "all" | "tagged" | "untagged" | "pinned";

export const toggleMobileMemoFilterMode = (
  current: MobileMemoFilterMode,
  requested: Exclude<MobileMemoFilterMode, "all">
): MobileMemoFilterMode => current === requested ? "all" : requested;

export const toggleMobileMemoSelection = (
  current: ReadonlySet<string>,
  memoId: string
): Set<string> => {
  const next = new Set(current);

  if (next.has(memoId)) {
    next.delete(memoId);
  } else {
    next.add(memoId);
  }

  return next;
};

export const getMobileCenteredScrollOffset = (
  rowTop: number,
  rowHeight: number,
  viewportHeight: number
): number => Math.max(0, rowTop - Math.max(0, viewportHeight - rowHeight) / 2);

export type MobileNotebookSearchItem = {
  id: string;
  name: string;
  parentId?: string | null;
};

export const getMobileNotebookSearchVisibleIds = (
  notebooks: ReadonlyArray<MobileNotebookSearchItem>,
  searchText: string
): Set<string> => {
  const query = searchText.trim().toLocaleLowerCase("zh-CN");
  const notebookById = new Map(notebooks.map((notebook) => [notebook.id, notebook]));

  if (!query) {
    return new Set(notebookById.keys());
  }

  const childrenByParentId = new Map<string, string[]>();
  for (const notebook of notebooks) {
    if (!notebook.parentId || !notebookById.has(notebook.parentId)) {
      continue;
    }
    const children = childrenByParentId.get(notebook.parentId) ?? [];
    children.push(notebook.id);
    childrenByParentId.set(notebook.parentId, children);
  }

  const visibleIds = new Set<string>();
  const includeDescendants = (notebookId: string, visited: Set<string>) => {
    if (visited.has(notebookId)) {
      return;
    }
    visited.add(notebookId);
    visibleIds.add(notebookId);
    for (const childId of childrenByParentId.get(notebookId) ?? []) {
      includeDescendants(childId, visited);
    }
  };

  for (const notebook of notebooks) {
    if (!notebook.name.toLocaleLowerCase("zh-CN").includes(query)) {
      continue;
    }

    includeDescendants(notebook.id, new Set());
    const visitedAncestors = new Set<string>([notebook.id]);
    let parentId = notebook.parentId ?? null;
    while (parentId && !visitedAncestors.has(parentId)) {
      visitedAncestors.add(parentId);
      visibleIds.add(parentId);
      parentId = notebookById.get(parentId)?.parentId ?? null;
    }
  }

  return visibleIds;
};
