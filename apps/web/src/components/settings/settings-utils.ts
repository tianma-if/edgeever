import type { TFunction } from "i18next";
import type { Notebook, TokenNotebookAccess, TokenNotebookDefaultAccess } from "@edgeever/shared";
import { getConfiguredDesktopApiBaseUrl } from "@/lib/api";
export { copyTextToClipboard } from "@/lib/clipboard";

export const ALL_TOKEN_SCOPES = [
  "read:notebooks",
  "write:notebooks",
  "read:memos",
  "write:memos",
  "read:resources",
  "write:resources",
  "read:tags",
  "write:tags",
  "ai:generate",
];

// Tokens issued before video-note summaries keep this set. They stay labeled
// full and do not gain ai:generate until the user creates a new token.
export const PREVIOUS_FULL_TOKEN_SCOPES = [
  "read:notebooks",
  "write:notebooks",
  "read:memos",
  "write:memos",
  "read:resources",
  "write:resources",
  "read:tags",
  "write:tags",
];

export type TokenAccessLevel = "full" | "read-only" | "custom";
export type StoredTokenAccessLevel = TokenAccessLevel | "legacy-custom";
export const DEFAULT_TOKEN_ACCESS_LEVEL: TokenAccessLevel = "full";

const padDatePart = (value: number) => String(value).padStart(2, "0");

const createFourDigitSuffix = () => {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  return 1000 + (values[0] % 9000);
};

export const createDefaultTokenName = (
  date: Date = new Date(),
  randomSuffix: number = createFourDigitSuffix(),
) => {
  const timestamp = [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
  ].join("");

  return `Token-${timestamp}-${String(randomSuffix).padStart(4, "0")}`;
};

const sameScopes = (left: string[], right: string[]) => {
  const leftScopes = new Set(left);
  const rightScopes = new Set(right);
  return leftScopes.size === rightScopes.size && [...leftScopes].every((scope) => rightScopes.has(scope));
};

export const getTokenScopesForAccessLevel = (
  accessLevel: TokenAccessLevel,
  availableScopes: string[] = ALL_TOKEN_SCOPES,
) => accessLevel === "read-only"
  ? availableScopes.filter((scope) => scope.startsWith("read:"))
  : [...availableScopes];

export const getStoredTokenAccessLevel = (
  scopes: string[],
  availableScopes: string[] = ALL_TOKEN_SCOPES,
  notebookAccess?: TokenNotebookAccess[] | null,
): StoredTokenAccessLevel => {
  // A notebook-scoped token is always "custom", whatever its global scopes.
  if (notebookAccess && notebookAccess.length > 0) {
    return "custom";
  }

  if (
    sameScopes(scopes, getTokenScopesForAccessLevel("full", availableScopes))
    || sameScopes(scopes, PREVIOUS_FULL_TOKEN_SCOPES)
  ) {
    return "full";
  }

  if (sameScopes(scopes, getTokenScopesForAccessLevel("read-only", availableScopes))) {
    return "read-only";
  }

  return "legacy-custom";
};

// --- Per-notebook grant editor draft ---------------------------------------

export type NotebookGrantDraft = {
  /** "all" = unrestricted (notebookAccess omitted); "selected" = per-notebook grants. */
  mode: "all" | "selected";
  /** notebookId → grant. Only notebooks with a grant are sent to the server. */
  grants: Record<string, { read: boolean; write: boolean }>;
  /** Access for notebooks without an explicit grant (notably new ones). */
  defaultAccess: TokenNotebookDefaultAccess;
};

export const emptyNotebookGrantDraft = (): NotebookGrantDraft => ({ mode: "all", grants: {}, defaultAccess: "none" });

export const notebookAccessToDraft = (
  notebookAccess: TokenNotebookAccess[] | null | undefined,
  notebookDefaultAccess: TokenNotebookDefaultAccess | undefined,
): NotebookGrantDraft => {
  if (!notebookAccess || notebookAccess.length === 0) {
    return emptyNotebookGrantDraft();
  }
  const grants: NotebookGrantDraft["grants"] = {};
  for (const entry of notebookAccess) {
    grants[entry.notebookId] = { read: entry.read, write: entry.write };
  }
  return { mode: "selected", grants, defaultAccess: notebookDefaultAccess ?? "none" };
};

export const draftToNotebookAccess = (draft: NotebookGrantDraft): TokenNotebookAccess[] | undefined => {
  if (draft.mode !== "selected") {
    return undefined;
  }
  return Object.entries(draft.grants)
    .filter(([, grant]) => grant.read || grant.write)
    .map(([notebookId, grant]) => ({ notebookId, read: grant.read, write: grant.write }));
};

/** Flattened notebook tree rows (parent before children) for the grant picker. */
export type NotebookTreeRow = {
  notebook: Notebook;
  depth: number;
};

export const buildNotebookTreeRows = (notebooks: Notebook[]): NotebookTreeRow[] => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const childrenByParent = new Map<string | null, Notebook[]>();
  for (const notebook of notebooks) {
    const parentId = notebook.parentId && byId.has(notebook.parentId) ? notebook.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(notebook);
    childrenByParent.set(parentId, siblings);
  }

  const rows: NotebookTreeRow[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const notebook of childrenByParent.get(parentId) ?? []) {
      rows.push({ notebook, depth });
      visit(notebook.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
};

/** Human summary of a stored token's notebook grants, e.g. "2 notebooks · read". */
export const describeNotebookAccess = (
  notebookAccess: TokenNotebookAccess[] | null | undefined,
  notebooksById: ReadonlyMap<string, Notebook>,
): string[] => {
  if (!notebookAccess || notebookAccess.length === 0) {
    return [];
  }
  return notebookAccess.map((entry) => {
    const name = notebooksById.get(entry.notebookId)?.name ?? entry.notebookId;
    const mode = entry.write ? "read/write" : entry.read ? "read" : "none";
    return `${name} (${mode})`;
  });
};

export const getTokenScopeLabel = (scope: string, t: TFunction) => t(`mcp.scopes.${scope}`, { defaultValue: scope });

export const EDGE_EVER_SERVER_URL_PLACEHOLDER = "https://your-edgeever-server";

// MCP clients connect to the EdgeEver server, not to the page that shows the
// settings. In the browser that is the page origin; the desktop renderer runs
// on its own app origin (`edgeever-app://app`), so it uses the configured
// instance URL and shows a placeholder until one is set.
export const getEdgeEverBaseUrl = () => {
  if (typeof window === "undefined") {
    return EDGE_EVER_SERVER_URL_PLACEHOLDER;
  }

  if (window.edgeeverDesktop?.isAvailable) {
    return getConfiguredDesktopApiBaseUrl().replace(/\/+$/, "") || EDGE_EVER_SERVER_URL_PLACEHOLDER;
  }

  return window.location.origin;
};

export const getMcpRemoteServerUrl = () => `${getEdgeEverBaseUrl()}/mcp`;

export const buildMcpRemoteConfig = (token: string) =>
  JSON.stringify(
    {
      mcpServers: {
        edgeever: {
          url: getMcpRemoteServerUrl(),
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2
  );
