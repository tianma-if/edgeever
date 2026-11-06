import { expect, test, type Page } from "@playwright/test";

const formatStorageKey = "edgeever.untitledMemoDateFormat";

const createUntitledMemo = async (page: Page, marker: string) => {
  const notebooks = await (await page.request.get("/api/v1/notebooks")).json() as { notebooks: Array<{ id: string }> };
  const response = await page.request.post("/api/v1/memos", {
    data: { notebookId: notebooks.notebooks[0]?.id, title: "", contentMarkdown: `${marker} body` },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { memo: { id: string; title: string; createdAt: string } }).memo;
};

const openList = async (page: Page, format: string | null, marker: string, memoId: string) => {
  await page.addInitScript(({ key, value }) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }, { key: formatStorageKey, value: format });
  await page.goto("/");
  // Startup auto-selects the demo notebook once the notebook list loads; wait for it first.
  const notebookRows = page.getByRole("button", { name: /^(当前|切换到 ).*条笔记/ });
  await expect(notebookRows.first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await expect(page.getByRole("button", { name: /^当前：.*条笔记/ })).toHaveCount(0);
  await page.getByPlaceholder("搜索笔记").fill(marker);
  const row = page.locator(`article[data-memo-id="${memoId}"]`);
  await expect(row).toBeVisible();
  return row;
};

// The creation time as the browser shows it in its own time zone, in the ISO format.
const localIsoTime = (page: Page, createdAt: string) => page.evaluate((value) => {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}, createdAt);

test("untitled notes show their creation time in the list and the quick switcher", async ({ page }) => {
  const marker = `untitled-date-${Date.now()}`;
  const memo = await createUntitledMemo(page, marker);
  try {
    // Default format: the localized date and time.
    let row = await openList(page, null, marker, memo.id);
    await expect(row).toContainText(/无标题笔记 · \d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/);

    row = await openList(page, "iso", marker, memo.id);
    await expect(row).toContainText(`无标题笔记 · ${await localIsoTime(page, memo.createdAt)}`);

    // The quick switcher uses the same label.
    await page.keyboard.press("ControlOrMeta+O");
    const switcher = page.getByRole("dialog");
    await switcher.getByPlaceholder("搜索笔记标题或内容…").fill(marker);
    await expect(switcher.getByRole("option")).toContainText(`无标题笔记 · ${await localIsoTime(page, memo.createdAt)}`);
    await page.keyboard.press("Escape");

    // Turning the date off restores the plain label.
    row = await openList(page, "off", marker, memo.id);
    await expect(row).toContainText("无标题笔记");
    await expect(row).not.toContainText("无标题笔记 ·");

    // The date is only part of the label; the stored title is unchanged.
    const stored = await (await page.request.get(`/api/v1/memos/${memo.id}`)).json() as { memo: { title: string } };
    expect(stored.memo.title).toBe(memo.title);
    expect(stored.memo.title).not.toContain("·");
  } finally {
    // Permanent deletion only applies to notes already in the trash.
    await page.request.delete(`/api/v1/memos/${memo.id}`);
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
  }
});
