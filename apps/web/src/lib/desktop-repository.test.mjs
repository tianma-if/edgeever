import { afterAll, describe, expect, test } from "bun:test";

let lastRequest = null;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

// Must be installed before importing modules that read `window` at load time.
globalThis.window = {
  location: { hostname: "notes.example.com", origin: "https://notes.example.com" },
  dispatchEvent: () => true,
  edgeeverDesktop: {
    isAvailable: true,
    listStagedResources: async () => [],
    listStagedResourceAliases: async (memoId) => memoId === "memo_alias"
      ? [{ id: "stage_exact", memoId, resourceId: "res_exact" }]
      : [],
    sidecarRequest: async (method, params) => {
      lastRequest = { method, params };
      if (method === "memo.get") {
        const filename = params.memoId === "memo_wechat" ? "微信图片_202609231723_1.jpg" : "screenshot.webp";
        return {
          memo: {
            id: params.memoId,
            contentJson: {
              type: "doc",
              content: [{
                type: "image",
                attrs: { alt: filename, src: "edgeever-staged://stage_dead" },
              }],
            },
            contentMarkdown: `![${filename}](edgeever-staged://stage_dead)\n\n`,
          },
        };
      }
      if (method === "resource.list") {
        return {
          resources: [{
            id: "res_shot",
            memoId: "memo_shot",
            kind: "image",
            filename: "screenshot.webp",
            url: "/api/v1/resources/res_shot/blob",
          }, {
            id: "res_wechat",
            memoId: "memo_wechat",
            kind: "image",
            filename: "微信图片_202609231723_1.webp",
            url: "/api/v1/resources/res_wechat/blob",
          }],
          summary: { totalCount: 2, totalBytes: 2, imageCount: 2, attachmentCount: 0 },
        };
      }
      if (method === "memo.update" || method === "memo.updateGuarded") {
        return { memo: { ...params, id: params.memoId, contentHash: "next-hash" } };
      }
      return { memos: [], totalCount: 0, nextCursor: null };
    },
  },
};

afterAll(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    delete globalThis.window;
  }
});

const { createDesktopRepository } = await import("./desktop-repository.ts");

describe("desktop repository notebook filters", () => {
  test("uses the notebook subtree without also restricting results to the parent", async () => {
    await createDesktopRepository().listMemos({
      notebookId: "parent",
      notebookIds: ["parent", "child"],
    });

    expect(lastRequest).toEqual({
      method: "memo.list",
      params: {
        notebookId: null,
        notebookIds: ["parent", "child"],
      },
    });
  });

  test("forwards the selected tag to the sidecar list query", async () => {
    await createDesktopRepository().listMemos({ tag: "AI-RSS" });

    expect(lastRequest).toEqual({
      method: "memo.list",
      params: {
        notebookId: null,
        tag: "AI-RSS",
      },
    });
  });
});

describe("desktop repository memo saves", () => {
  test("serializes rich content to Markdown before sending it to the sidecar", async () => {
    await createDesktopRepository().updateMemo(
      { id: "memo-1", revision: 2, contentHash: "base-hash" },
      {
        title: "Rich note",
        contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "富文本正文" }] }] },
        tags: [],
      },
    );

    expect(lastRequest.method).toBe("memo.update");
    expect(lastRequest.params.contentMarkdown).toContain("富文本正文");
  });

  test("rewrites a dead staged screenshot URL before saving the memo", async () => {
    await createDesktopRepository().updateMemo(
      { id: "memo_shot", revision: 1, contentHash: "base-hash" },
      {
        title: "截图",
        contentJson: {
          type: "doc",
          content: [{
            type: "image",
            attrs: { alt: "screenshot.webp", src: "edgeever-staged://stage_dead" },
          }],
        },
        contentMarkdown: "![screenshot.webp](edgeever-staged://stage_dead)\n\n",
        tags: [],
      },
    );

    expect(lastRequest.method).toBe("memo.update");
    expect(lastRequest.params.contentMarkdown).toContain("/api/v1/resources/res_shot/blob");
    expect(lastRequest.params.contentMarkdown).not.toContain("edgeever-staged://");
    expect(lastRequest.params.contentJson.content[0].attrs.src).toBe("/api/v1/resources/res_shot/blob");
  });

  test("uses the durable ID mapping when a stale editor saves an image", async () => {
    await createDesktopRepository().updateMemo(
      { id: "memo_alias", revision: 2, contentHash: "base-hash" },
      {
        title: "Image",
        contentJson: { type: "doc", content: [{ type: "image", attrs: {
          alt: "unrelated-original-name.jpg", src: "edgeever-staged://stage_exact",
        } }] },
        contentMarkdown: "![unrelated-original-name.jpg](edgeever-staged://stage_exact)",
        tags: [],
      },
    );
    expect(lastRequest.params.contentJson.content[0].attrs.src).toBe("/api/v1/resources/res_exact/blob");
    expect(lastRequest.params.contentMarkdown).toContain("/api/v1/resources/res_exact/blob");
  });

  test("refuses to save a deleted temporary image with no durable mapping", async () => {
    lastRequest = null;
    await expect(createDesktopRepository().updateMemo(
      { id: "memo_unknown", revision: 2, contentHash: "base-hash" },
      {
        title: "Image",
        contentJson: { type: "doc", content: [{ type: "image", attrs: {
          alt: "missing.jpg", src: "edgeever-staged://stage_missing",
        } }] },
        contentMarkdown: "![missing.jpg](edgeever-staged://stage_missing)",
        tags: [],
      },
    )).rejects.toThrow("missing staged resource");
    expect(lastRequest?.method).not.toBe("memo.update");
  });
});

