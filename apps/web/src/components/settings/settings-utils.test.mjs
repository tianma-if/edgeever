import { afterEach, describe, expect, test } from "bun:test";
import {
  ALL_TOKEN_SCOPES,
  buildMcpRemoteConfig,
  EDGE_EVER_SERVER_URL_PLACEHOLDER,
  getEdgeEverBaseUrl,
  getMcpRemoteServerUrl,
  createDefaultTokenName,
  DEFAULT_TOKEN_ACCESS_LEVEL,
  getStoredTokenAccessLevel,
  getTokenScopesForAccessLevel,
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
