import { expect, test } from "bun:test";
import { authenticateWorkBuddy, prepareWorkBuddyAuth } from "./workbuddy-auth.mjs";

const fixture = (responses, credentials = [null, "new-token"]) => {
  const calls = [];
  return {
    calls,
    readCredential: async () => credentials.shift(),
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return Response.json({ data: response });
    },
  };
};
const auth = { endpoint: "http://127.0.0.1:12345", password: "private-password" };

test("starts login without logout and waits for an authenticated account", async () => {
  const f = fixture([{ success: true }, { authenticated: false }, { authenticated: true, account: { userId: "user" } }]);
  await authenticateWorkBuddy(auth, "external", new AbortController().signal, { ...f, pollIntervalMs: 1 });
  expect(f.calls.map((call) => new URL(call.url).pathname)).toEqual([
    "/api/v1/auth/account/login", "/api/v1/auth/account/status", "/api/v1/auth/account/status",
  ]);
  expect(JSON.parse(f.calls[0].body)).toEqual({ method: "external" });
  expect(f.calls.every((call) => call.headers.Authorization === "Bearer private-password" && call.headers["x-codebuddy-request"] === "1" && call.redirect === "error")).toBe(true);
});

test("explicit login replaces a stale saved credential without logout", async () => {
  const f = fixture([{ success: true }, { authenticated: true, account: { userId: "saved-user" } }, { authenticated: true, account: { userId: "saved-user" } }], ["old-token", "old-token", "new-token"]);
  await authenticateWorkBuddy(auth, "external", new AbortController().signal, { ...f, pollIntervalMs: 1 });
  expect(f.calls.map((call) => new URL(call.url).pathname)).toEqual([
    "/api/v1/auth/account/login", "/api/v1/auth/account/status", "/api/v1/auth/account/status",
  ]);
});

test("a failed re-login is not masked by a saved authenticated account", async () => {
  const f = fixture([{ success: true }, { authenticated: true, account: { userId: "saved-user" }, loginError: "failed" }], ["old-token"]);
  await expect(authenticateWorkBuddy(auth, "external", new AbortController().signal, { ...f, pollIntervalMs: 1 })).rejects.toThrow("authentication_failed");
});

test("returns a swallowed or cancelled login failure before the overall timeout", async () => {
  const f = fixture([{ success: true }, { authenticated: false, loginError: "account.login.failed" }]);
  await expect(authenticateWorkBuddy(auth, "external", new AbortController().signal, { ...f, pollIntervalMs: 1 })).rejects.toThrow("authentication_failed");
});

test("does not treat an opened browser or an accountless status as login success", async () => {
  const f = fixture([{ success: true, authUrl: "https://example.com" }, { authenticated: true }, { loginError: "failed" }]);
  await expect(authenticateWorkBuddy(auth, "external", new AbortController().signal, { ...f, pollIntervalMs: 1 })).rejects.toThrow("authentication_failed");
});

test("stops pending polling when authentication times out", async () => {
  const f = fixture([{ success: true }]);
  const signal = AbortSignal.timeout(20);
  await expect(authenticateWorkBuddy(auth, "external", signal, { ...f, pollIntervalMs: 100 })).rejects.toThrow();
  expect(f.calls).toHaveLength(1);
});

test("fails closed when the installed CLI lacks the account API", async () => {
  await expect(authenticateWorkBuddy(auth, "external", new AbortController().signal, { readCredential: async () => null, fetchImpl: async () => new Response("unsupported", { status: 404 }) })).rejects.toThrow("workbuddy_auth_unavailable");
});

test("binds the login server to loopback with a fresh password and keeps the edition", async () => {
  const command = { command: "electron", args: ["codebuddy", "--acp"], env: { ELECTRON_RUN_AS_NODE: "1", CODEBUDDY_INTERNET_ENVIRONMENT: "internal" } };
  const first = await prepareWorkBuddyAuth(command);
  const second = await prepareWorkBuddyAuth(command);
  expect(first.password).not.toBe(second.password);
  expect(first.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(first.command.env.CODEBUDDY_GATEWAY_PASSWORD).toBe(first.password);
  expect(first.command.env.CODEBUDDY_GATEWAY_AUTH).toBe("password");
  expect(first.command.env.CODEBUDDY_INTERNET_ENVIRONMENT).toBe("internal");
  expect(first.command.args).toContain("stdio");
});
