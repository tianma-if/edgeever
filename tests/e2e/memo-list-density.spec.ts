import { expect, test, type Locator, type Page } from "@playwright/test";

const storageKey = "edgeever.memoListDensity";

const createMemo = async (page: Page, title: string, tags = ["density", "layout", "third"]) => {
  const notebooks = await (await page.request.get("/api/v1/notebooks")).json() as { notebooks: Array<{ id: string }> };
  const response = await page.request.post("/api/v1/memos", {
    data: {
      notebookId: notebooks.notebooks[0]?.id,
      title,
      contentMarkdown: "First line of the note body that is long enough to need more than one line in the preview list. ".repeat(3),
      tags,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { memo: { id: string } }).memo.id;
};

const openRow = async (page: Page, density: "preview" | "compact", title: string, memoId: string) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: density });
  await page.goto("/");
  // Startup auto-selects the demo notebook as soon as the notebook list loads. Wait for
  // that list before choosing All notes, or the late selection hides the note again.
  const notebookRows = page.getByRole("button", { name: /^(当前|切换到 ).*条笔记/ });
  await expect(notebookRows.first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await expect(page.getByRole("button", { name: /^当前：.*条笔记/ })).toHaveCount(0);
  await page.getByPlaceholder("搜索笔记").fill(title);
  const row = page.locator(`article[data-memo-id="${memoId}"]`);
  await expect(row).toBeVisible();
  await expect(row.locator(`[data-memo-density="${density}"]`)).toHaveCount(1);
  return row;
};

// Reads geometry through a retrying assertion so a list re-render cannot return null.
const boxOf = async (locator: Locator) => {
  let box: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  await expect.poll(async () => (box = await locator.boundingBox()) !== null).toBe(true);
  return box!;
};

test("compact rows show title, date, summary and tags in two short lines", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const title = `Density check ${Date.now()}`;
  const memoId = await createMemo(page, title);
  try {
    const previewRow = await openRow(page, "preview", title, memoId);
    const previewHeight = (await boxOf(previewRow)).height;
    expect(previewHeight).toBeGreaterThanOrEqual(120);

    const row = await openRow(page, "compact", title, memoId);
    const box = await boxOf(row);
    expect(box.height).toBeLessThanOrEqual(60);
    expect(box.height).toBeLessThan(previewHeight / 2);

    // The title and the date share the first line.
    const titleBox = await boxOf(row.getByText(title, { exact: true }));
    const timeBox = await boxOf(row.locator("time"));
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
    expect((await boxOf(row)).height).toBeCloseTo(box.height, 0);
  } finally {
    // Permanent deletion only applies to notes already in the trash.
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});

test("compact summary keeps its space next to two long tags in a narrow list", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem("edgeever.memoListWidth", "300"));
  const title = `Narrow density ${Date.now()}`;
  const tags = ["an-unusually-long-project-tag-name", "another-very-long-tag-for-layout"];
  const memoId = await createMemo(page, title, tags);
  try {
    const row = await openRow(page, "compact", title, memoId);
    const summary = row.getByText(/^First line of the note body/);
    await expect(summary).toBeVisible();
    expect((await boxOf(summary)).width).toBeGreaterThan(80);

    for (const tag of tags) {
      const chip = row.getByText(`#${tag}`, { exact: true });
      await expect(chip).toBeVisible();
      // Long tags end in an ellipsis instead of pushing the summary out.
      expect(await chip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    }
    expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  } finally {
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});
