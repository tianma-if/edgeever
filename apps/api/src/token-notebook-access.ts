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

/**
 * Parses the stored `notebook_access_json` column.
 *
 * - NULL/undefined → `null` (legacy token, unrestricted).
 * - A JSON array → its valid entries, possibly empty. An empty array is a
 *   restricted token with no grants (fail closed), never a fallback to
 *   unrestricted access.
 * - Unparseable or non-array values → `[]`: a corrupted grant column must
 *   narrow access instead of widening it. Valid entries among malformed
 *   ones are kept; the rest are dropped.
 */
export const parseNotebookAccessJson = (value: string | null | undefined): TokenNotebookAccess[] | null => {
  if (value == null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const entries: TokenNotebookAccess[] = [];
    for (const item of parsed) {
      // Any invalid entry marks the whole record unusable: dropping it would
      // turn "malformed grant" into "no explicit grant", which the default
      // policy could then widen. Fail closed instead.
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.notebookId !== "string" || !entry.notebookId.trim()) return [];
      if (typeof entry.read !== "boolean" || typeof entry.write !== "boolean") return [];
      entries.push({
        notebookId: entry.notebookId,
        read: entry.read,
        write: entry.write,
      });
    }
    return entries;
  } catch {
    return [];
  }
};

/** Parses the stored `notebook_default_access` column. Unknown/null means "none". */
export const parseNotebookDefaultAccess = (value: string | null | undefined): TokenNotebookDefaultAccess =>
  value === "read" || value === "write" ? value : "none";

/**
 * True when a stored grant column is present but unusable (unparseable JSON
 * or not an array). Such a record must deny access entirely — including the
 * default policy — instead of falling back to the default grant.
 */
export const isCorruptedNotebookAccess = (value: string | null | undefined): boolean => {
  if (value == null) return false;
  const entries = parseNotebookAccessJson(value);
  if (entries === null) return false;
  // Re-parse strictly: parseNotebookAccessJson returns [] for both a valid
  // empty array and an unusable record; distinguish them by re-checking the
  // raw structure.
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return true;
    for (const item of parsed) {
      if (!item || typeof item !== "object") return true;
      const entry = item as Record<string, unknown>;
      if (typeof entry.notebookId !== "string" || !entry.notebookId.trim()) return true;
      if (typeof entry.read !== "boolean" || typeof entry.write !== "boolean") return true;
    }
    return false;
  } catch {
    return true;
  }
};

/**
 * Cloudflare D1 counts bound parameters per whole statement, so passing
 * hundreds of ids as individual binds fails there even when each IN clause
 * is small. Notebook id lists are therefore passed as one JSON array bound
 * through json_each: every generated statement binds only a handful of
 * values, regardless of how many notebooks are granted.
 */
export const notebookIdsBind = (notebookIds: string[]): string => JSON.stringify(notebookIds);

/** SQL fragment: true when the column holds one of the listed notebook ids. */
export const notebookInListSql = (notebookIdColumn: string, notebookIds: string[]) =>
  notebookIds.length === 0
    ? "0 = 1"
    : `${notebookIdColumn} IN (SELECT value FROM json_each(?))`;

/** Expands granted notebook ids to include every live descendant notebook. */
const expandWithDescendants = async (
  db: DatabaseAdapter,
  workspaceId: string,
  notebookIds: string[],
): Promise<string[]> => {
  if (notebookIds.length === 0) return [];
  const rows = await db.prepare(
    `WITH RECURSIVE granted(id) AS (
       SELECT id FROM notebooks
       WHERE workspace_id = ? AND is_deleted = 0
         AND id IN (SELECT value FROM json_each(?))

       UNION ALL

       SELECT n.id
       FROM notebooks n
       INNER JOIN granted g ON n.parent_id = g.id
       WHERE n.workspace_id = ? AND n.is_deleted = 0
     )
     SELECT DISTINCT id FROM granted`,
  ).bind(workspaceId, notebookIdsBind(notebookIds), workspaceId).all<{ id: string }>();

  return rows.results.map((row) => row.id);
};

/**
 * Resolves the effective notebook access for a request. `null` entries (every
 * token created before this feature, and interactive user sessions) stay
 * unrestricted. An empty array is a restricted token with no grants at all
 * (fail closed). A `write` grant always implies `read`.
 *
 * `defaultAccess` covers only notebooks with NO explicit grant — notably
 * notebooks created after the token. Explicit grants always win: a notebook
 * granted read-only stays read-only even when the default is "write".
 */
export const resolveNotebookAccess = async (
  db: DatabaseAdapter,
  workspaceId: string,
  entries: TokenNotebookAccess[] | null | undefined,
  defaultAccess: TokenNotebookDefaultAccess = "none",
): Promise<NotebookAccess> => {
  if (entries == null) {
    return UNRESTRICTED_NOTEBOOK_ACCESS;
  }

  // Resolve per-notebook grants with nearest-entry-wins semantics: the grant
  // (or explicit deny) on the closest ancestor — including the notebook
  // itself — decides, so a read-only child overrides a read/write parent and
  // an explicit deny on a parent closes its whole subtree.
  const tree = await notebookTree(db, workspaceId);
  const grantByNotebook = new Map(entries.map((entry) => [entry.notebookId, entry]));

  const effectiveGrant = (notebookId: string): { read: boolean; write: boolean } | null => {
    let current: string | null = notebookId;
    let seen = 0;
    while (current && seen <= tree.ids.length + 1) {
      const grant = grantByNotebook.get(current);
      if (grant) return { read: grant.read || grant.write, write: grant.write };
      current = tree.parentByNotebook.get(current) ?? null;
      seen += 1;
    }
    return null;
  };

  const readable: string[] = [];
  const writable: string[] = [];
  for (const id of tree.ids) {
    const grant = effectiveGrant(id);
    if (grant) {
      if (grant.read) readable.push(id);
      if (grant.write) writable.push(id);
      continue;
    }
    if (defaultAccess !== "none") {
      readable.push(id);
      if (defaultAccess === "write") writable.push(id);
    }
  }

  return {
    restricted: true,
    readableNotebookIds: readable,
    writableNotebookIds: writable,
    defaultWrite: defaultAccess === "write",
  };
};

/**
 * Loads the live notebook tree (ids + parent links) in a single query, so a
 * restricted request pays one constant read for authorization instead of two
 * full-table scans.
 */
type NotebookTree = { ids: string[]; parentByNotebook: Map<string, string | null> };

const notebookTree = async (
  db: DatabaseAdapter,
  workspaceId: string,
): Promise<NotebookTree> => {
  const rows = await db.prepare(
    `SELECT id, parent_id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0`,
  ).bind(workspaceId).all<{ id: string; parent_id: string | null }>();
  return {
    ids: rows.results.map((row) => row.id),
    parentByNotebook: new Map(rows.results.map((row) => [row.id, row.parent_id])),
  };
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
export const notebookAccessBinds = (access: NotebookAccess, kind: "read" | "write"): string[] => {
  if (!access.restricted) return [];
  const notebookIds = kind === "read" ? access.readableNotebookIds : access.writableNotebookIds;
  return notebookIds.length === 0 ? [] : [notebookIdsBind(notebookIds)];
};

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
  if (!auth || auth.kind !== "agent" || auth.notebookAccess == null) {
    return UNRESTRICTED_NOTEBOOK_ACCESS;
  }
  return resolveNotebookAccess(c.env.storage.db, auth.workspaceId, auth.notebookAccess, auth.notebookDefaultAccess);
};