describe("desktop repository memo reads", () => {
  test("rewrites a dead staged screenshot URL when opening the memo", async () => {
    const result = await createDesktopRepository().getMemo("memo_shot");
    expect(result.memo.contentMarkdown).toContain("edgeever-resource://resource/res_shot");
    expect(result.memo.contentMarkdown).not.toContain("edgeever-staged://");
    expect(result.memo.contentJson.content[0].attrs.src).toBe("edgeever-resource://resource/res_shot");
  });

  test("recovers an imported WeChat image after jpg compression changed its extension", async () => {
    const result = await createDesktopRepository().getMemo("memo_wechat");
    expect(result.memo.contentJson.content[0].attrs.src).toBe("edgeever-resource://resource/res_wechat");
    expect(result.memo.contentMarkdown).toContain("edgeever-resource://resource/res_wechat");
  });
});

describe("guarded desktop plugin saves", () => {
  test("uses a dedicated RPC so older sidecars cannot silently ignore the snapshot guard", async () => {
    const memo = { id: "guarded", revision: 2, contentHash: "base", title: "Title", tags: ["keep"], contentMarkdown: "Original", contentJson: { type: "doc", content: [] } };
    await createDesktopRepository().updateMemo(memo, { title: "Title", contentMarkdown: "Edited", contentJson: memo.contentJson, tags: memo.tags }, { guardLocalSnapshot: true });
    expect(lastRequest.method).toBe("memo.updateGuarded");
    expect(lastRequest.params.expectedLocalSnapshot).toMatchObject({ revision: 2, contentHash: "base", contentMarkdown: "Original", title: "Title", tags: ["keep"] });
  });

  test("reports conflicts and refuses unsupported old hosts without an unguarded fallback", async () => {
    const request = window.edgeeverDesktop.sidecarRequest;
    const memo = { id: "guarded", revision: 2, contentHash: "base", title: "Title", tags: [], contentMarkdown: "Original", contentJson: { type: "doc", content: [] } };
    try {
      for (const [message, code] of [["NOTE_CONFLICT: Changed locally", "NOTE_CONFLICT"], ["Unknown sidecar method: memo.updateGuarded", "HOST_UPGRADE_REQUIRED"]]) {
        const calls = [];
        window.edgeeverDesktop.sidecarRequest = async method => { calls.push(method); throw new Error(message); };
        await expect(createDesktopRepository().updateMemo(memo, { title: "Title", contentJson: memo.contentJson, tags: [] }, { guardLocalSnapshot: true })).rejects.toMatchObject({ code });
        expect(calls).toEqual(["memo.updateGuarded"]);
      }
    } finally { window.edgeeverDesktop.sidecarRequest = request; }
  });
});

