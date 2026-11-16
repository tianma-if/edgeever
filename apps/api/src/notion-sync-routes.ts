import {
  NotionSyncConnectionTestSchema,
  NotionSyncRunBatchSchema,
  NotionSyncSettingsUpdateSchema,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { apiError, badRequest, notFound } from "./http-errors";
import { decryptNotionSecret, verifyNotionWebhookSignature } from "./notion-sync-crypto";
import {
  deleteNotionSyncSettings,
  getConfigRowByWebhookChannelToken,
  getNotionSyncSettings,
  handleIncomingNotionWebhookEvent,
  promotePendingNotionVerificationToken,
  rotateNotionWebhookChannel,
  runNotionSyncBatch,
  storePendingNotionVerificationToken,
  testNotionSyncConnection,
  upsertNotionSyncSettings,
} from "./notion-sync-service";
import { getWorkspaceId, requireOwner } from "./request-auth";

const respondWithAppError = (c: AppContext, error: unknown) => {
  if (error instanceof AppError) {
    return apiError(c, error.code, error.message, error.status);
  }
  throw error;
};

export const registerPublicNotionWebhookRoutes = (
  app: Hono<AppEnv>,
  dependencies: { isDemoMode: (env: Bindings) => boolean },
) => {
  app.post(
    "/api/public/webhooks/notion/:channelToken",
    bodyLimit({ maxSize: 512_000 }),
    async (c) => {
      if (dependencies.isDemoMode(c.env)) {
        return apiError(c, "demo_mode_disabled", "Notion webhooks are disabled in demo mode.", 403);
      }

      const channelToken = c.req.param("channelToken").trim();
      if (!channelToken) {
        return notFound(c, "Webhook endpoint not found.");
      }

      const configRow = await getConfigRowByWebhookChannelToken(c.env.storage.db, channelToken);
      if (!configRow) {
        return notFound(c, "Webhook endpoint not found.");
      }

      const rawBody = await c.req.text();
      let payload: {
        verification_token?: unknown;
        id?: string;
        type?: string;
        authors?: Array<{ id?: string; type?: string }>;
        entity?: { id?: string; type?: string };
      };
      try {
        payload = JSON.parse(rawBody) as typeof payload;
      } catch {
        return badRequest(c, "Invalid JSON webhook payload.");
      }

      if (
        typeof payload.verification_token === "string"
        && payload.verification_token.trim().length > 0
        && !payload.type
      ) {
        await storePendingNotionVerificationToken(
          c.env.storage.db,
          configRow.workspace_id,
          payload.verification_token.trim(),
          c.env,
        );
        return c.json({ ok: true, handshake: true });
      }

      const signatureHeader = c.req.header("x-notion-signature");
      const activeSecret = await decryptNotionSecret(
        configRow.webhook_secret_encrypted,
        configRow.workspace_id,
        c.env,
      );
      const pendingSecret = await decryptNotionSecret(
        configRow.pending_verification_token_encrypted,
        configRow.workspace_id,
        c.env,
      );

      let verified = false;
      if (activeSecret?.value) {
        verified = await verifyNotionWebhookSignature(activeSecret.value, signatureHeader, rawBody);
      }
      if (!verified && pendingSecret?.value) {
        const matchesPending = await verifyNotionWebhookSignature(
          pendingSecret.value,
          signatureHeader,
          rawBody,
        );
        if (matchesPending) {
          verified = true;
          await promotePendingNotionVerificationToken(
            c.env.storage.db,
            configRow.workspace_id,
            pendingSecret.value,
            c.env,
          );
        }
      }

      if (!verified) {
        return apiError(c, "invalid_webhook_signature", "Invalid Notion webhook signature.", 401);
      }

      c.executionCtx.waitUntil(
        handleIncomingNotionWebhookEvent(c.env, configRow, payload).catch((error) => {
          console.warn("[notion-sync] incoming webhook event failed", error);
        }),
      );

      return c.json({ ok: true });
    },
  );
};

export const registerNotionSyncRoutes = (
  app: Hono<AppEnv>,
  dependencies: { isDemoMode: (env: Bindings) => boolean },
) => {
  const ensureWritableOwner = (c: AppContext) => {
    const ownerDenied = requireOwner(c);
    if (ownerDenied) return ownerDenied;
    if (dependencies.isDemoMode(c.env)) {
      return apiError(
        c,
        "notion_sync_demo_disabled",
        "Notion synchronization is disabled in demo mode.",
        403,
      );
    }
    return null;
  };

  app.get("/api/v1/integrations/notion", async (c) => {
    const ownerDenied = requireOwner(c);
    if (ownerDenied) return ownerDenied;
    const settings = await getNotionSyncSettings(c.env.storage.db, getWorkspaceId(c), c.env);
    return c.json({ settings });
  });

  app.post(
    "/api/v1/integrations/notion/test",
    zValidator("json", NotionSyncConnectionTestSchema),
    async (c) => {
      const denied = ensureWritableOwner(c);
      if (denied) return denied;
      try {
        const result = await testNotionSyncConnection(
          c.env.storage.db,
          getWorkspaceId(c),
          c.env,
          c.req.valid("json"),
        );
        return c.json({ ok: true as const, ...result });
      } catch (error) {
        return respondWithAppError(c, error);
      }
    },
  );

  app.put(
    "/api/v1/integrations/notion",
    zValidator("json", NotionSyncSettingsUpdateSchema),
    async (c) => {
      const denied = ensureWritableOwner(c);
      if (denied) return denied;
      try {
        const settings = await upsertNotionSyncSettings(
          c.env.storage.db,
          getWorkspaceId(c),
          c.env,
          c.req.valid("json"),
        );
        return c.json({ settings });
      } catch (error) {
        return respondWithAppError(c, error);
      }
    },
  );

  app.post("/api/v1/integrations/notion/rotate-webhook", async (c) => {
    const denied = ensureWritableOwner(c);
    if (denied) return denied;
    try {
      const settings = await rotateNotionWebhookChannel(
        c.env.storage.db,
        getWorkspaceId(c),
        c.env,
      );
      return c.json({ settings });
    } catch (error) {
      return respondWithAppError(c, error);
    }
  });

  app.post(
    "/api/v1/integrations/notion/sync",
    zValidator("json", NotionSyncRunBatchSchema),
    async (c) => {
      const denied = ensureWritableOwner(c);
      if (denied) return denied;
      try {
        return c.json(
          await runNotionSyncBatch(c.env, getWorkspaceId(c), c.req.valid("json")),
        );
      } catch (error) {
        return respondWithAppError(c, error);
      }
    },
  );

  app.delete("/api/v1/integrations/notion", async (c) => {
    const denied = ensureWritableOwner(c);
    if (denied) return denied;
    await deleteNotionSyncSettings(c.env.storage.db, getWorkspaceId(c));
    return c.json({ ok: true as const });
  });
};
