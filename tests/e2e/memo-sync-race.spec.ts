import { expect, test, type Page, type Route } from "@playwright/test";

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
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

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
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
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
