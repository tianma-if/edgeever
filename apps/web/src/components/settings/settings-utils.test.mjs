import { afterEach, describe, expect, test } from "bun:test";
import {
  ALL_TOKEN_SCOPES,
  buildMcpRemoteConfig,
  buildNotebookTreeRows,
  describeNotebookAccess,
  draftToNotebookAccess,
  EDGE_EVER_SERVER_URL_PLACEHOLDER,
  emptyNotebookGrantDraft,
  getEdgeEverBaseUrl,
  getMcpRemoteServerUrl,
  createDefaultTokenName,
  DEFAULT_TOKEN_ACCESS_LEVEL,
  getStoredTokenAccessLevel,
  getTokenScopesForAccessLevel,
  notebookAccessToDraft,
} from "./settings-utils.ts";

const READ_ONLY_SCOPES = [
  "read:notebooks",
  "read:memos",
  "read:resources",
  "read:tags",
];

describe("API token access levels", () => {
  test("creates timestamped default token names with a four-digit suffix", () => {
    const date = new Date(2026, 7, 11, 9, 8, 7);
    expect(createDefaultTokenName(date, 4827)).toBe("Token-20260811090807-4827");
  });

  test("defaults new tokens to full access", () => {
    expect(DEFAULT_TOKEN_ACCESS_LEVEL).toBe("full");
    expect(getTokenScopesForAccessLevel(DEFAULT_TOKEN_ACCESS_LEVEL)).toEqual(ALL_TOKEN_SCOPES);
  });

  test("maps read-only access to every readable workspace resource", () => {
    expect(getTokenScopesForAccessLevel("read-only")).toEqual(READ_ONLY_SCOPES);
  });

  test("summarizes standard and legacy scope sets without broadening old tokens", () => {
    expect(getStoredTokenAccessLevel([...ALL_TOKEN_SCOPES].reverse())).toBe("full");
    expect(getStoredTokenAccessLevel([...READ_ONLY_SCOPES].reverse())).toBe("read-only");
    expect(getStoredTokenAccessLevel(["read:memos", "write:memos"])).toBe("legacy-custom");
    expect(getTokenScopesForAccessLevel("full")).toContain("ai:generate");
    expect(getTokenScopesForAccessLevel("read-only")).not.toContain("ai:generate");
    expect(getStoredTokenAccessLevel([
      "read:notebooks",
      "write:notebooks",
      "read:memos",
      "write:memos",
      "read:resources",
      "write:resources",
      "read:tags",
      "write:tags",
    ])).toBe("full");
  });
});

describe("notebook whitelist editor draft", () => {
  test("an unrestricted token loads as all-mode; a whitelist loads as selected", () => {
    expect(notebookAccessToDraft(null, undefined)).toEqual({ mode: "all", grantedIds: [], level: "read" });
    expect(notebookAccessToDraft(undefined, "write")).toEqual({ mode: "all", grantedIds: [], level: "read" });
    // An empty whitelist is still restricted: selected-with-nothing, not all.
    expect(notebookAccessToDraft([], "read")).toEqual({ mode: "selected", grantedIds: [], level: "read" });
    expect(notebookAccessToDraft(
      [{ notebookId: "nb_a", read: true, write: true }],
      "write",
    )).toEqual({ mode: "selected", grantedIds: ["nb_a"], level: "write" });
  });

  test("all-mode serializes to undefined (unrestricted); selected serializes to a whitelist", () => {
    expect(draftToNotebookAccess({ mode: "all", grantedIds: ["nb_a"], level: "write" })).toBeUndefined();
    expect(draftToNotebookAccess({ mode: "selected", grantedIds: [], level: "read" })).toEqual([]);
    expect(draftToNotebookAccess({ mode: "selected", grantedIds: ["nb_a", "nb_b"], level: "read" })).toEqual([
      { notebookId: "nb_a", read: true, write: false },
      { notebookId: "nb_b", read: true, write: false },
    ]);
    expect(draftToNotebookAccess({ mode: "selected", grantedIds: ["nb_a"], level: "write" })).toEqual([
      { notebookId: "nb_a", read: true, write: true },
    ]);
  });

  test("a checked notebook commits the draft to selected so creation is never stuck", () => {
    // Regression: the editor must flip mode to "selected" on any interaction,
    // otherwise serialization returns undefined and the create button stays
    // disabled even after checking notebooks.
    const start = emptyNotebookGrantDraft(); // all-mode
    const toggled = { ...start, mode: "selected", grantedIds: ["nb_a"] };
    expect(draftToNotebookAccess(toggled)).toEqual([{ notebookId: "nb_a", read: true, write: false }]);
    // Clearing back to zero grants still yields a savable empty whitelist.
    const cleared = { ...toggled, grantedIds: [] };
    expect(draftToNotebookAccess(cleared)).toEqual([]);
  });

  test("whitelist round-trips through draft and back without losing ids or level", () => {
    const stored = [
      { notebookId: "nb_a", read: true, write: true },
      { notebookId: "nb_b", read: true, write: true },
    ];
    const draft = notebookAccessToDraft(stored, "write");
    expect(draftToNotebookAccess(draft)).toEqual(stored);
  });

  test("a notebook-restricted token is always classified custom regardless of scopes", () => {
    expect(getStoredTokenAccessLevel(ALL_TOKEN_SCOPES, ALL_TOKEN_SCOPES, [])).toBe("custom");
    expect(getStoredTokenAccessLevel(ALL_TOKEN_SCOPES, ALL_TOKEN_SCOPES, [{ notebookId: "nb_a", read: true, write: false }])).toBe("custom");
    // Unrestricted tokens keep their scope-based classification.
    expect(getStoredTokenAccessLevel(ALL_TOKEN_SCOPES, ALL_TOKEN_SCOPES, null)).toBe("full");
    expect(getStoredTokenAccessLevel(READ_ONLY_SCOPES, ALL_TOKEN_SCOPES, null)).toBe("read-only");
  });
});

