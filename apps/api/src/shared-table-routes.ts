import { SharedTableMigration } from "./table-storage-migration";
import { TABLE_RECORD_LIMIT, type TableDocument, type TableRecord, type TableRowReceipt } from "@edgeever/shared";
import { AppError } from "./app-error";
import { isoNow } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "./api-context";
import { notFound } from "./http-errors";
import { applySharedMemoRecords, getSharedMemoWriteState } from "./memo-service";
import { getActorLabel, getAuditActor, getWorkspaceId, requireOwner, requireScopes } from "./request-auth";
import { SharedTableStore } from "./shared-table-store";
import {
  assertNotebookAccess,
  resolveRequestNotebookAccess,
} from "./token-notebook-access";

const revision = z.number().int().positive();
const changeSchema = z.object({
  since: revision,
  through: revision.optional(),
  after: z.object({ revision, recordId: z.string().min(1).max(80) }).optional(),
});
const tableQuerySchema = z.object({
  view: z.object({
    match: z.enum(["all", "any"]),
    filters: z.array(z.unknown()),
    sorts: z.array(z.unknown()),
  }),
  revision: revision.optional(),
  cursor: z.string().optional(),
  week: z.tuple([z.string(), z.string()]).optional(),
  includeTotal: z.boolean().optional(),
});

const idSchema = z.string().min(1).max(80);
const mutationSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  expectedContentHash: z.string().min(1).max(256),
  editSessionId: z.string().min(1).max(128),
  mutationId: z.string().min(1).max(128),
  puts: z.array(z.object({ id: idSchema, cells: z.record(z.string(), z.unknown()) })).max(TABLE_RECORD_LIMIT),
  deletes: z.array(idSchema).max(TABLE_RECORD_LIMIT),
}).refine((input) => input.puts.length + input.deletes.length > 0);

const available = z.number().int().nonnegative();
const operationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("estimate"), cursor: z.object({ memoId: z.string(), copiedRecords: available }).optional() }),
  z.object({ action: z.literal("start"), backupConfirmed: z.literal(true) }),
  z.object({ action: z.literal("advance"), budget: z.object({ readRows: available, writeRows: available, extraBytes: available }) }),
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("abort") }),
]);

