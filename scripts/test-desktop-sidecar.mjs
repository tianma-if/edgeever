import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultDiagramDocument, getDiagramSummary, serializeDiagramDocument } from "../packages/shared/src/diagram.ts";
import { createDefaultInfographicDocument, getInfographicSummary, serializeInfographicDocument } from "../packages/shared/src/infographic.ts";
import { createDefaultTableDocument, getTableSummary, serializeTableDocument } from "../packages/shared/src/table.ts";

const sidecarPath = process.env.EDGE_EVER_SIDECAR_PATH ?? join(process.cwd(), "crates/desktop-sidecar/target/debug/edgeever-sidecar");
const migrationsPath = process.env.EDGE_EVER_MIGRATIONS_PATH ?? join(process.cwd(), "migrations");
const dataDir = mkdtempSync(join(tmpdir(), "edgeever-sidecar-test-"));
const child = spawn(sidecarPath, ["--data-dir", dataDir, "--migrations-dir", migrationsPath], { stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: child.stdout });
const messages = [];
lines.on("line", (line) => {
  try { messages.push(JSON.parse(line)); } catch { /* Ignore diagnostics. */ }
});

const waitFor = async (predicate, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for sidecar response");
};

let nextId = 1;
const request = async (method, params = {}) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  const response = await waitFor((message) => message.id === id);
  if (response.error) throw new Error(response.error.message);
  return response.result;
};

await waitFor((message) => message.event === "ready");
const notebooks = await request("notebook.list");
const seedInbox = notebooks.notebooks.find((notebook) => notebook.slug === "inbox");
assert.ok(seedInbox, "seed inbox notebook should exist");
assert.deepEqual(await request("sync.bootstrap.prepare"), { clearedSeedData: true, rebuiltMirror: false });
assert.equal((await request("memo.list", { limit: 20 })).totalCount, 0, "bootstrap preparation should remove only pristine seed data");
assert.equal((await request("notebook.list")).notebooks.length, 0, "bootstrap preparation should remove pristine seed notebooks");
if (process.platform !== "win32") {
  assert.equal(statSync(dataDir).mode & 0o777, 0o700, "sidecar data directory should be private");
  assert.equal(statSync(join(dataDir, "edgeever.sqlite")).mode & 0o777, 0o600, "sidecar database should be private");
}

let inbox;
const remoteMemo = (id, {
  mergedIntoMemoId = null,
  sourceMemoIds = [],
  notebookId = inbox.id,
  isDeleted = Boolean(mergedIntoMemoId),
} = {}) => ({
  id,
  notebookId,
  title: id,
  excerpt: "",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted,
  revision: 0,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  deletedAt: isDeleted ? "2026-09-06T00:00:00.000Z" : null,
  contentJson: { type: "doc", content: [] },
  contentMarkdown: "",
  contentText: "",
  contentHash: id,
  sourceMemoIds,
  mergeSourceCount: sourceMemoIds.length,
  mergedIntoMemoId,
});
const applyRemoteMemo = (memo) => request("sync.apply", {
  changes: [{ entityType: "memo", operation: "upsert", entityId: memo.id, memo, notebook: null }],
});
const notebookPayload = (id, { name = id, slug = id, parentId = null } = {}) => ({
  id,
  parentId,
  name,
  slug,
  icon: "notebook",
  color: "#0f766e",
  sortOrder: 10,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
});

// Regression for #378: first pull after seed clear can receive memos before the
// renamed workspace inbox, and must not fail when slug is no longer `inbox`.
await request("sync.apply", {
  changes: [
    {
      entityType: "memo",
      operation: "upsert",
      entityId: "memo_e2e_renamed_inbox",
      memo: remoteMemo("memo_e2e_renamed_inbox", {
        notebookId: "notebook_deleted_on_server",
        isDeleted: true,
      }),
      notebook: null,
    },
    {
      entityType: "notebook",
      operation: "upsert",
      entityId: "ws_1_inbox",
      notebook: notebookPayload("ws_1_inbox", { name: "收集箱", slug: "shou-ji-xiang" }),
      memo: null,
    },
  ],
});
inbox = (await request("notebook.list")).notebooks.find((notebook) => notebook.id === "ws_1_inbox");
assert.ok(inbox, "sidecar should keep the workspace inbox even when its remote slug was renamed");
const cancelledImport = (await request("memo.create", {
  notebookId: inbox.id, title: "Failed screenshot import", contentMarkdown: "", tags: [],
})).memo;
assert.ok((await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.kind === "memo.create" && item.entityId === cancelledImport.id));
await request("memo.delete", { memoId: cancelledImport.id, permanent: true, cancelPendingCreate: true });
assert.ok(!(await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.entityId === cancelledImport.id), "cancelling an unsynced import must not queue a cloud delete");
await assert.rejects(request("memo.get", { memoId: cancelledImport.id, includeDeleted: true }), /Query returned no rows/);
await assert.rejects(request("memo.delete", { memoId: "memo_e2e_renamed_inbox", permanent: true, cancelPendingCreate: true }), /Only an unsynced local memo/);
assert.equal(inbox.slug, "inbox", "synced inbox identity should restore slug=inbox");
assert.equal(
  (await request("memo.get", { memoId: "memo_e2e_renamed_inbox", includeDeleted: true })).memo.notebookId,
  inbox.id,
  "a missing remote notebook should fall back to the workspace inbox in the same page",
);
assert.equal((await request("memo.emptyTrash")).deleted, 1, "renamed-inbox fixture should not leak into later scenarios");

