import { expect, test, type Page } from "@playwright/test";

const storageKey = "edgeever.memoListDensity";

const createMemo = async (page: Page, title: string) => {
  const notebooks = await (await page.request.get("/api/v1/notebooks")).json() as { notebooks: Array<{ id: string }> };
  const response = await page.request.post("/api/v1/memos", {
    data: {
      notebookId: notebooks.notebooks[0]?.id,
      title,
      contentMarkdown: "First line of the note body that is long enough to need more than one line in the preview list. ".repeat(3),
      tags: ["density", "layout", "third"],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { memo: { id: string } }).memo.id;
};

const openRow = async (page: Page, density: "preview" | "compact", title: string, memoId: string) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: density });
  await page.goto("/");
  const row = page.locator(`article[data-memo-id="${memoId}"]`);
  // Startup can auto-select the demo notebook after the first click, so retry until the note is listed.
  await expect(async () => {
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(title);
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(row.locator(`[data-memo-density="${density}"]`)).toHaveCount(1);
  return row;
};

test("compact rows show title, date, summary and tags in two short lines", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const title = `Density check ${Date.now()}`;
  const memoId = await createMemo(page, title);
  try {
    const previewRow = await openRow(page, "preview", title, memoId);
    const previewHeight = (await previewRow.boundingBox())!.height;
    expect(previewHeight).toBeGreaterThanOrEqual(120);

    const row = await openRow(page, "compact", title, memoId);
    const box = (await row.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(60);
    expect(box.height).toBeLessThan(previewHeight / 2);

    // The title and the date share the first line.
    const titleBox = (await row.getByText(title, { exact: true }).boundingBox())!;
    const timeBox = (await row.locator("time").boundingBox())!;
    expect(Math.abs((titleBox.y + titleBox.height / 2) - (timeBox.y + timeBox.height / 2))).toBeLessThan(4);
    expect(timeBox.x).toBeGreaterThan(titleBox.x + titleBox.width - 1);

    // The second line holds the excerpt and at most two tags.
    await expect(row.getByText(/^First line of the note body/)).toBeVisible();
    await expect(row.getByText("#density", { exact: true })).toBeVisible();
    await expect(row.getByText("#layout", { exact: true })).toBeVisible();
    await expect(row.getByText("#third", { exact: true })).toHaveCount(0);

    // Hover actions float over the row instead of making it taller.
    await row.hover();
    await expect(row.getByRole("button", { name: "更多操作" })).toBeVisible();
    expect((await row.boundingBox())!.height).toBeCloseTo(box.height, 0);
  } finally {
    // Permanent deletion only applies to notes already in the trash.
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});
