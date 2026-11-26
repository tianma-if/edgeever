import { expect, test, type Page } from "@playwright/test";
import { markdownToDoc, parseTableDocument, serializeTableDocument, tableFallbackMarkdown, type LegacyTableDocument } from "@edgeever/shared";

const recordQueue = (page: Page, memoId: string) => page.evaluate((id) => new Promise<any>((resolve, reject) => {
  const open = indexedDB.open("edgeever-local");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const read = db.transaction("syncQueue").objectStore("syncQueue").get(`memo.update:${id}`);
    read.onerror = () => reject(read.error);
    read.onsuccess = () => resolve(read.result);
    db.close();
  };
}), memoId);

test("a shared table replays a lost row receipt and retains a conflicting offline draft", async ({ page, context }) => {
  test.skip(!process.env.EDGE_EVER_E2E_SHARED_TABLES, "Requires an isolated instance with shared table storage activated");
  const document: LegacyTableDocument = {
    schemaVersion: 1, fields: [{ id: "task", name: "Task", type: "text" }], view: { filters: [], sort: null },
    records: [{ id: "a", cells: { task: "Original first row" } }, { id: "b", cells: { task: "Original second row" } }],
  };
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id, title: `Row sync ${Date.now()}`,
    contentMarkdown: serializeTableDocument(document), contentJson: markdownToDoc(tableFallbackMarkdown(document)),
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json();
  expect(memo.sharedTableRevision).toBe(1);
  const path = `/api/v1/memos/${memo.id}`;
  const recordsPath = `${path}/table/records`;
  const edit = async (label: string, updated: string) => {
    const grid = page.locator(".edgeever-workspace-editor table");
    await grid.getByRole("button", { name: label, exact: true }).click();
    const input = grid.getByRole("textbox", { name: "Task", exact: true });
    await input.fill(updated);
    await input.press("Enter");
  };

  let confirmFirstCommit!: () => void;
  let dropFirstResponse!: () => void;
  const firstCommit = new Promise<void>((resolve) => { confirmFirstCommit = resolve; });
  const loseResponse = new Promise<void>((resolve) => { dropFirstResponse = resolve; });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(memo.title);
    await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
    await expect(page.locator(".edgeever-workspace-editor table").getByRole("button", { name: "Original first row" })).toBeVisible();

    const requests: any[] = [];
    await context.route(`**${recordsPath}`, async (route) => {
      requests.push(route.request().postDataJSON());
      const first = requests.length === 1;
      const response = await route.fetch();
      if (first && response.ok()) {
        confirmFirstCommit();
        await loseResponse;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ response });
    });
    await context.setOffline(true);
    await edit("Original first row", "Offline first row");
    await expect.poll(async () => (await recordQueue(page, memo.id))?.status).toBe("pending");
    expect(requests).toHaveLength(0);
    await context.setOffline(false);
    await firstCommit;
    await edit("Original second row", "Edited while response was pending");
    await expect.poll(async () => {
      const queued = await recordQueue(page, memo.id);
      return parseTableDocument(queued?.payload.contentMarkdown)?.records[1]?.cells.task;
    }).toBe("Edited while response was pending");
    dropFirstResponse();
    await expect.poll(() => requests.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    expect(requests[1].mutationId).toBe(requests[0].mutationId);
    expect(requests[0].puts).toEqual([{ id: "a", cells: { task: "Offline first row" } }]);
    expect(requests[0]).not.toHaveProperty("contentMarkdown");
    expect(requests[2].puts).toEqual([{ id: "b", cells: { task: "Edited while response was pending" } }]);
    await expect.poll(() => recordQueue(page, memo.id)).toBeUndefined();
    const rowDelta = await (await page.request.post(`${path}/table/changes`, { data: { since: 1 } })).json();
    expect(rowDelta.changes.map(({ id }) => id)).toEqual(["a", "b"]);

    const remoteSave = async (text: string) => {
      const { editSession } = await (await page.request.post(`${path}/edit-sessions`, { data: {} })).json();
      const response = await page.request.patch(recordsPath, { data: {
        expectedRevision: editSession.baseRevision, expectedContentHash: editSession.baseContentHash,
        editSessionId: editSession.id, mutationId: crypto.randomUUID(), puts: [{ id: "b", cells: { task: text } }], deletes: [],
      } });
      expect(response.status()).toBe(200);
    };
    await context.setOffline(true);
    const pulled = page.waitForResponse((response) => response.url().endsWith(`${path}/table/changes`) && response.ok());
    await remoteSave("Pulled second row");
    await context.setOffline(false);
    await pulled;
    await expect(page.locator(".edgeever-workspace-editor table").getByRole("button", { name: "Pulled second row" })).toBeVisible();

    await context.setOffline(true);
    await edit("Pulled second row", "Conflicting local draft");
    await expect.poll(async () => (await recordQueue(page, memo.id))?.status).toBe("pending");
    await remoteSave("Remote wins while offline");
    await context.setOffline(false);
    await expect.poll(async () => (await recordQueue(page, memo.id))?.status).toBe("conflict");
    const draft = await recordQueue(page, memo.id);
    expect(parseTableDocument(draft.payload.contentMarkdown)?.records.find((row) => row.id === "b")?.cells.task).toBe("Conflicting local draft");
    const { memo: remote } = await (await page.request.get(path)).json();
    expect(parseTableDocument(remote.contentMarkdown)?.records.find((row) => row.id === "b")?.cells.task).toBe("Remote wins while offline");
  } finally {
    dropFirstResponse();
    await context.setOffline(false);
    await page.request.delete(path);
    await page.request.delete(`${path}?permanent=1`);
  }
});