await applyRemoteMemo(remoteMemo("memo_e2e_recreated_inbox", {
  notebookId: "notebook_also_missing",
  isDeleted: true,
}));
assert.equal(
  (await request("memo.get", { memoId: "memo_e2e_recreated_inbox", includeDeleted: true })).memo.notebookId,
  inbox.id,
  "later pulls should keep using the restored inbox",
);
assert.equal((await request("memo.emptyTrash")).deleted, 1, "recreated-inbox fixture should not leak into later scenarios");

// Regression for #362: bootstrap memo pages are sorted by id, so a deleted
// merge source can reach the real sidecar process before its merge target.
await applyRemoteMemo(remoteMemo("memo_e2e_merge_source_before", { mergedIntoMemoId: "memo_e2e_merge_target" }));
assert.equal(
  (await request("memo.get", { memoId: "memo_e2e_merge_source_before", includeDeleted: true })).memo.mergedIntoMemoId,
  null,
  "an unresolved merge target must not fail the bootstrap page",
);
await applyRemoteMemo(remoteMemo("memo_e2e_merge_target", {
  sourceMemoIds: ["memo_e2e_merge_source_before", "memo_e2e_merge_source_after"],
}));
await applyRemoteMemo(remoteMemo("memo_e2e_merge_source_after", { mergedIntoMemoId: "memo_e2e_merge_target" }));
for (const sourceId of ["memo_e2e_merge_source_before", "memo_e2e_merge_source_after"]) {
  assert.equal(
    (await request("memo.get", { memoId: sourceId, includeDeleted: true })).memo.mergedIntoMemoId,
    "memo_e2e_merge_target",
    "merge links should converge regardless of bootstrap page order",
  );
}
assert.equal((await request("memo.emptyTrash")).deleted, 2, "merge-order fixtures should not leak into later scenarios");

// Regression for #371: older servers can return a trashed memo whose original
// notebook is no longer part of the active notebook snapshot.
await applyRemoteMemo(remoteMemo("memo_e2e_deleted_notebook", {
  notebookId: "notebook_deleted_on_server",
  isDeleted: true,
}));
assert.equal(
  (await request("memo.get", { memoId: "memo_e2e_deleted_notebook", includeDeleted: true })).memo.notebookId,
  inbox.id,
  "a missing remote notebook should fall back to the local inbox",
);
assert.equal((await request("memo.emptyTrash")).deleted, 1, "deleted-notebook fixture should not leak into later scenarios");

const first = await request("memo.create", { notebookId: inbox.id, title: "Local first", contentMarkdown: "searchable body", tags: ["local"] });
assert.deepEqual(await request("sync.bootstrap.prepare"), { clearedSeedData: false, rebuiltMirror: false });
assert.equal((await request("memo.get", { memoId: first.memo.id })).memo.id, first.memo.id, "bootstrap preparation must preserve local user data");
const second = await request("memo.create", { notebookId: inbox.id, title: "Second memo", contentMarkdown: "another body", tags: [] });
const search = await request("memo.list", { q: "searchable", limit: 20 });
assert.deepEqual(search.memos.map((memo) => memo.id), [first.memo.id]);
assert.equal(search.memos[0].diagramKind, null, "an ordinary note has no diagram kind");
assert.equal(search.memos[0].infographic, false, "an ordinary note is not an infographic");
assert.equal(search.memos[0].structuredTable, false, "an ordinary note is not a table");
assert.equal(Object.hasOwn(search.memos[0], "diagramPreview"), false);
assert.equal(Object.hasOwn(search.memos[0], "tablePreview"), false);
assert.equal(Object.hasOwn(search.memos[0], "contentMarkdown"), false, "list rows must not include the document payload");

// #751: the editor sends an empty title for an untitled note. Local saves keep
// that as null, while the server returns the canonical default after sync.
const untitled = (await request("memo.create", {
  notebookId: inbox.id, title: "无标题笔记", contentMarkdown: "English 正文", tags: [],
})).memo;
const searchUntitled = () => request("memo.list", { notebookId: inbox.id, q: "无标题笔记", limit: 20 });
assert.deepEqual((await searchUntitled()).memos.map((memo) => memo.id), [untitled.id]);
const editedUntitled = (await request("memo.update", {
  memoId: untitled.id, expectedRevision: untitled.revision, expectedContentHash: untitled.contentHash,
  title: "", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "English 正文 edited" }] }] },
  contentMarkdown: "English 正文 edited", contentText: "English 正文 edited", tags: [],
})).memo;
assert.equal(editedUntitled.title, null, "search must not rewrite the saved title");
const untitledResults = await searchUntitled();
assert.deepEqual(untitledResults.memos.map((memo) => memo.id), [untitled.id], "local autosave must not hide an untitled search result");
assert.equal(untitledResults.totalCount, 1, "search count must include the local null title");
await request("memo.update", {
  memoId: untitled.id, expectedRevision: editedUntitled.revision, expectedContentHash: editedUntitled.contentHash,
  title: "Explicit title", contentJson: editedUntitled.contentJson,
  contentMarkdown: editedUntitled.contentMarkdown, contentText: editedUntitled.contentText, tags: [],
});
assert.equal((await searchUntitled()).totalCount, 0, "a genuinely nonmatching title must leave the search");
await request("memo.delete", { memoId: untitled.id, permanent: true });

