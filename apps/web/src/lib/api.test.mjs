import { afterAll, describe, expect, test } from "bun:test";

const storage = new Map();
const calls = [];
const events = [];
let completeSave;
let secureSessionToken = "";
let failSecureSessionWrite = false;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

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
    await expect(saveDesktopApiBaseUrl("not-an-instance")).rejects.toThrow();

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

  test("uses the desktop session token and stops network retries after a 401", async () => {
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
      return new Response(JSON.stringify({ error: { code: "unauthorized", message: "Authentication required" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(api.syncBootstrap({ limit: 200 })).rejects.toMatchObject({ status: 401 });
    await expect(api.syncBootstrap({ limit: 200 })).rejects.toMatchObject({ status: 401 });

    expect(requests).toEqual([{
      url: "https://notes.example.com/api/v1/sync/bootstrap?limit=200",
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

  test("sends the disabled-by-default AI streaming preference and honors opt-in", async () => {
    const requestBodies = [];
    globalThis.fetch = async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response('data: {"type":"finish"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const payload = { action: "summarize", title: "Note", contentMarkdown: "Body" };

    storage.delete("edgeever.aiStreamingEnabled");
    await api.streamAiGeneration(payload, { onEvent: () => {} });
    storage.set("edgeever.aiStreamingEnabled", "true");
    await api.streamAiGeneration(payload, { onEvent: () => {} });
    await api.streamAiGeneration({ ...payload, stream: false }, { onEvent: () => {} });

    expect(requestBodies.map((body) => body.stream)).toEqual([false, true, false]);
  });
});
