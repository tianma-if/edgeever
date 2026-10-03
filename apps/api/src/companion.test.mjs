import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { registerCompanionRoutes } from "./companion-routes.ts";
import { beginCompanionTurn, checkpointCompanionTurn, clearCompanionHistory, companionRevision, forgetCompanionMemory,
  getCompanionTurn, importCompanionMemories, listCompanionMemories, listCompanionTurns, saveCompanionMemory } from "./companion-service.ts";
import { parseCompanionMentionQuery } from "@edgeever/shared";
import { COMPANION_INSTRUCTIONS, companionAgentInstructions, companionMessages, companionTurnInstructions, companionUserContent, selectCompanionMemories, streamCompanion } from "./companion-runtime.ts";
import { applyCompanionAction, proposeCompanionAction, listCompanionActions, dismissCompanionAction } from "./companion-actions.ts";
import { createMemoRecord, getMemoDetail, updateMemoRecord } from "./memo-service.ts";
import { COMPANION_MCP_TOOLS } from "./companion-tool-catalog.ts";
import { AppError } from "./app-error.ts";

const databases = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const scope = { workspaceId: "ws_test", ownerId: "user_test" };
const other = { workspaceId: "ws_other", ownerId: "user_other" };
const input = (overrides = {}) => ({ id: crypto.randomUUID(), threadId: crypto.randomUUID(), message: "I prefer concise answers",
  useMemory: true, allowNotes: false, locale: "en-US", ...overrides });
