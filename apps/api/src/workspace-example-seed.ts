import {
  createExcerpt,
  docToText,
  markdownToDoc,
  normalizeTags,
  parseTableDocument,
  serializeTableDocument,
} from "@edgeever/shared";
import {
  WELCOME_MEMO_REPAIRED_CONTENT_HASH,
  WELCOME_MEMO_SEED_CONTENT_HASH,
  WELCOME_MEMO_TRANSLATIONS,
  buildWelcomeMemoContent,
} from "@edgeever/shared/default-workspace-seeds";
import { supportedLocales, type SupportedLocale } from "@edgeever/shared/i18n/locales";
import type { Bindings } from "./api-context";
import {
  decodeDemoAttachment,
  DEMO_SEED_ATTACHMENT_RESOURCES,
  DEMO_SEED_MEMOS,
  DEMO_SEED_REVISIONS,
} from "./demo-seed-data";
import { isDemoModeEnabled } from "./demo-mode";
import { isoNow } from "./entity-utils";
import { sha256, sha256Bytes } from "./hash-utils";
import { upsertMemoSearchDocumentStatement } from "./memo-search-index";
import { SharedTableStore } from "./shared-table-store";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";
import { compactSharedMemo, readActiveTableStorage } from "./table-memo-storage";

const EXAMPLE_NOTEBOOKS = [
  { id: "nb_demo_features", slug: "demo-features", name: "功能演示", sortOrder: 21 },
  { id: "nb_demo_features_en", slug: "feature-demos", name: "Feature Demos", sortOrder: 22 },
] as const;

const WELCOME_MEMO_ID = "memo_welcome";
const DEFAULT_WORKSPACE_ID = "ws_default";
const DEFAULT_BUCKET_NAME = "edgeever-resources";

// The public demo tells visitors to reset the shared workspace. A personal
// instance has no such action, so that tip is left out of the copied notes.
export const omitInstanceUnavailableExampleTips = (markdown: string) => markdown
  .split("\n")
  .filter((line) => !line.includes("恢复 Demo 数据") && !line.includes("Reset Demo Data"))
  .join("\n");

export const markWorkspaceExampleSeedPendingStatement = (
  db: DatabaseAdapter,
  workspaceId: string,
  now = isoNow(),
): PreparedStatementAdapter => db.prepare(
  `INSERT OR IGNORE INTO workspace_example_seeds (workspace_id, created_at) VALUES (?, ?)`,
).bind(workspaceId, now);

const knownWelcomeContentHashes = async () => {
  const hashes = new Set<string>([
    WELCOME_MEMO_SEED_CONTENT_HASH,
    WELCOME_MEMO_REPAIRED_CONTENT_HASH,
  ]);
  for (const locale of supportedLocales) {
    const welcome = buildWelcomeMemoContent(locale);
    hashes.add(await sha256(welcome.contentMarkdown + welcome.contentJson));
  }
  return hashes;
};

const knownWelcomeTitles = new Set(
  (Object.keys(WELCOME_MEMO_TRANSLATIONS) as SupportedLocale[])
    .map((locale) => WELCOME_MEMO_TRANSLATIONS[locale].title),
);

type WelcomeRow = {
  id: string;
  is_deleted: number;
  created_by: string;
  updated_by: string;
  title: string | null;
  content_hash: string | null;
};

const workspaceStillWantsExamples = async (
  db: DatabaseAdapter,
  workspaceId: string,
) => {
  const memos = (await db.prepare(
    `SELECT m.id, m.is_deleted, m.created_by, m.updated_by, m.title, c.content_hash
     FROM memos m
     LEFT JOIN memo_contents c ON c.memo_id = m.id
     WHERE m.workspace_id = ?`,
  ).bind(workspaceId).all<WelcomeRow>()).results;

  if (memos.length === 0) return true;

  const welcomeHashes = await knownWelcomeContentHashes();
  return memos.length === 1
    && memos[0].id === WELCOME_MEMO_ID
    && memos[0].is_deleted === 0
    && memos[0].created_by === "system"
    && memos[0].updated_by === "system"
    && knownWelcomeTitles.has(memos[0].title ?? "")
    && welcomeHashes.has(memos[0].content_hash ?? "");
};

const clearPending = (db: DatabaseAdapter, workspaceId: string) => db.prepare(
  `DELETE FROM workspace_example_seeds WHERE workspace_id = ?`,
).bind(workspaceId).run();

