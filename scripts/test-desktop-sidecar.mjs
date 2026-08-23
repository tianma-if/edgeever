import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const inbox = (await request("notebook.create", { name: "Inbox" })).notebook;
if (process.platform !== "win32") {
  assert.equal(statSync(dataDir).mode & 0o777, 0o700, "sidecar data directory should be private");
  assert.equal(statSync(join(dataDir, "edgeever.sqlite")).mode & 0o777, 0o600, "sidecar database should be private");
}

const first = await request("memo.create", { notebookId: inbox.id, title: "Local first", contentMarkdown: "searchable body", tags: ["local"] });
assert.deepEqual(await request("sync.bootstrap.prepare"), { clearedSeedData: false, rebuiltMirror: false });
assert.equal((await request("memo.get", { memoId: first.memo.id })).memo.id, first.memo.id, "bootstrap preparation must preserve local user data");
const second = await request("memo.create", { notebookId: inbox.id, title: "Second memo", contentMarkdown: "another body", tags: [] });
const search = await request("memo.list", { q: "searchable", limit: 20 });
assert.deepEqual(search.memos.map((memo) => memo.id), [first.memo.id]);
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
const conflictMemo = await request("memo.create", { notebookId: inbox.id, title: "Conflict test", contentMarkdown: "local conflict", tags: [] });
const conflictCandidate = (await request("sync.outbox.list", { limit: 200 })).items.find((item) => item.entityId === conflictMemo.memo.id);
assert.ok(conflictCandidate, "conflict test should create an outbox item");
await request("sync.outbox.fail", { id: conflictCandidate.id, error: "test conflict", conflict: true });
assert.ok((await request("sync.outbox.list", { limit: 200 })).items.some((item) => item.id === conflictCandidate.id && item.status === "conflict"));
await request("sync.outbox.discard", { id: conflictCandidate.id });
assert.equal((await request("sync.status")).conflict, 0);

child.stdin.end();
await new Promise((resolve) => child.once("close", resolve));
console.log(JSON.stringify({ ok: true, checked: ["memo.create", "memo.list.search", "memo.list.subtree", "memo.update", "memo.update.coalesce", "memo.revisions", "memo.restoreRevision", "memo.revision.cache", "tag.rename", "memo.moveBatch", "memo.pinBatch", "memo.deleteBatch", "memo.restore", "memo.emptyTrash", "memo.merge", "template.cache", "template.create.payload", "template.delete", "storage.backup", "storage.backups", "storage.restore", "sync.outbox", "sync.outbox.discard"] }));
