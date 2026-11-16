import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { apiError } from "./http-errors";
import { consumePendingResourceUpload, PENDING_RESOURCE_UPLOAD_PATH } from "./pending-resource-service";

/**
 * Anonymous by design: the upload token issued by create_resource_upload_url
 * is the only credential, so clients never put their API token in a shell
 * command. Mounted under /api/public, outside the /api/v1 session middleware.
 */
export const registerPublicPendingResourceRoutes = (app: Hono<AppEnv>) => {
  app.put(PENDING_RESOURCE_UPLOAD_PATH, async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const result = await consumePendingResourceUpload(context, {
        authorization: context.req.header("Authorization"),
        contentType: context.req.header("Content-Type"),
        contentLength: context.req.header("Content-Length"),
        body: context.req.raw.body,
      });
      return context.json(result.body, result.status);
    } catch (error) {
      if (error instanceof AppError) {
        if (error.status === 401) context.header("WWW-Authenticate", 'Bearer error="invalid_token"');
        return apiError(context, error.code, error.message, error.status);
      }
      throw error;
    }
  });
};
