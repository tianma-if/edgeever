import { afterAll, describe, expect, test } from "bun:test";

const storage = new Map();
const calls = [];
const events = [];
let completeSave;
let secureSessionToken = "";
let failSecureSessionWrite = false;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");

// Must be installed before importing modules that read `window` at load time.
globalThis.window = {
  location: { hostname: "notes.example.com", origin: "https://notes.example.com" },
  edgeeverDesktop: {
    isAvailable: true,
    apiBaseUrl: "",
    setApiBaseUrl: async (value) => {
      calls.push(["bridge:start", value]);
      if (!value) {
        calls.push(["bridge:complete", value]);
        return value;
      }
      await new Promise((resolve) => {
        completeSave = resolve;
      });
      calls.push(["bridge:complete", value]);
      return value;
    },
    getSessionToken: () => secureSessionToken,
    setSessionToken: async (value) => {
      if (failSecureSessionWrite) throw new Error("secure storage unavailable");
      secureSessionToken = value;
      return { stored: Boolean(value) };
    },
    clearSessionToken: async () => {
      secureSessionToken = "";
      return { stored: false };
    },
  },
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      calls.push(["storage", value]);
      storage.set(key, value);
    },
    removeItem: (key) => {
      storage.delete(key);
    },
  },
  dispatchEvent: (event) => {
    events.push(event.type);
    return true;
  },
};

afterAll(() => {
  if (originalFetch) {
    Object.defineProperty(globalThis, "fetch", originalFetch);
  } else {
    delete globalThis.fetch;
  }
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    delete globalThis.window;
  }
});

const {
  ApiRequestError,
  DESKTOP_API_BASE_URL_STORAGE_KEY,
  api,
  cacheDesktopSession,
  clearCachedDesktopSession,
  getConfiguredDesktopApiBaseUrl,
  getCachedDesktopSession,
  saveDesktopApiBaseUrl,
} = await import("./api.ts");

