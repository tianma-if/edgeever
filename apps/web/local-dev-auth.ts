import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const execute = promisify(execFile);
const apiUrl = "http://127.0.0.1:8787/api/v1/auth/session";
const createSession = async () => {
  const result = await execute("bun", ["scripts/local-dev.mjs", "auth-session", "local"], {
    cwd: new URL("../../", import.meta.url),
    timeout: 10000,
  });
  return JSON.parse(result.stdout) as { token: string; maxAge: number };
};

export const localDevelopmentAuth = (provisionSession = createSession): Plugin => ({
  name: "edgeever-local-development-auth",
  apply: "serve",
  configureServer(server) {
    // Only the persistent local profile may create sessions in local SQLite.
    // Plain dev:web, remote development, demo, and production never do this.
    if (process.env.EDGE_EVER_DEVELOPMENT_PROFILE !== "local"
      || process.env.EDGE_EVER_LOCAL_AUTO_LOGIN === "false") return;
    server.middlewares.use(async (request, response, next) => {
      const path = request.url?.split("?")[0];
      const logout = path === "/api/v1/auth/logout" && request.method === "POST";
      if (!logout && (path !== "/api/v1/auth/session" || request.method !== "GET")) return next();
      const host = request.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return next();
      if (request.headers.origin && request.headers.origin !== `http://${host}`) return next();
      if (request.headers["sec-fetch-site"] === "cross-site") return next();
      try {
        const headers = new Headers();
        if (request.headers.cookie) headers.set("Cookie", request.headers.cookie);
        if (request.headers.authorization) headers.set("Authorization", request.headers.authorization);
        if (logout) {
          const upstream = await fetch(apiUrl.replace(/session$/, "logout"), {
            method: "POST", headers, signal: AbortSignal.timeout(5000),
          });
          response.statusCode = upstream.status;
          response.setHeader("Set-Cookie", [
            ...upstream.headers.getSetCookie(),
            ...(upstream.ok ? ["edgeever_local_logged_out=1; Path=/; HttpOnly; SameSite=Lax"] : []),
          ]);
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(await upstream.text());
          return;
        }
        const current = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (!current.ok) return next();
        const session = await current.json() as { authRequired: boolean; authenticated: boolean };
        if (session.authenticated || request.headers.authorization) return next();
        // An explicit logout should still let developers test the login screen.
        if (request.headers.cookie?.includes("edgeever_local_logged_out=1")) return next();
        const { token, maxAge } = await provisionSession();
        const authenticated = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
        });
        if (!authenticated.ok) throw new Error(`Local session check failed: HTTP ${authenticated.status}`);
        const body = await authenticated.json() as { authRequired: boolean; authenticated: boolean };
        if (!body.authRequired || !body.authenticated) throw new Error("Local API did not accept the development session.");
        response.setHeader("Set-Cookie", `edgeever_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(body));
      } catch (error) {
        next(error);
      }
    });
  },
});