const assertListMetadata = async (title, markdown) => {
  const created = await request("memo.create", { notebookId: inbox.id, title, contentMarkdown: markdown, tags: [] });
  const listed = (await request("memo.list", { q: title, limit: 20 })).memos.find((memo) => memo.id === created.memo.id);
  assert.ok(listed, `${title} should appear in the desktop list`);
  const expected = { ...getDiagramSummary(markdown), ...getInfographicSummary(markdown), ...getTableSummary(markdown) };
  assert.equal(listed.diagramKind, expected.diagramKind, title);
  assert.deepEqual(listed.diagramPreview, expected.diagramPreview, title);
  assert.equal(listed.infographic, expected.infographic, title);
  assert.equal(listed.structuredTable, expected.structuredTable, title);
  assert.deepEqual(listed.tablePreview, expected.tablePreview, title);
  assert.equal(Object.hasOwn(listed, "contentMarkdown"), false, `${title} list row must not include the document payload`);
};
await assertListMetadata("Infographic list icon", serializeInfographicDocument({
  schemaVersion: 1,
  syntax: "infographic chart-column-simple\ndata\n  title 季度营收",
  history: [{ id: "one", prompt: "换成小米", createdAt: "2026-10-02T00:37:00.000Z", kind: "refined", resultTitle: "小米集团2024年季度营收", response: "已替换。" }],
}));
await assertListMetadata("Empty infographic list icon", serializeInfographicDocument(createDefaultInfographicDocument()));
await assertListMetadata("Mind map list icon", serializeDiagramDocument(createDefaultDiagramDocument("mind-map")));
await assertListMetadata("Flowchart list icon", serializeDiagramDocument(createDefaultDiagramDocument("flowchart")));
await assertListMetadata("Architecture list icon", serializeDiagramDocument(createDefaultDiagramDocument("architecture")));
await assertListMetadata("Table list icon", serializeTableDocument(createDefaultTableDocument()));
await assertListMetadata("Broken infographic list icon", "<!-- edgeever-infographic-v1:broken -->");
await request("memo.create", { notebookId: inbox.id, title: "Local daily", contentMarkdown: "prefix overlap", tags: ["local-daily"] });
const tagged = await request("memo.list", { tag: "local", limit: 20 });
assert.deepEqual(tagged.memos.map((memo) => memo.id), [first.memo.id], "tag filter should match an exact tag, not a prefix");
assert.equal(tagged.totalCount, 1, "tag filter total should count only exact matches");
const taggedCase = await request("memo.list", { tag: "LOCAL", limit: 20 });
assert.deepEqual(taggedCase.memos.map((memo) => memo.id), [first.memo.id], "tag filter should match tags case-insensitively");
const missingTag = await request("memo.list", { tag: "missing-tag", limit: 20 });
assert.equal(missingTag.totalCount, 0, "unknown tags should not leak untagged notes into the list");
const childNotebook = (await request("notebook.create", { name: "Inbox child", parentId: inbox.id })).notebook;
const childMemo = await request("memo.create", { notebookId: childNotebook.id, title: "Nested memo", contentMarkdown: "nested body", tags: [] });
const subtree = await request("memo.list", {
  notebookId: inbox.id,
  notebookIds: [inbox.id, childNotebook.id],
  limit: 20,
});
assert.ok(subtree.memos.some((memo) => memo.id === first.memo.id), "parent notebook notes should remain in a subtree query");
assert.ok(subtree.memos.some((memo) => memo.id === childMemo.memo.id), "subtree queries should include child notebook notes");
await request("memo.update", {
  memoId: first.memo.id,
  title: "Local first updated",
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "updated body" }] }] },
  contentMarkdown: "updated body",
  contentText: "updated body",
  tags: ["updated"],
});
const revisions = await request("memo.revisions", { memoId: first.memo.id });
assert.ok(revisions.revisions.length >= 1, "memo update should create a revision");
await request("memo.restoreRevision", { memoId: first.memo.id, revisionId: revisions.revisions[0].id });
const restoredRevisionMemo = await request("memo.get", { memoId: first.memo.id });
assert.equal(restoredRevisionMemo.memo.contentMarkdown, "searchable body");
await request("memo.revision.cache", {
  revision: {
    id: "remote_revision_test",
    memoId: first.memo.id,
    revision: 99,
    title: "Remote cached revision",
    tags: ["remote"],
    contentJson: { type: "doc", content: [] },
    contentMarkdown: "cached remote revision",
    contentText: "cached remote revision",
    contentHash: "remote-hash",
    createdBy: "remote",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
});
const cachedRevisions = await request("memo.revisions", { memoId: first.memo.id });
assert.ok(cachedRevisions.revisions.some((revision) => revision.id === "remote_revision_test"));

const coalesced = await request("memo.create", { notebookId: inbox.id, title: "Autosave coalesce", contentMarkdown: "initial", tags: [] });
const updatePayload = (contentMarkdown) => ({
  memoId: coalesced.memo.id,
  title: "Autosave coalesce",
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: contentMarkdown }] }] },
  contentMarkdown,
  contentText: contentMarkdown,
  tags: [],
});
await request("memo.update", updatePayload("first autosave"));
await request("memo.update", updatePayload("latest autosave"));
const coalescedUpdates = (await request("sync.outbox.list", { limit: 200 })).items.filter((item) => item.kind === "memo.update" && item.entityId === coalesced.memo.id);
assert.equal(coalescedUpdates.length, 1, "offline autosaves should coalesce into one sidecar outbox item");
assert.equal(coalescedUpdates[0].payload.contentMarkdown, "latest autosave");
assert.equal((await request("memo.get", { memoId: coalesced.memo.id })).memo.revision, 0, "local autosaves must not advance the acknowledged cloud revision");
assert.equal(coalescedUpdates[0].version, 2, "coalescing a newer autosave should advance the outbox version");

