import { expect, test, type Page, type Route } from "@playwright/test";
import { createDefaultDiagramDocument, diagramFallbackMarkdown, parseDiagramDocument, serializeDiagramDocument } from "../../packages/shared/src/diagram";
import { markdownToDoc } from "../../packages/shared/src/content";

type StoredQueueItem = {
  kind?: string;
  memoId?: string;
  status?: string;
  payload?: unknown;
};

const readSyncQueue = (page: Page) => page.evaluate(
  () => new Promise<StoredQueueItem[]>((resolve, reject) => {
    const openRequest = indexedDB.open("edgeever-local");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains("syncQueue")) {
        database.close();
        resolve([]);
        return;
      }
      const transaction = database.transaction("syncQueue", "readonly");
      const request = transaction.objectStore("syncQueue").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        database.close();
        resolve(request.result as StoredQueueItem[]);
      };
    };
  }),
);

const queueItemWithContent = async (page: Page, memoId: string, marker: string) => {
  const item = (await readSyncQueue(page)).find((candidate) => candidate.kind === "memo.update" && candidate.memoId === memoId);
  return item && JSON.stringify(item.payload).includes(marker) ? item : null;
};

const waitForQueuedContent = (page: Page, memoId: string, marker: string) => expect.poll(
  async () => Boolean(await queueItemWithContent(page, memoId, marker)),
).toBe(true);

const waitForPendingQueuedContent = (page: Page, memoId: string, marker: string) => expect.poll(
  async () => (await queueItemWithContent(page, memoId, marker))?.status ?? null,
).toBe("pending");

const waitForSyncCompleted = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  window.addEventListener("edgeever:sync-completed", () => resolve(), { once: true });
}));

const readEditorSelection = (page: Page) => page.evaluate(() => {
  const selection = window.getSelection();
  const paragraph = selection?.anchorNode?.parentElement?.closest("p");
  const range = document.createRange();
  if (paragraph && selection?.anchorNode) {
    range.selectNodeContents(paragraph);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
  }
  return {
    offset: paragraph && selection?.anchorNode ? range.toString().length : -1,
    paragraphText: paragraph?.textContent ?? "",
  };
});

