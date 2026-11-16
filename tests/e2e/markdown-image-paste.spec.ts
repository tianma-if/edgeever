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
    // Filenames/titles stay in the document model, not native hover tooltips.
    await expect(image).not.toHaveAttribute("title");
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
    const saved = await (await page.request.get(`/api/v1/memos/${memo.id}`)).json();
    expect(JSON.stringify(saved.memo.contentJson)).toContain('"title":"Issue 229"');
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

test("keeps typing and consecutive uploads usable, including when final images load slowly", async ({ page }) => {
  const memo = await createMemo(page, `Consecutive image uploads ${Date.now()}`);
  let releaseUploads = () => {};
  let releaseImages = () => {};
  const uploads = new Promise<void>((resolve) => { releaseUploads = resolve; });
  const images = new Promise<void>((resolve) => { releaseImages = resolve; });
  try {
    await page.route("**/api/v1/memos/*/resources", async (route) => {
      await uploads;
      await route.continue();
    });
    await page.route("**/api/v1/resources/*/blob", async (route) => {
      await images;
      await route.continue();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeEditable();
    await editor.click();
    await dispatchPngFilePaste(editor);
    const pending = editor.locator(".edgeever-image-upload-placeholder");
    await expect(pending).toHaveCount(1);
    const editorBox = (await editor.boundingBox())!;
    const pendingBox = (await pending.boundingBox())!;
    // Reproduce the lost native selection after clicking below the block widget
    // in an otherwise empty paragraph, then type through real keyboard input.
    await editor.click({ position: { x: 20, y: pendingBox.y + pendingBox.height - editorBox.y + 20 } });
    await page.keyboard.type("Typing during upload");
    await expect(editor).toContainText("Typing during upload");
    await dispatchPngFilePaste(editor);
    await expect(pending).toHaveCount(2);
    await page.keyboard.type(" still works");
    releaseUploads();
    const preview = editor.locator("img[data-upload-preview]");
    await expect(pending).toHaveCount(0);
    await expect(preview).toHaveCount(2);
    // The previous preload timeout was four seconds. Neither local preview may
    // disappear while the actual mounted images are still waiting for bytes.
    await page.waitForTimeout(4_500);
    for (const image of await preview.all()) {
      await expect(image).toBeVisible();
      expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    }
    await expect(editor).toContainText("Typing during upload");
    await expect(editor).toContainText(" still works");
    releaseImages();
    await expect(preview).toHaveCount(0);
    const finalImages = editor.locator(".edgeever-image-node img");
    await expect(finalImages).toHaveCount(2);
    for (const image of await finalImages.all()) {
      await expect(image).toBeVisible();
      expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    }
  } finally {
    releaseUploads();
    releaseImages();
    await deleteMemo(page, memo.id);
  }
});

for (const mimeType of ["image/svg+xml", "application/octet-stream"]) {
  test(`previews and persists a pasted SVG without rasterizing (${mimeType})`, async ({ page }) => {
    const title = `SVG upload ${Date.now()}`;
    const memo = await createMemo(page, title);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><style>rect{fill:#07130b}</style><rect width="240" height="120"/><text x="20" y="65" fill="white">SVG preview</text><script>window.svgExecuted=true</script></svg>';
    try {
      await page.goto("/");
      await expect(page.locator(".ProseMirror[contenteditable='true']")).toBeEditable();
      await page.getByRole("button", { name: "全部笔记", exact: true }).click();
      await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
      const editor = page.locator(".ProseMirror[contenteditable='true']");
      await expect(editor).toBeEditable();
      const uploaded = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/api/v1/memos/${memo.id}/resources`));
      await editor.evaluate((element, input) => {
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([input.svg], "diagram.svg", { type: input.mimeType }));
        element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
      }, { svg, mimeType });
      const { resource } = await (await uploaded).json();
      expect(resource.kind).toBe("image");
      expect(resource.mimeType).toBe("image/svg+xml");
      const image = editor.locator(`img[src="${resource.url}"]`);
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(240);
      const original = await page.request.get(resource.url);
      expect(await original.text()).toBe(svg);
      await test.info().attach("svg-preview", { body: await image.screenshot(), contentType: "image/png" });
      expect(original.headers()["content-security-policy"]).toContain("sandbox");
      await expect.poll(async () => {
        const response = await page.request.get(`/api/v1/memos/${memo.id}`);
        return JSON.stringify((await response.json()).memo.contentJson);
      }).toContain(resource.url);
      await page.reload();
      await expect(page.locator(".ProseMirror[contenteditable='true']")).toBeEditable();
      await page.getByRole("button", { name: "全部笔记", exact: true }).click();
      await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
      await expect(page.locator(`.ProseMirror img[src="${resource.url}"]`)).toBeVisible();
      // Opening the original as a document must not execute embedded scripts.
      const document = await page.context().newPage();
      try {
        await document.goto(new URL(resource.url, page.url()).href);
        expect(await document.evaluate(() => Reflect.get(window, "svgExecuted"))).toBeUndefined();
      } finally { await document.close(); }
    } finally {
      await deleteMemo(page, memo.id);
    }
  });
}
