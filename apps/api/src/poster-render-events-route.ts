import {
  POSTER_RENDER_EVENTS_PATH,
  POSTER_RENDER_EVENTS_PROTOCOL,
  POSTER_RENDER_SESSION_PROTOCOL_PREFIX,
} from "@edgeever/shared/poster-render-events";
import { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { authenticateSession, authenticateSessionToken, getInstanceAuthMode } from "./auth-service";
import { apiError, authNotConfigured, forbidden, unauthorized } from "./http-errors";
import { DEFAULT_WORKSPACE_ID } from "./workspace-provisioning";

// Keep upgrades out of HTTP CORS middleware, which can rebuild the 101 response.
export const posterRenderEventsApp = new Hono<AppEnv>();
posterRenderEventsApp.get(POSTER_RENDER_EVENTS_PATH, async (c) => {
  const connect = c.env.connectPosterRenderEvents;
  if (!connect) return apiError(c, "poster_events_unavailable", "Poster render notifications are unavailable.", 503);
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.text("WebSocket upgrade required.", 426);
  }

  const protocols = c.req.header("Sec-WebSocket-Protocol")?.split(",").map((value) => value.trim()) ?? [];
  if (!protocols.includes(POSTER_RENDER_EVENTS_PROTOCOL)) return c.text("Unsupported WebSocket protocol.", 400);
  const token = protocols.find((value) => value.startsWith(POSTER_RENDER_SESSION_PROTOCOL_PREFIX))
    ?.slice(POSTER_RENDER_SESSION_PROTOCOL_PREFIX.length);
  const origin = c.req.header("Origin");
  const url = new URL(c.req.url);
  const sameOrigin = origin === url.origin
    || (c.req.header("X-Forwarded-Proto") === "https" && origin === `https://${url.host}`);
  const desktopOrigin = origin === "edgeever-app://app" || (Boolean(token) && (
    origin === "null" || origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173"
  ));
  if (!sameOrigin && !desktopOrigin) return forbidden(c, "Unexpected WebSocket origin.");

  const mode = await getInstanceAuthMode(c.env);
  if (mode === "unconfigured") return authNotConfigured(c);
  if (mode === "disabled") return connect(c.req.raw, DEFAULT_WORKSPACE_ID);

  // Cross-origin desktop connections use an explicit session, never cookies.
  // The upgrade response selects only the public protocol, never the token.
  const auth = token && /^[A-Za-z0-9_-]{1,128}$/.test(token)
    ? await authenticateSessionToken(c, token, false)
    : sameOrigin ? await authenticateSession(c, false) : null;
  if (!auth) return unauthorized(c, "Authentication required.");
  if (auth.mfaRestricted) return forbidden(c, "Bind a new authenticator to finish signing in.");
  return connect(c.req.raw, auth.workspaceId);
});
