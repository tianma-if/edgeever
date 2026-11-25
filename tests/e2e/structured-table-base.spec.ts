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

const planFields = [
  { id: "name", name: "标题", type: "text" as const },
  { id: "status", name: "状态", type: "select" as const, options: ["未开始", "进行中", "完成"] },
];

const plan: LegacyTableDocument = {
  schemaVersion: 1,
  fields: planFields,
  records: [
    { id: "record_a", cells: { name: "公众号选题", status: "未开始" } },
    { id: "record_b", cells: { name: "短视频脚本", status: "进行中" } },
    { id: "record_c", cells: { name: "直播复盘", status: "完成" } },
  ],
  view: { filters: [], sort: null },
};

const assets: LegacyTableDocument = {
  schemaVersion: 1,
  fields: [{ id: "title", name: "素材", type: "text" as const }],
  records: [{ id: "asset_1", cells: { title: "封面图" } }],
  view: { filters: [], sort: null },
};

const openMemo = async (page: Page, memo: { id: string; title: string }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await page.getByPlaceholder("搜索笔记").fill(memo.title);
  await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
};

test("a base holds several tables, switches views, groups records, opens kanban and edits a record panel", async ({ page }) => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const base = createTableBaseDocument({
    tables: [
      { name: "内容计划", document: saveTableViews(plan, getTableViews(plan)) },
      { name: "素材库", document: saveTableViews(assets, getTableViews(assets)) },
    ],
  });
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id,
    title: `多维表格 Base ${Date.now()}`,
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
  const tableItems = page.locator('[data-testid="base-table-item"]');
  const grid = page.locator('[data-testid="base-grid"]');

  try {
    await openMemo(page, memo);
    await expect(tableItems).toHaveCount(2);
    await expect(tableItems.first()).toContainText("内容计划");
    await expect(grid.getByRole("button", { name: "公众号选题", exact: true })).toBeVisible();

    // Switching tables swaps the whole grid, not just a filter.
    await tableItems.filter({ hasText: "素材库" }).click();
    await expect(grid.getByRole("button", { name: "封面图", exact: true })).toBeVisible();
    await expect(grid.getByRole("button", { name: "公众号选题", exact: true })).toHaveCount(0);
    await persisted((document) => document.tables.find((table) => table.id === document.activeTableId)?.name === "素材库", "active table");

    // A new table starts from the default seeded table and becomes active.
    await page.getByRole("button", { name: "新建数据表" }).click();
    await expect(tableItems).toHaveCount(3);
    await expect(grid.locator("thead").getByText("名称", { exact: true })).toBeVisible();
    await persisted((document) => document.tables.length === 3, "third table");

    // Renaming goes through the table menu.
    await tableItems.last().hover();
    await page.getByRole("button", { name: "数据表 3 的操作" }).click();
    await page.getByRole("menuitem", { name: "重命名数据表" }).click();
    const renameInput = page.getByRole("textbox", { name: "重命名数据表" });
    await renameInput.fill("任务清单");
    await renameInput.press("Enter");
    await expect(tableItems.filter({ hasText: "任务清单" })).toHaveCount(1);
    await persisted((document) => document.tables.some((table) => table.name === "任务清单"), "renamed table");

    // Grouping and the kanban layout are stored on the active view of one table only.
    await tableItems.filter({ hasText: "内容计划" }).click();
    await page.getByRole("button", { name: "分组", exact: true }).click();
    await page.getByRole("dialog", { name: "分组" }).getByLabel("分组字段").selectOption({ label: "状态" });
    await page.getByRole("dialog", { name: "分组" }).getByRole("button", { name: "应用" }).click();
    await expect(page.locator('[data-testid="base-group-row"]')).toHaveCount(3);
    await persisted((document) => {
      const table = document.tables.find((item) => item.name === "内容计划");
      const view = table ? getTableViews(tableBaseTableDocument(table)!) [0] : undefined;
      return view?.groupBy?.fieldId === "status";
    }, "group by status");

    await page.getByRole("button", { name: "看板视图" }).click();
    const kanban = page.locator('[data-testid="base-kanban"]');
    await expect(kanban).toBeVisible();
    await expect(kanban.locator("section")).toHaveCount(3);
    await persisted((document) => {
      const table = document.tables.find((item) => item.name === "内容计划");
      return table ? getTableViews(tableBaseTableDocument(table)!) [0]?.layout === "kanban" : false;
    }, "kanban layout");

    // A card opens the right-side record panel, which edits the record.
    await kanban.getByRole("button", { name: "公众号选题", exact: true }).click();
    const panel = page.locator('[data-testid="base-record-panel"]');
    await expect(panel).toBeVisible();
    const titleField = panel.getByRole("textbox", { name: "标题" });
    await titleField.fill("公众号选题 v2");
    // The text field commits on blur; the panel header is a stable place to drop focus.
    await panel.locator("header").click();
    await expect(panel.getByRole("heading", { name: "公众号选题 v2", exact: true })).toBeVisible();
    await persisted((document) => {
      const table = document.tables.find((item) => item.name === "内容计划");
      return table ? tableBaseTableDocument(table)?.records.some((record) => record.cells.name === "公众号选题 v2") === true : false;
    }, "edited record");
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(panel).toHaveCount(0);

    // Row actions live in a right-click menu: insert, duplicate and delete, all undoable.
    await page.getByRole("button", { name: "表格视图" }).click();
    const rows = grid.locator('[data-testid="base-record-row"]');
    const before = await rows.count();
    await rows.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "复制记录" }).click();
    await expect(rows).toHaveCount(before + 1);
    await persisted((document) => {
      const table = document.tables.find((item) => item.name === "内容计划");
      return table ? (tableBaseTableDocument(table)?.records.length ?? 0) === before + 1 : false;
    }, "duplicated record");

    await rows.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "向下插入行" }).click();
    await expect(rows).toHaveCount(before + 2);
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(rows).toHaveCount(before + 1);
    await page.getByRole("button", { name: "重做" }).click();
    await expect(rows).toHaveCount(before + 2);

    await rows.last().click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除这条记录" }).click();
    await expect(rows).toHaveCount(before + 1);
    await persisted((document) => {
      const table = document.tables.find((item) => item.name === "内容计划");
      return table ? (tableBaseTableDocument(table)?.records.length ?? 0) === before + 1 : false;
    }, "deleted record");

    // Everything survives a reload: three tables, the rename and the record edits.
    await page.reload();
    await openMemo(page, memo);
    await expect(tableItems).toHaveCount(3);
    await expect(tableItems.filter({ hasText: "任务清单" })).toHaveCount(1);
    await tableItems.filter({ hasText: "内容计划" }).click();
    await expect(grid.locator('[data-testid="base-record-row"]')).toHaveCount(before + 1);
  } finally {
    await page.request.delete(path).catch(() => undefined);
    await page.request.delete(`${path}?permanent=1`).catch(() => undefined);
  }
});