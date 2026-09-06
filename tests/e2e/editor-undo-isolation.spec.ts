import { expect, test } from "@playwright/test";

test("keeps undo history isolated when switching between search results", async ({ page }) => {
  const marker = `undo-isolation-${Date.now()}`;
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

  const createMemo = async (title: string, contentMarkdown: string) => {
    const response = await page.request.post("/api/v1/memos", {
      data: { notebookId, title, contentMarkdown },
    });
    expect(response.status()).toBe(201);
    return (await response.json() as { memo: { id: string } }).memo;
  };

  const first = await createMemo(`${marker} first`, `${marker} FIRST CONTENT`);
  const second = await createMemo(`${marker} second`, `${marker} SECOND CONTENT`);

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(marker);

    await page.locator(`[data-memo-id="${first.id}"]`).locator("button").first().click();
    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toContainText(`${marker} FIRST CONTENT`);

    await page.locator(`[data-memo-id="${second.id}"]`).locator("button").first().click();
    await expect(editor).toContainText(`${marker} SECOND CONTENT`);

    await editor.click();
    await page.keyboard.insertText(" accidental edit");
    await page.keyboard.press("ControlOrMeta+z");

    await expect(editor).toContainText(`${marker} SECOND CONTENT`);
    await expect(editor).not.toContainText("accidental edit");
    await expect(editor).not.toContainText(`${marker} FIRST CONTENT`);
  } finally {
    for (const memo of [first, second]) {
      await page.request.delete(`/api/v1/memos/${memo.id}`);
      await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
    }
  }
});
