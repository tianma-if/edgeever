import { expect, test, type Page } from "@playwright/test";

type LocalMemoRecord = {
  id: string;
  scope: string;
  title: string;
  [key: string]: unknown;
};

const readLocalMemo = (page: Page, memoId: string) => page.evaluate(
  (targetMemoId) => new Promise<LocalMemoRecord | null>((resolve, reject) => {
    const openRequest = indexedDB.open("edgeever-local");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction("memos", "readonly");
      const request = transaction.objectStore("memos").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        database.close();
        resolve((request.result as LocalMemoRecord[]).find((memo) => memo.id === targetMemoId) ?? null);
      };
    };
  }),
  memoId,
);

const makeMirrorStale = (page: Page, memo: LocalMemoRecord, staleTitle: string) => page.evaluate(
  ({ localMemo, title }) => new Promise<void>((resolve, reject) => {
    const openRequest = indexedDB.open("edgeever-local");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(["memos", "syncMeta"], "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.objectStore("memos").put({ ...localMemo, title });
      transaction.objectStore("syncMeta").put({
        scope: localMemo.scope,
        key: "cursor",
        value: "999999999",
        updatedAt: new Date().toISOString(),
      });
    };
  }),
  { localMemo: memo, title: staleTitle },
);

test("rebuilds a stale browser mirror when the server cursor rewinds", async ({ page }) => {
  const marker = Date.now();
  const serverTitle = `Cursor rewind server ${marker}`;
  const staleTitle = `Cursor rewind stale ${marker}`;
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

  const createResponse = await page.request.post("/api/v1/memos", {
    data: { notebookId, title: serverTitle, contentMarkdown: `Server content ${marker}` },
  });
  expect(createResponse.status()).toBe(201);
  const memoId = (await createResponse.json() as { memo: { id: string } }).memo.id;

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(serverTitle);
    await expect(page.locator(`[data-memo-id="${memoId}"]`)).toContainText(serverTitle);
    await expect.poll(async () => (await readLocalMemo(page, memoId))?.title ?? null).toBe(serverTitle);

    const localMemo = await readLocalMemo(page, memoId);
    expect(localMemo).not.toBeNull();
    await makeMirrorStale(page, localMemo!, staleTitle);
    expect((await readLocalMemo(page, memoId))?.title).toBe(staleTitle);

    await page.reload();

    await expect.poll(async () => (await readLocalMemo(page, memoId))?.title ?? null).toBe(serverTitle);
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(serverTitle);
    await expect(page.locator(`[data-memo-id="${memoId}"]`)).toContainText(serverTitle);
    await expect(page.getByText(staleTitle, { exact: true })).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});