function fixture(options = {}) {
  const sqlite = new Database(":memory:"); databases.push(sqlite);
  for (const path of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(path, "utf8"));
  for (const id of [scope.workspaceId, other.workspaceId]) sqlite.query("INSERT INTO workspaces(id, name, is_personal) VALUES (?, ?, 1)").run(id, id);
  const storage = createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-companion-unused-resources");
  const app = new Hono();
  app.use("*", async (c, next) => {
    const identity = c.req.header("x-test-other") ? other : scope;
    c.set("auth", { kind: options.agent ? "agent" : "user", actorId: options.anonymous ? null : identity.ownerId,
      workspaceId: identity.workspaceId, role: "member", scopes: [] });
    await next();
  });
  registerCompanionRoutes(app, { isDemoMode: () => options.demo ?? false,
    loadModel: options.loadModel ?? (async () => ({ modelId: "test-model" })),
    loadCredentials: options.loadCredentials, stream: options.stream });
  const request = (path, method = "GET", body, headers = {}) => app.request(`/api/v1/companion/${path}`, {
    method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { storage });
  const context = { env: { storage }, get: () => ({ kind: "user", actorType: "user", actorId: scope.ownerId, workspaceId: scope.workspaceId, role: "member", scopes: [] }) };
  return { sqlite, db: storage.db, request, context };
}
const parseEvents = text => text.split("\n\n").filter(Boolean).map(frame => JSON.parse(frame.slice(6)));
const finish = { type: "finish", finishReason: { unified: "stop" }, usage: {
  inputTokens: { total: 12 }, outputTokens: { total: 8 },
} };

async function organizationFixture() {
  const setup = fixture();
  setup.sqlite.exec("PRAGMA foreign_keys = ON");
  setup.sqlite.query("INSERT INTO notebooks(id, name, workspace_id) VALUES ('nb_ideas', 'Ideas', ?)").run(scope.workspaceId);
  const notes = [];
  for (const [title, contentMarkdown, tags] of [["Idea A", "First unedited thought", ["existing"]], ["Idea B", "Second unedited thought", ["second"]]]) {
    notes.push(await createMemoRecord(setup.db, scope.workspaceId, { notebookId: "nb_ideas", title, contentMarkdown, tags },
      { actorType: "user", actorId: scope.ownerId }, scope.ownerId));
  }
  const row = await beginCompanionTurn(setup.db, scope, input({ allowNotes: true }), "mock-model");
  const inspected = new Map(notes.map(note => [note.id, note.revision]));
  const complete = () => checkpointCompanionTurn(setup.db, scope, row, "Review suggestions", notes.map(({ id, title, revision }) => ({ id, title, revision })), "completed");
  return { ...setup, notes, row, inspected, complete };
}

describe("companion turn context", () => {
  test("focus is model-only data and read-only turns cannot propose writes", () => {
    expect(companionUserContent(input({
      message: "What did I write?",
      focus: { memoId: "memo_1", notebookId: "nb_1", notebookTitle: "功能演示", title: "Pricing", selectionMarkdown: "Q3 cap" },
    }))).toContain("[note:memo_1]");
    expect(companionUserContent(input({
      message: "学习资料里面有哪些笔记?",
      focus: { memoId: "memo_1", notebookId: "nb_demo_features", notebookTitle: "功能演示" },
    }))).toContain("功能演示");
    expect(companionUserContent(input({
      message: "学习资料里面有哪些笔记?",
      focus: { memoId: "memo_1", notebookId: "nb_demo_features", notebookTitle: "功能演示" },
    }))).toContain("not a search filter");
    expect(companionUserContent(input({
      message: "帮我新建一个RAG原理的思维导图。",
      focus: { memoId: "memo_1", notebookId: "nb_demo_features", notebookTitle: "功能演示" },
    }))).toContain("saved in the inbox notebook (等待分类)");
    expect(companionUserContent(input({
      message: "帮我新建一个RAG原理的思维导图。",
      focus: { memoId: "memo_1", notebookId: "nb_demo_features", notebookTitle: "功能演示" },
    }))).toContain("Do not ask which notebook");
    expect(companionUserContent(input({
      message: "根据这篇做思维导图",
      focus: {
        memoId: "memo_1", notebookId: "nb_demo_features", notebookTitle: "功能演示", title: "RAG 原理",
        contentMarkdown: "检索、增强、生成是 RAG 的三步。",
      },
    }))).toContain("检索、增强、生成是 RAG 的三步。");
    expect(companionUserContent(input({
      message: "给这张图加一个评估节点",
      focus: { memoId: "memo_1", notebookId: "nb_demo_features", title: "RAG 原理", diagramKind: "mind-map" },
    }))).toContain("editable mind-map");
    expect(companionUserContent(input({
      message: "整理这些",
      mentions: [{ type: "notebook", id: "nb_study", title: "学习资料" }],
    }))).toContain("[notebook:nb_study]");
    expect(companionUserContent(input({ message: "What did I write?" }))).toBe("What did I write?");
    expect(companionTurnInstructions(input({ allowNotes: true, allowWrites: false }))).toContain("read-only");
    expect(companionTurnInstructions(input({ allowNotes: true }))).toBe("");
    expect(parseCompanionMentionQuery("see @note", 9)).toEqual({ query: "note", start: 4, end: 9 });
    expect(parseCompanionMentionQuery("hello", 5)).toBeNull();
  });

  test("a replacement follow-up retains the latest translation after an older, unrelated translation", () => {
    const next = input({ allowNotes: true, useMemory: false, message: "用翻译后的内容替换原笔记。",
      focus: { memoId: "memo_current", title: "Napoleon quote" } });
    const base = { thread_id: next.threadId, status: "completed", memory_revision: 3, use_memory: 0,
      allow_notes: 1, sources_json: "[]" };
    const history = [
      { ...base, id: "latest", message: "翻译一下当前笔记。", response: "拿破仑说：当你的敌人正在犯错时，千万不要打断他。" },
      { ...base, id: "older", message: "请把下面这段翻译成日文：极客知识库", response: "ギーク知識ベース" },
    ];
    const messages = companionMessages(next, history, 3);
    expect(messages.map(message => message.content)).toEqual([
      history[1].message, history[1].response, history[0].message, history[0].response,
      expect.stringContaining("用翻译后的内容替换原笔记。"),
    ]);
    expect(messages.at(-1).content).toContain("[note:memo_current]");
    expect(COMPANION_INSTRUCTIONS).toContain("An older translation of different text does not override the latest relevant translation.");
  });

  test("unqualified translations follow conversation language and ask only when source already matches", () => {
    const instructions = (message, locale) => companionAgentInstructions(input({ locale, message, allowNotes: true }), [], []);
    expect(instructions("翻译一下当前笔记。", "ja")).toContain("Simplified Chinese (current request)");
    expect(instructions("このノートを翻訳して", "zh-CN")).toContain("Japanese (current request)");
    expect(instructions("このノートを翻訳して", "zh-CN")).toContain("Reply in Japanese unless the user asks otherwise.");
    expect(instructions("Translate this note", "zh-CN")).toContain("English (current request)");
    expect(instructions("Translate this note", "zh-CN")).toContain("source is already mainly in English");
    expect(instructions("Translate this note", "zh-CN")).toContain("otherwise ask which other language");
    const next = input({ locale: "zh-CN", message: "🔄", useMemory: false });
    const prior = { id: "prior", thread_id: next.threadId, status: "completed", memory_revision: 3, use_memory: 0,
      allow_notes: 0, sources_json: "[]", message: "このノートを翻訳して", response: "Translation" };
    expect(companionAgentInstructions(next, [], [], [prior], 3)).toContain("Japanese (recent conversation)");
    expect(companionAgentInstructions(next, [], [], [{ ...prior, use_memory: 1 }], 3)).toContain("Simplified Chinese (interface)");
    expect(companionAgentInstructions({ ...next, message: "请翻译我正在看的内容，并把译文作为回复写给我。" }, [], [], [prior], 3))
      .toContain("Japanese (recent conversation)");
  });
});

describe("companion organization proposals", () => {
  test("proposing does not mutate notes and cannot execute before completion or as another owner", async () => {
    const { db, notes, row, inspected, request, complete } = await organizationFixture();
    const { proposalId } = await proposeCompanionAction(db, scope, row.id, { kind: "tag", memoId: notes[0].id, tags: ["idea"], reason: "same project" }, inspected);
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id)).tags).toEqual(["existing"]);
    await expect(applyCompanionAction(db, scope, proposalId)).rejects.toMatchObject({ code: "companion_action_conflict" });
    await complete();
    expect((await request(`actions/${proposalId}/apply`, "POST", {}, { "x-test-other": "1" })).status).toBe(404);
    await expect(applyCompanionAction(db, { ...scope, ownerId: "other-user" }, proposalId)).rejects.toMatchObject({ status: 404 });
    expect(await listCompanionActions(db, other)).toEqual([]);
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id)).tags).toEqual(["existing"]);
  });

  test("adds tags without replacing body or existing tags; retries recover the same receipt", async () => {
    const { db, notes, row, inspected, complete } = await organizationFixture();
    const { proposalId } = await proposeCompanionAction(db, scope, row.id, { kind: "tag", memoId: notes[0].id, tags: ["existing", "idea", "idea"], reason: "Capture ideas" }, inspected);
    await complete();
    const [first, second] = await Promise.all([applyCompanionAction(db, scope, proposalId), applyCompanionAction(db, scope, proposalId)]);
    expect(first.status).toBe("applied");
    expect(second.resultMemoId).toBe(first.resultMemoId);
    const result = await getMemoDetail(db, scope.workspaceId, notes[0].id);
    expect(result.tags).toEqual(["existing", "idea"]);
    expect(result.contentJson).toEqual(notes[0].contentJson);
    expect(result.revision).toBe(notes[0].revision + 1);
    expect(await applyCompanionAction(db, scope, proposalId)).toEqual(first);
  });

  test("rejects redundant tags and additions beyond capacity without dropping existing tags", async () => {
    const { db, sqlite, notes, row, inspected } = await organizationFixture();
    const plan = { kind: "tag", memoId: notes[0].id, tags: ["existing"], reason: "Organize" };
    await expect(proposeCompanionAction(db, scope, row.id, plan, inspected)).rejects.toMatchObject({ code: "companion_action_no_change" });
    const tags = Array.from({ length: 24 }, (_, i) => `tag-${i}`);
    sqlite.query("UPDATE memos SET tags_json = ? WHERE id = ?").run(JSON.stringify(tags), notes[0].id);
    await expect(proposeCompanionAction(db, scope, row.id, { ...plan, tags: ["new"] }, inspected)).rejects.toMatchObject({ code: "companion_action_tag_limit" });
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id)).tags).toEqual(tags);
    expect(await listCompanionActions(db, scope)).toEqual([]);
  });

  test("merges losslessly in reviewed order and records sources, tags and trash state", async () => {
    const { db, sqlite, notes, row, inspected, complete } = await organizationFixture();
    const { proposalId } = await proposeCompanionAction(db, scope, row.id, { kind: "merge", memoIds: notes.map(n => n.id).reverse(), title: "Collected ideas", reason: "Two parts of one idea" }, inspected);
    await complete();
    const result = await applyCompanionAction(db, scope, proposalId);
    const merged = await getMemoDetail(db, scope.workspaceId, result.resultMemoId);
    expect(merged.title).toBe("Collected ideas");
    expect(merged.tags).toEqual(["second", "existing"]);
    expect(merged.sourceMemoIds).toEqual(notes.map(n => n.id).reverse());
    expect(merged.contentMarkdown.indexOf("Second unedited thought")).toBeLessThan(merged.contentMarkdown.indexOf("First unedited thought"));
    expect(await getMemoDetail(db, scope.workspaceId, notes[0].id)).toBeNull();
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id, true)).isDeleted).toBe(true);
    expect((await applyCompanionAction(db, scope, proposalId)).resultMemoId).toBe(merged.id);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM companion_action_checks").get().count).toBe(0);
  });

  test("rejects uninspected, duplicate, stale or foreign source notes and caps proposals", async () => {
    const { db, notes, row, inspected } = await organizationFixture();
    const plan = { kind: "tag", memoId: notes[0].id, tags: ["new"], reason: "Organize" };
    await expect(proposeCompanionAction(db, scope, row.id, plan, new Map())).rejects.toMatchObject({ code: "companion_action_unread" });
    await expect(proposeCompanionAction(db, other, row.id, plan, inspected)).rejects.toMatchObject({ code: "companion_action_conflict" });
    await expect(proposeCompanionAction(db, scope, row.id, { kind: "merge", memoIds: [notes[0].id, notes[0].id], title: "Dup", reason: "No" }, inspected)).rejects.toMatchObject({ code: "companion_action_unread" });
    for (let i = 0; i < 3; i++) await proposeCompanionAction(db, scope, row.id, plan, inspected);
    await expect(proposeCompanionAction(db, scope, row.id, plan, inspected)).rejects.toMatchObject({ code: "companion_action_conflict" });
  });

  for (const change of ["edit", "delete", "move", "dismiss", "forget", "expire", "clear"]) {
    test(`rejects ${change} after review without touching other notes`, async () => {
      const { db, sqlite, notes, row, inspected, complete } = await organizationFixture();
      const { proposalId } = await proposeCompanionAction(db, scope, row.id, { kind: "merge", memoIds: notes.map(n => n.id), title: "Combined", reason: "same idea" }, inspected);
      await complete();
      if (change === "edit") await updateMemoRecord(db, scope.workspaceId, notes[0].id, { contentMarkdown: "New user thought" }, { actorType: "user", actorId: scope.ownerId }, scope.ownerId);
      if (change === "delete") sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run(notes[0].id);
      if (change === "move") {
        sqlite.query("INSERT INTO notebooks(id, name, workspace_id) VALUES ('nb_moved', 'Moved', ?)").run(scope.workspaceId);
        sqlite.query("UPDATE memos SET notebook_id = 'nb_moved' WHERE id = ?").run(notes[0].id);
      }
      if (change === "dismiss") await dismissCompanionAction(db, scope, proposalId);
      if (change === "forget") await saveCompanionMemory(db, scope, { content: "New context" });
      if (change === "expire") sqlite.query("UPDATE companion_actions SET expires_at = '2000-01-01' WHERE id = ?").run(proposalId);
      if (change === "clear") await clearCompanionHistory(db, scope);
      await expect(applyCompanionAction(db, scope, proposalId)).rejects.toMatchObject({ status: change === "clear" ? 404 : 409 });
      expect((await getMemoDetail(db, scope.workspaceId, notes[1].id)).contentMarkdown).toBe(notes[1].contentMarkdown);
      expect(sqlite.query("SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ?").get(scope.workspaceId).count).toBe(2);
      expect(sqlite.query("SELECT COUNT(*) AS count FROM companion_action_checks").get().count).toBe(0);
    });
  }

  test("the final transaction catches a concurrent edit after the mutation service has read its source", async () => {
    const { db, sqlite, notes, row, inspected, complete } = await organizationFixture();
    const { proposalId } = await proposeCompanionAction(db, scope, row.id, { kind: "tag", memoId: notes[0].id, tags: ["new"], reason: "same project" }, inspected);
    await complete();
    const racingDb = { prepare: sql => db.prepare(sql), batch: async statements => {
      sqlite.query("UPDATE memo_contents SET revision = revision + 1, content_markdown = 'Concurrent user content' WHERE memo_id = ?").run(notes[0].id);
      return db.batch(statements);
    } };
    await expect(applyCompanionAction(racingDb, scope, proposalId)).rejects.toMatchObject({ code: "companion_action_conflict" });
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id)).tags).toEqual(["existing"]);
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id)).contentMarkdown).toBe("Concurrent user content");
    expect(sqlite.query("SELECT COUNT(*) AS count FROM companion_action_checks").get().count).toBe(0);
  });
});

