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

const dispatchPngFilePaste = async (editor: Locator) => {
  await editor.evaluate((element) => {
    const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "upload-feedback.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });
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

    const imageNode = editor.locator(".edgeever-image-node");
    await image.click();
    await expect(imageNode).toHaveClass(/(?:is-selected|ProseMirror-selectednode)/);
    await imageNode.getByRole("button", { name: "较小" }).click();

    const editorBox = await editor.boundingBox();
    const imageBox = await imageNode.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(imageBox).not.toBeNull();
    await editor.click({
      position: {
        x: (editorBox?.width ?? 0) - 4,
        y: (imageBox?.y ?? 0) - (editorBox?.y ?? 0) + Math.min((imageBox?.height ?? 0) / 2, 20),
      },
    });
    await expect(imageNode).not.toHaveClass(/(?:is-selected|ProseMirror-selectednode)/);

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

test("shows a stable local preview while a pasted image is uploading", async ({ page }) => {
  const title = `Image upload feedback ${Date.now()}`;
  const memo = await createMemo(page, title);
  let releaseUpload: () => void = () => undefined;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let markUploadStarted: () => void = () => undefined;
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });

  try {
    await page.route("**/api/v1/memos/*/resources", async (route) => {
      markUploadStarted();
      await uploadGate;
      await route.continue();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(title);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();

    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeEditable();
    await dispatchPngFilePaste(editor);

    const placeholder = editor.locator(".edgeever-image-upload-placeholder");
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveClass(/is-preview-ready/);
    expect((await placeholder.boundingBox())?.height ?? 0).toBeGreaterThan(150);
    await uploadStarted;
    await expect(placeholder).toBeVisible();

    releaseUpload();
    const finalImage = editor.locator(".edgeever-image-node img");
    await expect(finalImage).toBeVisible();
    await expect(placeholder).toHaveCount(0);
    expect((await finalImage.boundingBox())?.height ?? 0).toBeGreaterThan(1);
  } finally {
    releaseUpload();
    await deleteMemo(page, memo.id);
  }
});