const remapRace = await request("memo.create", { notebookId: inbox.id, title: "Remap race", contentMarkdown: "created locally", tags: [] });
const remapCreate = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.kind === "memo.create" && item.entityId === remapRace.memo.id);
assert.ok(remapCreate, "new desktop memo should have a create outbox item");
const remoteCreatedMemo = {
  ...remapRace.memo,
  id: "memo_remote_remap_race",
  revision: 1,
  updatedAt: "2026-08-26T02:15:21.000Z",
};
await request("sync.outbox.ack", { id: remapCreate.id, version: remapCreate.version, remoteMemo: remoteCreatedMemo });
await request("memo.update", {
  ...updatePayload("first save after create acknowledgement"),
  memoId: remoteCreatedMemo.id,
  expectedRevision: 0,
  expectedContentHash: remapRace.memo.contentHash,
});
const remappedUpdate = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.kind === "memo.update" && item.entityId === remoteCreatedMemo.id);
assert.ok(remappedUpdate, "editing immediately after id remapping should queue a remote-id update");
assert.equal(remappedUpdate.payload.expectedRevision, remoteCreatedMemo.revision, "a scheduled revision-0 autosave should rebase to its own create acknowledgement");
assert.equal(remappedUpdate.payload.expectedContentHash, remoteCreatedMemo.contentHash);

await request("memo.update", {
  ...updatePayload("successor typed while the first request was in flight"),
  memoId: remoteCreatedMemo.id,
  expectedRevision: remoteCreatedMemo.revision,
  expectedContentHash: remoteCreatedMemo.contentHash,
});
const successorBeforeAck = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.id === remappedUpdate.id);
assert.equal(successorBeforeAck.version, remappedUpdate.version + 1);
const firstRemoteUpdate = {
  ...remoteCreatedMemo,
  revision: 2,
  contentJson: remappedUpdate.payload.contentJson,
  contentMarkdown: remappedUpdate.payload.contentMarkdown,
  contentText: remappedUpdate.payload.contentMarkdown,
  contentHash: "remote-hash-after-first-save",
  updatedAt: "2026-08-26T02:15:22.000Z",
};
const supersededAck = await request("sync.outbox.ack", {
  id: remappedUpdate.id,
  version: remappedUpdate.version,
  remoteMemo: firstRemoteUpdate,
});
assert.equal(supersededAck.superseded, true, "an acknowledgement must not delete a newer coalesced autosave");
const successorAfterAck = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.id === remappedUpdate.id);
assert.ok(successorAfterAck, "the successor autosave should remain queued");
assert.equal(successorAfterAck.status, "pending");
assert.equal(successorAfterAck.payload.contentMarkdown, "successor typed while the first request was in flight");
assert.equal(successorAfterAck.payload.expectedRevision, firstRemoteUpdate.revision);
assert.equal(successorAfterAck.payload.expectedContentHash, firstRemoteUpdate.contentHash);
const preservedSuccessor = await request("memo.get", { memoId: remoteCreatedMemo.id });
assert.equal(preservedSuccessor.memo.contentMarkdown, "successor typed while the first request was in flight", "acknowledging an older request must preserve the live local draft");
assert.equal(preservedSuccessor.memo.revision, firstRemoteUpdate.revision, "the preserved successor should advance to the acknowledged cloud revision");
const secondRemoteUpdate = {
  ...preservedSuccessor.memo,
  revision: 3,
  contentHash: "remote-hash-after-successor",
  updatedAt: "2026-08-26T02:15:23.000Z",
};
const finalAck = await request("sync.outbox.ack", {
  id: successorAfterAck.id,
  version: successorAfterAck.version,
  remoteMemo: secondRemoteUpdate,
});
assert.equal(finalAck.superseded, false);
assert.ok(!(await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.id === successorAfterAck.id), "the exact successor acknowledgement should clear the outbox item");
assert.equal((await request("memo.get", { memoId: remoteCreatedMemo.id })).memo.revision, secondRemoteUpdate.revision);