describe("companion persistence and governance", () => {
  test("requires a usable default model to enable discovery but always allows disabling", async () => {
    let modelLoads = 0;
    const unavailable = fixture({ loadModel: async () => {
      modelLoads++;
      throw new AppError("ai_not_configured", "Choose a default AI model first.", 409);
    } });
    const disabled = await unavailable.request("discovery/settings", "PUT", { enabled: false, version: 0 });
    expect(disabled.status).toBe(200);
    expect(modelLoads).toBe(0);
    const rejected = await unavailable.request("discovery/settings", "PUT", { enabled: true, version: 1 });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: { code: "ai_not_configured" } });
    expect(modelLoads).toBe(1);

    const available = fixture({ loadModel: async () => { modelLoads++; return { modelId: "ready" }; } });
    const enabled = await available.request("discovery/settings", "PUT", { enabled: true, version: 0 });
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).settings.enabled).toBe(true);
    expect(modelLoads).toBe(2);
  });
  test("stores, corrects, and forgets only within the owner/workspace pair", async () => {
    const { db } = fixture();
    const memory = await saveCompanionMemory(db, scope, { content: "Be concise" });
    expect(await listCompanionMemories(db, other)).toEqual([]);
    expect(await listCompanionMemories(db, { ...scope, ownerId: "other-owner" })).toEqual([]);
    await expect(saveCompanionMemory(db, other, { content: "tampered" }, memory)).rejects.toMatchObject({ code: "companion_memory_conflict" });
    const corrected = await saveCompanionMemory(db, scope, { content: "Explain tradeoffs" }, memory);
    expect(corrected.version).toBe(2);
    await expect(forgetCompanionMemory(db, scope, memory.id, 1)).rejects.toMatchObject({ code: "companion_memory_conflict" });
    await forgetCompanionMemory(db, scope, memory.id, 2);
    expect(await listCompanionMemories(db, scope)).toEqual([]);
  });
  test("explicit message provenance is validated and detached when history is cleared", async () => {
    const { db } = fixture();
    const row = await beginCompanionTurn(db, scope, input(), "model");
    await checkpointCompanionTurn(db, scope, row, "Understood", [], "completed");
    await expect(saveCompanionMemory(db, other, { content: row.message, sourceTurnId: row.id })).rejects.toMatchObject({ code: "companion_source_invalid" });
    await expect(saveCompanionMemory(db, scope, { content: "invented", sourceTurnId: row.id })).rejects.toMatchObject({ code: "companion_source_invalid" });
    await saveCompanionMemory(db, scope, { content: row.message, sourceTurnId: row.id });
    await clearCompanionHistory(db, scope);
    expect(await listCompanionTurns(db, scope)).toEqual([]);
    expect((await listCompanionMemories(db, scope))[0]).toMatchObject({ sourceTurnId: null, version: 2 });
  });
  test("forgetting cancels in-flight generation and excludes old context", async () => {
    const { db } = fixture();
    const memory = await saveCompanionMemory(db, scope, { content: "My secret preference" });
    const row = await beginCompanionTurn(db, scope, input(), "model");
    await forgetCompanionMemory(db, scope, memory.id, memory.version);
    await expect(checkpointCompanionTurn(db, scope, row, "outdated", [], "completed")).rejects.toMatchObject({ code: "companion_context_changed" });
    expect((await getCompanionTurn(db, scope, row.id)).status).toBe("cancelled");
    const history = [{ ...row, status: "completed", response: "old memory" }];
    const next = input({ threadId: row.thread_id });
    expect(companionMessages(next, history, await companionRevision(db, scope))).toHaveLength(1);
    expect(companionMessages({ ...next, useMemory: false }, history, row.memory_revision)).toHaveLength(1);
    expect(companionMessages(next, [{ ...history[0], sources_json: '[{"id":"deleted"}]' }], row.memory_revision)).toHaveLength(1);
  });
  test("rejected memory edits/deletes leave the context and active turn unchanged", async () => {
    const { db } = fixture();
    const memory = await saveCompanionMemory(db, scope, { content: "original" });
    const updated = await saveCompanionMemory(db, scope, { content: "corrected" }, memory);
    const row = await beginCompanionTurn(db, scope, input(), "model");
    const revision = await companionRevision(db, scope);
    await expect(saveCompanionMemory(db, scope, { content: "stale" }, memory)).rejects.toMatchObject({ code: "companion_memory_conflict" });
    await expect(forgetCompanionMemory(db, scope, memory.id, memory.version)).rejects.toMatchObject({ code: "companion_memory_conflict" });
    expect(await companionRevision(db, scope)).toBe(revision);
    expect((await getCompanionTurn(db, scope, row.id)).status).toBe("running");
    await forgetCompanionMemory(db, scope, updated.id, updated.version);
    expect((await getCompanionTurn(db, scope, row.id)).status).toBe("cancelled");
  });
  test("empty/duplicate imports and capacity failures do not cancel a conversation", async () => {
    const { db } = fixture();
    const contents = Array.from({ length: 50 }, (_, i) => `memory ${i}`);
    await importCompanionMemories(db, scope, contents);
    const row = await beginCompanionTurn(db, scope, input(), "model");
    const revision = await companionRevision(db, scope);
    await importCompanionMemories(db, scope, []);
    await importCompanionMemories(db, scope, contents);
    await expect(importCompanionMemories(db, scope, ["overflow"])).rejects.toMatchObject({ code: "companion_memory_conflict" });
    await expect(saveCompanionMemory(db, scope, { content: "overflow" })).rejects.toMatchObject({ code: "companion_memory_conflict" });
    expect(await companionRevision(db, scope)).toBe(revision);
    expect((await getCompanionTurn(db, scope, row.id)).status).toBe("running");
    await checkpointCompanionTurn(db, scope, row, "still valid", [], "completed");
  });
  test("imports atomically, deduplicates and enforces capacity", async () => {
    const { db } = fixture();
    await importCompanionMemories(db, scope, Array.from({ length: 49 }, (_, i) => `memory ${i}`));
    await expect(importCompanionMemories(db, scope, ["new a", "new b"])).rejects.toMatchObject({ code: "companion_memory_conflict" });
    expect(await listCompanionMemories(db, scope)).toHaveLength(49);
    await importCompanionMemories(db, scope, ["memory 0", "last", "last"]);
    expect(await listCompanionMemories(db, scope)).toHaveLength(50);
    await expect(saveCompanionMemory(db, scope, { content: "overflow" })).rejects.toMatchObject({ code: "companion_memory_conflict" });
  });
  test("one generation per owner, with expired-run recovery", async () => {
    const { db, sqlite } = fixture();
    const first = await beginCompanionTurn(db, scope, input(), "model");
    await expect(beginCompanionTurn(db, scope, input(), "model")).rejects.toMatchObject({ code: "companion_busy" });
    await beginCompanionTurn(db, other, input(), "model");
    sqlite.query("UPDATE companion_turns SET expires_at = '2000-01-01' WHERE id = ?").run(first.id);
    await beginCompanionTurn(db, scope, input(), "model");
    expect((await getCompanionTurn(db, scope, first.id)).status).toBe("interrupted");
  });
});