describe("desktop note duplication", () => {
  const withDuplicateHarness = async (outboxItems, run) => {
    // Paused, the real synchronization returns at once. Replacing the module
    // instead would leak into other test files run in the same process.
    const { pauseDesktopSyncForImport } = await import("./desktop-sync.ts");
    const resumeSync = await pauseDesktopSyncForImport();
    const { api } = await import("./api.ts");
    const request = window.edgeeverDesktop.sidecarRequest;
    const duplicate = api.duplicateMemo;
    const onLine = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const calls = [];
    const apiCalls = [];
    api.duplicateMemo = async (memoId, input) => {
      apiCalls.push({ memoId, input });
      return { memo: { id: "memo_copy", title: input.title, contentMarkdown: "Copy", contentJson: { type: "doc", content: [] } } };
    };
    window.edgeeverDesktop.sidecarRequest = async (method, params) => {
      calls.push({ method, params });
      // Like the sidecar (crates/desktop-sidecar/src/sync.rs): the list holds
      // pending, error and conflict items in queue order, at most 200 of them.
      if (method === "sync.outbox.list") {
        const listed = outboxItems.filter((item) => ["pending", "error", "conflict"].includes(item.status ?? "pending"));
        return { items: listed.slice(0, Math.min(Math.max(params.limit ?? 50, 1), 200)) };
      }
      if (method === "sync.status") {
        const count = (status) => outboxItems.filter((item) => (item.status ?? "pending") === status).length;
        return { pending: count("pending"), syncing: count("syncing"), conflict: count("conflict"), error: count("error"), cursor: 0, syncIdentity: null, lastSyncedAt: null };
      }
      if (method === "memo.get") return { memo: { id: params.memoId, title: "Plan (copy)", contentMarkdown: "Copy", contentJson: { type: "doc", content: [] } } };
      return {};
    };
    try {
      await run({ calls, apiCalls });
    } finally {
      resumeSync();
      window.edgeeverDesktop.sidecarRequest = request;
      api.duplicateMemo = duplicate;
      if (onLine) Object.defineProperty(globalThis.navigator, "onLine", onLine);
      else delete globalThis.navigator.onLine;
    }
  };

  test("checks the outbox, copies on the server and stores the copy in the sidecar", async () => {
    await withDuplicateHarness([], async ({ calls, apiCalls }) => {
      const result = await createDesktopRepository().duplicateMemo("memo_plan", { title: "Plan (copy)" });

      expect(apiCalls).toEqual([{ memoId: "memo_plan", input: { title: "Plan (copy)" } }]);
      expect(calls.map((call) => call.method)).toEqual(["sync.status", "sync.outbox.list", "sync.apply", "memo.get"]);
      expect(calls[2].params.changes[0]).toMatchObject({ entityType: "memo", operation: "upsert", entityId: "memo_copy" });
      expect(result.memo).toMatchObject({ id: "memo_copy", title: "Plan (copy)" });
    });
  });

  const conflicts = (count) => Array.from({ length: count }, (_, index) => ({
    id: index + 1, kind: "memo.update", entityId: `memo_other_${index}`, status: "conflict",
  }));

  test("refuses when the note's conflict lies beyond the 200 items the sidecar lists", async () => {
    const outbox = [...conflicts(200), { id: 201, kind: "memo.update", entityId: "memo_plan", status: "conflict" }];
    await withDuplicateHarness(outbox, async ({ apiCalls }) => {
      await expect(createDesktopRepository().duplicateMemo("memo_plan", { title: "Plan (copy)" }))
        .rejects.toThrow("memo_duplicate_pending_changes");
      expect(apiCalls).toEqual([]);
    });
  });

  test("copies when every outstanding item was listed and none belongs to the note", async () => {
    await withDuplicateHarness(conflicts(150), async ({ apiCalls }) => {
      await createDesktopRepository().duplicateMemo("memo_plan", { title: "Plan (copy)" });
      expect(apiCalls).toHaveLength(1);
    });
  });

  test("refuses while another synchronization is still sending changes", async () => {
    await withDuplicateHarness([{ id: 1, kind: "memo.update", entityId: "memo_other", status: "syncing" }], async ({ apiCalls }) => {
      await expect(createDesktopRepository().duplicateMemo("memo_plan", { title: "Plan (copy)" }))
        .rejects.toThrow("memo_duplicate_pending_changes");
      expect(apiCalls).toEqual([]);
    });
  });

  test("refuses while the note still has unsynchronized changes", async () => {
    await withDuplicateHarness([{ id: 1, kind: "memo.update", entityId: "memo_plan" }], async ({ apiCalls }) => {
      await expect(createDesktopRepository().duplicateMemo("memo_plan", { title: "Plan (copy)" }))
        .rejects.toThrow("memo_duplicate_pending_changes");
      expect(apiCalls).toEqual([]);
    });
  });
});