const batchNotebook = (await request("notebook.create", { name: "Batch destination" })).notebook;
const batchFirst = (await request("memo.create", { notebookId: inbox.id, title: "Batch one", contentMarkdown: "batch one", tags: ["batch-tag"] })).memo;
const batchSecond = (await request("memo.create", { notebookId: inbox.id, title: "Batch two", contentMarkdown: "batch two", tags: ["batch-tag"] })).memo;
const renamedTag = await request("tag.rename", { tag: "batch-tag", name: "renamed-batch-tag" });
assert.equal(renamedTag.updated, 2);
assert.ok((await request("tag.list")).tags.some((tag) => tag.name === "renamed-batch-tag"));
assert.equal((await request("memo.moveBatch", { memoIds: [batchFirst.id, batchSecond.id], notebookId: batchNotebook.id })).moved, 2);
assert.equal((await request("memo.pinBatch", { memoIds: [batchFirst.id, batchSecond.id], isPinned: true })).updated, 2);
assert.equal((await request("memo.list", { notebookId: batchNotebook.id, filter: "pinned", limit: 20 })).totalCount, 2);
assert.equal((await request("memo.deleteBatch", { memoIds: [batchFirst.id, batchSecond.id] })).deleted, 2);
assert.equal((await request("memo.list", { trash: true, notebookId: batchNotebook.id, limit: 20 })).totalCount, 2);
await request("memo.restore", { memoId: batchFirst.id });
assert.equal((await request("memo.list", { notebookId: batchNotebook.id, limit: 20 })).totalCount, 1);
assert.equal((await request("memo.emptyTrash")).deleted, 1);
assert.equal((await request("memo.list", { trash: true, notebookId: batchNotebook.id, limit: 20 })).totalCount, 0);

await request("resource.cache", {
  resource: {
    id: "resource-from-merge-source",
    memoId: first.memo.id,
    originalMemoId: null,
    kind: "attachment",
    mimeType: "application/zip",
    filename: "merged-source.zip",
    byteSize: 42,
    sha256: "resource-hash",
    width: null,
    height: null,
  },
});
const merged = await request("memo.merge", { memoIds: [first.memo.id, second.memo.id] });
assert.equal(merged.memo.sourceMemoIds.length, 2);
const trash = await request("memo.list", { trash: true, limit: 20 });
assert.ok(trash.memos.some((memo) => memo.id === first.memo.id));
const mergeOutbox = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.kind === "memo.merge" && item.entityId === merged.memo.id);
assert.ok(mergeOutbox, "memo merge should be queued");
const remoteMergedMemo = { ...merged.memo, id: "memo_remote_merged" };
await request("sync.apply", {
  changes: [{ entityType: "memo", operation: "upsert", entityId: remoteMergedMemo.id, memo: remoteMergedMemo, notebook: null }],
});
await request("sync.outbox.ack", { id: mergeOutbox.id, remoteMemo: remoteMergedMemo });
await assert.rejects(() => request("memo.get", { memoId: merged.memo.id, includeDeleted: true }), /Query returned no rows/);
assert.equal((await request("memo.get", { memoId: first.memo.id, includeDeleted: true })).memo.mergedIntoMemoId, remoteMergedMemo.id);
const mergedResource = (await request("resource.list", { limit: 200 })).resources.find((resource) => resource.id === "resource-from-merge-source");
assert.equal(mergedResource.memoId, remoteMergedMemo.id, "merge acknowledgement should remap resources before deleting the local memo");
assert.equal(mergedResource.originalMemoId, first.memo.id, "merge acknowledgement should preserve the resource's source memo");
assert.ok(!(await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.id === mergeOutbox.id), "merge acknowledgement should clear the outbox item");

await request("template.cache", {
  template: {
    id: "tpl_remote_test",
    name: "Remote test template",
    description: null,
    title: "Template title",
    contentJson: { type: "doc", content: [] },
    contentMarkdown: "Template body",
    tags: ["test"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
});
const templates = await request("template.list");
assert.ok(templates.templates.some((template) => template.id === "tpl_remote_test"));
const localTemplate = await request("template.create", { name: "Local template", memoId: first.memo.id });
const templateOutbox = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.entityId === localTemplate.template.id);
assert.ok(templateOutbox, "template create should be queued");
assert.equal(templateOutbox.payload.contentMarkdown, "searchable body");
assert.deepEqual(templateOutbox.payload.tags, ["local"]);
await request("template.update", { templateId: localTemplate.template.id, name: "Local template updated", contentMarkdown: "updated template" });
const templateUpdateBeforeAck = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.kind === "template.update" && item.entityId === localTemplate.template.id);
assert.ok(templateUpdateBeforeAck, "template update should be queued behind create");
await request("sync.outbox.ack", {
  id: templateOutbox.id,
  remoteTemplate: {
    id: "tpl_remote_mapped",
    name: "Local template updated",
    description: null,
    title: "",
    contentJson: { type: "doc", content: [] },
    contentMarkdown: "updated template",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
});
const templateUpdateAfterAck = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.kind === "template.update");
assert.equal(templateUpdateAfterAck.entityId, "tpl_remote_mapped");
assert.equal(templateUpdateAfterAck.payload.templateId, "tpl_remote_mapped");
await request("template.delete", { templateId: "tpl_remote_test" });
assert.equal((await request("template.list")).templates.some((template) => template.id === "tpl_remote_test"), false);

