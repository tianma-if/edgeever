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
