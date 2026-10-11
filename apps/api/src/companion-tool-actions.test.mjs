import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { registerCompanionRoutes } from "./companion-routes.ts";
import { beginCompanionTurn, checkpointCompanionTurn, clearCompanionHistory, saveCompanionMemory } from "./companion-service.ts";
import { createPosterDocument, serializePosterDocument, parsePosterDocument, createDefaultTableDocument, parseDiagramDocument, parseInfographicDocument, parseTableDocument, serializeTableDocument } from "@edgeever/shared";
import { createMemoRecord, getMemoDetail, normalizeSearchTimeBound, updateMemoRecord } from "./memo-service.ts";
import { companionWorkspaceCursor, proposeCompanionToolAction } from "./companion-tool-actions.ts";
import { getCompanionAction, applyCompanionAction, dismissCompanionAction } from "./companion-actions.ts";
import { COMPANION_MCP_TOOLS, validateCompanionTool } from "./companion-tool-catalog.ts";
import { MCP_TOOLS } from "./mcp-tools.ts";
import { companionToolDefinitions, createCompanionTools, explicitDiagramKind, requestsInfographic, resolveWorkspaceInboxId } from "./companion-agent-tools.ts";
import { companionExecutionReceipts } from "./companion-runtime.ts";

const databases = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const scope = { workspaceId: "ws_test", ownerId: "owner" };
const actor = { actorType: "user", actorId: scope.ownerId };
async function setup() {
  const sqlite = new Database(":memory:"); databases.push(sqlite);
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  sqlite.query("INSERT INTO workspaces(id, name) VALUES (?, 'Test')").run(scope.workspaceId);
  for (const id of ["ideas", "target"]) sqlite.query("INSERT INTO notebooks(id, workspace_id, name) VALUES (?, ?, ?)").run(id, scope.workspaceId, id);
  const storage = createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-companion-tool-test-unused");
  const db = storage.db;
  const auth = { kind: "user", actorType: "user", actorId: scope.ownerId, workspaceId: scope.workspaceId, scopes: [], role: "member" };
  const context = { env: { storage }, get: () => auth };
  const notes = [];
  for (const title of ["One", "Two"]) notes.push(await createMemoRecord(db, scope.workspaceId,
    { notebookId: "ideas", title, contentMarkdown: `${title} original content`, tags: ["old"] }, actor, "owner"));
  const input = { id: crypto.randomUUID(), threadId: crypto.randomUUID(), message: "Organize my notes", allowNotes: true, useMemory: false, locale: "en-US" };
  const turn = await beginCompanionTurn(db, scope, input, "mock");
  const complete = () => checkpointCompanionTurn(db, scope, turn, "Review the operations", [], "completed");
  const propose = async (name, args, inspected = new Map(notes.map(note => [note.id, note.revision]))) => {
    const { proposalId } = await proposeCompanionToolAction(db, scope, turn.id, name, args, "User-requested organization",
      await companionWorkspaceCursor(db, scope.workspaceId), inspected);
    return proposalId;
  };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("auth", c.req.header("x-other") ? { ...auth, actorId: "other" } : auth); await next(); });
  registerCompanionRoutes(app, { isDemoMode: () => false });
  const request = (path, body = {}, headers = {}) => app.request(`/api/v1/companion/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }, context.env);
  return { sqlite, db, storage, context, notes, input, turn, complete, propose, request };
}

describe("shared companion MCP adapter", () => {
  test("reuses the exact reviewed MCP definitions, with no administration or upload tools", () => {
    expect(COMPANION_MCP_TOOLS).toHaveLength(49);
    for (const definition of COMPANION_MCP_TOOLS) expect(MCP_TOOLS.includes(definition)).toBe(true);
    for (const name of ["upload_memo_image", "upload_memo_attachment", "empty_trash", "share_memo"]) {
      expect(() => validateCompanionTool(name, {})).toThrow();
    }
    expect(() => validateCompanionTool("create_memo", { notebookId: "ideas", unexpected: true })).toThrow();
    expect(() => validateCompanionTool("trash_memos", { memoIds: [] })).toThrow();
    expect(() => validateCompanionTool("update_memo", { memoId: "x", expectedRevision: -1 })).toThrow();
    expect(() => validateCompanionTool("create_memo", { notebookId: "ideas", contentMarkdown: "x".repeat(25000) })).toThrow();
  });

  const operations = [
    ["create_memo", n => ({ notebookId: "ideas", title: "New", contentMarkdown: "Exact new body" })],
    ["update_memo", n => ({ memoId: n[0].id, title: "Changed", contentMarkdown: "Exact replacement" })],
    ["merge_memos", n => ({ memoIds: n.map(note => note.id), title: "Merged", notebookId: "target" })],
    ["move_memos", n => ({ memoIds: [n[0].id], notebookId: "target" })],
    ["add_tags_to_memos", n => ({ memoIds: [n[0].id], tags: ["new"] })],
    ["remove_tags_from_memos", n => ({ memoIds: [n[0].id], tags: ["old"] })],
    ["rename_tag", () => ({ from: "old", to: "renamed" })],
    ["delete_tag", () => ({ tag: "old" })],
    ["trash_memos", n => ({ memoIds: [n[0].id] })],
    ["restore_memos", n => ({ memoIds: [n[0].id] })],
    ["create_notebook", () => ({ name: "Created notebook" })],
    ["rename_notebook", () => ({ notebookId: "ideas", name: "Renamed notebook" })],
    ["move_notebook", () => ({ notebookId: "target", parentId: "ideas" })],
    ["import_memos", () => ({ source: "test", notebookId: "ideas", items: [{ externalId: "one", contentMarkdown: "Imported body" }] })],
  ];
  for (const [name, parameters] of operations) test(`${name} proposes without writing, then confirms through the shared executor`, async () => {
    const f = await setup();
    if (name === "restore_memos") f.sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run(f.notes[0].id);
    const before = f.sqlite.query("SELECT id, title, notebook_id, tags_json, is_deleted FROM memos ORDER BY id").all();
    const id = await f.propose(name, parameters(f.notes));
    expect(f.sqlite.query("SELECT id, title, notebook_id, tags_json, is_deleted FROM memos ORDER BY id").all()).toEqual(before);
    expect((await f.request(`actions/${id}/apply`)).status).toBe(409);
    await f.complete();
    const response = await f.request(`actions/${id}/apply`, { arguments: { title: "tampered" } });
    const body = await response.json();
    expect(body).toMatchObject({ action: { status: "applied", plan: { toolName: name } } });
    expect(response.status).toBe(200);
    expect(await (await f.request(`actions/${id}/apply`)).json()).toEqual(body);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_action_checks").get().n).toBe(0);
    const note = await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id, true);
    if (name === "update_memo") expect(note).toMatchObject({ title: "Changed", contentMarkdown: "Exact replacement" });
    if (name === "move_memos") expect(note.notebookId).toBe("target");
    if (name === "add_tags_to_memos") expect(note.tags).toEqual(["old", "new"]);
    if (name === "remove_tags_from_memos" || name === "delete_tag") expect(note.tags).toEqual([]);
    if (name === "rename_tag") expect(note.tags).toEqual(["renamed"]);
    if (name === "trash_memos" || name === "merge_memos") expect(note.isDeleted).toBe(true);
    if (name === "restore_memos") expect(note.isDeleted).toBe(false);
    if (name === "create_memo" || name === "merge_memos") expect(body.action.resultMemoId).toBeTruthy();
    if (name === "merge_memos") expect(body.action.resultNotebookId).toBe("target");
  });

  test("restores a historical revision using the existing revision service", async () => {
    const f = await setup();
    await updateMemoRecord(f.db, scope.workspaceId, f.notes[0].id, { contentMarkdown: "New body" }, actor, "owner");
    const revision = f.sqlite.query("SELECT id FROM memo_revisions WHERE memo_id = ? ORDER BY created_at LIMIT 1").get(f.notes[0].id);
    const id = await f.propose("restore_memo_revision", { memoId: f.notes[0].id, revisionId: revision.id });
    await f.complete();
    expect(await (await f.request(`actions/${id}/apply`)).json()).toMatchObject({ action: { status: "applied" } });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).contentMarkdown).toBe("One original content");
  });

  test("read and dry-run tools reuse MCP without writing or requiring a proposal", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    expect(Object.keys(tools)).toHaveLength(51);
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toMatchObject({ content: "One original content" });
    expect(await tools.trash_memos.execute({ memoIds: [f.notes[0].id], dryRun: true })).toMatchObject({ dryRun: true });
    expect(await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).not.toBeNull();
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
    expect(createCompanionTools({ ...f, scope, input: { ...f.input, allowNotes: false } })).toEqual({});
  });
  test("poster changes use the shared agent execution path with read and revision guards", async () => {
    const f = await setup();
    const created = await createMemoRecord(f.db, scope.workspaceId, { notebookId: "ideas", title: "Poster", contentMarkdown: serializePosterDocument(createPosterDocument("Hello")), tags: [] }, actor, "owner");
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    await expect(tools.update_poster.execute({ memoId: created.id, expectedRevision: created.revision, background: "#16A06E" })).rejects.toMatchObject({ code: "companion_action_unread" });
    await tools.get_memo.execute({ memoId: created.id });
    const read = await tools.get_poster.execute({ memoId: created.id });
    expect(read.poster.elements.length).toBeGreaterThan(0);
    const updated = await tools.update_poster.execute({ memoId: created.id, expectedRevision: read.memo.revision, background: "#16A06E" });
    expect(updated).toMatchObject({ applied: true, id: created.id });
    expect(parsePosterDocument((await getMemoDetail(f.db, scope.workspaceId, created.id)).contentMarkdown).background).toBe("#16A06E");
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
  });
  test("read-only note access keeps MCP reads and omits write tools", async () => {
    const f = await setup();
    const tools = createCompanionTools({
      ...f, scope, input: { ...f.input, allowWrites: false },
      signal: new AbortController().signal, assertActive: async () => {}, sources: [],
    });
    expect(tools.get_memo).toBeTruthy();
    expect(tools.search_memos).toBeTruthy();
    expect(tools.create_memo).toBeUndefined();
    expect(tools.create_diagram_memo).toBeUndefined();
    expect(tools.update_diagram).toBeUndefined();
    expect(tools.get_diagram).toBeTruthy();
    expect(tools.get_poster).toBeTruthy();
    expect(tools.update_poster).toBeUndefined();
    expect(tools.update_memo).toBeUndefined();
    expect(tools.merge_memos).toBeUndefined();
    expect(tools.list_note_templates).toBeTruthy();
    expect(tools.get_ai_instruction).toBeTruthy();
    expect(tools.use_note_template).toBeUndefined();
    expect(tools.create_ai_instruction).toBeUndefined();
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toMatchObject({ content: "One original content" });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
  });
  test("create_memo, update_memo and trash_memos execute immediately", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    await expect(tools.update_memo.execute({ memoId: f.notes[0].id, contentMarkdown: "unread" })).rejects.toMatchObject({ code: "companion_action_unread" });
    const created = await tools.create_memo.execute({ notebookId: "ideas", title: "New", contentMarkdown: "Exact new body" });
    expect(created).toMatchObject({ applied: true });
    const createdId = created.memo?.id ?? created.id;
    expect(createdId).toBeTruthy();
    expect(await getMemoDetail(f.db, scope.workspaceId, createdId)).toMatchObject({ title: "New", contentMarkdown: "Exact new body" });
    expect(await tools.trash_memos.execute({ memoIds: [createdId] })).toMatchObject({ applied: true });
    expect((await getMemoDetail(f.db, scope.workspaceId, createdId, true)).isDeleted).toBe(true);
    await tools.get_memo.execute({ memoId: f.notes[1].id });
    expect(await tools.update_memo.execute({ memoId: f.notes[1].id, title: "Title only" })).toMatchObject({ applied: true });
    expect(await getMemoDetail(f.db, scope.workspaceId, f.notes[1].id)).toMatchObject({ title: "Title only", contentMarkdown: "Two original content" });
    await tools.get_memo.execute({ memoId: f.notes[0].id });
    const updated = await tools.update_memo.execute({ memoId: f.notes[0].id, title: "Changed", contentMarkdown: "Exact replacement" });
    expect(updated).toMatchObject({ applied: true, id: f.notes[0].id, title: "Changed" });
    expect(updated).not.toHaveProperty("proposalId");
    expect(await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).toMatchObject({ title: "Changed", contentMarkdown: "Exact replacement" });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
    expect(await tools.update_memo.execute({ memoId: f.notes[0].id, contentMarkdown: "Second replacement" }))
      .toMatchObject({ applied: true, id: f.notes[0].id });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).contentMarkdown).toBe("Second replacement");
  });
  test("an auto-applied body edit does not overwrite a note changed after its read", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    await tools.get_memo.execute({ memoId: f.notes[0].id });
    await updateMemoRecord(f.db, scope.workspaceId, f.notes[0].id, { contentMarkdown: "Newer edit" }, actor, "owner");
    expect(await tools.update_memo.execute({ memoId: f.notes[0].id, contentMarkdown: "Stale replacement" }))
      .toMatchObject({ error: expect.any(String) });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).contentMarkdown).toBe("Newer edit");
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
  });
  test("move, tag, and notebook writes execute immediately without a confirmation card", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    expect(await tools.add_tags_to_memos.execute({ memoIds: [f.notes[1].id], tags: ["new"] })).toMatchObject({ applied: true });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[1].id)).tags).toEqual(["old", "new"]);
    expect(await tools.move_memos.execute({ memoIds: [f.notes[1].id], notebookId: "target" })).toMatchObject({ applied: true });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[1].id)).notebookId).toBe("target");
    expect(await tools.create_notebook.execute({ name: "Inbox Two" })).toMatchObject({ applied: true });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
    await expect(tools.merge_memos.execute({ memoIds: f.notes.map(note => note.id) })).rejects.toMatchObject({ code: "companion_action_unread" });
  });
  test("create_diagram_memo immediately creates an editable mind map, not Markdown", async () => {
    const f = await setup();
    const sources = [];
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources });
    expect(tools.create_diagram_memo).toBeTruthy();
    expect(tools.get_diagram).toBeTruthy();
    const created = await tools.create_diagram_memo.execute({
      notebookId: "ideas",
      title: "RAG 原理思维导图",
      kind: "mind-map",
      theme: "mint",
      nodes: [
        { id: "root", label: "RAG" },
        { id: "retrieve", label: "检索", parentId: "root" },
        { id: "generate", label: "生成", parentId: "root" },
      ],
    });
    expect(created).toMatchObject({ applied: true, title: "RAG 原理思维导图", diagramKind: "mind-map", nodeCount: 3 });
    expect(created.id).toBeTruthy();
    expect(JSON.stringify(created)).not.toContain("edgeever-diagram-v1");
    const memo = await getMemoDetail(f.db, scope.workspaceId, created.id);
    expect(parseDiagramDocument(memo.contentMarkdown)).toMatchObject({ kind: "mind-map", theme: "plain" });
    expect(memo.contentMarkdown).not.toContain("## RAG");
    expect(sources.map(source => source.id)).toContain(created.id);
    const diagramMemo = await tools.get_memo.execute({ memoId: created.id });
    expect(diagramMemo).toMatchObject({
      diagramKind: "mind-map",
      message: expect.stringContaining("update_diagram"),
    });
    expect(JSON.stringify(diagramMemo)).not.toContain("edgeever-diagram-v1");
    expect(diagramMemo.content).toBeUndefined();
    await expect(tools.update_memo.execute({ memoId: created.id, contentMarkdown: "# no" })).rejects.toThrow(
      "This is an editable diagram. Change it with update_diagram, not update_memo.",
    );
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
    expect(() => validateCompanionTool("update_diagram", {
      memoId: created.id, expectedRevision: 0,
      operations: [{ op: "add_node", node: { id: "eval", label: "评估", parentId: "root" } }],
    })).not.toThrow();
    const editor = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    await expect(editor.update_diagram.execute({
      memoId: created.id, expectedRevision: 0,
      operations: [{ op: "add_node", node: { id: "eval", label: "评估", parentId: "root" } }],
    })).rejects.toMatchObject({ code: "companion_action_unread" });
    const graph = await editor.get_diagram.execute({ memoId: created.id });
    expect(graph).toMatchObject({ memo: { id: created.id }, diagram: { kind: "mind-map" } });
    const updated = await editor.update_diagram.execute({
      memoId: created.id, expectedRevision: graph.memo.revision,
      operations: [{ op: "add_node", node: { id: "eval", label: "评估", parentId: "root" } }],
    });
    expect(updated).toMatchObject({ applied: true, id: created.id, nodeCount: 4 });
    expect(parseDiagramDocument((await getMemoDetail(f.db, scope.workspaceId, created.id)).contentMarkdown).nodes.map(node => node.id))
      .toContain("eval");
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
  });
  test("creates a structured table in the inbox and adds a record using real field IDs", async () => {
    const f = await setup();
    const inboxId = `${scope.workspaceId}_inbox`;
    f.sqlite.query("INSERT INTO notebooks(id, workspace_id, name, slug) VALUES (?, ?, '等待分类', 'inbox')").run(inboxId, scope.workspaceId);
    const input = { ...f.input, message: "帮我生成一个自媒体选题库的多维表格" };
    const definition = companionToolDefinitions(input).find(tool => tool.name === "create_table_memo");
    expect(definition).toBeTruthy();
    expect(definition.inputSchema.required).not.toContain("notebookId");
    expect(definition.description).toContain("editable structured table");
    const sources = [];
    const tools = createCompanionTools({ ...f, input, scope, signal: new AbortController().signal, assertActive: async () => {}, sources });
    const created = await tools.create_table_memo.execute({
      title: "自媒体选题库",
      fields: [
        { name: "选题标题", type: "text" },
        { name: "平台", type: "select", options: ["小红书", "抖音", "公众号"] },
        { name: "计划发布时间", type: "date" },
      ],
    });
    expect(created).toMatchObject({ applied: true, title: "自媒体选题库", notebookId: inboxId, fieldCount: 3 });
    expect(created).not.toHaveProperty("memo");
    expect(sources.map(source => source.id)).toContain(created.id);
    const memo = await getMemoDetail(f.db, scope.workspaceId, created.id);
    expect(parseTableDocument(memo.contentMarkdown)).toMatchObject({ records: [], fields: [
      { name: "选题标题", type: "text" },
      { name: "平台", type: "select", options: ["小红书", "抖音", "公众号"] },
      { name: "计划发布时间", type: "date" },
    ] });
    const table = await tools.get_table_records.execute({ memoId: created.id });
    expect(table).toMatchObject({ memoId: created.id, totalRecords: 0 });
    const cells = Object.fromEntries(table.fields.slice(0, 2).map((field, index) => [field.id, ["秋季选题", "小红书"][index]]));
    const added = await tools.add_table_record.execute({ memoId: created.id, expectedRevision: table.revision, cells });
    expect(added).toMatchObject({ applied: true });
    expect((await tools.get_table_records.execute({ memoId: created.id })).totalRecords).toBe(1);
    expect(parseTableDocument((await getMemoDetail(f.db, scope.workspaceId, created.id)).contentMarkdown).records).toHaveLength(1);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
  });
  test("refuses to replace a structured table with update_memo", async () => {
    const f = await setup();
    const table = await createMemoRecord(f.db, scope.workspaceId, {
      notebookId: "ideas",
      title: "Tasks",
      contentMarkdown: serializeTableDocument(createDefaultTableDocument()),
    }, actor, "owner");
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    const read = await tools.get_memo.execute({ memoId: table.id });
    expect(read.message).toContain("structured table");
    expect(read.structuredTable).toBeTruthy();
    expect(read.content).toContain("|");
    expect(read.content).not.toContain("edgeever-table-v1");
    await expect(tools.update_memo.execute({ memoId: table.id, contentMarkdown: "# no" })).rejects.toThrow(
      "This is a structured table. Do not replace it with update_memo.",
    );
    expect((await getMemoDetail(f.db, scope.workspaceId, table.id)).contentMarkdown).toContain("edgeever-table-v1");
  });
  test("create_diagram_memo keeps generated edge IDs out of Agent input", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    const input = {
      notebookId: "ideas",
      title: "Service architecture",
      kind: "architecture",
      nodes: [
        { id: "web", label: "Web", type: "frontend" },
        { id: "api", label: "API", type: "service" },
      ],
      edges: [{ source: "web", target: "api", type: "request" }],
    };
    expect(() => validateCompanionTool("create_diagram_memo", {
      ...input,
      edges: [{ id: "edge-1", source: "web", target: "api", type: "request" }],
    })).toThrow();
    const created = await tools.create_diagram_memo.execute(input);
    expect(created).toMatchObject({ applied: true, diagramKind: "architecture", nodeCount: 2 });
    const diagram = parseDiagramDocument((await getMemoDetail(f.db, scope.workspaceId, created.id)).contentMarkdown);
    expect(diagram.edges).toMatchObject([{ source: "web", target: "api", kind: "request" }]);
    expect(diagram.edges[0].id).toBeTruthy();
  });
  test("an explicit diagram type narrows the Agent schema and rejects a mismatched write", async () => {
    expect(explicitDiagramKind("帮我生成一个架构图笔记作为说明。")).toBe("architecture");
    expect(explicitDiagramKind("Create a flow chart note.")).toBe("flowchart");
    expect(explicitDiagramKind("マインドマップを作成して")).toBe("mind-map");
    expect(explicitDiagramKind("比较思维导图和架构图")).toBeUndefined();

    const f = await setup();
    const agentInput = { ...f.input, message: "帮我生成一个架构图笔记作为说明。" };
    const definition = companionToolDefinitions(agentInput).find(tool => tool.name === "create_diagram_memo");
    expect(definition.inputSchema.properties.kind.enum).toEqual(["architecture"]);
    expect(definition.inputSchema.required ?? []).not.toContain("notebookId");
    expect(definition.description).toContain("use exactly that kind");
    expect(definition.description).toContain("等待分类");
    const plain = companionToolDefinitions(f.input);
    for (const name of ["create_memo", "create_diagram_memo", "create_infographic_memo", "use_note_template"]) {
      const tool = plain.find(item => item.name === name);
      expect(tool.inputSchema.required ?? []).not.toContain("notebookId");
      expect(tool.description).toContain("等待分类");
    }
    expect(plain.find(item => item.name === "ask_user_question").description).toContain("Do not use this to choose a notebook");

    const tools = createCompanionTools({ ...f, input: agentInput, scope, signal: new AbortController().signal,
      assertActive: async () => {}, sources: [] });
    const graph = {
      notebookId: "ideas",
      title: "Requested architecture",
      nodes: [{ id: "web", label: "Web", type: "frontend" }],
    };
    await expect(tools.create_diagram_memo.execute({ ...graph, kind: "mind-map" }))
      .rejects.toMatchObject({ code: "invalid_params", message: expect.stringContaining("kind must be architecture") });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = ?").get(graph.title).n).toBe(0);
    expect(await tools.create_diagram_memo.execute({ ...graph, kind: "architecture" }))
      .toMatchObject({ applied: true, diagramKind: "architecture" });
  });
  test("a new note or diagram without a named notebook is saved in the inbox", async () => {
    const f = await setup();
    const inboxId = `${scope.workspaceId}_inbox`;
    f.sqlite.query("INSERT INTO notebooks(id, workspace_id, name, slug) VALUES (?, ?, '等待分类', 'inbox')").run(inboxId, scope.workspaceId);
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    const note = await tools.create_memo.execute({ title: "Inbox note", contentMarkdown: "Saved without asking" });
    expect(note.memo.notebookId).toBe(inboxId);
    const diagram = await tools.create_diagram_memo.execute({
      title: "模型蒸馏",
      kind: "flowchart",
      nodes: [
        { id: "teacher", label: "教师模型", type: "process" },
        { id: "student", label: "学生模型", type: "process" },
      ],
      edges: [{ source: "teacher", target: "student" }],
    });
    expect(diagram).toMatchObject({ applied: true, notebookId: inboxId, diagramKind: "flowchart" });
    const named = await tools.create_memo.execute({ notebookId: "ideas", title: "Named", contentMarkdown: "Stay put" });
    expect(named.memo.notebookId).toBe("ideas");
    expect(await resolveWorkspaceInboxId(f.db, scope.workspaceId)).toBe(inboxId);
  });
  test("an infographic request creates a pie infographic instead of a mind map", async () => {
    const message = "给我生成一个腾讯营收占比的信息图。";
    expect(requestsInfographic(message)).toBe(true);
    expect(explicitDiagramKind(message)).toBeUndefined();
    const f = await setup();
    const inboxId = `${scope.workspaceId}_inbox`;
    f.sqlite.query("INSERT INTO notebooks(id, workspace_id, name, slug) VALUES (?, ?, '等待分类', 'inbox')").run(inboxId, scope.workspaceId);
    const agentInput = { ...f.input, message };
    const definitions = companionToolDefinitions(agentInput);
    expect(definitions.find(tool => tool.name === "create_diagram_memo").description).toContain("create_infographic_memo");
    expect(definitions.find(tool => tool.name === "create_infographic_memo").description).toContain("chart-pie-donut-plain-text");
    const tools = createCompanionTools({ ...f, input: agentInput, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    await expect(tools.create_diagram_memo.execute({
      title: "腾讯 2025 年营收占比信息图",
      kind: "mind-map",
      nodes: [{ id: "root", label: "营收" }, { id: "ads", label: "网络广告 16%", parentId: "root" }],
    })).rejects.toMatchObject({ code: "invalid_params", message: expect.stringContaining("create_infographic_memo") });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title LIKE '%营收%'").get().n).toBe(0);
    const created = await tools.create_infographic_memo.execute({
      data: {
        title: "腾讯 2025 年营收占比",
        desc: "图中比例为演示用估算，不代表腾讯官方披露数据。",
        values: [
          { label: "增值服务", value: 52 },
          { label: "金融科技与企业服务", value: 30 },
          { label: "网络广告", value: 16 },
          { label: "其他业务", value: 2 },
        ],
      },
      template: "chart-pie-donut-plain-text",
    });
    expect(created).toMatchObject({
      applied: true,
      notebookId: inboxId,
      template: "chart-pie-donut-plain-text",
      title: "腾讯 2025 年营收占比",
      infographic: true,
    });
    expect(JSON.stringify(created)).not.toContain("edgeever-infographic-v1");
    const stored = await getMemoDetail(f.db, scope.workspaceId, created.id);
    const infographic = parseInfographicDocument(stored.contentMarkdown);
    expect(infographic.syntax).toContain("infographic chart-pie-donut-plain-text");
    expect(infographic.syntax).toContain("label 增值服务");
    expect(infographic.syntax).not.toContain("parentId");
    const read = await tools.get_memo.execute({ memoId: created.id });
    expect(read.infographic).toMatchObject({ template: "chart-pie-donut-plain-text" });
    expect(read.message).toContain("infographic");
    expect(JSON.stringify(read)).not.toContain("edgeever-infographic-v1");
    await expect(tools.update_memo.execute({ memoId: created.id, contentMarkdown: "# no" })).rejects.toThrow(
      "This is an infographic. Do not replace it with update_memo.",
    );
  });
  test("a diagram request cannot pause to ask which notebook", async () => {
    const f = await setup();
    const run = { tools: [], todos: [], questions: [], pause: { ask: false } };
    const tools = createCompanionTools({
      ...f,
      input: { ...f.input, message: "给我生成一个模型蒸馏的流程图" },
      scope,
      signal: new AbortController().signal,
      assertActive: async () => {},
      sources: [],
      run,
    });
    const blocked = await tools.ask_user_question.execute({
      questions: [{ id: "notebook", prompt: "流程图要保存到哪个笔记本？请提供笔记本名称。", inputType: "free_text" }],
    });
    expect(blocked).toMatchObject({ waiting: false, error: expect.stringContaining("等待分类") });
    expect(run.pause.ask).toBe(false);
    expect(run.questions).toEqual([]);
    const allowed = await tools.ask_user_question.execute({
      questions: [{
        id: "strategy",
        prompt: "按主题合并，还是按时间合并？",
        inputType: "single_select",
        options: [{ id: "topic", label: "主题" }, { id: "time", label: "时间" }],
      }],
    });
    expect(allowed).toMatchObject({ waiting: true });
    expect(run.questions).toHaveLength(1);
  });
  test("creating a note without a notebook fails when the inbox is missing", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    await expect(tools.create_memo.execute({ title: "Nowhere", contentMarkdown: "body" })).rejects.toMatchObject({ code: "inbox_notebook_missing" });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = 'Nowhere'").get().n).toBe(0);
  });
  test("note templates and AI instructions execute immediately including deletes", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    const template = await tools.create_note_template.execute({ name: "Weekly", contentMarkdown: "Agenda body" });
    expect(template).toMatchObject({ applied: true });
    const templateId = template.template?.id;
    expect(templateId).toBeTruthy();
    const used = await tools.use_note_template.execute({ templateId, notebookId: "ideas" });
    expect(used).toMatchObject({ applied: true });
    const usedId = used.memo?.id ?? used.id;
    expect(await getMemoDetail(f.db, scope.workspaceId, usedId)).toMatchObject({ contentMarkdown: "Agenda body" });
    const instruction = await tools.create_ai_instruction.execute({ name: "Tighten", instruction: "Make it shorter." });
    expect(instruction).toMatchObject({ applied: true });
    expect(await tools.delete_note_template.execute({ templateId })).toMatchObject({ applied: true });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memo_templates WHERE id = ?").get(templateId).n).toBe(0);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
  });
  test("repeated complete reads return a reference without consuming the note budget again", async () => {
    const f = await setup();
    for (const note of f.notes) await updateMemoRecord(f.db, scope.workspaceId, note.id, { contentMarkdown: "x".repeat(6000) }, actor, "owner");
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    const first = await tools.get_memo.execute({ memoId: f.notes[0].id });
    const repeated = await tools.get_memo.execute({ memoId: f.notes[0].id });
    expect(first.content).toHaveLength(6000); expect(first.truncated).toBe(false);
    expect(repeated).toMatchObject({ id: f.notes[0].id, alreadyRead: true });
    expect(repeated).not.toHaveProperty("content");
    expect(JSON.stringify(repeated).length).toBeLessThan(JSON.stringify(first).length / 10);
    const second = await tools.get_memo.execute({ memoId: f.notes[1].id });
    expect(second.content).toHaveLength(6000); expect(second.truncated).toBe(false);
    const merged = await tools.merge_memos.execute({ memoIds: f.notes.map(note => note.id) });
    expect(merged).toMatchObject({ applied: true });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id, true)).isDeleted).toBe(true);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
  });
  test("a truncated read cannot become a complete source through the duplicate-read optimization", async () => {
    const f = await setup();
    await updateMemoRecord(f.db, scope.workspaceId, f.notes[0].id, { contentMarkdown: "x".repeat(9000) }, actor, "owner");
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toMatchObject({ truncated: true });
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toMatchObject({ truncated: true });
    await expect(tools.update_memo.execute({ memoId: f.notes[0].id, contentMarkdown: "replacement", _reason: "Rewrite" })).rejects.toThrow();
  });

  for (const state of ["owner", "edit", "move-notebook", "forget", "dismiss", "expire", "clear"]) test(`rejects ${state} changes before any write`, async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "Must not exist" });
    await f.complete();
    if (state === "edit") f.sqlite.query("UPDATE memos SET title = 'Other edit' WHERE id = ?").run(f.notes[0].id);
    if (state === "move-notebook") f.sqlite.query("UPDATE notebooks SET parent_id = 'target' WHERE id = 'ideas'").run();
    if (state === "forget") await saveCompanionMemory(f.db, scope, { content: "Changed context" });
    if (state === "dismiss") await dismissCompanionAction(f.db, scope, id);
    if (state === "expire") f.sqlite.query("UPDATE companion_actions SET expires_at = '2000-01-01' WHERE id = ?").run(id);
    if (state === "clear") await clearCompanionHistory(f.db, scope);
    const response = await f.request(`actions/${id}/apply`, {}, state === "owner" ? { "x-other": "1" } : {});
    expect([404, 409]).toContain(response.status);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = 'Must not exist'").get().n).toBe(0);
  });

  test("concurrent confirmations create only one note", async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "Only once" }); await f.complete();
    await Promise.all([f.request(`actions/${id}/apply`), f.request(`actions/${id}/apply`)]);
    expect((await getCompanionAction(f.db, scope, id)).status).toBe("applied");
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = 'Only once'").get().n).toBe(1);
  });
  test("continuations see scoped receipts only with current note and memory permissions", async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "New" }); await f.complete();
    await f.request(`actions/${id}/apply`);
    expect(await companionExecutionReceipts(f.db, scope, f.input, 0)).toMatchObject([{ tool: "create_memo", status: "applied" }]);
    expect(await companionExecutionReceipts(f.db, scope, { ...f.input, allowNotes: false }, 0)).toEqual([]);
    expect(await companionExecutionReceipts(f.db, { ...scope, ownerId: "other" }, f.input, 0)).toEqual([]);
    expect(await companionExecutionReceipts(f.db, scope, { ...f.input, threadId: crypto.randomUUID() }, 0)).toEqual([]);
    expect(await companionExecutionReceipts(f.db, scope, f.input, 1)).toEqual([]);
    f.sqlite.query("UPDATE companion_turns SET use_memory = 1 WHERE id = ?").run(f.turn.id);
    expect(await companionExecutionReceipts(f.db, scope, f.input, 0)).toEqual([]);
  });

  test("a lost commit acknowledgement leaves a non-replayable uncertain receipt", async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "Committed once" }); await f.complete();
    let failed = false;
    const uncertainDb = { prepare: sql => f.db.prepare(sql), batch: async statements => {
      const result = await f.db.batch(statements);
      if (!failed) { failed = true; throw new Error("Connection lost after commit"); }
      return result;
    } };
    const context = { ...f.context, env: { storage: { ...f.storage, db: uncertainDb } } };
    expect((await applyCompanionAction(uncertainDb, scope, id, context)).status).toBe("uncertain");
    expect((await f.request(`actions/${id}/apply`)).status).toBe(409);
    expect((await dismissCompanionAction(f.db, scope, id)).status).toBe("uncertain");
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = 'Committed once'").get().n).toBe(1);
  });

  test("an edit between the service read and write is caught inside the mutation batch", async () => {
    const f = await setup();
    const id = await f.propose("update_memo", { memoId: f.notes[0].id, contentMarkdown: "Must not replace" }); await f.complete();
    let changed = false;
    const racingDb = { prepare: sql => f.db.prepare(sql), batch: async statements => {
      if (!changed) { changed = true; f.sqlite.query("UPDATE memo_contents SET revision = revision + 1 WHERE memo_id = ?").run(f.notes[0].id); }
      return f.db.batch(statements);
    } };
    await expect(applyCompanionAction(racingDb, scope, id, { ...f.context, env: { storage: { ...f.storage, db: racingDb } } }))
      .rejects.toMatchObject({ code: "companion_action_conflict" });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).contentMarkdown).toBe("One original content");
  });

  test("search and list results keep timestamps and accept a date-only createdAfter", async () => {
    expect(normalizeSearchTimeBound("2026-09-09", "after")).toBe("2026-09-09T00:00:00.000Z");
    expect(normalizeSearchTimeBound("2026-09-09", "before")).toBe("2026-09-09T23:59:59.999Z");
    expect(() => validateCompanionTool("search_memos", { createdAfter: "2026-09-09" })).not.toThrow();
    const f = await setup();
    f.sqlite.query("UPDATE memos SET created_at = '2020-01-01T00:00:00.000Z', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .run(f.notes[0].id);
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    const listed = await tools.search_memos.execute({ createdAfter: "2026-01-01" });
    expect(listed.memos.map(memo => memo.id)).toEqual([f.notes[1].id]);
    expect(listed.memos[0]).toMatchObject({
      createdAt: f.notes[1].createdAt,
      updatedAt: f.notes[1].updatedAt,
      notebookName: "ideas",
    });
    expect(listed.hasMore).toBe(false);
    const page = await tools.search_memos.execute({ createdAfter: "2000-01-01", limit: 1 });
    expect(page.memos).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(await tools.list_memos.execute({})).toMatchObject({
      memos: expect.arrayContaining([expect.objectContaining({
        id: f.notes[1].id, createdAt: f.notes[1].createdAt, updatedAt: f.notes[1].updatedAt,
      })]),
    });
    expect(await tools.get_memo.execute({ memoId: f.notes[1].id })).toMatchObject({
      createdAt: f.notes[1].createdAt, updatedAt: f.notes[1].updatedAt,
    });
    const missed = await tools.search_memos.execute({ query: "最近一周" });
    expect(missed.memos).toEqual([]);
  });
});