const backup = await request("storage.backup");
assert.equal(backup.ok, true);
const outsideBackup = join(dataDir, "outside.sqlite");
writeFileSync(outsideBackup, "not a managed backup");
await assert.rejects(() => request("storage.restore", { path: outsideBackup }), /managed EdgeEver backup/);
const stagedResourceDirectory = join(dataDir, "resource-outbox");
mkdirSync(stagedResourceDirectory, { recursive: true });
writeFileSync(join(stagedResourceDirectory, "stage-test.bin"), "offline attachment snapshot");
const backupWithResource = await request("storage.backup");
if (process.platform !== "win32") assert.equal(statSync(backupWithResource.path).mode & 0o777, 0o600, "database backups should be private");
const resourceBackupDirectory = backupWithResource.path.replace(/\.sqlite$/, ".resources");
assert.ok(existsSync(join(resourceBackupDirectory, "stage-test.bin")), "backup should include staged resources");
writeFileSync(join(stagedResourceDirectory, "stage-test.bin"), "changed after backup");
for (let index = 0; index < 4; index += 1) await request("storage.backup");
const backups = await request("storage.backups");
assert.ok(backups.backups.some((item) => item.path === backupWithResource.path));
const afterBackup = await request("memo.create", { notebookId: inbox.id, title: "After backup", contentMarkdown: "should disappear after restore", tags: [] });
await request("storage.restore", { path: backupWithResource.path });
await assert.rejects(() => request("memo.get", { memoId: afterBackup.memo.id }), /Query returned no rows/);
assert.equal(readFileSync(join(stagedResourceDirectory, "stage-test.bin"), "utf8"), "offline attachment snapshot", "restore should recover staged resources");
const outbox = await request("sync.outbox.list", { limit: 100 });
assert.ok(!outbox.items.some((item) => item.id === mergeOutbox.id), "a restored backup must not resurrect an acknowledged merge");

const deferredMemo = await request("memo.create", { notebookId: inbox.id, title: "Deferred retry", contentMarkdown: "retry later", tags: [] });
const deferredItem = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.entityId === deferredMemo.memo.id);
assert.ok(deferredItem, "deferred retry test should create an outbox item");
await request("sync.outbox.fail", {
  id: deferredItem.id,
  version: deferredItem.version,
  error: "temporary outage",
  errorCode: "http_503",
  retryable: true,
  nextAttemptAt: "2099-01-01T00:00:00.000Z",
});
assert.ok(!(await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.id === deferredItem.id), "a deferred error should wait until its retry time");
const deferredDetails = (await request("sync.outbox.list", { limit: 200, includeConflicts: true })).items.find((item) => item.id === deferredItem.id);
assert.equal(deferredDetails.lastErrorCode, "http_503");
assert.equal(deferredDetails.retryable, true);
assert.equal(deferredDetails.nextAttemptAt, "2099-01-01T00:00:00.000Z");
await request("sync.outbox.retry", { id: deferredItem.id, version: deferredItem.version });
assert.ok((await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.id === deferredItem.id), "manual retry should make a deferred item immediately eligible");
await request("sync.outbox.discard", { id: deferredItem.id });

const recoveryCandidate = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.kind === "memo.update" && item.entityId === coalesced.memo.id);
assert.ok(recoveryCandidate, "recovery test should reuse a durable memo update");
await request("sync.outbox.fail", {
  id: recoveryCandidate.id,
  version: recoveryCandidate.version,
  error: "Memo not found",
  errorCode: "memo_not_found",
  retryable: false,
});
assert.ok(!(await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.id === recoveryCandidate.id), "a permanent missing memo error must stop automatic retries");
const recovered = await request("sync.outbox.recoverMemoUpdate", { id: recoveryCandidate.id, version: recoveryCandidate.version, notebookId: inbox.id });
assert.equal(recovered.memo.contentMarkdown, "latest autosave", "recovery should preserve the failed update content");
assert.deepEqual(recovered.memo.contentJson, recoveryCandidate.payload.contentJson, "recovery should preserve rich document content");
assert.ok(!(await request("sync.outbox.list", { limit: 200, includeConflicts: true })).items.some((item) => item.id === recoveryCandidate.id), "recovery should remove the failed update");
assert.ok((await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.kind === "memo.create" && item.entityId === recovered.memo.id), "recovery should queue the new local note for upload");
assert.ok((await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.kind === "memo.update" && item.entityId === recovered.memo.id && JSON.stringify(item.payload.contentJson) === JSON.stringify(recoveryCandidate.payload.contentJson)), "recovery should queue a successor update that preserves rich content after create acknowledgement");

const conflictMemo = await request("memo.create", { notebookId: inbox.id, title: "Conflict test", contentMarkdown: "local conflict", tags: [] });
const conflictCandidate = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.entityId === conflictMemo.memo.id);
assert.ok(conflictCandidate, "conflict test should create an outbox item");
await request("sync.outbox.fail", { id: conflictCandidate.id, error: "test conflict", conflict: true });
assert.ok(!(await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.id === conflictCandidate.id), "conflicts must not be returned to the automatic retry loop");
assert.ok((await request("sync.outbox.list", { limit: 200, includeConflicts: true })).items.some((item) => item.id === conflictCandidate.id && item.status === "conflict"), "conflicts should remain available to explicit recovery actions");
await request("sync.outbox.discard", { id: conflictCandidate.id });
assert.equal((await request("sync.status")).conflict, 0);

