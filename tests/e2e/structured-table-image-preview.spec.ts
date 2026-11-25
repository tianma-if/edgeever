import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createTableBaseDocument,
  markdownToDoc,
  serializeTableBaseDocument,
  tableBaseFallbackMarkdown,
  type LegacyTableDocument,
} from "@edgeever/shared";

/**
 * Attachment thumbnails and card covers must paint a downscaled preview instead
 * of the original blob: a single poster upload can decode into hundreds of
 * megabytes of bitmap and turn every hover into a long task.
 */
const fixturePath = fileURLToPath(new URL("../../docs/changes/evidence/2026-10-30-share-options/reopened.png", import.meta.url));

const openMemo = async (page: Page, memo: { id: string; title: string }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await page.getByPlaceholder("搜索笔记").fill(memo.title);
  await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
};

test("a base preview downscales attachment images for the grid and the kanban covers", async ({ page }) => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const document: LegacyTableDocument = {
    schemaVersion: 1,
    fields: [
      { id: "name", name: "标题", type: "text" },
      { id: "status", name: "状态", type: "select", options: ["未开始", "进行中", "完成"] },
      { id: "cover", name: "封面", type: "attachment" },
    ],
    records: [{ id: "record_cover", cells: { name: "封面测试", status: "未开始", cover: [] } }],
    view: { filters: [], sort: null },
  };
  const base = createTableBaseDocument({ tables: [{ name: "素材", document }] });
  const created = await page.request.post("/api/v1/memos", {
    data: {
      notebookId: notebooks[0].id,
      title: `多维表格图片预览 ${Date.now()}`,
      contentMarkdown: serializeTableBaseDocument(base),
      contentJson: markdownToDoc(tableBaseFallbackMarkdown(base)),
    },
  });
  const { memo } = await created.json();

  try {
    await openMemo(page, memo);
    const grid = page.locator('[data-testid="base-grid"]');
    await expect(grid).toBeVisible();

    const sourceBytes = readFileSync(fixturePath);
    await grid.locator('tr[data-record-id="record_cover"] input[type=file]').setInputFiles({
      name: "poster.png",
      mimeType: "image/png",
      buffer: sourceBytes,
    });

    // The grid thumbnail resolves through the preview pipeline: a blob URL that
    // is smaller than the uploaded poster.
    const cellImage = grid.locator('[data-testid="resource-image"]').first();
    await expect(cellImage).toBeVisible({ timeout: 20_000 });
    await expect(cellImage).toHaveAttribute("src", /^blob:/);
    const cellWidth = await cellImage.evaluate((element: HTMLImageElement) => element.naturalWidth);
    expect(cellWidth).toBeLessThanOrEqual(640);

    // Grouping by the select field turns the view into kanban lanes with covers.
    await page.getByRole("button", { name: "分组" }).click();
    await page.getByRole("combobox").first().selectOption({ label: "状态" });
    await page.getByRole("button", { name: "应用" }).click();
    await page.getByRole("button", { name: "看板视图" }).click();

    const kanban = page.locator('[data-testid="base-kanban"]');
    await expect(kanban).toBeVisible();
    const cover = kanban.locator('[data-testid="resource-image"]').first();
    await expect(cover).toBeVisible({ timeout: 20_000 });
    await expect(cover).toHaveAttribute("src", /^blob:/);
    const coverWidth = await cover.evaluate((element: HTMLImageElement) => element.naturalWidth);
    expect(coverWidth).toBeLessThanOrEqual(640);
    await expect(kanban.locator('[data-testid="resource-image-placeholder"]')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
  }
});