describe("desktop Markdown note creation", () => {
  test("parses imported Markdown before sending it to the sidecar", async () => {
    const markdown = "### 项目经历\n\n**项目亮点：**\n\n* 使用 `Next.js`\n* [文档](https://example.com)";
    await createDesktopRepository().createMemo({ notebookId: "nb", title: "简历", contentMarkdown: markdown, tags: [] });
    expect(lastRequest.method).toBe("memo.create");
    expect(lastRequest.params.contentMarkdown).toBe(markdown);
    const nodes = lastRequest.params.contentJson.content;
    expect(nodes[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(nodes[1].content[0].marks).toContainEqual({ type: "bold" });
    expect(nodes[2].type).toBe("bulletList");
    expect(lastRequest.params.contentText).not.toContain("###");
    expect(lastRequest.params.contentText).not.toContain("**");
  });

  test("preserves an explicitly supplied rich document", async () => {
    const contentJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "**literal**" }] }] };
    await createDesktopRepository().createMemo({ notebookId: "nb", title: "Rich", contentJson, contentMarkdown: "different", tags: [] });
    expect(lastRequest.params.contentJson).toEqual(contentJson);
    expect(lastRequest.params.contentText).toBe("**literal**");
  });
});

const { cancelPendingDesktopImportMemo } = await import("./desktop-repository.ts");

