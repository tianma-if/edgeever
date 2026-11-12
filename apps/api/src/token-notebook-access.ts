import type { TokenNotebookAccess, TokenNotebookAccessLevel } from "@edgeever/shared";
import { AppError } from "./app-error";
import type { AppContext } from "./api-context";
import type { DatabaseAdapter } from "./storage-contract";

/**
 * Resolved per-notebook access for one authenticated request.
 *
 * - `restricted: false` — the request is not notebook-scoped (interactive user
 *   sessions, and tokens created without a whitelist). Everything behaves
 *   exactly as before this feature existed.
 * - `restricted: true` — the request only reaches the whitelisted notebook
 *   subtrees. One access level applies to the whole list: "read" grants read
 *   only, "write" grants read and write. Notebooks not on the list —
 *   including newly created ones — are invisible.
 */
export type NotebookAccess = {
  restricted: boolean;
  readableNotebookIds: string[];
  writableNotebookIds: string[];
  /** True when the level is "write" (the token may create top-level notebooks). */
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
 *   narrow access instead of widening it.
 */
export const parseNotebookAccessJson = (value: string | null | undefined): TokenNotebookAccess[] | null => {
  if (value == null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const entries: TokenNotebookAccess[] = [];
    for (const item of parsed) {
      // Any invalid entry marks the whole record unusable: dropping it would
      // turn "malformed grant" into "no explicit grant". Fail closed instead.
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

/** Parses the stored `notebook_access_level` column. Unknown/null means "read". */
export const parseNotebookAccessLevel = (value: string | null | undefined): TokenNotebookAccessLevel =>
  value === "write" ? "write" : "read";

/**
 * True when a stored grant column is present but unusable (unparseable JSON
 * or not an array). Such a record must deny access entirely instead of
 * falling back to any default.
 */
export const isCorruptedNotebookAccess = (value: string | null | undefined): boolean => {
  if (value == null) return false;
  const entries = parseNotebookAccessJson(value);
  if (entries === null) return false;
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

/**
 * Resolves the effective notebook access for a request. `null` entries (every
 * token created before this feature, and interactive user sessions) stay
 * unrestricted. An empty array is a restricted token with no grants at all
 * (fail closed).
 *
 * One level applies to the whole whitelist: "read" grants read-only on every
 * granted subtree, "write" grants read and write. Notebooks not on the list
 * — including notebooks created after the token — are invisible.
 */
export const resolveNotebookAccess = async (
  db: DatabaseAdapter,
  workspaceId: string,
  entries: TokenNotebookAccess[] | null | undefined,
  level: TokenNotebookAccessLevel = "read",
): Promise<NotebookAccess> => {
  if (entries == null) {
    return UNRESTRICTED_NOTEBOOK_ACCESS;
  }

  // The tree is loaded once per request (ids + parents in a single query) and
  // the whitelist expanded in memory: a granted notebook opens its whole
  // live subtree, and a child listed alongside its parent adds nothing.
  const tree = await notebookTree(db, workspaceId);

  const readable: string[] = [];
  const writable: string[] = [];
  const open = (notebookId: string) => {
    if (!tree.parentByNotebook.has(notebookId)) return; // Not live.
    if (readable.includes(notebookId)) return; // Already expanded.
    readable.push(notebookId);
    if (level === "write") writable.push(notebookId);
    for (const [childId, parentId] of tree.parentByNotebook) {
      if (parentId === notebookId) open(childId);
    }
  };
  for (const entry of entries) open(entry.notebookId);

  return {
    restricted: true,
    readableNotebookIds: readable,
    writableNotebookIds: writable,
    defaultWrite: level === "write",
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

/**
 * Throws unless the notebook is accessible with the requested mode.
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

const hasNotebook = (access: NotebookAccess, kind: "read" | "write", notebookId: string) => {
  if (!access.restricted) return true;
  const ids = kind === "read" ? access.readableNotebookIds : access.writableNotebookIds;
  return ids.includes(notebookId);
};

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
  return resolveNotebookAccess(c.env.storage.db, auth.workspaceId, auth.notebookAccess, auth.notebookAccessLevel);
};
