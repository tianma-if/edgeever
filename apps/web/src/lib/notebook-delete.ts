export class NotebookNotEmptyError extends Error {
  readonly code = "notebook_not_empty";

  constructor() {
    super("notebook_not_empty");
    this.name = "NotebookNotEmptyError";
  }
}

export const notebookDeleteIdsFromPayload = (
  payload: { notebookId?: unknown; notebookIds?: unknown } | null | undefined,
  fallbackId: string,
) => {
  const listed = Array.isArray(payload?.notebookIds)
    ? payload.notebookIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (listed.length > 0) return listed;
  const notebookId = typeof payload?.notebookId === "string" && payload.notebookId.length > 0
    ? payload.notebookId
    : fallbackId;
  return notebookId ? [notebookId] : [];
};

// A pending delete of a parent must also hide descendants that the server
// still lists, including when the parent itself is already absent.
export const notebooksBlockedByPendingDeletes = (
  notebooks: Array<{ id: string; parentId?: string | null }>,
  pendingDeleteIds: ReadonlySet<string>,
) => {
  const parentById = new Map(notebooks.map((notebook) => [notebook.id, notebook.parentId ?? null]));
  const blocked = new Set<string>();

  for (const notebook of notebooks) {
    const seen = new Set<string>();
    let currentId: string | null = notebook.id;
    while (currentId && !seen.has(currentId)) {
      if (pendingDeleteIds.has(currentId)) {
        blocked.add(notebook.id);
        break;
      }
      seen.add(currentId);
      const parentId: string | null = parentById.get(currentId) ?? null;
      if (parentId && pendingDeleteIds.has(parentId)) {
        blocked.add(notebook.id);
        break;
      }
      currentId = parentId;
    }
  }

  return blocked;
};