test("keeps the caret and rebases edits made while autosave sync is in flight", async ({ page }) => {
  const marker = `sync-race-${Date.now()}`;
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string; name: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  const notebookName = notebooks.notebooks[0]?.name;
  expect(notebookId).toBeTruthy();
  expect(notebookName).toBeTruthy();

  const createResponse = await page.request.post("/api/v1/memos", {
    data: {
      notebookId,
      title: marker,
      contentMarkdown: `First paragraph ${marker}\n\nSecond paragraph\n\nLast paragraph`,
    },
  });
  expect(createResponse.status()).toBe(201);
  const memoId = (await createResponse.json() as { memo: { id: string } }).memo.id;

  let releaseFirstUpdate!: () => void;
  let markFirstUpdateStarted!: () => void;
  const firstUpdateGate = new Promise<void>((resolve) => { releaseFirstUpdate = resolve; });
  const firstUpdateStarted = new Promise<void>((resolve) => { markFirstUpdateStarted = resolve; });
  let updateCount = 0;

  await page.route(`**/api/v1/memos/${memoId}`, async (route: Route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    updateCount += 1;
    if (updateCount === 1) {
      markFirstUpdateStarted();
      await firstUpdateGate;
    }
    await route.continue();
  });

  try {
    await page.goto("/");
    await page.locator('[data-notebook-tree-button="true"]').filter({ hasText: notebookName! }).first().click();
    await page.getByPlaceholder("搜索笔记").fill(marker);
    await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
    await page.getByRole("button", { name: "清空搜索", exact: true }).click();

    const editor = page.locator(".ProseMirror[contenteditable='true']");
    const firstParagraph = editor.locator("p").first();
    await expect(firstParagraph).toContainText(`First paragraph ${marker}`);
    await firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" first-save");
    await waitForQueuedContent(page, memoId, "first-save");

    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    await firstUpdateStarted;

    await firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" typed-during-sync");
    await waitForPendingQueuedContent(page, memoId, "typed-during-sync");

    const selectionBeforeAcknowledgement = await readEditorSelection(page);
    expect(selectionBeforeAcknowledgement.offset).toBe(selectionBeforeAcknowledgement.paragraphText.length);

    const firstSyncCompleted = waitForSyncCompleted(page);
    releaseFirstUpdate();
    await firstSyncCompleted;

    await expect.poll(async () => {
      const item = (await readSyncQueue(page)).find((candidate) => candidate.kind === "memo.update" && candidate.memoId === memoId);
      return item ? JSON.stringify(item.payload) : "";
    }).toContain("typed-during-sync");

    expect(await readEditorSelection(page)).toEqual(selectionBeforeAcknowledgement);

    await page.keyboard.insertText(" after-ack");
    await expect(firstParagraph).toContainText("typed-during-sync after-ack");
    await expect(editor.locator("p").last()).not.toContainText("after-ack");
    await waitForPendingQueuedContent(page, memoId, "after-ack");
    const selectionBeforeCompletedSync = await readEditorSelection(page);

    const secondUpdateResponse = page.waitForResponse(
      (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/memos/${memoId}`,
    );
    const secondSyncCompleted = waitForSyncCompleted(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    expect((await secondUpdateResponse).ok()).toBe(true);
    await secondSyncCompleted;
    expect(await readEditorSelection(page)).toEqual(selectionBeforeCompletedSync);

    await expect.poll(async () => (await readSyncQueue(page)).some(
      (item) => item.memoId === memoId && item.status === "conflict",
    )).toBe(false);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/memos/${memoId}`);
      const body = await response.json() as { memo: { contentJson: unknown } };
      return JSON.stringify(body.memo.contentJson);
    }).toContain("typed-during-sync after-ack");
  } finally {
    await page.unroute(`**/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});

test("preserves a mind-map draft when an earlier autosave is acknowledged", async ({ page }) => {
  const marker = `diagram-sync-race-${Date.now()}`;
  const tag = `${marker}-tag`;
  const deferredTag = `${marker}-defer`;
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const { notebooks } = await notebooksResponse.json() as { notebooks: Array<{ id: string; name: string }> };
  const notebook = notebooks[0]!;
  const document = createDefaultDiagramDocument("mind-map");
  const createResponse = await page.request.post("/api/v1/memos", {
    data: {
      notebookId: notebook.id,
      title: marker,
      contentJson: markdownToDoc(diagramFallbackMarkdown(document)),
      contentMarkdown: serializeDiagramDocument(document),
    },
  });
  expect(createResponse.status()).toBe(201);
  const memoId = (await createResponse.json() as { memo: { id: string } }).memo.id;
  let releaseAcknowledgment!: () => void;
  let markUpdateStored!: () => void;
  const acknowledgmentGate = new Promise<void>((resolve) => { releaseAcknowledgment = resolve; });
  const updateStored = new Promise<void>((resolve) => { markUpdateStored = resolve; });
  let updateCount = 0;
  await page.route(`**/api/v1/memos/${memoId}`, async (route) => {
    if (route.request().method() !== "PATCH" || ++updateCount !== 1) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    markUpdateStored();
    await acknowledgmentGate;
    await route.fulfill({ response });
  });

  try {
    await page.goto("/");
    await page.locator('[data-notebook-tree-button="true"]').filter({ hasText: notebook.name }).first().click();
    await page.getByPlaceholder("搜索笔记").fill(marker);
    await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
    await page.getByRole("button", { name: "清空搜索", exact: true }).click();
    const canvas = page.locator('[data-diagram-kind="mind-map"]');
    await expect(canvas.locator(".x6-node")).toHaveCount(8);

    const title = page.getByRole("textbox", { name: "图表标题", exact: true });
    await title.fill(`${marker}-first-save`);
    await waitForQueuedContent(page, memoId, "first-save");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    await updateStored;

    // Keep the next edit inside the real 1,200 ms debounce window while the
    // previous response arrives. X6 still gets its animation frames.
    await page.clock.install();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1_000));
    await canvas.focus();
    await page.keyboard.press("Tab");
    await page.clock.runFor(100);
    const nodeInput = page.getByRole("textbox", { name: "编辑节点文字", exact: true });
    await nodeInput.fill("draft-during-sync");
    await canvas.focus();
    await title.fill(`${marker}-newer-title`);
    await page.getByRole("button", { name: "选择笔记标签", exact: true }).click();
    const tagDialog = page.getByRole("dialog");
    await tagDialog.getByRole("textbox").fill(tag);
    await tagDialog.locator('button[type="submit"]').click();
    await page.keyboard.press("Escape");
    await page.clock.runFor(100);
    await expect(canvas).toContainText("draft-during-sync");

    const completed = waitForSyncCompleted(page);
    releaseAcknowledgment();
    await completed;
    await expect(title).toHaveValue(`${marker}-newer-title`);
    await expect(canvas.locator(".x6-node")).toHaveCount(9);
    await expect(page.getByText("未保存", { exact: true }).last()).toBeVisible();

    const nextUpdate = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/v1/memos/${memoId}`
      && response.request().postDataJSON()?.contentMarkdown?.includes("draft-during-sync"));
    await page.clock.runFor(1_300);
    await expect.poll(async () => {
      if (await queueItemWithContent(page, memoId, "draft-during-sync")) return true;
      const response = await page.request.get(`/api/v1/memos/${memoId}`);
      const body = await response.json() as { memo: { contentMarkdown: string } };
      return body.memo.contentMarkdown.includes("draft-during-sync");
    }).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    const nextResponse = await nextUpdate;
    expect(nextResponse.ok(), await nextResponse.text()).toBe(true);
    const savedResponse = await page.request.get(`/api/v1/memos/${memoId}`);
    const { memo: saved } = await savedResponse.json() as { memo: { title: string; tags: string[]; contentMarkdown: string } };
    expect(saved.title).toBe(`${marker}-newer-title`);
    expect(saved.tags).toContain(tag);
    expect(saved.contentMarkdown).toContain("draft-during-sync");

    await page.clock.resume();
    await page.reload();
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(`${marker}-newer-title`);
    await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
    await expect(canvas).toContainText("draft-during-sync");
    await expect(title).toHaveValue(`${marker}-newer-title`);

    const changeRemoteRoot = async (label: string) => {
      const response = await page.request.get(`/api/v1/memos/${memoId}`);
      const { memo: remote } = await response.json() as { memo: { contentMarkdown: string } };
      const next = parseDiagramDocument(remote.contentMarkdown)!;
      next.nodes.find((node) => node.id === "topic-root")!.label = label;
      const sessionResponse = await page.request.post(`/api/v1/memos/${memoId}/edit-sessions`);
      const { editSession } = await sessionResponse.json() as {
        editSession: { id: string; baseRevision: number; baseContentHash: string };
      };
      const update = await page.request.patch(`/api/v1/memos/${memoId}`, {
        data: {
          expectedRevision: editSession.baseRevision,
          expectedContentHash: editSession.baseContentHash,
          editSessionId: editSession.id,
          contentJson: markdownToDoc(diagramFallbackMarkdown(next)),
          contentMarkdown: serializeDiagramDocument(next),
        },
      });
      expect(update.ok(), await update.text()).toBe(true);
      const { memo: incoming } = await update.json();
      await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("edgeever:memo-detail-refreshed", { detail })), incoming);
      return incoming as { revision: number; contentHash: string };
    };

    // A genuinely different remote document still updates an idle editor.
    await changeRemoteRoot("remote-when-idle");
    await expect(canvas).toContainText("remote-when-idle");
    await expect(canvas.locator(".x6-node")).toHaveCount(9);

    await canvas.locator('.x6-node[data-cell-id="topic-root"]').dblclick();
    await expect(nodeInput).toHaveValue("remote-when-idle");
    await changeRemoteRoot("remote-after-cancel");
    await expect(nodeInput).toHaveValue("remote-when-idle");
    await nodeInput.press("Escape");
    await expect(canvas).toContainText("remote-after-cancel");

    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 50));
    // Returning tags to their saved values leaves the existing tagsDirty flag
    // set. It must not mask an outline confirmation being canceled.
    await page.getByRole("button", { name: "选择笔记标签", exact: true }).click();
    await tagDialog.getByRole("textbox").fill(deferredTag);
    await tagDialog.locator('button[type="submit"]').click();
    await tagDialog.locator("button").filter({ hasText: `#${deferredTag}` }).first().click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "大纲视图", exact: true }).click();
    const outline = page.getByRole("textbox", { name: "大纲视图", exact: true });
    const outlineBeforeRemoval = await outline.inputValue();
    await outline.fill(outlineBeforeRemoval.split("\n")[0]!);
    const outlinePane = page.locator('section[aria-label="大纲视图"]');
    await expect(outlinePane.getByRole("button", { name: /恢复/ })).toBeVisible();
    const idleRemote = await changeRemoteRoot("remote-after-outline-restore");
    // Flush the query notification before restoring, then X6's async paint.
    await page.clock.runFor(50);
    await outlinePane.getByRole("button", { name: /恢复/ }).click();
    await page.clock.runFor(50);
    await expect(canvas).toContainText("remote-after-outline-restore");
    await expect(outline).toHaveValue(new RegExp("remote-after-outline-restore"));
    await page.getByRole("button", { name: "画布视图", exact: true }).click();

    await canvas.focus();
    await page.keyboard.press("Tab");
    await page.clock.runFor(100);
    await nodeInput.fill("inline-draft-during-remote-update");
    await changeRemoteRoot("remote-while-editing");
    await page.clock.runFor(50);
    await expect(nodeInput).toHaveValue("inline-draft-during-remote-update");
    await expect(canvas).toContainText("remote-after-outline-restore");
    await canvas.focus();
    await page.clock.runFor(1_300);
    await waitForQueuedContent(page, memoId, "inline-draft-during-remote-update");
    const draft = await queueItemWithContent(page, memoId, "inline-draft-during-remote-update");
    expect(draft?.payload).toMatchObject({
      expectedRevision: idleRemote.revision,
      expectedContentHash: idleRemote.contentHash,
    });
    const remoteResponse = await page.request.get(`/api/v1/memos/${memoId}`);
    const { memo: remoteAfterDraft } = await remoteResponse.json() as { memo: { contentMarkdown: string } };
    expect(remoteAfterDraft.contentMarkdown).toContain("remote-while-editing");
    expect(remoteAfterDraft.contentMarkdown).not.toContain("inline-draft-during-remote-update");
  } finally {
    releaseAcknowledgment();
    await page.unroute(`**/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});

test("a queued mind-map successor survives the older save receipt and refresh", async ({ page }) => {
  const marker = `diagram-queued-${Date.now()}`;
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const document = createDefaultDiagramDocument("mind-map");
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id,
    title: marker,
    contentJson: markdownToDoc(diagramFallbackMarkdown(document)),
    contentMarkdown: serializeDiagramDocument(document),
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json();
  let markStored!: (receipt: unknown) => void;
  let release!: () => void;
  const firstStored = new Promise<unknown>((resolve) => { markStored = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let firstUpdate = true;
  await page.route(`**/api/v1/memos/${memo.id}`, async (route) => {
    if (route.request().method() !== "PATCH" || !firstUpdate) return route.continue();
    firstUpdate = false;
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    markStored((await response.json()).memo);
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(marker);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    await page.getByRole("button", { name: "清空搜索", exact: true }).click();
    const title = page.getByRole("textbox", { name: "图表标题", exact: true });
    await title.fill(`${marker}-first`);
    await waitForQueuedContent(page, memo.id, `${marker}-first`);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    const receipt = await firstStored;
    await title.fill(`${marker}-second`);
    await waitForQueuedContent(page, memo.id, `${marker}-second`);

    await page.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent("edgeever:memo-sync-acknowledged", { detail }));
      window.dispatchEvent(new CustomEvent("edgeever:memo-detail-refreshed", { detail }));
    }, receipt);
    await expect(title).toHaveValue(`${marker}-second`);
    const completed = waitForSyncCompleted(page);
    release();
    await completed;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    await expect.poll(async () => (await (await page.request.get(`/api/v1/memos/${memo.id}`)).json()).memo.title)
      .toBe(`${marker}-second`);
    await expect(title).toHaveValue(`${marker}-second`);
  } finally {
    release();
    await page.unroute(`**/api/v1/memos/${memo.id}`);
    await page.request.delete(`/api/v1/memos/${memo.id}`);
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
  }
});

test("keeps a new mind-map editor and its draft when its temporary id is remapped", async ({ page }) => {
  let releaseCreate!: () => void;
  let created!: (id: string) => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  const createdId = new Promise<string>((resolve) => { created = resolve; });
  let memoId: string | undefined;
  await page.route("**/api/v1/memos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    const body = await response.json() as { memo: { id: string } };
    created(body.memo.id);
    await createGate;
    await route.fulfill({ response });
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "选择笔记类型", exact: true }).click();
    await page.getByRole("menuitem", { name: "思维导图", exact: true }).click();
    memoId = await createdId;
    const canvas = page.locator('[data-diagram-kind="mind-map"]');
    await expect(canvas.locator(".x6-node")).toHaveCount(8);
    await page.clock.install();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1_000));
    const title = page.getByRole("textbox", { name: "图表标题", exact: true });
    const marker = `new-diagram-${Date.now()}`;
    await title.fill(marker);
    await canvas.focus();
    await page.keyboard.press("Tab");
    await page.clock.runFor(100);
    const input = page.getByRole("textbox", { name: "编辑节点文字", exact: true });
    await input.fill("draft-during-id-remap");
    const originalGraph = await canvas.locator(".x6-graph-svg").elementHandle();
    const mapped = page.evaluate(() => new Promise<void>((resolve) => {
      window.addEventListener("edgeever:memo-id-remapped", () => resolve(), { once: true });
    }));
    releaseCreate();
    await mapped;
    await expect(page.locator(`[data-memo-id="${memoId}"]`)).toBeVisible();
    await expect(title).toHaveValue(marker);
    await expect(input).toHaveValue("draft-during-id-remap");
    await expect(input).toBeFocused();
    expect(await originalGraph!.evaluate((graph) => graph.isConnected)).toBe(true);
    await expect(canvas.locator(".x6-node")).toHaveCount(9);

    const saved = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/v1/memos/${memoId}`
      && response.request().postDataJSON()?.contentMarkdown?.includes("draft-during-id-remap"));
    await canvas.focus();
    await page.clock.runFor(1_300);
    await expect.poll(async () => {
      if (await queueItemWithContent(page, memoId!, "draft-during-id-remap")) return true;
      const response = await page.request.get(`/api/v1/memos/${memoId}`);
      const body = await response.json() as { memo: { contentMarkdown: string } };
      return body.memo.contentMarkdown.includes("draft-during-id-remap");
    }).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    await page.clock.resume();
    await page.reload();
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(marker);
    await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
    await expect(title).toHaveValue(marker);
    await expect(canvas).toContainText("draft-during-id-remap");
  } finally {
    releaseCreate();
    await page.unroute("**/api/v1/memos");
    if (memoId) {
      await page.request.delete(`/api/v1/memos/${memoId}`);
      await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
    }
  }
});
