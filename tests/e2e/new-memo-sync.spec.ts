import { expect, test, type Page, type Route } from "@playwright/test";

type StoredQueueItem = {
  kind?: string;
  memoId?: string;
  status?: string;
  payload?: unknown;
};

const readIndexedDbStore = <T>(page: Page, storeName: string) => page.evaluate(
  (targetStore) => new Promise<T[]>((resolve, reject) => {
    const openRequest = indexedDB.open("edgeever-local");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(targetStore)) {
        database.close();
        resolve([]);
        return;
      }

      const transaction = database.transaction(targetStore, "readonly");
      const getAllRequest = transaction.objectStore(targetStore).getAll();
      getAllRequest.onerror = () => reject(getAllRequest.error);
      getAllRequest.onsuccess = () => {
        database.close();
        resolve(getAllRequest.result as T[]);
      };
    };
  }),
  storeName,
);

const storeContains = async (page: Page, storeName: string, marker: string) =>
  JSON.stringify(await readIndexedDbStore(page, storeName)).includes(marker);

const holdNextMemoCreate = async (page: Page) => {
  let releaseCreate!: () => void;
  let markCreateStarted!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const createStarted = new Promise<void>((resolve) => {
    markCreateStarted = resolve;
  });
  const createResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/memos",
  );

  await page.route("**/api/v1/memos", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    markCreateStarted();
    await createGate;
    await route.continue();
  });

  return { createResponse, createStarted, releaseCreate };
};

const editNewMemo = async (page: Page, title: string, content: string) => {
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();

  const titleInput = page.getByPlaceholder("无标题");
  const editor = page.locator(".ProseMirror[contenteditable='true']");
  await expect(titleInput).toBeEditable();
  await expect(editor).toBeEditable();
  await expect(titleInput).toHaveValue("");
  await expect(editor).toBeEmpty();
  await titleInput.fill(title);
  await editor.click();
  await page.keyboard.insertText(content);

  await expect.poll(() => storeContains(page, "drafts", content)).toBe(true);
};

const finishSyncAndVerifyReload = async (
  page: Page,
  createResponsePromise: ReturnType<Page["waitForResponse"]>,
  releaseCreate: () => void,
  title: string,
  content: string,
) => {
  const updateResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.startsWith("/api/v1/memos/"),
  );
  const createSyncCompletedPromise = page.evaluate(() => new Promise<void>((resolve) => {
    window.addEventListener("edgeever:sync-completed", () => resolve(), { once: true });
  }));
  releaseCreate();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json() as { memo: { id: string; revision: number } };
  const memoId = created.memo.id;
  expect(created.memo.revision).toBe(0);

  try {
    await expect.poll(async () => {
      const items = await readIndexedDbStore<StoredQueueItem>(page, "syncQueue");
      return !items.some((item) => item.kind === "memo.create");
    }).toBe(true);

    await createSyncCompletedPromise;
    const firstUpdateSyncCompletedPromise = page.evaluate(() => new Promise<void>((resolve) => {
      window.addEventListener("edgeever:sync-completed", () => resolve(), { once: true });
    }));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
    const updateResponse = await updateResponsePromise;
    expect(new URL(updateResponse.url()).pathname).toBe(`/api/v1/memos/${memoId}`);
    expect(updateResponse.request().postDataJSON()).toMatchObject({
      expectedRevision: created.memo.revision,
    });
    expect(updateResponse.ok()).toBe(true);
    const updated = await updateResponse.json() as { memo: { title: string; contentJson: unknown; revision: number } };
    expect(updated.memo.title).toBe(title);
    expect(JSON.stringify(updated.memo.contentJson)).toContain(content);
    expect(updated.memo.revision).toBe(1);
    await firstUpdateSyncCompletedPromise;

    const followUp = ` after revision ${updated.memo.revision}`;
    let releaseSecondUpdate!: () => void;
    let markSecondUpdateStarted!: () => void;
    let secondUpdateRequestBody: Record<string, unknown> | null = null;
    const secondUpdateGate = new Promise<void>((resolve) => { releaseSecondUpdate = resolve; });
    const secondUpdateStarted = new Promise<void>((resolve) => { markSecondUpdateStarted = resolve; });
    await page.route(`**/api/v1/memos/${memoId}`, async (route: Route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      secondUpdateRequestBody = route.request().postDataJSON() as Record<string, unknown>;
      markSecondUpdateStarted();
      await secondUpdateGate;
      await route.continue();
    });
    const secondUpdateResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/memos/${memoId}`,
    );
    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(followUp);
    await secondUpdateStarted;
    expect(secondUpdateRequestBody).toMatchObject({ expectedRevision: updated.memo.revision });
    const secondUpdateSyncCompletedPromise = page.evaluate(() => new Promise<void>((resolve) => {
      window.addEventListener("edgeever:sync-completed", () => resolve(), { once: true });
    }));
    releaseSecondUpdate();
    const secondUpdateResponse = await secondUpdateResponsePromise;
    expect(secondUpdateResponse.ok()).toBe(true);
    await secondUpdateSyncCompletedPromise;
    await page.unroute(`**/api/v1/memos/${memoId}`);

    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/memos/${memoId}`);
      if (!response.ok()) return false;
      const body = await response.json() as { memo: { title: string; contentJson: unknown } };
      const serializedContent = JSON.stringify(body.memo.contentJson);
      return body.memo.title === title && serializedContent.includes(content) && serializedContent.includes(followUp);
    }).toBe(true);
    await expect(page.getByText("有冲突", { exact: true })).toHaveCount(0);

    await page.reload();
    const memoCard = page.locator(`[data-memo-id="${memoId}"]`);
    await expect(memoCard).toContainText(title);
    await memoCard.locator("button").first().click();
    await expect(page.getByPlaceholder("无标题")).toHaveValue(title);
    await expect(page.locator(".ProseMirror[contenteditable='true']")).toContainText(content);
    await expect(page.locator(".ProseMirror[contenteditable='true']")).toContainText(followUp.trim());
  } finally {
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
};

test.describe("new memo synchronization", () => {
  test("rebases a second autosave after memo creation reaches cloud revision 1", async ({ page }) => {
    const marker = `${Date.now()}-draft-only`;
    const title = `E2E create race ${marker}`;
    const content = `Content pasted before create completed ${marker}`;
    const heldCreate = await holdNextMemoCreate(page);

    await page.goto("/");
    const editing = editNewMemo(page, title, content);
    await heldCreate.createStarted;
    await editing;

    const queuedBeforeCreate = await readIndexedDbStore<StoredQueueItem>(page, "syncQueue");
    expect(queuedBeforeCreate.some((item) => item.kind === "memo.update")).toBe(false);

    await finishSyncAndVerifyReload(page, heldCreate.createResponse, heldCreate.releaseCreate, title, content);
  });
});
