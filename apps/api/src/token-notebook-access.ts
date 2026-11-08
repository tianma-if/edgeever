import type { TokenNotebookAccess, TokenNotebookDefaultAccess } from "@edgeever/shared";
import { AppError } from "./app-error";
import type { AppContext } from "./api-context";
import type { DatabaseAdapter } from "./storage-contract";

/**
 * Resolved per-notebook access for one authenticated request.
 *
 * - `restricted: false` — the request is not notebook-scoped (interactive user
 *   sessions, and tokens created without `notebookAccess`). Everything behaves
 *   exactly as before this feature existed.
 * - `restricted: true` — the request only reaches the notebooks listed in
 *   `readableNotebookIds`/`writableNotebookIds`, each expanded to its live
 *   subtree. Notebook ids whose notebook no longer exists are dropped, so
 *   deleting a granted notebook narrows the token instead of erroring.
 */
export type NotebookAccess = {
  restricted: boolean;
  readableNotebookIds: string[];
  writableNotebookIds: string[];
  /**
   * True when the token's default policy grants write access to notebooks
   * without an explicit grant. Such a token may also create top-level
   * notebooks, which it can then immediately write to.
   */
  defaultWrite: boolean;
};

export const UNRESTRICTED_NOTEBOOK_ACCESS: NotebookAccess = {
  restricted: false,
  readableNotebookIds: [],
  writableNotebookIds: [],
  defaultWrite: true,
};

/** Parses the stored `notebook_access_json` column. Null keeps legacy tokens unrestricted. */
export const parseNotebookAccessJson = (value: string | null | undefined): TokenNotebookAccess[] | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const entries: TokenNotebookAccess[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.notebookId !== "string" || !entry.notebookId.trim()) continue;
      entries.push({
        notebookId: entry.notebookId,
        read: entry.read === true,
        write: entry.write === true,
      });
    }
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
};

/** Parses the stored `notebook_default_access` column. Unknown/null means "none". */
export const parseNotebookDefaultAccess = (value: string | null | undefined): TokenNotebookDefaultAccess =>
  value === "read" || value === "write" ? value : "none";

/** Expands granted notebook ids to include every live descendant notebook. */
const expandWithDescendants = async (
  db: DatabaseAdapter,
  workspaceId: string,
  notebookIds: string[],
): Promise<string[]> => {
  if (notebookIds.length === 0) return [];
  const placeholders = notebookIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `WITH RECURSIVE granted(id) AS (
       SELECT id FROM notebooks
       WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})

       UNION ALL

       SELECT n.id
       FROM notebooks n
       INNER JOIN granted g ON n.parent_id = g.id
       WHERE n.workspace_id = ? AND n.is_deleted = 0
     )
     SELECT DISTINCT id FROM granted`,
  ).bind(workspaceId, ...notebookIds, workspaceId).all<{ id: string }>();

  return rows.results.map((row) => row.id);
};

/**
 * Resolves the effective notebook access for a request. `null` entries (every
 * token created before this feature, and interactive user sessions) stay
 * unrestricted. A `write` grant always implies `read`.
 *
 * `defaultAccess` covers notebooks with no explicit grant — notably notebooks
 * created after the token: "read" grants the whole workspace read access on
 * top of the explicit grants, "write" additionally grants write access, and
 * "none" (the default) keeps the original allow-list behaviour.
 */