describe("desktop instance setup", () => {
  test("can retry with a valid URL after invalid input", async () => {
    await expect(saveDesktopApiBaseUrl("ftp://example.com")).rejects.toThrow();

    const saving = saveDesktopApiBaseUrl(" https://notes.example.com/ ");
    await Promise.resolve();
    expect(calls).toEqual([["bridge:start", "https://notes.example.com"]]);
    expect(storage.has(DESKTOP_API_BASE_URL_STORAGE_KEY)).toBe(false);

    completeSave();
    await expect(saving).resolves.toBe("https://notes.example.com");
    expect(calls).toEqual([
      ["bridge:start", "https://notes.example.com"],
      ["bridge:complete", "https://notes.example.com"],
      ["storage", "https://notes.example.com"],
    ]);
    expect(storage.get(DESKTOP_API_BASE_URL_STORAGE_KEY)).toBe("https://notes.example.com");
  });

  test("maps the App Review demo alias to the public instance", async () => {
    calls.length = 0;
    const saving = saveDesktopApiBaseUrl("demo");
    await Promise.resolve();
    expect(calls).toEqual([["bridge:start", "https://demo.edgeever.org"]]);
    completeSave();
    await expect(saving).resolves.toBe("https://demo.edgeever.org");
  });

  test("prefixes https when the instance host has no protocol", async () => {
    calls.length = 0;
    const saving = saveDesktopApiBaseUrl(" example.workers.dev/ ");
    await Promise.resolve();
    expect(calls).toEqual([["bridge:start", "https://example.workers.dev"]]);
    completeSave();
    await expect(saving).resolves.toBe("https://example.workers.dev");
    expect(storage.get(DESKTOP_API_BASE_URL_STORAGE_KEY)).toBe("https://example.workers.dev");
  });

  test("keeps an explicit http instance URL", async () => {
    calls.length = 0;
    const saving = saveDesktopApiBaseUrl("http://127.0.0.1:8787/");
    await Promise.resolve();
    expect(calls).toEqual([["bridge:start", "http://127.0.0.1:8787"]]);
    completeSave();
    await expect(saving).resolves.toBe("http://127.0.0.1:8787");
  });

  test("clears the cached session when the login form changes instances", async () => {
    calls.length = 0;
    window.edgeeverDesktop.apiBaseUrl = "https://notes.example.com";
    storage.set(DESKTOP_API_BASE_URL_STORAGE_KEY, "https://notes.example.com");
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "old-instance-session",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });
    calls.length = 0;

    const saving = saveDesktopApiBaseUrl("https://other.example.com");
    await Promise.resolve();

    expect(getCachedDesktopSession()).toBeNull();
    expect(calls).toEqual([
      ["bridge:start", "https://other.example.com"],
    ]);

    completeSave();
    await expect(saving).resolves.toBe("https://other.example.com");
    expect(storage.get(DESKTOP_API_BASE_URL_STORAGE_KEY)).toBe("https://other.example.com");
    expect(getConfiguredDesktopApiBaseUrl()).toBe("https://other.example.com");
    window.edgeeverDesktop.apiBaseUrl = "";
  });

  test("ignores a leftover desktop instance URL in the browser", () => {
    storage.set(DESKTOP_API_BASE_URL_STORAGE_KEY, "https://example.workers.dev");
    window.edgeeverDesktop.isAvailable = false;
    expect(getConfiguredDesktopApiBaseUrl()).toBe("");
    window.edgeeverDesktop.isAvailable = true;
    expect(getConfiguredDesktopApiBaseUrl()).toBe("https://example.workers.dev");
  });

  test("preserves the desktop token when refreshing the same authenticated session", async () => {
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "desktop-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });

    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      user: { id: "user-1", username: "admin", displayName: "Owner", role: "owner" },
    });

    expect(getCachedDesktopSession()).toEqual({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      user: { id: "user-1", username: "admin", displayName: "Owner", role: "owner" },
    });
  });

  test("does not carry a desktop token into a different account session", async () => {
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "user-1-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });

    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      user: { id: "user-2", username: "member", displayName: null, role: "member" },
    });

    expect(getCachedDesktopSession()?.sessionToken).toBeUndefined();
  });

  test("migrates a legacy localStorage token into desktop secure storage", async () => {
    clearCachedDesktopSession();
    await Promise.resolve();
    storage.set("edgeever.desktop.session", JSON.stringify({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "legacy-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    }));

    const requests = [];
    globalThis.fetch = async (_url, init) => {
      requests.push(new Headers(init?.headers).get("Authorization"));
      return Response.json({
        authRequired: true,
        authenticated: true,
        demoMode: false,
        user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
      });
    };

    const session = await api.getSession();
    await cacheDesktopSession(session);

    expect(requests).toEqual(["Bearer legacy-session-token"]);
    expect(secureSessionToken).toBe("legacy-session-token");
    expect(getCachedDesktopSession()?.sessionToken).toBeUndefined();
  });

  test("keeps a localStorage fallback when secure token persistence fails", async () => {
    failSecureSessionWrite = true;
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "fallback-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });
    failSecureSessionWrite = false;

    expect(getCachedDesktopSession()?.sessionToken).toBe("fallback-session-token");
  });

  test("keeps secure credentials out of unauthenticated session snapshots", async () => {
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "desktop-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });
    await Promise.resolve();

    await cacheDesktopSession({
      authRequired: true,
      authenticated: false,
      demoMode: false,
      user: null,
    });

    expect(secureSessionToken).toBe("desktop-session-token");
    expect(getCachedDesktopSession()).toEqual({
      authRequired: true,
      authenticated: false,
      demoMode: false,
      user: null,
    });
  });

  test("clears a secure token only after the server rejects that exact credential", async () => {
    events.length = 0;
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "rejected-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });
    await Promise.resolve();

    globalThis.fetch = async () => Response.json({
      authRequired: true,
      authenticated: false,
      demoMode: false,
      user: null,
    });

    await expect(api.getSession()).resolves.toMatchObject({ authenticated: false });
    await Promise.resolve();
    expect(secureSessionToken).toBe("");
    expect(events).toEqual(["edgeever:unauthorized"]);

    globalThis.fetch = async () => Response.json({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "replacement-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });
    await cacheDesktopSession(await api.login({ username: "admin", password: "secret" }));
  });

  test("keeps the desktop session after a route-specific 401", async () => {
    events.length = 0;
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "desktop-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });

    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
      if (String(url).endsWith("/api/v1/auth/session")) {
        return Response.json({ authRequired: true, authenticated: true, demoMode: false, user: { id: "user-1" } });
      }
      if (String(url).endsWith("/api/v1/auth/sessions")) return Response.json({ sessions: [] });
      return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
    };

    await expect(api.changePassword({
      currentPassword: "old-password",
      newPassword: "new-password",
      confirmPassword: "new-password",
    })).rejects.toMatchObject({ status: 401 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(api.listLoginDeviceSessions()).resolves.toEqual({ sessions: [] });

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/api/v1/auth/change-password",
      "/api/v1/auth/session",
      "/api/v1/auth/sessions",
    ]);
    expect(requests.every(({ authorization }) => authorization === "Bearer desktop-session-token")).toBe(true);
    expect(secureSessionToken).toBe("desktop-session-token");
    expect(events).toEqual([]);
  });

  test("uses the desktop session token and stops network retries after a confirmed 401", async () => {
    calls.length = 0;
    events.length = 0;
    storage.set(DESKTOP_API_BASE_URL_STORAGE_KEY, "https://notes.example.com");
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "desktop-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });

    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
      if (String(url).endsWith("/api/v1/auth/session")) {
        return Response.json({ authRequired: true, authenticated: false, demoMode: false, user: null });
      }
      return new Response(JSON.stringify({ error: { code: "unauthorized", message: "Authentication required" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(api.syncBootstrap({ limit: 200 })).rejects.toMatchObject({ status: 401 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(api.syncBootstrap({ limit: 200 })).rejects.toMatchObject({ status: 401 });

    expect(requests).toEqual([{
      url: "https://notes.example.com/api/v1/sync/bootstrap?limit=200",
      authorization: "Bearer desktop-session-token",
    }, {
      url: "https://notes.example.com/api/v1/auth/session",
      authorization: "Bearer desktop-session-token",
    }]);
    expect(events).toEqual(["edgeever:unauthorized"]);
    expect(getCachedDesktopSession()).toBeNull();

    globalThis.fetch = async (url, init) => {
      requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
      return Response.json({
        authRequired: true,
        authenticated: true,
        demoMode: false,
        sessionToken: "replacement-session-token",
        user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
      });
    };

    const replacement = await api.login({ username: "admin", password: "secret" });
    await cacheDesktopSession(replacement);
    await api.syncBootstrap({ limit: 200 });

    expect(requests.at(-1)).toEqual({
      url: "https://notes.example.com/api/v1/sync/bootstrap?limit=200",
      authorization: "Bearer replacement-session-token",
    });
  });

  test("does not clear a replacement session when an older desktop token is rejected late", async () => {
    events.length = 0;
    storage.set(DESKTOP_API_BASE_URL_STORAGE_KEY, "https://notes.example.com");
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "stale-session-token",
      user: { id: "user-1", username: "admin", displayName: null, role: "owner" },
    });

    let releaseRequest;
    globalThis.fetch = async () => {
      await new Promise((resolve) => {
        releaseRequest = resolve;
      });
      return new Response(JSON.stringify({ error: { code: "unauthorized", message: "Authentication required" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    const staleRequest = api.syncBootstrap({ limit: 200 });
    await Promise.resolve();
    await cacheDesktopSession({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      sessionToken: "current-session-token",
      user: { id: "user-1", username: "admin", displayName: "Owner", role: "owner" },
    });
    releaseRequest();

    await expect(staleRequest).rejects.toMatchObject({ status: 401 });
    await Promise.resolve();
    expect(secureSessionToken).toBe("current-session-token");
    expect(getCachedDesktopSession()).toMatchObject({ authenticated: true, user: { id: "user-1" } });
    expect(events).toEqual([]);
  });

  test("preserves Cloudflare response diagnostics for login failures", async () => {
    globalThis.fetch = async () => new Response("<html>challenge</html>", {
      status: 403,
      headers: {
        "CF-Mitigated": "challenge",
        "CF-Ray": "abc123-SJC",
        "Content-Type": "text/html",
      },
    });

    try {
      await api.login({ username: "admin", password: "secret" });
      throw new Error("Expected login to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        status: 403,
        responseDiagnostics: {
          cloudflareMitigated: true,
          isEdgeEverApiError: false,
          rayId: "abc123-SJC",
        },
      });
    }
  });

  test("does not opt the web proxy into AI streaming", async () => {
    const requestBodies = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/api/v1/ai/direct-target")) {
        return new Response("{}", { status: 404 });
      }
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response('data: {"type":"finish"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    await api.streamAiGeneration(
      { action: "summarize", title: "Note", contentMarkdown: "Body" },
      { onEvent: () => {} },
    );

    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0].stream).toBeUndefined();
  });

  test("streams infographic agent tool events through the authenticated client", async () => {
    let requestPath = "";
    let requestBody;
    globalThis.fetch = async (url, init) => {
      requestPath = String(url);
      requestBody = JSON.parse(String(init?.body));
      return new Response('data: {"type":"proposal","template":"list-grid-simple","data":{"title":"示例","lists":[{"label":"A"}]},"explanation":"已创建"}\n\ndata: {"type":"finish"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const received = [];
    await api.streamInfographicAgent({ prompt: "做个列表", currentContent: "", candidates: ["list-grid-simple"], history: [] }, { onEvent: (event) => received.push(event) });
    expect(requestPath).toContain("/api/v1/ai/infographic-agent");
    expect(requestBody.prompt).toBe("做个列表");
    expect(received.map((event) => event.type)).toEqual(["proposal", "finish"]);
  });
});