describe("notebook tree rows and whitelist summary", () => {
  const notebook = (id, parentId = null) => ({ id, parentId, name: `Name-${id}` });

  test("flattens parents before children with correct depth", () => {
    const rows = buildNotebookTreeRows([
      notebook("child", "root"),
      notebook("root"),
      notebook("grandchild", "child"),
      notebook("other"),
    ]);
    expect(rows.map(({ notebook, depth }) => [notebook.id, depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
      ["other", 0],
    ]);
  });

  test("treats a child whose parent is missing as a root", () => {
    const rows = buildNotebookTreeRows([notebook("orphan", "gone")]);
    expect(rows.map(({ notebook, depth }) => [notebook.id, depth])).toEqual([["orphan", 0]]);
  });

  test("summarizes a whitelist by notebook name, falling back to the id", () => {
    const byId = new Map([["nb_a", notebook("nb_a")]]);
    expect(describeNotebookAccess([{ notebookId: "nb_a", read: true, write: false }, { notebookId: "nb_z", read: true, write: false }], byId))
      .toEqual(["Name-nb_a", "nb_z"]);
    expect(describeNotebookAccess([], byId)).toEqual([]);
    expect(describeNotebookAccess(null, byId)).toEqual([]);
  });
});

describe("MCP server address", () => {
  const previousWindow = globalThis.window;
  afterEach(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const installWindow = ({ origin, desktop, savedUrl = "" }) => {
    const storage = new Map(savedUrl ? [["edgeever.desktop.api-base-url", savedUrl]] : []);
    globalThis.window = {
      location: { origin },
      localStorage: { getItem: (key) => storage.get(key) ?? null },
      edgeeverDesktop: desktop,
    };
  };

  test("uses the page origin in the browser", () => {
    installWindow({ origin: "https://notes.example" });
    expect(getEdgeEverBaseUrl()).toBe("https://notes.example");
    expect(getMcpRemoteServerUrl()).toBe("https://notes.example/mcp");
  });

  test("uses the configured instance on desktop instead of the app origin", () => {
    installWindow({
      origin: "edgeever-app://app",
      desktop: { isAvailable: true, apiBaseUrl: "https://bridge.example" },
      savedUrl: "https://ever.example//",
    });
    expect(getMcpRemoteServerUrl()).toBe("https://ever.example/mcp");
    expect(JSON.parse(buildMcpRemoteConfig("eev_token"))).toEqual({
      mcpServers: {
        edgeever: {
          url: "https://ever.example/mcp",
          headers: { Authorization: "Bearer eev_token" },
        },
      },
    });
  });

  test("falls back to the desktop bridge URL when nothing is saved", () => {
    installWindow({ origin: "edgeever-app://app", desktop: { isAvailable: true, apiBaseUrl: "https://bridge.example/" } });
    expect(getMcpRemoteServerUrl()).toBe("https://bridge.example/mcp");
  });

  test("shows a placeholder on desktop without a configured server", () => {
    installWindow({ origin: "edgeever-app://app", desktop: { isAvailable: true, apiBaseUrl: "" } });
    expect(getMcpRemoteServerUrl()).toBe(`${EDGE_EVER_SERVER_URL_PLACEHOLDER}/mcp`);
    expect(getMcpRemoteServerUrl()).not.toContain("edgeever-app:");
  });

  test("shows a placeholder outside a browser", () => {
    delete globalThis.window;
    expect(getMcpRemoteServerUrl()).toBe(`${EDGE_EVER_SERVER_URL_PLACEHOLDER}/mcp`);
  });
});