// Routes sidecar RPCs to `handlers` and records every call and dispatched event.
const withSidecar = async (handlers, run, { online = true, bridge = {} } = {}) => {
  const { api } = await import("./api.ts");
  const desktop = window.edgeeverDesktop;
  const original = { ...desktop };
  const dispatchEvent = window.dispatchEvent;
  const onLine = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
  Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: online });
  const calls = [];
  const events = [];
  const apiOriginals = {};
  const stubApi = (overrides) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (!(key in apiOriginals)) apiOriginals[key] = api[key];
      api[key] = value;
    }
  };
  window.dispatchEvent = (event) => { events.push(event.type); return true; };
  Object.assign(desktop, bridge, {
    sidecarRequest: async (method, params) => {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected sidecar method: ${method}`);
      return handler(params);
    },
  });
  try {
    await run({ calls, events, stubApi });
  } finally {
    for (const key of Object.keys(desktop)) if (!(key in original)) delete desktop[key];
    Object.assign(desktop, original);
    Object.assign(api, apiOriginals);
    window.dispatchEvent = dispatchEvent;
    if (onLine) Object.defineProperty(globalThis.navigator, "onLine", onLine);
    else delete globalThis.navigator.onLine;
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const emptySummary = { totalCount: 0, totalBytes: 0, imageCount: 0, attachmentCount: 0 };
const desktopResource = (id, overrides = {}) => ({
  id, memoId: "memo-1", kind: "attachment", filename: `${id}.txt`, byteSize: 3, url: `/api/v1/resources/${id}/blob`, ...overrides,
});
const desktopTemplate = (id, overrides = {}) => ({
  id, name: id, description: null, title: `${id} title`, contentJson: { type: "doc", content: [] }, contentMarkdown: "**Body**", tags: ["t"],
  createdAt: "2026-01-01", updatedAt: "2026-01-01", ...overrides,
});

describe("desktop repository bridge", () => {
  test("rejects every request when the desktop bridge is unavailable", async () => {
    window.edgeeverDesktop.isAvailable = false;
    try {
      await expect(createDesktopRepository().listNotebooks()).rejects.toThrow("EdgeEver desktop bridge is unavailable");
    } finally {
      window.edgeeverDesktop.isAvailable = true;
    }
  });

  test("announces queue changes after every local mutation", async () => {
    const ok = () => ({ ok: true });
    const handlers = Object.fromEntries([
      "notebook.create", "notebook.update", "notebook.delete", "notebook.restore", "template.create", "template.update", "template.delete",
      "tag.rename", "tag.delete", "memo.moveBatch", "memo.deleteBatch", "memo.emptyTrash", "memo.pinBatch", "memo.delete",
    ].map((method) => [method, ok]));
    handlers["memo.restore"] = () => ({ memo: { id: "memo-1" } });
    await withSidecar(handlers, async ({ calls, events }) => {
      const repository = createDesktopRepository();
      await repository.createNotebook({ name: "A" });
      await repository.updateNotebook("nb-1", { name: "B" });
      await repository.deleteNotebook("nb-1");
      await repository.restoreNotebook("nb-1");
      await repository.createTemplate({ name: "T" });
      await repository.updateTemplate("tpl-1", { name: "U" });
      await repository.deleteTemplate("tpl-1");
      await repository.renameTag("a", "b");
      await repository.deleteTag("b");
      await repository.moveMemos({ memoIds: ["m"], notebookId: "nb-2" });
      await repository.deleteMemos({ memoIds: ["m"] });
      await repository.emptyTrash();
      await repository.pinMemos({ memoIds: ["m"], isPinned: true });
      await repository.deleteMemo("memo-1");
      expect(await repository.restoreMemo("memo-1")).toEqual({ memo: { id: "memo-1" }, queued: true });
      expect(events).toHaveLength(15);
      expect(new Set(events)).toEqual(new Set(["edgeever:sync-queue-changed"]));
      expect(calls.find((call) => call.method === "notebook.update").params).toEqual({ notebookId: "nb-1", name: "B" });
      expect(calls.find((call) => call.method === "template.update").params).toEqual({ templateId: "tpl-1", name: "U" });
      expect(calls.find((call) => call.method === "memo.delete").params).toEqual({ memoId: "memo-1", permanent: false });
    });
  });

  test("cancels a pending import by permanently deleting its queued create", async () => {
    await withSidecar({ "memo.delete": () => ({ ok: true }) }, async ({ calls, events }) => {
      expect(await cancelPendingDesktopImportMemo("memo-import")).toEqual({ ok: true });
      expect(calls).toEqual([{ method: "memo.delete", params: { memoId: "memo-import", permanent: true, cancelPendingCreate: true } }]);
      expect(events).toEqual(["edgeever:sync-queue-changed"]);
    });
  });
});

describe("desktop repository templates", () => {
  test("returns cached templates and refreshes the cache in the background", async () => {
    const cached = [];
    await withSidecar({
      "template.list": () => ({ templates: [desktopTemplate("tpl-local")] }),
      "template.cache": ({ template }) => { cached.push(template.id); return { ok: true }; },
    }, async ({ stubApi }) => {
      stubApi({ listTemplates: async () => ({ templates: [desktopTemplate("tpl-remote")] }) });
      expect((await createDesktopRepository().listTemplates()).templates.map((template) => template.id)).toEqual(["tpl-local"]);
      await settle();
      expect(cached).toEqual(["tpl-remote"]);
    });
  });

  test("keeps cached templates when the background refresh fails", async () => {
    await withSidecar({ "template.list": () => ({ templates: [desktopTemplate("tpl-local")] }) }, async ({ stubApi }) => {
      stubApi({ listTemplates: async () => { throw new Error("network down"); } });
      expect((await createDesktopRepository().listTemplates()).templates).toHaveLength(1);
      await settle();
    });
  });

  test("returns the empty cache offline without contacting the server", async () => {
    await withSidecar({ "template.list": () => ({ templates: [] }) }, async ({ stubApi }) => {
      stubApi({ listTemplates: async () => { throw new Error("must not call the server"); } });
      expect(await createDesktopRepository().listTemplates()).toEqual({ templates: [] });
    }, { online: false });
  });

  test("fills an empty cache from the server when online", async () => {
    const cached = [];
    await withSidecar({
      "template.list": () => ({ templates: [] }),
      "template.cache": ({ template }) => { cached.push(template.id); return { ok: true }; },
    }, async ({ stubApi }) => {
      stubApi({ listTemplates: async () => ({ templates: [desktopTemplate("tpl-a"), desktopTemplate("tpl-b")] }) });
      expect((await createDesktopRepository().listTemplates()).templates.map((template) => template.id)).toEqual(["tpl-a", "tpl-b"]);
      expect(cached).toEqual(["tpl-a", "tpl-b"]);
    });
  });

  test("creates a note from a cached template and rejects an unknown template", async () => {
    await withSidecar({
      "template.list": () => ({ templates: [desktopTemplate("tpl-1")] }),
      "memo.create": (params) => ({ memo: { id: "memo-new", ...params } }),
    }, async ({ calls, stubApi }) => {
      stubApi({ listTemplates: async () => ({ templates: [] }) });
      const repository = createDesktopRepository();
      const { memo } = await repository.useTemplate("tpl-1", "nb-1");
      expect(memo).toMatchObject({ notebookId: "nb-1", title: "tpl-1 title", contentMarkdown: "**Body**", tags: ["t"], contentText: "Body" });
      await expect(repository.useTemplate("tpl-missing", "nb-1")).rejects.toThrow("Template not found: tpl-missing");
      expect(calls.filter((call) => call.method === "memo.create")).toHaveLength(1);
    });
  });
});

describe("desktop repository resources", () => {
  test("caches uploaded resources in the sidecar and serves them through the desktop protocol", async () => {
    await withSidecar({ "resource.cache": () => ({ ok: true }) }, async ({ calls, stubApi }) => {
      stubApi({ uploadMemoResource: async () => ({ resource: desktopResource("res-up") }) });
      const { resource } = await createDesktopRepository().uploadMemoResource("memo-1", new File(["abc"], "a.txt"));
      expect(resource.url).toBe("edgeever-resource://resource/res-up");
      expect(calls).toEqual([{ method: "resource.cache", params: { resource: desktopResource("res-up") } }]);
    });
  });

  test("reads resource bytes from the escaped blob endpoint", async () => {
    await withSidecar({}, async ({ stubApi }) => {
      const urls = [];
      stubApi({ getResourceResponse: async (url, init) => { urls.push([url, init]); return new Response("bytes"); } });
      expect(await (await createDesktopRepository().readResource("res/1")).text()).toBe("bytes");
      expect(urls).toEqual([["/api/v1/resources/res%2F1/blob", { cache: "no-store" }]]);
    });
  });

  test("replaces the cached resource after updating its contents", async () => {
    await withSidecar({ "resource.delete": () => ({ ok: true }), "resource.cache": () => ({ ok: true }) }, async ({ calls, stubApi }) => {
      stubApi({ updateResourceContent: async (id) => ({ resource: desktopResource(id, { byteSize: 9 }) }) });
      const { resource } = await createDesktopRepository().updateResource("res-1", new File(["x"], "a.txt"), "hash");
      expect(resource.url).toBe("edgeever-resource://resource/res-1");
      expect(calls.map((call) => call.method)).toEqual(["resource.delete", "resource.cache"]);
    });
  });

  test("does not touch the sidecar cache when the server update fails", async () => {
    await withSidecar({}, async ({ calls, stubApi }) => {
      stubApi({ updateResourceContent: async () => { throw new Error("hash mismatch"); } });
      await expect(createDesktopRepository().updateResource("res-1", new File(["x"], "a.txt"), "stale")).rejects.toThrow("hash mismatch");
      expect(calls).toEqual([]);
    });
  });

  test("lists cached resources with staged uploads first and summed totals", async () => {
    let refreshes = 0;
    await withSidecar({
      "resource.list": () => ({ resources: [desktopResource("res-1"), desktopResource("res-abs", { url: "https://cdn.example.com/res-abs" })], summary: { totalCount: 2, totalBytes: 6, imageCount: 0, attachmentCount: 2 } }),
      "resource.cache": () => ({ ok: true }),
    }, async ({ stubApi }) => {
      stubApi({ listResources: async () => { refreshes += 1; return { resources: [desktopResource("res-1")], summary: emptySummary }; } });
      const result = await createDesktopRepository().listResources();
      expect(result.resources.map((resource) => resource.url)).toEqual([
        "edgeever-staged://stage-1",
        "edgeever-resource://resource/res-1",
        "https://cdn.example.com/res-abs",
      ]);
      expect(result.summary).toEqual({ totalCount: 3, totalBytes: 16, imageCount: 1, attachmentCount: 2 });
      await settle();
      expect(refreshes).toBe(1);
    }, { bridge: { apiBaseUrl: "https://notes.example.com/", listStagedResources: async () => [{ id: "stage-1", memoId: "memo-1", name: "shot.png", type: "image/png", size: 10 }] } });
  });

  test("returns the empty cache offline and fills it from the server online", async () => {
    await withSidecar({ "resource.list": () => ({ resources: [], summary: emptySummary }) }, async ({ stubApi }) => {
      stubApi({ listResources: async () => { throw new Error("must not call the server"); } });
      expect(await createDesktopRepository().listResources()).toEqual({ resources: [], summary: emptySummary });
    }, { online: false });

    const cached = [];
    await withSidecar({
      "resource.list": () => ({ resources: [], summary: emptySummary }),
      "resource.cache": ({ resource }) => { cached.push(resource.id); return { ok: true }; },
    }, async ({ stubApi }) => {
      stubApi({ listResources: async () => ({ resources: [desktopResource("res-2")], summary: { ...emptySummary, totalCount: 1 } }) });
      const result = await createDesktopRepository().listResources();
      expect(result.resources.map((resource) => resource.url)).toEqual(["edgeever-resource://resource/res-2"]);
      expect(cached).toEqual(["res-2"]);
    });
  });

  test("surfaces a server failure on an empty cache unless staged uploads can still be shown", async () => {
    await withSidecar({ "resource.list": () => ({ resources: [], summary: emptySummary }) }, async ({ stubApi }) => {
      stubApi({ listResources: async () => { throw new Error("network down"); } });
      await expect(createDesktopRepository().listResources()).rejects.toThrow("network down");
    });
  });

  test("renames and deletes resources on the server before updating the sidecar cache", async () => {
    await withSidecar({ "resource.cache": () => ({ ok: true }), "resource.delete": () => ({ ok: true }) }, async ({ calls, stubApi }) => {
      stubApi({
        renameResource: async (id, filename) => ({ resource: desktopResource(id, { filename }) }),
        deleteResource: async () => ({ ok: true }),
      });
      const repository = createDesktopRepository();
      const renamed = await repository.renameResource("res-1", "new.txt");
      expect(renamed.resource).toMatchObject({ filename: "new.txt", url: "edgeever-resource://resource/res-1" });
      expect(await repository.deleteResource("res-1")).toEqual({ ok: true });
      expect(calls.map((call) => call.method)).toEqual(["resource.cache", "resource.delete"]);
    });
  });

  test("keeps the sidecar cache when the server delete fails", async () => {
    await withSidecar({}, async ({ calls, stubApi }) => {
      stubApi({ deleteResource: async () => { throw new Error("forbidden"); } });
      await expect(createDesktopRepository().deleteResource("res-1")).rejects.toThrow("forbidden");
      expect(calls).toEqual([]);
    });
  });
});

describe("desktop repository notes", () => {
  test("lists tags from the sidecar", async () => {
    await withSidecar({ "tag.list": () => ({ tags: [{ name: "a", memoCount: 1, updatedAt: null }] }) }, async () => {
      expect((await createDesktopRepository().listTags()).tags[0].name).toBe("a");
    });
  });

  test("merges notes in the sidecar and shows resource links through the desktop protocol", async () => {
    await withSidecar({
      "memo.merge": () => ({ memo: { id: "memo-merged", contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/resources/res-1/blob" } }] }, contentMarkdown: "![a](/api/v1/resources/res-1/blob)" } }),
    }, async ({ events }) => {
      const { memo } = await createDesktopRepository().mergeMemos({ memoIds: ["a", "b"] });
      expect(memo.contentJson.content[0].attrs.src).toBe("edgeever-resource://resource/res-1");
      expect(memo.contentMarkdown).toBe("![a](edgeever-resource://resource/res-1)");
      expect(events).toEqual(["edgeever:sync-queue-changed"]);
    });
  });

  test("refuses to duplicate a note offline", async () => {
    await withSidecar({}, async ({ calls }) => {
      await expect(createDesktopRepository().duplicateMemo("memo-1")).rejects.toThrow("memo_duplicate_offline");
      expect(calls).toEqual([]);
    }, { online: false });
  });

  test("passes the guarded-save error through when it is neither a conflict nor an old host", async () => {
    const memo = { id: "guarded", revision: 2, contentHash: "base", title: "Title", tags: [], contentMarkdown: "Original", contentJson: { type: "doc", content: [] } };
    await withSidecar({ "memo.updateGuarded": () => { throw "disk full"; } }, async () => {
      const error = await createDesktopRepository().updateMemo(memo, { title: "Title", contentJson: memo.contentJson, tags: [] }, { guardLocalSnapshot: true }).catch((caught) => caught);
      expect(error).toBe("disk full");
    });
  });

  test("adopts the cloud copy by acknowledging the update conflict and discarding other conflicts of the note", async () => {
    await withSidecar({
      "sync.apply": () => ({ ok: true }),
      "sync.outbox.list": () => ({ items: [
        { id: 1, kind: "memo.update", entityId: "memo-1", status: "conflict", version: 3 },
        { id: 2, kind: "memo.delete", entityId: "memo-1", status: "conflict", version: 1 },
        { id: 3, kind: "memo.update", entityId: "memo-1", status: "pending", version: 4 },
        { id: 4, kind: "memo.update", entityId: "memo-other", status: "conflict", version: 1 },
      ] }),
      "sync.outbox.ack": () => ({ ok: true }),
      "sync.outbox.discard": () => ({ ok: true }),
    }, async ({ calls, events, stubApi }) => {
      const cloud = { id: "memo-1", title: "Cloud", contentJson: { type: "doc", content: [] }, contentMarkdown: "Cloud" };
      stubApi({ getMemo: async () => ({ memo: cloud }) });
      const { memo } = await createDesktopRepository().adoptCloudMemo("memo-1");
      expect(memo.title).toBe("Cloud");
      expect(calls.map((call) => call.method)).toEqual(["sync.apply", "sync.outbox.list", "sync.outbox.ack", "sync.outbox.discard"]);
      expect(calls[2].params).toEqual({ id: 1, version: 3, remoteMemo: cloud });
      expect(calls[3].params).toEqual({ id: 2 });
      expect(events).toEqual(["edgeever:sync-queue-changed"]);
    });
  });

  test("returns cached revisions offline and caches server revisions online", async () => {
    const local = { revisions: [{ id: "rev-local" }] };
    await withSidecar({ "memo.revisions": () => local }, async ({ stubApi }) => {
      stubApi({ listMemoRevisions: async () => { throw new Error("must not call the server"); } });
      expect(await createDesktopRepository().listMemoRevisions("memo-1")).toBe(local);
    }, { online: false });

    const cached = [];
    await withSidecar({
      "memo.revisions": () => local,
      "memo.revision.cache": ({ revision }) => { cached.push(revision.id); return { ok: true }; },
    }, async ({ stubApi }) => {
      stubApi({ listMemoRevisions: async () => ({ revisions: [{ id: "rev-remote" }] }) });
      expect((await createDesktopRepository().listMemoRevisions("memo-1")).revisions).toEqual([{ id: "rev-remote" }]);
      expect(cached).toEqual(["rev-remote"]);
    });
  });

  test("falls back to cached revisions on a server failure and reports it when none are cached", async () => {
    const local = { revisions: [{ id: "rev-local" }] };
    let revisions = local;
    await withSidecar({ "memo.revisions": () => revisions }, async ({ stubApi }) => {
      stubApi({ listMemoRevisions: async () => { throw new Error("network down"); } });
      const repository = createDesktopRepository();
      expect(await repository.listMemoRevisions("memo-1")).toBe(local);
      revisions = { revisions: [] };
      await expect(repository.listMemoRevisions("memo-1")).rejects.toThrow("network down");
    });
  });

  test("restores a revision in the sidecar and shows it through the desktop protocol", async () => {
    await withSidecar({
      "memo.restoreRevision": () => ({ memo: { id: "memo-1", contentJson: { type: "doc", content: [] }, contentMarkdown: "![x](/api/v1/resources/res-9/blob)" } }),
    }, async ({ calls, events }) => {
      const { memo } = await createDesktopRepository().restoreMemoRevision("memo-1", "rev-1");
      expect(memo.contentMarkdown).toBe("![x](edgeever-resource://resource/res-9)");
      expect(calls[0].params).toEqual({ memoId: "memo-1", revisionId: "rev-1" });
      expect(events).toEqual(["edgeever:sync-queue-changed"]);
    });
  });

  test("reports a no-op sync because the desktop host synchronizes on its own", async () => {
    expect(await createDesktopRepository().sync()).toEqual({ bootstrapped: false, changed: 0 });
  });
});
