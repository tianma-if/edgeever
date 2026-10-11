import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export async function prepareWorkBuddyAuth(command) {
  const server = createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const password = randomUUID();
  return {
    command: {
      ...command,
      args: [...command.args, "--serve", "--acp-transport", "stdio", "--host", "127.0.0.1", "--port", String(port)],
      env: { ...command.env, SERVER__HOST: "127.0.0.1", SERVER__PORT: String(port), CODEBUDDY_GATEWAY_AUTH: "password", CODEBUDDY_GATEWAY_PASSWORD: password },
    },
    endpoint: `http://127.0.0.1:${port}`,
    password,
  };
}

// WorkBuddy's ACP authenticate handler ignores login() returning false and then
// waits forever for a session. Its local account API reports that failure and
// starts login without first logging out (which can cancel login via its watcher).
export async function authenticateWorkBuddy({ endpoint, password }, methodId, signal, { fetchImpl = fetch, pollIntervalMs = 500, readCredential } = {}) {
  const request = async (route, body) => {
    const response = await fetchImpl(`${endpoint}/api/v1/auth/account/${route}`, {
      method: body ? "POST" : "GET",
      headers: { "x-codebuddy-request": "1", Authorization: `Bearer ${password}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      redirect: "error",
    });
    if (!response.ok) throw new Error("workbuddy_auth_unavailable");
    const result = (await response.json())?.data;
    if (!result || typeof result !== "object") throw new Error("workbuddy_auth_unavailable");
    return result;
  };
  const signedIn = (status) => status.authenticated === true && typeof status.account?.userId === "string" && Boolean(status.account.userId);
  // A saved account can contain an expired token. An explicit login must start
  // a new flow, and the old account must not satisfy polling while it is open.
  if (typeof readCredential !== "function") throw new Error("workbuddy_auth_unavailable");
  const previousCredential = await readCredential();
  const started = await request("login", { method: methodId });
  if (started.loginError || started.success !== true) throw new Error("authentication_failed");
  for (;;) {
    await delay(pollIntervalMs, undefined, { signal });
    const status = await request("status");
    if (status.loginError) throw new Error("authentication_failed");
    if (signedIn(status)) {
      const credential = await readCredential();
      if (credential && credential !== previousCredential) return;
    }
  }
}