export const registerSharedTableRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/admin/table-storage", async (c) => {
    const denied = requireOwner(c);
    if (denied) return denied;
    return c.json({ progress: await new SharedTableMigration(c.env.storage.db).status() });
  });
  app.post("/api/v1/admin/table-storage", zValidator("json", operationSchema), async (c) => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const input = c.req.valid("json");
    const migration = new SharedTableMigration(c.env.storage.db);
    if (input.action === "estimate") return c.json({ estimate: await migration.estimate(input.cursor) });
    if (input.action === "start") return c.json({ progress: await migration.start() });
    if (input.action === "abort") return c.json({ progress: await migration.beginRollback() });
    if (input.action === "activate") return c.json({ progress: await migration.activate() });
    try {
      return c.json({ progress: await migration.advance(input.budget) });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "table_migration_budget_exhausted") throw error;
      return c.json({ paused: true, reason: error.code, progress: await migration.status() });
    }
  });

  const authorize = async (c: AppContext, id: string) => {
    const denied = requireScopes(c, "read:memos");
    if (denied) return denied;
    const current = await getSharedMemoWriteState(
      c.env.storage.db,
      getWorkspaceId(c),
      id,
    );
    if (!current) return notFound(c, "Shared table not found");
    assertNotebookAccess(
      await resolveRequestNotebookAccess(c),
      "read",
      current.notebook_id,
      "read this table",
    );
    return null;
  };

  app.post(
    "/api/v1/memos/:id/table/query",
    zValidator("json", tableQuerySchema),
    async (c) => {
      const id = c.req.param("id");
      const denied = await authorize(c, id);
      if (denied) return denied;
      const store = new SharedTableStore(c.env.storage.db);
      return c.json(
        await store.query(getWorkspaceId(c), id, c.req.valid("json")),
      );
    },
  );

  app.post(
    "/api/v1/memos/:id/table/changes",
    zValidator("json", changeSchema),
    async (c) => {
      const id = c.req.param("id");
      const denied = await authorize(c, id);
      if (denied) return denied;
      const store = new SharedTableStore(c.env.storage.db);
      return c.json(
        await store.changes(getWorkspaceId(c), id, c.req.valid("json")),
      );
    },
  );
  app.patch("/api/v1/memos/:id/table/records", zValidator("json", mutationSchema), async (c) => {
    const denied = requireScopes(c, "write:memos");
    if (denied) return denied;
    const db = c.env.storage.db;
    const workspaceId = getWorkspaceId(c);
    const id = c.req.param("id");
    const current = await getSharedMemoWriteState(db, workspaceId, id);
    if (!current) return notFound(c, "Shared table not found");
    assertNotebookAccess(await resolveRequestNotebookAccess(c), "write", current.notebook_id, "edit this table");
    const input = c.req.valid("json");
    const actor = getAuditActor(c);
    const actorId = JSON.stringify([actor.actorType, actor.actorId]);
    const requestHash = await sha256(JSON.stringify([input.expectedRevision, input.expectedContentHash, input.puts, input.deletes]));
    const readReceipt = async () => {
      const saved = await db.prepare(`SELECT request_hash, receipt_json FROM ee_table_memo_receipts
        WHERE workspace_id = ? AND table_id = ? AND actor = ? AND mutation_id = ?`)
        .bind(workspaceId, id, actorId, input.mutationId).first<{ request_hash: string; receipt_json: string }>();
      if (!saved) return null;
      if (saved.request_hash !== requestHash) throw new AppError("idempotency_conflict", "This mutation ID was already used for different records", 409);
      return JSON.parse(saved.receipt_json) as TableRowReceipt;
    };
    const replay = await readReceipt();
    if (replay) return c.json({ receipt: replay });
    if (current.revision !== input.expectedRevision || current.content_hash !== input.expectedContentHash) {
      throw new AppError("revision_conflict", "The table changed before the draft could sync", 409);
    }
    const now = isoNow();
    const sessionBinds = [input.editSessionId, id, actor.actorType, actor.actorId, current.revision, current.content_hash, now];
    const sessionSql = `SELECT 1 FROM memo_edit_sessions WHERE id = ? AND memo_id = ? AND actor_type = ? AND actor_id IS ?
      AND base_revision = ? AND base_content_hash = ? AND expires_at > ?`;
    try {
      if (!await db.prepare(sessionSql).bind(...sessionBinds).first()) {
        throw new AppError("edit_session_conflict", "The edit session is stale or belongs to another note", 409);
      }
      const receipt = await applySharedMemoRecords(db, workspaceId, current, JSON.parse(current.header_json) as TableDocument,
        { puts: input.puts as TableRecord[], deletes: input.deletes }, actor, getActorLabel(c), (receipt) => [
          db.prepare(`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (${sessionSql})`).bind(...sessionBinds),
          db.prepare(`UPDATE memo_edit_sessions SET base_revision = ?, base_content_hash = ?, updated_at = ? WHERE id = ?`)
            .bind(receipt.revision, receipt.contentHash, receipt.updatedAt, input.editSessionId),
          db.prepare(`INSERT INTO ee_table_memo_receipts(workspace_id,table_id,actor,mutation_id,request_hash,receipt_json)
            VALUES(?,?,?,?,?,?)`).bind(workspaceId, id, actorId, input.mutationId, requestHash, JSON.stringify(receipt)),
        ]);
      return c.json({ receipt });
    } catch (error) {
      const replay = await readReceipt();
      if (replay) return c.json({ receipt: replay });
      throw error;
    }
  });

};
