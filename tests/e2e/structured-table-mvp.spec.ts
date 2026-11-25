import { expect, test, type Page } from "@playwright/test";
import {
  getTableViews, markdownToDoc, parseTableDocument, saveTableViews, serializeTableDocument, tableFallbackMarkdown,
  type LegacyTableDocument, type TableDocument,
} from "@edgeever/shared";

const fields = [
  { id: "name", name: "名称", type: "text" as const },
  { id: "status", name: "状态", type: "select" as const, options: ["未开始", "进行中", "完成"] },
  { id: "tags", name: "标签", type: "multiSelect" as const, options: ["重要", "紧急"] },
  { id: "phone", name: "电话", type: "phone" as const },
  { id: "email", name: "邮箱", type: "email" as const },
];

const legacy: LegacyTableDocument = {
  schemaVersion: 1,
  fields,
  records: [
    { id: "record_a", cells: { name: "甲", status: "未开始", tags: ["重要"], phone: "13800000000", email: "a@example.com" } },
    { id: "record_b", cells: { name: "乙", status: "进行中", tags: [], phone: "", email: "" } },
    { id: "record_c", cells: { name: "丙", status: "完成", tags: ["紧急"], phone: "", email: "" } },
  ],
  view: { filters: [], sort: null },
};

const openMemo = async (page: Page, memo: { id: string; title: string }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await page.getByPlaceholder("搜索笔记").fill(memo.title);
  await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
};

test("a view hides and resizes columns, groups records, opens kanban, edits a record detail and imports CSV", async ({ page }) => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id,
    title: `表格 MVP ${Date.now()}`,
    contentMarkdown: serializeTableDocument(saveTableViews(legacy, getTableViews(legacy))),
    contentJson: markdownToDoc(tableFallbackMarkdown(saveTableViews(legacy, getTableViews(legacy)))),
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json();
  const path = `/api/v1/memos/${memo.id}`;
  const stored = async () => parseTableDocument((await (await page.request.get(path)).json()).memo.contentMarkdown)!;
  // The table editor saves into the local mirror first and lets the background sync queue
  // push the PATCH after DEFERRED_MEMO_SYNC_DELAY_MS (30s). Nudging the queue with the same
  // event the app dispatches after other mutations keeps the test fast without faking a save.
  const flushSyncQueue = () => page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
  });
  const persisted = async (predicate: (document: TableDocument) => boolean, label: string) => {
    await expect.poll(async () => {
      await flushSyncQueue().catch(() => undefined);
      try { return predicate(await stored()); } catch { return false; }
    }, { timeout: 20_000, message: `${label} was not persisted` }).toBe(true);
  };
  const groupHeaders = page.locator('.edgeever-workspace-editor table tbody tr:not([aria-hidden]) td[colspan]');

  try {
    await openMemo(page, memo);
    const grid = page.locator(".edgeever-workspace-editor table");
    await expect(grid.getByRole("button", { name: "甲", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "字段配置" }).click();
    const fieldsDialog = page.getByRole("dialog", { name: "字段配置" });
    await fieldsDialog.getByRole("checkbox", { name: "电话" }).uncheck();
    await fieldsDialog.getByRole("spinbutton", { name: "电话 列宽" }).fill("220");
    await fieldsDialog.getByRole("button", { name: "应用" }).click();
    await expect(page.getByRole("dialog", { name: "字段配置" })).toHaveCount(0);
    await expect(grid.locator("thead").getByText("电话", { exact: true })).toHaveCount(0);
    await persisted((document) => document.schemaVersion === 3
      && getTableViews(document)[0]?.columns?.some((column) => column.fieldId === "phone" && column.hidden === true && column.width === 220) === true,
    "hidden phone column");
    expect(getTableViews(await stored())[0]?.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldId: "phone", hidden: true, width: 220 }),
    ]));

    await page.getByRole("button", { name: "分组", exact: true }).click();
    const groupDialog = page.getByRole("dialog", { name: "分组" });
    await groupDialog.getByLabel("分组字段").selectOption({ label: "状态" });
    await groupDialog.getByRole("button", { name: "应用" }).click();
    await expect(groupHeaders).toHaveCount(3);
    await expect(groupHeaders.first()).toContainText("未开始");
    await persisted((document) => getTableViews(document)[0]?.groupBy?.fieldId === "status", "group by status");

    await page.getByRole("button", { name: "看板视图" }).click();
    const kanban = page.getByTestId("table-kanban");
    await expect(kanban).toBeVisible();
    await expect(kanban.locator("section")).toHaveCount(3);
    await expect(kanban.locator("section").filter({ hasText: "进行中" })).toContainText("乙");
    await persisted((document) => getTableViews(document)[0]?.layout === "kanban", "kanban layout");

    await kanban.locator("article").filter({ hasText: "甲" }).getByRole("button", { name: "展开记录" }).click();
    const detail = page.getByRole("dialog").filter({ has: page.getByRole("textbox", { name: "名称" }) });
    await expect(detail).toBeVisible();
    await detail.getByRole("textbox", { name: "名称" }).fill("甲改");
    // The detail dialog commits on blur, so click its heading to leave the field.
    await detail.getByRole("heading", { name: "甲", exact: true }).click();
    await persisted((document) => document.records.find((record) => record.id === "record_a")?.cells.name === "甲改",
      "record detail rename");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog").filter({ has: page.getByRole("textbox", { name: "名称" }) })).toHaveCount(0);
    await expect(kanban.getByText("甲改", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "表格视图" }).click();
    await expect(grid.getByRole("button", { name: "甲改", exact: true })).toBeVisible();
    await expect(groupHeaders).toHaveCount(3);
    await persisted((document) => getTableViews(document)[0]?.layout !== "kanban", "back to grid layout");

    await page.locator('input[aria-label="导入 CSV"]').setInputFiles({
      name: "rows.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("名称,标签,邮箱\n导入一,重要;紧急,one@example.com\n导入二,,\n", "utf8"),
    });
    await expect(page.getByRole("status").filter({ hasText: "已导入 2 条记录" })).toBeVisible();
    await persisted((document) => document.records.length === 5, "CSV rows");
    const imported = await stored();
    expect(imported.records.at(-2)?.cells).toMatchObject({ name: "导入一", tags: ["重要", "紧急"], email: "one@example.com" });
    expect(imported.records.at(-1)?.cells).toMatchObject({ name: "导入二", tags: [] });

    await openMemo(page, memo);
    await expect(page.getByTestId("table-kanban")).toHaveCount(0);
    await expect(page.locator(".edgeever-workspace-editor table thead").getByText("电话", { exact: true })).toHaveCount(0);
    // Two imported rows have no status yet, so the grid keeps a lane for the empty value.
    await expect(groupHeaders).toHaveCount(4);
    await expect(groupHeaders.last()).toContainText("空值");
  } finally {
    await page.request.delete(path);
    await page.request.delete(`${path}?permanent=1`);
  }
});