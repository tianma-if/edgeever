import { expect, test, type Page } from "@playwright/test";
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

const fields = [
  { id: "name", name: "标题", type: "text" as const },
  {
    id: "status",
    name: "状态",
    type: "select" as const,
    options: ["未开始", "进行中", "完成"],
    optionColors: { 未开始: "purple", 进行中: "orange" },
  },
  { id: "due", name: "截止", type: "date" as const },
];

const table: LegacyTableDocument = {
  schemaVersion: 1,
  fields,
  records: [
    { id: "record_a", cells: { name: "公众号选题", status: "未开始", due: "2026-12-01" } },
    { id: "record_b", cells: { name: "短视频脚本", status: "进行中", due: null } },
    { id: "record_c", cells: { name: "直播复盘", status: "完成", due: null } },
  ],
  view: { filters: [], sort: null },
};

const openMemo = async (page: Page, memo: { id: string; title: string }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await page.getByPlaceholder("搜索笔记").fill(memo.title);
  await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
};

test("single and multi select options keep custom colors across views", async ({ page }) => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const views = getTableViews(table).map((view) => ({ ...view, groupBy: { fieldId: "status", direction: "asc" as const } }));
  const base = createTableBaseDocument({ tables: [{ name: "内容计划", document: saveTableViews(table, views) }] });
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id,
    title: `多维表格选项颜色 ${Date.now()}`,
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
  const grid = page.locator('[data-testid="base-grid"]');

  try {
    await openMemo(page, memo);
    await expect(grid).toBeVisible();

    // stored colors reach the grid pills
    const started = grid.locator('[data-option-color]', { hasText: "未开始" });
    const running = grid.locator('[data-option-color]', { hasText: "进行中" });
    await expect(started.first()).toHaveAttribute("data-option-color", "purple");
    await expect(running.first()).toHaveAttribute("data-option-color", "orange");
    // 完成 has no stored color, so it falls back to a stable hash color
    const done = grid.locator('[data-option-color]', { hasText: "完成" });
    const fallbackColor = await done.first().getAttribute("data-option-color");
    expect(fallbackColor).toBeTruthy();

    // recolor one option through the field dialog
    await grid.getByRole("button", { name: "编辑字段 状态" }).click();
    await page.getByRole("menuitem", { name: "字段配置" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "选项颜色" })).toHaveCount(3);
    await dialog.getByRole("button", { name: "选项颜色" }).nth(2).click();
    await page.getByRole("menuitem", { name: "蓝色" }).click();
    await dialog.getByRole("button", { name: "确定" }).click();
    await expect(done.first()).toHaveAttribute("data-option-color", "blue");
    await persisted((document) => {
      const fields = tableBaseTableDocument(document.tables[0])?.fields ?? [];
      return fields.find((field) => field.id === "status")?.optionColors?.完成 === "blue";
    }, "option color");

    // kanban lanes borrow the same colors
    await page.getByRole("button", { name: "看板视图" }).click();
    const kanban = page.locator('[data-testid="base-kanban"]');
    await expect(kanban).toBeVisible();
    const lanes = kanban.locator('[data-option-color]');
    await expect(lanes).toHaveCount(3);
    await expect(kanban.locator('[data-option-color="purple"]')).toHaveCount(1);
    await expect(kanban.locator('[data-option-color="orange"]')).toHaveCount(1);
    await expect(kanban.locator('[data-option-color="blue"]')).toHaveCount(1);
    await page.getByRole("button", { name: "表格视图" }).click();

    // gantt lists scheduled and unscheduled records
    await page.getByRole("button", { name: "甘特视图" }).click();
    const gantt = page.locator('[data-testid="base-gantt"]');
    await expect(gantt).toBeVisible();
    await expect(page.locator('[data-testid="base-gantt-scheduled"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="base-gantt-unscheduled"]')).toHaveCount(2);
    await expect(gantt).toContainText("未排期");
    await page.getByRole("button", { name: "表格视图" }).click();
    await expect(grid).toBeVisible();
  } finally {
    await page.request.delete(`${path}?permanent=1`).catch(() => undefined);
  }
});