export const resolveNotebookAccess = async (
  db: DatabaseAdapter,
  workspaceId: string,
  entries: TokenNotebookAccess[] | null | undefined,
  defaultAccess: TokenNotebookDefaultAccess = "none",
): Promise<NotebookAccess> => {
  if (!entries || entries.length === 0) {
    return UNRESTRICTED_NOTEBOOK_ACCESS;
  }

  const readGrants = entries.filter((entry) => entry.read || entry.write).map((entry) => entry.notebookId);
  const writeGrants = entries.filter((entry) => entry.write).map((entry) => entry.notebookId);
  const [grantedReadable, grantedWritable] = await Promise.all([
    expandWithDescendants(db, workspaceId, readGrants),
    expandWithDescendants(db, workspaceId, writeGrants),
  ]);

  if (defaultAccess === "none") {
    return {
      restricted: true,
      readableNotebookIds: grantedReadable,
      writableNotebookIds: grantedWritable,
      defaultWrite: false,
    };
  }

  const allNotebookIds = await expandWithDescendants(db, workspaceId, await liveNotebookIds(db, workspaceId));
  const readable = new Set(grantedReadable);
  for (const id of allNotebookIds) readable.add(id);
  const writable = new Set(grantedWritable);
  if (defaultAccess === "write") {
    for (const id of allNotebookIds) writable.add(id);
  }

  return {
    restricted: true,
    readableNotebookIds: [...readable],
    writableNotebookIds: [...writable],
    defaultWrite: defaultAccess === "write",
  };
};

const liveNotebookIds = async (db: DatabaseAdapter, workspaceId: string): Promise<string[]> => {
  const rows = await db.prepare(
    `SELECT id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0`,
  ).bind(workspaceId).all<{ id: string }>();
  return rows.results.map((row) => row.id);
};

/** SQL fragment: true when the column holds one of the listed notebook ids. */
export const notebookInListSql = (notebookIdColumn: string, notebookIds: string[]) => {
  if (notebookIds.length === 0) return "0 = 1";
  const placeholders = notebookIds.map(() => "?").join(", ");
  return `${notebookIdColumn} IN (${placeholders})`;
};

/** SQL fragment for memo rows: true when the memo's notebook is accessible. */
export const memoNotebookAccessSql = (
  memoNotebookColumn: string,
  access: NotebookAccess,
  kind: "read" | "write",
) => {
  if (!access.restricted) return "1 = 1";
  const notebookIds = kind === "read" ? access.readableNotebookIds : access.writableNotebookIds;
  return notebookInListSql(memoNotebookColumn, notebookIds);
};

/** Bind values for the readable/writable SQL fragments, in fragment order. */
export const notebookAccessBinds = (access: NotebookAccess, kind: "read" | "write"): string[] =>
  !access.restricted ? [] : kind === "read" ? access.readableNotebookIds : access.writableNotebookIds;

const hasNotebook = (access: NotebookAccess, kind: "read" | "write", notebookId: string) => {
  if (!access.restricted) return true;
  const ids = kind === "read" ? access.readableNotebookIds : access.writableNotebookIds;
  return ids.includes(notebookId);
};

/**
 * Throws unless the notebook subtree rooted at `notebookId` is accessible with
 * the requested mode.
 */
export const assertNotebookAccess = (
  access: NotebookAccess,
  kind: "read" | "write",
  notebookId: string,
  action: string,
) => {
  if (!hasNotebook(access, kind, notebookId)) {
    throw new AppError(
      "notebook_access_denied",
      `This API token does not have ${kind} access to the notebook needed to ${action}. Update the token's notebook access in EdgeEver settings.`,
      403,
    );
  }
};

/** True when every listed notebook is accessible with the requested mode. */
export const hasAllNotebookAccess = (
  access: NotebookAccess,
  kind: "read" | "write",
  notebookIds: string[],
) => notebookIds.every((notebookId) => hasNotebook(access, kind, notebookId));

/**
 * Resolves the effective per-notebook access for the current request.
 * Interactive sessions and unrestricted tokens resolve without touching the
 * database, so unrestricted usage keeps its exact previous cost.
 */
export const resolveRequestNotebookAccess = async (c: AppContext): Promise<NotebookAccess> => {
  const auth = c.get("auth");
  if (!auth || auth.kind !== "agent" || !auth.notebookAccess?.length) {
    return UNRESTRICTED_NOTEBOOK_ACCESS;
  }
  return resolveNotebookAccess(c.env.storage.db, auth.workspaceId, auth.notebookAccess, auth.notebookDefaultAccess);
};