describe("companion HTTP contracts", () => {
  test("blocks demo, API agents and anonymous identities", async () => {
    for (const options of [{ demo: true }, { agent: true }, { anonymous: true }]) {
      expect((await fixture(options).request("memories")).status).toBe(403);
    }
  });
  test("validates payloads, sanitizes provider errors and scopes export", async () => {
    const { request, db } = fixture({ loadModel: async () => { throw new Error("API-KEY-secret"); } });
    expect((await request("memories", "POST", { content: "x".repeat(501) })).status).toBe(400);
    const failure = await request("turns", "POST", input());
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("API-KEY-secret");
    await saveCompanionMemory(db, scope, { content: "private" });
    const exported = await request("export", "GET", undefined, { "x-test-other": "1" });
    expect((await exported.json()).memories).toEqual([]);
    expect(exported.headers.get("cache-control")).toBe("no-store");
  });
  test("persists displayed chunks and usage, recovers by ID without duplicate model calls", async () => {
    let calls = 0;
    const { request, db } = fixture({ stream: async args => {
      calls++;
      return { totalUsage: Promise.resolve({ inputTokens: 12, outputTokens: 8 }),
        fullStream: (async function* () {
          yield { type: "text-delta", text: "a".repeat(320) };
          expect((await getCompanionTurn(db, scope, args.input.id)).response).toHaveLength(320);
          yield { type: "text-delta", text: " done" };
        })() };
    } });
    const payload = input();
    const response = await request("turns", "POST", payload);
    const events = parseEvents(await response.text());
    expect(events.at(-1)).toMatchObject({ type: "done", turn: { status: "completed", inputTokens: 12, outputTokens: 8 } });
    expect((await request(`turns/${payload.id}`)).status).toBe(200);
    expect((await request(`turns/${payload.id}`, "GET", undefined, { "x-test-other": "1" })).status).toBe(404);
    expect((await request("turns", "POST", payload)).status).toBe(409);
    expect(calls).toBe(1);
  });
  test("stream failure preserves prefix but does not disclose provider details", async () => {
    const { request, db } = fixture({ stream: async () => ({ totalUsage: Promise.resolve({}), fullStream: (async function* () {
      yield { type: "text-delta", text: "partial response" };
      throw new Error("provider-secret");
    })() }) });
    const payload = input();
    const result = await (await request("turns", "POST", payload)).text();
    expect(result).not.toContain("provider-secret");
    expect(parseEvents(result).some(event => event.type === "error" && event.code === "companion_generation_failed")).toBe(true);
    expect((await getCompanionTurn(db, scope, payload.id))).toMatchObject({ status: "failed", response: "partial response" });
  });
  test("maps provider HTTP 400 without leaking the response body", async () => {
    const { request } = fixture({ stream: async () => ({ totalUsage: Promise.resolve({}), fullStream: (async function* () {
      const error = new Error("Invalid schema sk-secret");
      error.statusCode = 400;
      throw error;
    })() }) });
    const result = await (await request("turns", "POST", input())).text();
    expect(result).not.toContain("sk-secret");
    expect(parseEvents(result).some(event => event.type === "error" && event.code === "ai_provider_request_rejected")).toBe(true);
  });
  test("concurrent memory change prevents final outdated output", async () => {
    const { request, db } = fixture({ stream: async () => ({ totalUsage: Promise.resolve({}), fullStream: (async function* () {
      yield { type: "text-delta", text: "a".repeat(300) };
      await saveCompanionMemory(db, scope, { content: "new preference" });
      yield { type: "text-delta", text: "outdated final" };
    })() }) });
    const payload = input();
    const result = await (await request("turns", "POST", payload)).text();
    expect(result).not.toContain("outdated final");
    expect((await getCompanionTurn(db, scope, payload.id)).status).toBe("cancelled");
    expect(parseEvents(result).some(event => event.type === "error")).toBe(true);
  });
  test("text before a tool is sealed as process, later text is the answer", async () => {
    const { request } = fixture({ stream: async args => ({
      totalUsage: Promise.resolve({}),
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Let me read the note." };
        args.run?.tools.push({ id: "tool-1", name: "get_memo", status: "done", effects: [] });
        await args.run?.onProgress?.();
        yield { type: "text-delta", text: "Created the map." };
      })(),
    }) });
    const events = parseEvents(await (await request("turns", "POST", input({ allowNotes: true }))).text());
    expect(events.some(event => event.type === "process" && event.text.includes("Let me read the note."))).toBe(true);
    expect(events.at(-1).turn.process).toContain("Let me read the note.");
    expect(events.at(-1).turn.response).toBe("Created the map.");
  });
  test("tool-only runs complete without assistant text and persist the timeline", async () => {
    const { request, db } = fixture({ stream: async args => {
      args.run?.tools.push({ id: "tool-1", name: "create_memo", status: "done", effects: [{ kind: "created", memoId: "memo_1", title: "New" }] });
      await args.run?.onProgress?.();
      return { totalUsage: Promise.resolve({ inputTokens: 4, outputTokens: 0 }), fullStream: (async function* () {})() };
    } });
    const payload = input({ allowNotes: true });
    const events = parseEvents(await (await request("turns", "POST", payload)).text());
    expect(events.some(event => event.type === "tools" && event.tools[0]?.name === "create_memo")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", turn: { status: "completed", tools: [{ name: "create_memo" }] } });
    expect((await getCompanionTurn(db, scope, payload.id)).tools_json).toContain("create_memo");
  });
  test("asking the user pauses the turn until answers resume it", async () => {
    let calls = 0;
    const { request, db } = fixture({ stream: async args => {
      calls++;
      if (calls === 1) {
        args.run?.questions.push({ id: "notebook", prompt: "Which notebook?", inputType: "single_select", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] });
        args.run.pause.ask = true;
        await args.run?.onProgress?.();
      }
      return { totalUsage: Promise.resolve({}), fullStream: (async function* () {
        yield { type: "text-delta", text: calls === 1 ? "Need a notebook." : " Using A." };
      })() };
    } });
    const payload = input({ allowNotes: true });
    const events = parseEvents(await (await request("turns", "POST", payload)).text());
    expect(events.at(-1).turn.status).toBe("interrupted");
    expect(events.at(-1).turn.questions[0].id).toBe("notebook");
    expect((await request(`turns/${payload.id}/resume`, "POST", {})).status).toBe(400);
    const resumed = parseEvents(await (await request(`turns/${payload.id}/resume`, "POST", { answers: [{ questionId: "notebook", optionIds: ["a"] }] })).text());
    expect(resumed.at(-1).turn.status).toBe("completed");
    expect((await getCompanionTurn(db, scope, payload.id)).answers_json).toContain("notebook");
  });
  test("interrupted runs can resume on the same turn", async () => {
    let calls = 0;
    const { request, db } = fixture({ stream: async () => {
      calls++;
      return { totalUsage: Promise.resolve({}), fullStream: (async function* () {
        if (calls === 1) {
          yield { type: "text-delta", text: "working" };
          throw new Error("timeout-like");
        }
        yield { type: "text-delta", text: " continued" };
      })() };
    } });
    const payload = input({ allowNotes: true });
    await (await request("turns", "POST", payload)).text();
    expect((await getCompanionTurn(db, scope, payload.id)).status).toBe("failed");
    await db.prepare("UPDATE companion_turns SET status = 'interrupted' WHERE id = ?").bind(payload.id).run();
    const events = parseEvents(await (await request(`turns/${payload.id}/resume`, "POST", {})).text());
    expect(calls).toBe(2);
    expect(events.at(-1).turn.response).toContain("continued");
    expect(events.at(-1).turn.status).toBe("completed");
  });
});