const idsAreFree = async (db: DatabaseAdapter, table: string, ids: string[]) => {
  if (ids.length === 0) return true;
  const row = await db.prepare(
    `SELECT id FROM ${table} WHERE id IN (${ids.map(() => "?").join(", ")}) LIMIT 1`,
  ).bind(...ids).first<{ id: string }>();
  return !row;
};

const applyImageWidths = (nodes: Array<{ type?: string; attrs?: Record<string, unknown>; content?: unknown[] }>) => {
  for (const node of nodes) {
    if (node.type === "image") {
      node.attrs = { ...node.attrs, width: 35 };
    }
    if (Array.isArray(node.content)) {
      applyImageWidths(node.content as Array<{ type?: string; attrs?: Record<string, unknown>; content?: unknown[] }>);
    }
  }
};

const resourceBytes = (resource: (typeof DEMO_SEED_ATTACHMENT_RESOURCES)[number]) => {
  if ("svg" in resource) return new TextEncoder().encode(resource.svg);
  return decodeDemoAttachment(resource);
};

export const ensureWorkspaceExampleSeed = async (env: Bindings, workspaceId: string) => {
  const db = env.storage.db;
  const pending = await db.prepare(
    `SELECT workspace_id FROM workspace_example_seeds WHERE workspace_id = ?`,
  ).bind(workspaceId).first<{ workspace_id: string }>();
  if (!pending) return;

  const demoOwnsTheCatalog = isDemoModeEnabled(env.EDGE_EVER_DEMO_MODE)
    || isDemoModeEnabled(env.EDGE_EVER_LOCAL_DEMO_SEED);
  if (demoOwnsTheCatalog || !await workspaceStillWantsExamples(db, workspaceId)) {
    await clearPending(db, workspaceId);
    return;
  }

  if (typeof env.storage.resources?.put !== "function") return;

  const projects = await db.prepare(
    `SELECT id FROM notebooks
     WHERE workspace_id = ? AND is_deleted = 0 AND parent_id IS NULL
       AND (slug = 'work-projects' OR id = 'nb_projects' OR id = ?)
     LIMIT 1`,
  ).bind(workspaceId, `${workspaceId}_projects`).first<{ id: string }>();
  if (!projects) {
    await clearPending(db, workspaceId);
    return;
  }

  const canonicalNotebookIds = EXAMPLE_NOTEBOOKS.map((notebook) => notebook.id);
  const canonicalMemoIds = DEMO_SEED_MEMOS.map((memo) => memo.id);
  const canonicalRevisionIds = DEMO_SEED_REVISIONS.map((revision) => revision.id);
  const canonicalResourceIds = DEMO_SEED_ATTACHMENT_RESOURCES.map((resource) => resource.id);
  // The installation workspace keeps the ids the clients already open. Every
  // later workspace gets its own ids so the two copies can exist together.
  const useCanonicalIds = workspaceId === DEFAULT_WORKSPACE_ID
    && await idsAreFree(db, "notebooks", canonicalNotebookIds)
    && await idsAreFree(db, "memos", canonicalMemoIds)
    && await idsAreFree(db, "memo_revisions", canonicalRevisionIds)
    && await idsAreFree(db, "resources", canonicalResourceIds);
  const mapId = (id: string) => useCanonicalIds ? id : `${workspaceId}_${id}`;
  const rewriteResourceLinks = (markdown: string) => {
    if (useCanonicalIds) return markdown;
    return canonicalResourceIds.reduce(
      (current, id) => current.replaceAll(`/api/v1/resources/${id}/`, `/api/v1/resources/${mapId(id)}/`),
      markdown,
    );
  };
  const exampleContent = (source: string) => {
    let markdown = rewriteResourceLinks(omitInstanceUnavailableExampleTips(source));
    const table = parseTableDocument(markdown);
    if (table && !useCanonicalIds) {
      for (const record of table.records) {
        for (const field of table.fields) {
          const attachments = record.cells[field.id];
          if (field.type === "attachment" && Array.isArray(attachments)) {
            record.cells[field.id] = attachments.map((attachment) => ({ ...attachment, resourceId: mapId(attachment.resourceId) }));
          }
        }
      }
      markdown = serializeTableDocument(table);
    }
    return { markdown, table };
  };

  const now = isoNow();
  const active = await readActiveTableStorage(db, workspaceId, "");
  const store = new SharedTableStore(db);
  const statements: PreparedStatementAdapter[] = [];
  for (const notebook of EXAMPLE_NOTEBOOKS) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO notebooks (
         id, workspace_id, parent_id, name, slug, icon, color, sort_order, is_deleted, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, 'notebook', NULL, ?, 0, ?, ?, NULL)`,
    ).bind(mapId(notebook.id), workspaceId, projects.id, notebook.name, notebook.slug, notebook.sortOrder, now, now));
  }

  for (const memo of DEMO_SEED_MEMOS) {
    const { markdown, table } = exampleContent(memo.markdown);
    const memoId = mapId(memo.id);
    const contentJson = markdownToDoc(markdown);
    if (Array.isArray(contentJson.content)) applyImageWidths(contentJson.content);
    const contentText = docToText(contentJson);
    const contentHash = await sha256(markdown + JSON.stringify(contentJson));
    const tags = normalizeTags(memo.tags);
    const compact = active && table ? compactSharedMemo(table) : null;
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO memos (
           id, workspace_id, notebook_id, title, excerpt, tags_json, is_pinned,
           is_archived, is_deleted, created_by, updated_by, created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'system', 'system', ?, ?, NULL)`,
      ).bind(
        memoId,
        workspaceId,
        mapId(memo.notebookId),
        memo.title,
        createExcerpt(contentText),
        JSON.stringify(tags),
        memo.isPinned ? 1 : 0,
        now,
        now,
      ),
      db.prepare(
        `INSERT OR IGNORE INTO memo_contents (
           memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at, shared_table_revision
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).bind(memoId, compact?.content_json ?? JSON.stringify(contentJson), compact?.content_markdown ?? markdown,
        compact?.content_text ?? contentText, contentHash, now, now, compact ? 1 : null),
      upsertMemoSearchDocumentStatement(db, memoId, memo.title, compact?.content_text ?? contentText, tags.join(" ")),
    );
    if (active && table) statements.push(...store.planMemoInitialization(workspaceId, memoId, table, active.run_id));
  }

  for (const revision of DEMO_SEED_REVISIONS) {
    const { markdown } = exampleContent(revision.markdown);
    const contentJson = markdownToDoc(markdown);
    const contentHash = await sha256(markdown + JSON.stringify(contentJson));
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO memo_revisions (
         id, memo_id, revision, title, content_json, content_markdown, content_hash, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'system', ?)`,
    ).bind(
      mapId(revision.id),
      mapId(revision.memoId),
      revision.revision,
      revision.title,
      JSON.stringify(contentJson),
      markdown,
      contentHash,
      now,
    ));
  }

  const bucketName = env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_BUCKET_NAME;
  for (const resource of DEMO_SEED_ATTACHMENT_RESOURCES) {
    const bytes = resourceBytes(resource);
    const extension = "svg" in resource ? "svg" : resource.filename.split(".").pop() || "bin";
    const resourceId = mapId(resource.id);
    const objectKey = `examples/${workspaceId}/${resourceId}.${extension}`;
    await env.storage.resources.put(objectKey, bytes, {
      httpMetadata: {
        contentType: resource.mimeType,
        cacheControl: "private, max-age=3600",
      },
      customMetadata: {
        memoId: mapId(resource.memoId),
        resourceId,
        filename: resource.filename,
        instanceExample: "true",
      },
    });
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO resources (
         id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
         byte_size, sha256, width, height, metadata_json, is_deleted, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'builtin', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
    ).bind(
      resourceId,
      mapId(resource.memoId),
      bucketName,
      objectKey,
      "svg" in resource ? "image" : "attachment",
      resource.mimeType,
      resource.filename,
      bytes.byteLength,
      await sha256Bytes(bytes),
      "svg" in resource ? resource.width : null,
      "svg" in resource ? resource.height : null,
      JSON.stringify({ source: "instance-example" }),
      now,
      now,
    ));
  }

  statements.push(db.prepare(
    `DELETE FROM workspace_example_seeds WHERE workspace_id = ?`,
  ).bind(workspaceId));
  try {
    await db.batch(statements);
  } catch (error) {
    // A concurrent seed of the same workspace may have already committed.
    if (await db.prepare(`SELECT 1 FROM workspace_example_seeds WHERE workspace_id = ?`).bind(workspaceId).first()) throw error;
  }
};
