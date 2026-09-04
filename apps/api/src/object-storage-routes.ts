import {
  ObjectStorageConnectionTestSchema,
  ObjectStorageSettingsUpdateSchema,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { auditStatement } from "./audit";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { isoNow } from "./entity-utils";
import { apiError, forbidden, notFound } from "./http-errors";
import {
  BUILTIN_STORAGE_CONFIG_ID,
  S3_STORAGE_CONFIG_ID,
  getActiveObjectStorageConfig,
  getObjectStorageConfig,
  mapObjectStorageSettings,
  resolvePrimaryObjectStorageEncryptionKey,
  resolveStoredObjectStorageSecret,
} from "./object-storage";
import { requireOwner } from "./request-auth";
import { encryptSecret } from "./secret-encryption";
import { testWorkerS3Connection } from "./worker-s3-blob-store";

type ObjectStorageRouteDependencies = {
  isDemoMode: (environment: Bindings) => boolean;
};

const hasEncryptionKey = (context: AppContext) => Boolean(
  resolvePrimaryObjectStorageEncryptionKey(context.env),
);

const getSubmittedObjectStorageSecret = async (
  context: AppContext,
  submittedSecret: string | undefined,
) => {
  if (submittedSecret) return submittedSecret;
  const existing = await getObjectStorageConfig(context.env.storage.db, S3_STORAGE_CONFIG_ID);
  if (!existing?.secret_access_key_encrypted) {
    throw new AppError("object_storage_secret_required", "Secret Access Key is required.", 400);
  }
  return resolveStoredObjectStorageSecret(context.env.storage.db, existing, context.env);
};

export const registerObjectStorageRoutes = (
  app: Hono<AppEnv>,
  dependencies: ObjectStorageRouteDependencies,
) => {
  app.get("/api/v1/instance/object-storage", async (context) => {
    const denied = requireOwner(context);
    if (denied) return denied;

    const active = await getActiveObjectStorageConfig(context.env.storage.db);
    if (!active) return notFound(context, "Object storage configuration not found.");
    const external = await getObjectStorageConfig(context.env.storage.db, S3_STORAGE_CONFIG_ID);
    return context.json({
      settings: mapObjectStorageSettings(active, hasEncryptionKey(context)),
      externalSettings: external
        ? mapObjectStorageSettings(external, hasEncryptionKey(context))
        : null,
    });
  });

  app.post(
    "/api/v1/instance/object-storage/test",
    zValidator("json", ObjectStorageConnectionTestSchema),
    async (context) => {
      const denied = requireOwner(context);
      if (denied) return denied;
      const input = context.req.valid("json");

      try {
        await testWorkerS3Connection({
          endpoint: input.endpoint.replace(/\/+$/, ""),
          region: input.region,
          bucket: input.bucket,
          accessKeyId: input.accessKeyId,
          secretAccessKey: await getSubmittedObjectStorageSecret(context, input.secretAccessKey),
          forcePathStyle: input.forcePathStyle,
          objectPrefix: input.objectPrefix,
        });
        return context.json({ ok: true });
      } catch (error) {
        if (error instanceof AppError) {
          return apiError(context, error.code, error.message, error.status);
        }
        return apiError(
          context,
          "object_storage_connection_failed",
          error instanceof Error ? error.message : "Object storage connection failed.",
          400,
        );
      }
    },
  );

  app.put(
    "/api/v1/instance/object-storage",
    zValidator("json", ObjectStorageSettingsUpdateSchema),
    async (context) => {
      const denied = requireOwner(context);
      if (denied) return denied;
      if (dependencies.isDemoMode(context.env)) {
        return forbidden(context, "Object storage cannot be changed in demo mode.");
      }

      const input = context.req.valid("json");
      const now = isoNow();
      if (input.provider === "builtin") {
        await context.env.storage.db.batch([
          context.env.storage.db.prepare(
            `UPDATE object_storage_configs SET is_active = 0, updated_at = ? WHERE is_active = 1`,
          ).bind(now),
          context.env.storage.db.prepare(
            `UPDATE object_storage_configs SET is_active = 1, updated_at = ? WHERE id = ?`,
          ).bind(now, BUILTIN_STORAGE_CONFIG_ID),
          auditStatement(
            context.env.storage.db,
            "user",
            context.get("auth").actorId,
            "instance.object_storage.update",
            "object_storage",
            BUILTIN_STORAGE_CONFIG_ID,
            { provider: "builtin" },
          ),
        ]);
      } else {
        const encryptionKey = resolvePrimaryObjectStorageEncryptionKey(context.env);
        if (!encryptionKey) {
          return apiError(
            context,
            "object_storage_authentication_required",
            "Instance authentication is required before saving external credentials.",
            400,
          );
        }

        try {
          const secretAccessKey = await getSubmittedObjectStorageSecret(
            context,
            input.secretAccessKey,
          );
          const endpoint = input.endpoint.replace(/\/+$/, "");
          await testWorkerS3Connection({ ...input, endpoint, secretAccessKey });
          const encryptedSecret = await encryptSecret(secretAccessKey, encryptionKey);
          await context.env.storage.db.batch([
            context.env.storage.db.prepare(
              `UPDATE object_storage_configs SET is_active = 0, updated_at = ? WHERE is_active = 1`,
            ).bind(now),
            context.env.storage.db.prepare(
              `INSERT INTO object_storage_configs (
                 id, provider, display_name, endpoint, region, bucket, access_key_id,
                 secret_access_key_encrypted, force_path_style, object_prefix, is_active, created_at, updated_at
               ) VALUES (?, 's3', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 display_name = excluded.display_name, endpoint = excluded.endpoint, region = excluded.region,
                 bucket = excluded.bucket, access_key_id = excluded.access_key_id,
                 secret_access_key_encrypted = excluded.secret_access_key_encrypted,
                 force_path_style = excluded.force_path_style, object_prefix = excluded.object_prefix,
                 is_active = 1, updated_at = excluded.updated_at`,
            ).bind(
              S3_STORAGE_CONFIG_ID,
              input.displayName,
              endpoint,
              input.region,
              input.bucket,
              input.accessKeyId,
              encryptedSecret,
              input.forcePathStyle ? 1 : 0,
              input.objectPrefix.replace(/^\/+|\/+$/g, ""),
              now,
              now,
            ),
            auditStatement(
              context.env.storage.db,
              "user",
              context.get("auth").actorId,
              "instance.object_storage.update",
              "object_storage",
              S3_STORAGE_CONFIG_ID,
              { provider: "s3", endpoint, bucket: input.bucket },
            ),
          ]);
        } catch (error) {
          if (error instanceof AppError) {
            return apiError(context, error.code, error.message, error.status);
          }
          return apiError(
            context,
            "object_storage_connection_failed",
            error instanceof Error ? error.message : "Object storage connection failed.",
            400,
          );
        }
      }

      const active = await getActiveObjectStorageConfig(context.env.storage.db);
      return context.json({
        settings: mapObjectStorageSettings(active!, hasEncryptionKey(context)),
      });
    },
  );
};