describe("companion client-direct HTTP contracts", () => {
  const credentials = {
    provider: "openai-compatible",
    baseUrl: "https://api.example/v1",
    apiKey: "direct-key",
    modelId: "direct-model",
  };
  const directFixture = () => fixture({
    stream: async () => ({ totalUsage: Promise.resolve({}), fullStream: (async function* () {
      yield { type: "text-delta", text: "proxied" };
    })() }),
    loadCredentials: async () => credentials,
  });

  test("prepare returns model credentials and does not invoke the proxy stream", async () => {
    let streamed = 0;
    const { request } = fixture({
      stream: async () => {
        streamed++;
        return { totalUsage: Promise.resolve({}), fullStream: (async function* () {})() };
      },
      loadCredentials: async () => credentials,
    });
    const payload = input({ allowNotes: true });
    const response = await request("turns/prepare", "POST", payload);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(streamed).toBe(0);
    expect(body.apiKey).toBe("direct-key");
    expect(body.modelId).toBe("direct-model");
    expect(body.provider).toBe("openai-compatible");
    expect(body.instructions).toContain("untrusted DATA");
    expect(body.messages.at(-1).content).toBe(payload.message);
    expect(body.tools.some(tool => tool.name === "search_memos")).toBe(true);
    expect(body.tools.some(tool => tool.name === "todo_write")).toBe(true);
    expect(body.maxSteps).toBe(8);
    expect((await request("turns/prepare", "POST", payload)).status).toBe(409);
  });

  test("tool execute, checkpoint and complete persist a client-driven turn", async () => {
    const setup = fixture({ loadCredentials: async () => credentials });
    setup.sqlite.exec("PRAGMA foreign_keys = ON");
    setup.sqlite.query("INSERT INTO notebooks(id, name, workspace_id) VALUES ('nb_ideas', 'Ideas', ?)").run(scope.workspaceId);
    await createMemoRecord(setup.db, scope.workspaceId, {
      notebookId: "nb_ideas", title: "Idea A", contentMarkdown: "First unedited thought", tags: ["existing"],
    }, { actorType: "user", actorId: scope.ownerId }, scope.ownerId);
    const payload = input({ allowNotes: true });
    expect((await setup.request("turns/prepare", "POST", payload)).status).toBe(200);
    const listed = await setup.request(`turns/${payload.id}/tools`, "POST", {
      name: "search_memos", input: { query: "Idea" }, response: "", process: "",
    });
    expect(listed.status).toBe(200);
    const toolBody = await listed.json();
    expect(toolBody.tools[0]).toMatchObject({ name: "search_memos", status: "done" });
    expect((await setup.request(`turns/${payload.id}/checkpoint`, "POST", { response: "Working" })).status).toBe(200);
    const completed = await setup.request(`turns/${payload.id}/complete`, "POST", {
      response: "Found the notes.", status: "completed", inputTokens: 9, outputTokens: 4,
    });
    expect(completed.status).toBe(200);
    expect((await completed.json()).turn).toMatchObject({
      status: "completed", response: "Found the notes.", inputTokens: 9, outputTokens: 4,
    });
    expect((await getCompanionTurn(setup.db, scope, payload.id)).status).toBe("completed");
  });

  test("proxy streams an already prepared running turn", async () => {
    const { request } = directFixture();
    const payload = input();
    expect((await request("turns/prepare", "POST", payload)).status).toBe(200);
    const events = parseEvents(await (await request(`turns/${payload.id}/proxy`, "POST", {})).text());
    expect(events.some(event => event.type === "text-delta" && event.text === "proxied")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", turn: { status: "completed" } });
  });
});

describe("actual AI SDK companion runtime", () => {
  test("assistant instructions describe direct note edits and trustworthy receipts", () => {
    expect(COMPANION_INSTRUCTIONS).toContain("update_memo with contentMarkdown, execute immediately");
    expect(COMPANION_INSTRUCTIONS).toContain("Read the complete current note before replacing its body");
    expect(COMPANION_INSTRUCTIONS).toContain("Only report a note operation as completed when the tool result says applied");
    expect(COMPANION_INSTRUCTIONS).not.toContain("awaiting_user_confirmation");
    expect(COMPANION_INSTRUCTIONS).toContain("[Note title](#memo=memo_abc123)");
    expect(COMPANION_INSTRUCTIONS).toContain("Do not drop memo_");
    expect(COMPANION_INSTRUCTIONS).toContain("not as a heading");
    expect(COMPANION_INSTRUCTIONS).toContain("Do not paste note bodies");
    expect(COMPANION_INSTRUCTIONS).toContain("find_notebooks");
    expect(COMPANION_INSTRUCTIONS).toContain("Do not ask permission to search");
    expect(COMPANION_INSTRUCTIONS).toContain("createdAfter");
    expect(COMPANION_INSTRUCTIONS).toContain("Do not ask which notebook or tag first");
    expect(COMPANION_INSTRUCTIONS).toContain("after you have already searched");
    expect(COMPANION_INSTRUCTIONS).toContain("create_diagram_memo");
    expect(COMPANION_INSTRUCTIONS).toContain("create_infographic_memo");
    expect(COMPANION_INSTRUCTIONS).toContain("信息图");
    expect(COMPANION_INSTRUCTIONS).toContain("chart-pie-donut-plain-text");
    expect(COMPANION_INSTRUCTIONS).toContain("思维导图");
    expect(COMPANION_INSTRUCTIONS).toContain("架构图/architecture diagram means kind=architecture");
    expect(COMPANION_INSTRUCTIONS).toContain("update_diagram");
    expect(COMPANION_INSTRUCTIONS).toContain("这篇");
    expect(COMPANION_INSTRUCTIONS).not.toContain("You cannot create or edit diagrams");
    expect(COMPANION_INSTRUCTIONS).not.toContain("You cannot edit existing diagrams");
    expect(COMPANION_INSTRUCTIONS).toContain("use_note_template");
    expect(COMPANION_INSTRUCTIONS).toContain("todo_write");
    expect(COMPANION_INSTRUCTIONS).toContain("ask_user_question");
    expect(COMPANION_INSTRUCTIONS).toContain("Omit notebookId and it is saved in the inbox notebook (等待分类)");
    expect(COMPANION_INSTRUCTIONS).toContain("Do not ask which notebook, and do not use the open notebook unless the user named it");
    expect(COMPANION_INSTRUCTIONS).not.toContain("use the open notebook from Focus DATA");
    expect(COMPANION_INSTRUCTIONS).toContain("Do not narrate");
    expect(COMPANION_INSTRUCTIONS).toContain("AI instructions");
    expect(COMPANION_INSTRUCTIONS).toContain("cannot empty the trash");
    expect(COMPANION_INSTRUCTIONS).toContain("delete note templates");
  });

  test("the real tool loop applies tag writes immediately without a confirmation card", async () => {
    const { db, notes, row, complete, context } = await organizationFixture();
    const calls = [
      { toolName: "search_memos", input: JSON.stringify({ query: "Idea" }) },
      { toolName: "get_memo", input: JSON.stringify({ memoId: notes[0].id }) },
      { toolName: "add_tags_to_memos", input: JSON.stringify({ memoIds: [notes[0].id], tags: ["idea"] }) },
    ];
    const model = new MockLanguageModelV4({ doStream: async () => {
      const call = calls.shift();
      return { stream: simulateReadableStream({ chunks: call ? [
        { type: "tool-call", toolCallId: crypto.randomUUID(), ...call }, { ...finish, finishReason: { unified: "tool-calls" } },
      ] : [{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "Tagged." }, { type: "text-end", id: "1" }, finish] }) };
    } });
    const result = await streamCompanion({ db, context, scope, input: input({ id: row.id, threadId: row.thread_id, allowNotes: true }), model,
      memories: [], history: [], revision: 0, signal: new AbortController().signal, sources: [], assertActive: async () => {} });
    expect(await result.text).toBe("Tagged.");
    expect(model.doStreamCalls[0].tools.map(t => t.name).sort()).toEqual([...COMPANION_MCP_TOOLS.map(t => t.name), "ask_user_question", "todo_write"].sort());
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id)).tags).toEqual(["existing", "idea"]);
    await complete();
    expect(await listCompanionActions(db, scope)).toEqual([]);
  });

  test("the real tool loop replaces note content without a confirmation card", async () => {
    const { db, notes, row, complete, context } = await organizationFixture();
    const calls = [
      { toolName: "get_memo", input: JSON.stringify({ memoId: notes[0].id }) },
      { toolName: "update_memo", input: JSON.stringify({ memoId: notes[0].id, contentMarkdown: "Translated content" }) },
    ];
    const model = new MockLanguageModelV4({ doStream: async () => {
      const call = calls.shift();
      return { stream: simulateReadableStream({ chunks: call ? [
        { type: "tool-call", toolCallId: crypto.randomUUID(), ...call }, { ...finish, finishReason: { unified: "tool-calls" } },
      ] : [{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "Updated." }, { type: "text-end", id: "1" }, finish] }) };
    } });
    const result = await streamCompanion({ db, context, scope, input: input({ id: row.id, threadId: row.thread_id, allowNotes: true }), model,
      memories: [], history: [], revision: 0, signal: new AbortController().signal, sources: [], assertActive: async () => {} });
    expect(await result.text).toBe("Updated.");
    expect((await getMemoDetail(db, scope.workspaceId, notes[0].id)).contentMarkdown).toBe("Translated content");
    await complete();
    expect(await listCompanionActions(db, scope)).toEqual([]);
  });

  test("truncated notes cannot be used for a body edit", async () => {
    const { db, notes, row, context } = await organizationFixture();
    await updateMemoRecord(db, scope.workspaceId, notes[0].id, { contentMarkdown: "x".repeat(9000) }, { actorType: "user", actorId: scope.ownerId }, scope.ownerId);
    const calls = [
      { toolName: "search_memos", input: JSON.stringify({ query: "Idea" }) },
      { toolName: "get_memo", input: JSON.stringify({ memoId: notes[0].id }) },
      { toolName: "update_memo", input: JSON.stringify({ memoId: notes[0].id, contentMarkdown: "Shortened", _reason: "Only partial evidence" }) },
    ];
    const model = new MockLanguageModelV4({ doStream: async () => {
      const call = calls.shift();
      return { stream: simulateReadableStream({ chunks: call ? [
        { type: "tool-call", toolCallId: crypto.randomUUID(), ...call }, { ...finish, finishReason: { unified: "tool-calls" } },
      ] : [{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "Not enough evidence." }, { type: "text-end", id: "1" }, finish] }) };
    } });
    const result = await streamCompanion({ db, context, scope, input: input({ id: row.id, threadId: row.thread_id, allowNotes: true }), model,
      memories: [], history: [], revision: 0, signal: new AbortController().signal, sources: [], assertActive: async () => {} });
    expect(await result.text).toBe("Not enough evidence.");
    expect(await listCompanionActions(db, scope)).toEqual([]);
  });

  test("shared tools search scoped notes and cannot read another workspace's ID", async () => {
    const { db, sqlite, context } = fixture();
    for (const [id, workspaceId, deleted] of [["mine", scope.workspaceId, 0], ["foreign", other.workspaceId, 0], ["trashed", scope.workspaceId, 1]]) {
      sqlite.query("INSERT INTO notebooks(id, name, workspace_id) VALUES (?, ?, ?)").run(`nb-${id}`, id, workspaceId);
      sqlite.query("INSERT INTO memos(id, notebook_id, title, excerpt, workspace_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, `nb-${id}`, "testnote", `text-${id}`, workspaceId, deleted);
      sqlite.query("INSERT INTO memo_contents(memo_id, content_json, content_hash, content_markdown, content_text) VALUES (?, '{}', 'hash', ?, ?)")
        .run(id, `text-${id}`, `text-${id}`);
    }
    const calls = [
      { toolName: "get_memo", input: JSON.stringify({ memoId: "foreign" }) },
      { toolName: "search_memos", input: JSON.stringify({ query: "testnote" }) },
      { toolName: "get_memo", input: JSON.stringify({ memoId: "mine" }) },
    ];
    const model = new MockLanguageModelV4({ doStream: async () => {
      const call = calls.shift();
      return { stream: simulateReadableStream({ chunks: call ? [
        { type: "tool-call", toolCallId: crypto.randomUUID(), ...call },
        { ...finish, finishReason: { unified: "tool-calls" } },
      ] : [{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "Found your note" }, { type: "text-end", id: "1" }, finish] }) };
    } });
    const sources = [];
    const result = await streamCompanion({ db, context, scope, input: input({ allowNotes: true }), model, memories: [], history: [],
      revision: 0, signal: new AbortController().signal, sources, assertActive: async () => {} });
    expect(await result.text).toBe("Found your note");
    expect(model.doStreamCalls).toHaveLength(4);
    expect(model.doStreamCalls[0].tools.map(tool => tool.name).sort()).toEqual([...COMPANION_MCP_TOOLS.map(t => t.name), "ask_user_question", "todo_write"].sort());
    expect(sources.map(source => source.id)).toEqual(["mine"]);
    const prompt = JSON.stringify(model.doStreamCalls.at(-1).prompt);
    expect(prompt).toContain("Memo not found");
    expect(prompt).toContain("text-mine");
    expect(prompt).not.toContain("text-foreign");
    expect(prompt).not.toContain("text-trashed");
  });

  test("disabled note access exposes no tools; only explicitly enabled memory enters prompt", async () => {
    const { db } = fixture();
    const model = new MockLanguageModelV4({ doStream: { stream: simulateReadableStream({ chunks: [
      { type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "Hello" }, { type: "text-end", id: "1" }, finish,
    ] }) } });
    const memories = [{ content: "private-memory", updatedAt: "2026-01-01" }];
    const result = await streamCompanion({ db, scope, input: input({ useMemory: false }), model, memories,
      history: [], revision: 0, signal: new AbortController().signal, sources: [], assertActive: async () => {} });
    expect(await result.text).toBe("Hello");
    const call = model.doStreamCalls[0];
    expect(call.tools?.length ?? 0).toBe(0);
    expect(JSON.stringify(call.prompt)).not.toContain("private-memory");
    expect(JSON.stringify(call.prompt)).toContain("untrusted DATA");
    expect(call.maxOutputTokens).toBe(2048);
  });
  test("memory selection and history size stay bounded", () => {
    const memories = Array.from({ length: 50 }, () => ({ content: "a".repeat(500), updatedAt: "2026-01-01" }));
    expect(selectCompanionMemories(memories, "hello")).toHaveLength(2);
    const next = input();
    const history = Array.from({ length: 100 }, () => ({ id: crypto.randomUUID(), thread_id: next.threadId, status: "completed", memory_revision: 1, use_memory: 1,
      allow_notes: 0, sources_json: "[]", message: "user", response: "reply" }));
    expect(companionMessages(next, history, 1)).toHaveLength(13);
  });
  test("Chinese questions recall older relevant memories within the fixed budget", () => {
    const old = { id: "coffee", content: "咖啡偏好：我喜欢不加糖的咖啡。", updatedAt: "2020-01-01" };
    const newer = Array.from({ length: 49 }, (_, i) => ({ id: String(i), content: "与问题无关的记录。".repeat(50), updatedAt: "2026-01-01" }));
    const memories = [...newer, old];
    const selected = selectCompanionMemories(memories, "我的咖啡偏好是什么？");
    expect(selected[0].id).toBe("coffee");
    expect(selected).toHaveLength(1);
    expect(memories.at(-1)).toBe(old);
  });
  test("normalizes Unicode and matches words rather than accidental substrings", () => {
    const memories = [
      { id: "trust", content: "Trust matters", updatedAt: "2026-01-01" },
      { id: "rust", content: "The desktop sidecar uses Rust", updatedAt: "2020-01-01" },
    ];
    expect(selectCompanionMemories(memories, "ＲＵＳＴ")[0].id).toBe("rust");
    expect(selectCompanionMemories(memories, "？？？")[0].id).toBe("trust");
  });
  test("memory context keeps at most eight relevant records within 4000 characters without deleting stored data", () => {
    const memories = Array.from({ length: 50 }, (_, i) => ({ id: String(i), content: `coffee ${i} ` + "x".repeat(490), updatedAt: "2026-01-01" }));
    const selected = selectCompanionMemories(memories, "coffee");
    expect(selected).toHaveLength(8);
    expect(selected.reduce((sum, memory) => sum + memory.content.length, 0)).toBeLessThanOrEqual(4000);
    expect(memories).toHaveLength(50);
    expect(selectCompanionMemories(memories, "unrelated")).toHaveLength(2);
  });
  test("memory-off mode keeps only safe same-thread history and respects forgetting", () => {
    const next = input({ useMemory: false });
    const safe = { id: "safe", thread_id: next.threadId, status: "completed", memory_revision: 3, use_memory: 0,
      allow_notes: 0, sources_json: "[]", message: "Help me write a title", response: "A small beginning" };
    const history = [
      { ...safe, id: "private", use_memory: 1, response: "memory-derived secret" },
      { ...safe, id: "note", sources_json: '[{"id":"note"}]', response: "note-derived secret" },
      { ...safe, id: "metadata", allow_notes: 1, response: "notebook-name secret" },
      { ...safe, id: "forgotten", memory_revision: 2, response: "forgotten secret" },
      { ...safe, id: "another-thread", thread_id: crypto.randomUUID(), response: "other-thread secret" },
      { ...safe, id: "partial", status: "failed", response: "partial secret" }, safe,
    ];
    const messages = companionMessages(next, history, 3);
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toBe("A small beginning");
    expect(JSON.stringify(messages)).not.toContain("secret");
    expect(companionMessages({ ...next, useMemory: true }, [safe], 3)).toHaveLength(3);
    expect(companionMessages(next, [safe], 4)).toHaveLength(1);
  });
  test("note-enabled follow-ups keep prior sourced replies", () => {
    const next = input({ allowNotes: true, useMemory: false, message: "把第二篇打开" });
    const prior = { id: "listed", thread_id: next.threadId, status: "completed", memory_revision: 3, use_memory: 0,
      allow_notes: 1, sources_json: '[{"id":"memo_1","title":"随手记下"}]', message: "学习资料里面有哪些笔记?",
      response: "[随手记下](#memo=memo_1)" };
    const messages = companionMessages(next, [prior], 3);
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toContain("随手记下");
    expect(companionMessages(input({ allowNotes: false, useMemory: false, threadId: next.threadId }), [prior], 3)).toHaveLength(1);
  });
  test("large histories have a total budget and never split message pairs", () => {
    const next = input({ message: "current" });
    const history = Array.from({ length: 6 }, (_, index) => ({ id: String(index), thread_id: next.threadId,
      status: "completed", memory_revision: 1, use_memory: 1, allow_notes: 0, sources_json: "[]", message: "u".repeat(4000), response: "a".repeat(4000) }));
    const messages = companionMessages(next, history, 1);
    expect(messages).toHaveLength(3);
    expect(messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages.slice(0, -1).reduce((total, m) => total + m.content.length, 0)).toBeLessThanOrEqual(12000);
    expect(messages.at(-1).content).toBe("current");
  });
});