const examNotebook = (await request("notebook.create", { name: "注册考试" })).notebook;
const lawNotebook = (await request("notebook.create", { name: "法律法规", parentId: examNotebook.id })).notebook;
const historyNotebook = (await request("notebook.create", { name: "建筑史", parentId: examNotebook.id })).notebook;
await request("notebook.delete", { notebookId: examNotebook.id });
const remainingNotebookIds = new Set((await request("notebook.list")).notebooks.map((notebook) => notebook.id));
assert.equal(remainingNotebookIds.has(examNotebook.id), false, "an empty parent notebook should be deleted with its children");
assert.equal(remainingNotebookIds.has(lawNotebook.id), false, "an empty child notebook should be deleted with its parent");
assert.equal(remainingNotebookIds.has(historyNotebook.id), false, "every empty descendant should be deleted with the parent");
const blockedNotebook = (await request("notebook.create", { name: "仍有笔记" })).notebook;
const blockedChild = (await request("notebook.create", { name: "子笔记本", parentId: blockedNotebook.id })).notebook;
await request("memo.create", { notebookId: blockedChild.id, title: "还在", contentMarkdown: "keep", tags: [] });
await assert.rejects(request("notebook.delete", { notebookId: blockedNotebook.id }), /notebook_not_empty/);
const blockedNotebookIds = new Set((await request("notebook.list")).notebooks.map((notebook) => notebook.id));
assert.equal(blockedNotebookIds.has(blockedNotebook.id), true, "a notebook with notes in a child should stay");
assert.equal(blockedNotebookIds.has(blockedChild.id), true, "a child notebook that still has notes should stay");

// Reproduce the installed client's failed notebook acknowledgement with notes
// and a child already referring to the placeholder.
const pendingNotebook = (await request("notebook.create", { name: "Notebook remap regression" })).notebook;
const pendingChild = (await request("notebook.create", { name: "Pending child", parentId: pendingNotebook.id })).notebook;
const pendingNotes = [];
for (const contentMarkdown of ["first preserved body", "second preserved body"]) {
  pendingNotes.push((await request("memo.create", { notebookId: pendingNotebook.id, contentMarkdown, tags: [] })).memo);
}
pendingNotes[0] = (await request("memo.update", {
  memoId: pendingNotes[0].id,
  contentMarkdown: "edited body survives recovery",
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "edited body survives recovery" }] }] },
  tags: [],
})).memo;
const notebookQueue = (await request("sync.outbox.list", { limit: 200 })).items;
const parentCreate = notebookQueue.find((item) => item.kind === "notebook.create" && item.entityId === pendingNotebook.id);
for (const item of notebookQueue.filter((item) => item.kind === "memo.create" && pendingNotes.some((memo) => memo.id === item.entityId))) {
  await request("sync.outbox.fail", { id: item.id, version: item.version, error: "Notebook not found", errorCode: "not_found", retryable: false });
}
const dependentUpdate = notebookQueue.find((item) => item.kind === "memo.update" && item.entityId === pendingNotes[0].id);
await request("sync.outbox.fail", { id: dependentUpdate.id, version: dependentUpdate.version, error: "Memo not found", errorCode: "memo_not_found", retryable: false });
const durableNotebook = { ...pendingNotebook, id: "nb_regression_durable" };
await request("sync.apply", { changes: [{ entityType: "notebook", operation: "upsert", entityId: durableNotebook.id, notebook: durableNotebook }] });
// Force the final acknowledgement to fail after all remapping statements.
// Every relationship and queue payload must roll back together.
const inspectionDb = new Database(join(dataDir, "edgeever.sqlite"));
inspectionDb.exec(`CREATE TRIGGER fail_notebook_ack BEFORE DELETE ON _edgeever_sidecar_outbox
  WHEN OLD.id = ${parentCreate.id}
  BEGIN SELECT RAISE(ABORT, 'injected notebook ack failure'); END`);
