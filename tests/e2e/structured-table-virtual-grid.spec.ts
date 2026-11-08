import { expect, test } from "@playwright/test";
import {
  getTableViews, markdownToDoc, parseTableDocument, saveTableViews, serializeTableDocument, tableFallbackMarkdown,
  type LegacyTableDocument,
} from "@edgeever/shared";

test("a long grid keeps the edited record mounted across scrolling and saves only the edited row", async ({ page }) => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const legacy: LegacyTableDocument = {
    schemaVersion: 1,
    fields: [{ id: "task", name: "Task", type: "text" }, { id: "file", name: "File", type: "attachment" }],
    records: Array.from({ length: 500 }, (_, i) => ({ id: `record_${i}`, cells: { task: `Task ${i}`, file: [] } })),
    view: { filters: [], sort: null },
  };
  const table = saveTableViews(legacy, [
    { ...getTableViews(legacy)[0]!, name: "All tasks" },
    { id: "short", name: "Short list", match: "all", filters: [{ fieldId: "task", operator: "eq", value: "Task 0" }], sorts: [] },
  ]);
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id,
    title: `Virtual grid ${Date.now()}`,
    contentMarkdown: serializeTableDocument(table),
    contentJson: markdownToDoc(tableFallbackMarkdown(table)),
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json();
  const path = `/api/v1/memos/${memo.id}`;

  try {
    await page.addInitScript(() => {
      const probe = window as typeof window & { tableSerializationCount: number; resizeLoopErrors: string[] };
      probe.tableSerializationCount = 0;
      probe.resizeLoopErrors = [];
      window.addEventListener("error", (event) => {
        if (event.message.startsWith("ResizeObserver loop")) probe.resizeLoopErrors.push(event.message);
      });
      const stringify = JSON.stringify;
      JSON.stringify = (value, ...args: Parameters<typeof JSON.stringify> extends [unknown, ...infer Rest] ? Rest : never) => {
        if (value?.schemaVersion === 2 && value.records?.length === 500) probe.tableSerializationCount += 1;
        return stringify(value, ...args);
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(memo.title);
    await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
    const grid = page.locator(".edgeever-workspace-editor table");
    const rows = grid.locator("tbody tr:not([aria-hidden])");
    const scroll = grid.locator("..");
    await expect(grid.getByRole("button", { name: "Task 0", exact: true })).toBeVisible();
    expect(await rows.count()).toBeLessThan(80);
    await expect(grid.getByRole("button", { name: "Task 499", exact: true })).toHaveCount(0);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && new URL(request.url()).pathname === path) writes.push(request.url());
    });
    await page.getByRole("button", { name: "Short list", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole("button", { name: "All tasks", exact: true }).click();
    const countSerializations = () => page.evaluate(() => (window as typeof window & { tableSerializationCount: number }).tableSerializationCount);
    expect(await countSerializations()).toBe(0);
    await page.locator("[data-ai-assistant-launcher]").click();
    await expect.poll(countSerializations).toBe(1);
    await page.getByRole("button", { name: "收起助手" }).click();
    await expect(page.locator("[data-ai-assistant-launcher]")).toBeVisible();
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const last = grid.getByRole("button", { name: "Task 499", exact: true });
    await expect(last).toBeInViewport();
    await last.click();
    const editor = grid.getByRole("textbox", { name: "Task", exact: true });
    await editor.fill("Edited distant task");
    await scroll.evaluate((element) => { element.scrollTop = 0; });
    await expect(grid.getByRole("button", { name: "Task 0", exact: true })).toBeInViewport();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("Edited distant task");
    expect(writes).toHaveLength(0);

    const saved = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === path);
    await editor.press("Enter");
    expect((await saved).status()).toBe(200);
    const result = await (await page.request.get(path)).json();
    const reopened = parseTableDocument(result.memo.contentMarkdown)!;
    expect(reopened.records[0]?.cells.task).toBe("Task 0");
    expect(reopened.records.at(-1)?.cells.task).toBe("Edited distant task");
    expect(getTableViews(reopened)).toEqual(getTableViews(table));
    expect(writes).toHaveLength(1);

    let startUpload!: () => void;
    let releaseUpload!: () => void;
    const uploadStarted = new Promise<void>((resolve) => { startUpload = resolve; });
    const uploadReleased = new Promise<void>((resolve) => { releaseUpload = resolve; });
    const uploadUrl = `**${path}/resources`;
    await page.route(uploadUrl, async (route) => {
      startUpload();
      await uploadReleased;
      await route.continue();
    });
    const firstFile = grid.locator('tr[data-record-id="record_0"] input[type=file]');
    const nextEditor = grid.locator('tr[data-record-id="record_1"]').getByRole("textbox", { name: "Task", exact: true });
    try {
      await scroll.evaluate((element) => { element.scrollTop = 0; });
      await firstFile.setInputFiles({ name: "sample.txt", mimeType: "text/plain", buffer: Buffer.from("table attachment") });
      await uploadStarted;
      await expect(firstFile).toBeDisabled();
      await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect(firstFile).toHaveCount(0);
      await scroll.evaluate((element) => { element.scrollTop = 0; });
      await expect(firstFile).toBeDisabled();
      await grid.getByRole("button", { name: "Task 1", exact: true }).click();
      await nextEditor.fill("Still typing during upload");
    } finally {
      releaseUpload();
    }
    await expect(grid.getByText("sample.txt", { exact: true })).toBeVisible();
    await expect(nextEditor).toBeFocused();
    await expect(nextEditor).toHaveValue("Still typing during upload");
    const attachmentSaved = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === path);
    await nextEditor.press("Enter");
    expect((await attachmentSaved).status()).toBe(200);
    const withFile = parseTableDocument((await (await page.request.get(path)).json()).memo.contentMarkdown)!;
    expect(withFile.records[0]?.cells.file).toEqual([expect.objectContaining({ filename: "sample.txt" })]);
    expect(withFile.records[1]?.cells.task).toBe("Still typing during upload");
    expect(withFile.records.at(-1)?.cells.task).toBe("Edited distant task");
    await page.unroute(uploadUrl);
    expect(await page.evaluate(() => (window as typeof window & { resizeLoopErrors: string[] }).resizeLoopErrors)).toEqual([]);
  } finally {
    await page.request.delete(path);
    await page.request.delete(`${path}?permanent=1`);
  }
});
