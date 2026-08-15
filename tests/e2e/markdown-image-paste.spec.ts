import { expect, test, type Locator, type Page } from "@playwright/test";

const createMemo = async (page: Page, title: string) => {
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

  const createResponse = await page.request.post("/api/v1/memos", {
    data: { notebookId, title, contentMarkdown: "" },
  });
  expect(createResponse.status()).toBe(201);
  return (await createResponse.json() as { memo: { id: string } }).memo;
};

const deleteMemo = async (page: Page, memoId: string) => {
  await page.request.delete(`/api/v1/memos/${memoId}`);
  await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
};

const dispatchPlainTextPaste = async (editor: Locator, text: string) => {
  await editor.click();
  await editor.evaluate((element, clipboardText) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", clipboardText);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, text);
};

test("converts a pasted Markdown image line in the main Web editor", async ({ page }) => {
  const title = `Markdown image paste ${Date.now()}`;
  const memo = await createMemo(page, title);
  const source = "https://picui.ogmua.cn/s1/2026/08/12/6a7c64323d0a8.webp";
  const markdown = `![图片](${source} \"Issue 229\")`;

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(title);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();

    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeEditable();
    await dispatchPlainTextPaste(editor, markdown);

    const image = editor.locator(`img[src="${source}"]`);
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute("alt", "图片");
    await expect(image).toHaveAttribute("title", "Issue 229");
    await expect(editor).not.toContainText(markdown);

    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/memos/${memo.id}`);
      const body = await response.json() as { memo: { contentJson: unknown } };
      return JSON.stringify(body.memo.contentJson);
    }, { timeout: 20_000 }).toContain(source);
  } finally {
    await deleteMemo(page, memo.id);
  }
});

test("converts a pasted Markdown image line in the standalone mobile Web editor", async ({ page }) => {
  const title = `Mobile Markdown image paste ${Date.now()}`;
  const memo = await createMemo(page, title);
  const source = "https://example.com/mobile-image.png";
  const secondSource = "https://example.com/second-mobile-image.png";
  const markdown = [
    `![Mobile image](${source})`,
    `![Second mobile image](${secondSource})`,
  ].join("\n");

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/mobile-edit.html#memoId=${encodeURIComponent(memo.id)}&returnTo=%2F`);

    const editor = page.locator(".edgeever-mobile-tiptap-content[contenteditable='true']");
    await expect(editor).toBeEditable();
    await dispatchPlainTextPaste(editor, markdown);

    await expect(editor.locator("img")).toHaveCount(2);
    await expect(editor.locator(`img[src="${source}"]`)).toHaveAttribute("alt", "Mobile image");
    await expect(editor.locator(`img[src="${secondSource}"]`)).toHaveAttribute("alt", "Second mobile image");
    await expect(editor).not.toContainText(markdown);
  } finally {
    await deleteMemo(page, memo.id);
  }
});
