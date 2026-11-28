import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createTableBaseDocument,
  getTableViews,
  markdownToDoc,
  parseTableBaseDocument,
  saveTableViews,
  serializeTableBaseDocument,
  tableBaseFallbackMarkdown,
  tableBaseTableDocument,
  type LegacyTableDocument,
  type TableBaseDocument,
} from "@edgeever/shared";

test.use({ timezoneId: "Asia/Shanghai" });

const pickFieldType = async (dialog: Locator, label: string) => {
  await dialog.getByRole("button", { name: "字段类型" }).click();
  await dialog.getByRole("option", { name: label, exact: true }).click();
};

const tasks: LegacyTableDocument = {
  schemaVersion: 1,
  fields: [
    { id: "name", name: "标题", type: "text" },
    { id: "qty", name: "数量", type: "number" },
    { id: "price", name: "单价", type: "currency" },
    { id: "progress", name: "完成度", type: "progress" },
    { id: "stars", name: "评分", type: "rating" },
    { id: "rate", name: "折扣", type: "percent" },
    { id: "created", name: "创建时间", type: "createdTime" },
  ],
  records: [
    {
      id: "task_1",
      cells: { name: "品牌片", qty: 2, price: 1234.5, progress: 40, stars: 4, rate: 0.125 },
      createdAt: "2026-01-02T03:04:05.000Z",
    },
    { id: "task_2", cells: { name: "口播", qty: 3, price: 5, progress: 100, stars: 5, rate: 1 } },
  ],
  view: { filters: [], sort: null },
};

const openMemo = async (page: Page, memo: { id: string; title: string }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await page.getByPlaceholder("搜索笔记").fill(memo.title);
  await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
};

test("business field types render, and the field dialog only offers the simple types", async ({ page }) => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const base = createTableBaseDocument({
    tables: [
      { id: "tbl_tasks", name: "任务", document: saveTableViews(tasks, getTableViews(tasks)) },
    ],
  });
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id,
    title: `多维表格字段 ${Date.now()}`,
    contentMarkdown: serializeTableBaseDocument(base),
    contentJson: markdownToDoc(tableBaseFallbackMarkdown(base)),
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json();
  const path = `/api/v1/memos/${memo.id}`;
  const stored = async () => parseTableBaseDocument((await (await page.request.get(path)).json()).memo.contentMarkdown)!;
  const flushSyncQueue = () => page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
  });
  const persisted = async (predicate: (document: TableBaseDocument) => boolean, label: string) => {
    await expect.poll(async () => {
      await flushSyncQueue().catch(() => undefined);
      try { return predicate(await stored()); } catch { return false; }
    }, { timeout: 30_000, message: `${label} was not persisted` }).toBe(true);
  };

  try {
    await openMemo(page, memo);
    const grid = page.locator('[data-testid="base-grid"]');
    const firstRow = page.locator('[data-testid="base-record-row"][data-record-id="task_1"]');
    await expect(grid).toBeVisible();

    // 货币、进度、评分、百分比字段按各自格式渲染
    await expect(firstRow.getByText("¥1,234.50")).toBeVisible();
    await expect(firstRow.getByText("40%")).toBeVisible();
    await expect(firstRow.getByRole("img", { name: "4 分" })).toBeVisible();
    await expect(firstRow.getByText("12.5%")).toBeVisible();
    // 系统时间字段只读展示
    await expect(firstRow.locator('[data-testid="computed-cell-createdTime"]')).toHaveText("2026-01-02 11:04");

    // 记录详情面板同样展示系统时间
    await firstRow.getByRole("button", { name: "展开记录" }).click();
    const panel = page.locator('[data-testid="base-record-panel"]');
    await expect(panel.locator('[data-testid="panel-computed-createdTime"]')).toContainText("2026-01-02 11:04");
    await panel.getByRole("button", { name: "关闭" }).click();

    // 字段类型选择器里不再出现关联 / 查找引用 / 公式
    await page.getByRole("button", { name: "添加字段" }).click();
    const addDialog = page.getByRole("dialog");
    await expect(addDialog).toBeVisible();
    await addDialog.getByRole("button", { name: "字段类型" }).click();
    const optionCount = await addDialog.getByRole("option").count();
    await addDialog.getByLabel("搜索字段类型").fill("公式");
    await expect(addDialog.getByRole("option")).toHaveCount(0);
    for (const removed of ["关联", "查找引用", "公式"]) {
      await addDialog.getByLabel("搜索字段类型").fill(removed);
      await expect(addDialog.getByRole("option")).toHaveCount(0);
    }
    await addDialog.getByLabel("搜索字段类型").fill("");
    await expect(addDialog.getByRole("option")).toHaveCount(optionCount);

    // 通过同一个对话框新增评分字段（选择器仍开着，直接搜索并选中）
    await addDialog.getByLabel("字段标题").fill("复核评分");
    await addDialog.getByLabel("搜索字段类型").fill("评分");
    await addDialog.getByRole("option", { name: "评分", exact: true }).click();
    await addDialog.getByRole("button", { name: "确定" }).click();
    await persisted((document) => {
      const table = tableBaseTableDocument(document.tables[0]);
      return Boolean(table?.fields.some((field) => field.name === "复核评分" && field.type === "rating"));
    }, "rating field");

    // 把百分比字段改成货币字段
    await grid.getByRole("button", { name: "编辑字段 折扣" }).click();
    await page.getByRole("menuitem", { name: "字段配置" }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByRole("heading", { name: "编辑字段" })).toBeVisible();
    await pickFieldType(editDialog, "货币");
    await editDialog.getByRole("button", { name: "确定" }).click();
    await persisted((document) => {
      const table = tableBaseTableDocument(document.tables[0]);
      return Boolean(table?.fields.some((field) => field.name === "折扣" && field.type === "currency"));
    }, "currency field");

    // 重新打开后字段与取值都保留
    await openMemo(page, memo);
    await expect(page.getByRole("columnheader", { name: /复核评分/ })).toBeVisible();
    await expect(page.locator('[data-testid="base-record-row"][data-record-id="task_2"]').getByText("100%")).toBeVisible();
  } finally {
    await page.request.delete(`${path}?permanent=1`).catch(() => undefined);
  }
});