await assert.rejects(request("sync.outbox.ack", { id: parentCreate.id, version: parentCreate.version, remoteNotebook: durableNotebook }), /injected notebook ack failure/);
assert.equal(inspectionDb.query("SELECT notebook_id FROM memos WHERE id = ?").get(pendingNotes[0].id).notebook_id, pendingNotebook.id);
assert.equal(inspectionDb.query("SELECT parent_id FROM notebooks WHERE id = ?").get(pendingChild.id).parent_id, pendingNotebook.id);
assert.equal(inspectionDb.query("SELECT COUNT(*) AS count FROM notebooks WHERE id = ?").get(pendingNotebook.id).count, 1);
const failedRemapQueue = (await request("sync.outbox.list", { limit: 200, includeConflicts: true })).items;
for (const original of notebookQueue.filter((item) => item.payload.notebookId === pendingNotebook.id || item.payload.parentId === pendingNotebook.id)) {
  const current = failedRemapQueue.find((item) => item.id === original.id);
  assert.equal(current.version, original.version);
  assert.deepEqual(current.payload, original.payload);
}
assert.ok(failedRemapQueue.some((item) => item.id === parentCreate.id));
inspectionDb.exec("DROP TRIGGER fail_notebook_ack");
inspectionDb.close();
await request("sync.outbox.ack", { id: parentCreate.id, version: parentCreate.version, remoteNotebook: durableNotebook });
const afterNotebooks = (await request("notebook.list")).notebooks;
assert.ok(!afterNotebooks.some((notebook) => notebook.id === pendingNotebook.id));
assert.equal(afterNotebooks.find((notebook) => notebook.id === pendingChild.id).parentId, durableNotebook.id);
const remappedQueue = (await request("sync.outbox.list", { limit: 200 })).items;
assert.equal(remappedQueue.find((item) => item.entityId === pendingChild.id).payload.parentId, durableNotebook.id);
for (const memo of pendingNotes) {
  assert.equal((await request("memo.get", { memoId: memo.id })).memo.notebookId, durableNotebook.id);
  assert.equal((await request("memo.get", { memoId: memo.id })).memo.contentMarkdown, memo.contentMarkdown);
  const item = remappedQueue.find((item) => item.kind === "memo.create" && item.entityId === memo.id);
  assert.equal(item.payload.notebookId, durableNotebook.id);
  assert.equal(item.status, "pending", "dependency errors must become eligible after remapping");
  assert.equal(item.version, notebookQueue.find((previous) => previous.id === item.id).version + 1);
}

const recoveredCreate = remappedQueue.find((item) => item.kind === "memo.create" && item.entityId === pendingNotes[0].id);
const recoveredRemoteMemo = { ...pendingNotes[0], id: "memo_recovered_notebook", notebookId: durableNotebook.id, revision: 1 };
await request("sync.outbox.ack", { id: recoveredCreate.id, version: recoveredCreate.version, remoteMemo: recoveredRemoteMemo });
const recoveredUpdate = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.id === dependentUpdate.id);
assert.equal(recoveredUpdate.entityId, recoveredRemoteMemo.id);
assert.equal(recoveredUpdate.payload.memoId, recoveredRemoteMemo.id);
assert.equal(recoveredUpdate.payload.contentMarkdown, "edited body survives recovery");
assert.equal(recoveredUpdate.payload.expectedRevision, 1);
assert.equal(recoveredUpdate.status, "pending", "missing-memo edits should recover after memo create acknowledgement");

// Exercise appearance through the public JSON-RPC boundary, including rollback and sync.
const appearanceBook = (await request("notebook.create", { name: "Appearance regression" })).notebook;
const appearance = { icon: "alarm-clock", color: "#2563eb", textColor: "#dc2626", isBold: true, iconInverted: true, rowInverted: true };
const readAppearance = async () => (await request("notebook.list")).notebooks.find(book => book.id === appearanceBook.id);
const changedAppearance = (await request("notebook.update", { notebookId: appearanceBook.id, ...appearance })).notebook;
for (const [key, value] of Object.entries(appearance)) assert.equal(changedAppearance[key], value);
const appearanceQueue = (await request("sync.outbox.list", { limit: 1000 })).items.find(item => item.kind === "notebook.update" && item.entityId === appearanceBook.id);
assert.ok(appearanceQueue);
for (const [key, value] of Object.entries(appearance)) assert.equal(appearanceQueue.payload[key], value);
await assert.rejects(request("notebook.update", { notebookId: appearanceBook.id, name: "Must roll back", rowInverted: "yes" }), /Invalid notebook/);
assert.equal((await readAppearance()).name, "Appearance regression");
const pulledAppearance = { ...changedAppearance, textColor: "#16a34a", isBold: false, iconInverted: false, rowInverted: false };
await request("sync.apply", { changes: [{ entityType: "notebook", operation: "upsert", entityId: appearanceBook.id, notebook: pulledAppearance }] });
for (const key of Object.keys(appearance)) assert.equal((await readAppearance())[key], pulledAppearance[key]);

child.stdin.end();
await new Promise((resolve) => child.once("close", resolve));
console.log(JSON.stringify({ ok: true, checked: ["notebook.appearance.roundtrip-sync-rollback", "memo.create", "memo.list.search", "memo.list.untitled", "memo.list.noteKind", "memo.list.tag", "memo.list.subtree", "memo.update", "memo.update.coalesce", "memo.revisions", "memo.restoreRevision", "memo.revision.cache", "tag.rename", "memo.moveBatch", "memo.pinBatch", "memo.deleteBatch", "memo.restore", "memo.emptyTrash", "memo.merge", "template.cache", "template.create.payload", "template.delete", "storage.backup", "storage.backups", "storage.restore", "sync.apply.merge-page-order", "sync.apply.deleted-notebook", "sync.apply.renamed-inbox", "sync.outbox", "sync.outbox.notebook-remap", "sync.outbox.notebook-remap-rollback", "sync.outbox.retry", "sync.outbox.recoverMemoUpdate", "sync.outbox.discard", "notebook.delete.empty-tree", "notebook.delete.not-empty"] }));
