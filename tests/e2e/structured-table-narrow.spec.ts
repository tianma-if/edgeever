import { expect, test } from "@playwright/test";
import {
  createTableBaseDocument,
  markdownToDoc,
  serializeTableBaseDocument,
  tableBaseFallbackMarkdown,
  type LegacyTableDocument,
} from "@edgeever/shared";

const plan: LegacyTableDocument = {
  schemaVersion: 1,
  fields: [
    { id: "name", name: "标题", type: "text" as const },
    { id: "status", name: "状态", type: "select" as const, options: ["未开始", "完成"] },
  ],
  records: [{ id: "record_a", cells: { name: "公众号选题", status: "未开始" } }],
  view: { filters: [], sort: null },
};

const assets: LegacyTableDocument = {
  schemaVersion: 1,
  fields: [{ id: "title", name: "素材", type: "text" as const }],
  records: [{ id: "asset_1", cells: { title: "封面图" } }],
  view: { filters: [], sort: null },
};

type BaseMarkdown = { contentMarkdown: string; contentJson: unknown };

const buildMemo = async (
  page: import("@playwright/test").Page,
  planDocument: LegacyTableDocument,
  assetDocument: LegacyTableDocument,
  label: string,
): Promise<BaseMarkdown & { memoId: string; title: string }> => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const inbox = notebooks.find((notebook: { name: string }) => notebook.name === "功能演示") ?? notebooks[0];
  const base = createTableBaseDocument({
    tables: [{ name: "内容计划", document: planDocument }, { name: "素材库", document: assetDocument }],
  });
  const title = `${label} ${Date.now()}`;
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: inbox.id,
    title,
    contentMarkdown: serializeTableBaseDocument(base),
    contentJson: markdownToDoc(tableBaseFallbackMarkdown(base)),
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json();
  return { memoId: memo.id, title, contentMarkdown: memo.contentMarkdown ?? "", contentJson: memo.contentJson };
};

test("a phone viewport switches tables from the compact picker", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const inbox = notebooks.find((notebook: { name: string }) => notebook.name === "功能演示") ?? notebooks[0];
  const base = createTableBaseDocument({
    tables: [{ name: "内容计划", document: plan }, { name: "素材库", document: assets }],
  });
  const title = `多维表格窄屏 ${Date.now()}`;
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: inbox.id,
    title,
    contentMarkdown: serializeTableBaseDocument(base),
    contentJson: markdownToDoc(tableBaseFallbackMarkdown(base)),
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json();

  try {
    await page.goto("/");
    await page.getByText(title, { exact: false }).first().click();

    const picker = page.getByTestId("base-table-picker");
    await expect(picker).toBeVisible();
    await expect(picker).toContainText("内容计划");
    await expect(page.getByTestId("base-table-item").first()).toBeHidden();
    await expect(page.getByTestId("base-grid")).toContainText("公众号选题");

    await picker.click();
    await page.getByTestId("base-table-picker-item").filter({ hasText: "素材库" }).click();
    await expect(page.getByTestId("base-grid")).toContainText("封面图");
    await expect(picker).toContainText("素材库");

    // Switching back in a fresh page keeps the menu stable and proves both directions.
    await page.goto("/");
    await page.getByText(title, { exact: false }).first().click();
    const reopened = page.getByTestId("base-table-picker");
    await expect(reopened).toBeVisible();
    if (!(await reopened.textContent())?.includes("内容计划")) {
      await reopened.click();
      await page.getByTestId("base-table-picker-item").filter({ hasText: "内容计划" }).click();
    }
    await expect(reopened).toContainText("内容计划");
    await expect(page.getByTestId("base-grid")).toContainText("公众号选题");
  } finally {
    await page.goto("/").catch(() => undefined);
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`, { timeout: 20_000 }).catch(() => undefined);
  }
});

test("a phone viewport keeps the app chrome inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { memoId, title } = await buildMemo(page, plan, assets, "多维表格手机");

  try {
    await page.goto("/");
    await page.getByText(title, { exact: false }).first().click();
    await expect(page.getByTestId("base-grid")).toBeVisible();

    // Only the grid body may scroll sideways; headers, toolbars and sheets must fit.
    const nonGridScrollers = await page.evaluate(() => {
      const scrolls = (element: Element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
      };
      return Array.from(document.querySelectorAll("div, nav, header, section"))
        .filter(scrolls)
        .filter((element) => !element.querySelector('[data-testid="base-grid"]'))
        .map((element) => `${element.tagName}:${element.className}`);
    });
    expect(nonGridScrollers).toEqual([]);

    // Field tools live in a sheet, and cancelling a dialog returns to the field panel.
    await page.getByTestId("base-compact-tools").click();
    await expect(page.getByTestId("base-tools-sheet")).toBeVisible();
    for (const layout of ["grid", "kanban", "calendar", "gallery", "gantt"]) {
      await expect(page.getByTestId(`base-tools-layout-${layout}`)).toBeVisible();
    }
    await page.getByTestId("base-tools-fields").click();
    await expect(page.getByTestId("field-panel-list")).toBeVisible();
    await expect(page.getByTestId("field-panel-row")).toHaveCount(2);
    // Editing a field from the panel returns to the panel instead of the grid.
    await page.getByTestId("field-panel-edit").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByTestId("field-panel-list")).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByTestId("field-panel-list")).toBeHidden();

    // Kanban is reachable from the sheet and opens the record from a tap on the card.
    await page.getByTestId("base-compact-tools").click();
    await page.getByTestId("base-tools-layout-kanban").click();
    await expect(page.getByTestId("base-kanban")).toBeVisible();
    await page.locator('[data-testid="base-kanban"] article').first().click();
    await expect(page.getByTestId("base-record-panel")).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByTestId("base-record-panel")).toBeHidden();

    // The grid keeps a tap target for the record panel and never hides the row actions.
    await page.getByTestId("base-compact-tools").click();
    await page.getByTestId("base-tools-layout-grid").click();
    await expect(page.getByTestId("base-grid")).toBeVisible();
    await expect(page.getByRole("button", { name: "展开记录" }).first()).toBeVisible();
    await page.getByTestId("base-row-index").first().click();
    await expect(page.getByTestId("base-record-panel")).toBeVisible();
    await expect(page.getByTestId("base-record-panel")).toContainText("公众号选题");
    await page.getByRole("button", { name: "关闭", exact: true }).click();

    // Renaming and deleting a table live in the phone menu, not in a hidden sidebar.
    await page.getByTestId("base-more-menu").click();
    await page.getByTestId("base-rename-table").click();
    const renameInput = page.getByTestId("base-table-dialog").getByRole("textbox");
    await renameInput.fill("内容计划 2");
    await page.getByTestId("base-table-dialog").getByRole("button", { name: "确定" }).click();
    await expect(page.getByTestId("base-table-picker")).toContainText("内容计划 2");

    await page.getByTestId("base-more-menu").click();
    await page.getByTestId("base-delete-table").click();
    await expect(page.getByTestId("base-table-dialog")).toContainText("删除数据表「内容计划 2」");
    await page.getByTestId("base-table-dialog").getByRole("button", { name: "确定" }).click();
    await expect(page.getByTestId("base-table-picker")).toContainText("素材库");
    await page.getByTestId("base-more-menu").click();
    await expect(page.getByTestId("base-delete-table")).toHaveAttribute("data-disabled", "");
  } finally {
    await page.goto("/").catch(() => undefined);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`, { timeout: 20_000 }).catch(() => undefined);
  }
});
