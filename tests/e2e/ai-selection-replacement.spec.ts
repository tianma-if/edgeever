import { expect, test, type Locator, type Page } from "@playwright/test";

const selectEditorText = async (page: Page, editor: Locator, text: string) => {
  const selected = await editor.evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent ?? "";
      const start = value.indexOf(needle);
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + needle.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new Event("selectionchange", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return selection?.toString() ?? "";
      }
      node = walker.nextNode();
    }
    return "";
  }, text);

  expect(selected).toBe(text);
  await expect(page.getByRole("button", { name: "用 AI 处理" })).toBeVisible();
};

const mockAiReplacement = async (page: Page, replacement: string) => {
  await page.route("**/api/v1/ai/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: [
        `data: ${JSON.stringify({ type: "start" })}`,
        `data: ${JSON.stringify({ type: "text-delta", text: replacement })}`,
        `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}`,
        "",
      ].join("\n\n"),
    });
  });
};

const openMemo = async (page: Page, memoId: string, notebookName: string) => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(notebookName) }).click();
  await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
  return page.locator(".ProseMirror[contenteditable='true']");
};

const applyAiReplacement = async (page: Page) => {
  await page.getByRole("button", { name: "用 AI 处理" }).click();
  const dialog = page.getByRole("dialog", { name: "AI 笔记助手" });
  await expect(dialog.getByText("生成结果", { exact: true })).toBeVisible();
  await expect(dialog.getByText("AI 输出会先作为草稿展示，只有你主动操作后才会修改笔记。", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("AI 草稿", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "接受并替换选中内容" })).toBeEnabled();
  await dialog.getByRole("button", { name: "接受并替换选中内容" }).click();
  await expect(dialog).toBeHidden();
};

test.describe("AI selected-text replacement", () => {
  let notebookId: string;
  let notebookName: string;
  const createdMemoIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    const response = await request.get("/api/v1/notebooks");
    expect(response.ok()).toBe(true);
    const body = await response.json() as { notebooks: Array<{ id: string; name: string }> };
    notebookId = body.notebooks[0]?.id;
    notebookName = body.notebooks[0]?.name;
    expect(notebookId).toBeTruthy();
    expect(notebookName).toBeTruthy();
  });

  test.afterEach(async ({ request }) => {
    while (createdMemoIds.length) {
      const memoId = createdMemoIds.pop();
      if (!memoId) continue;
      await request.delete(`/api/v1/memos/${memoId}`);
      await request.delete(`/api/v1/memos/${memoId}?permanent=1`);
    }
  });

  const createMemo = async (page: Page, title: string, contentMarkdown: string) => {
    const response = await page.request.post("/api/v1/memos", {
      data: { notebookId, title, contentMarkdown },
    });
    expect(response.status()).toBe(201);
    const memo = (await response.json() as { memo: { id: string } }).memo;
    createdMemoIds.push(memo.id);
    return memo;
  };

  test("keeps list-like replacement text inside its surrounding paragraph", async ({ page }) => {
    const marker = `ai-inline-replace-${Date.now()}`;
    const content = "入口放在笔记栏中，1. - 校对先预览结果，再进行写入。";
    const memo = await createMemo(page, marker, content);
    await mockAiReplacement(page, "\n1. - 校对\n");

    const editor = await openMemo(page, memo.id, notebookName);
    await expect(editor).toHaveText(content);
    await selectEditorText(page, editor, "1. - 校对");
    await applyAiReplacement(page);

    await expect(editor.locator(":scope > p")).toHaveCount(1);
    await expect(editor.locator(":scope > p")).toHaveText(content);
    await expect(editor.locator("ol, ul")).toHaveCount(0);
  });

  test("keeps a whole selected list item in its original list", async ({ page }) => {
    const marker = `ai-list-replace-${Date.now()}`;
    const content = [
      "入口放在选中文本菜单和笔记栏中，",
      "",
      "1. - 校对",
      "",
      "先预览结果，再进行写入。",
    ].join("\n");
    const memo = await createMemo(page, marker, content);
    await mockAiReplacement(page, "\n- 已校对\n");

    const editor = await openMemo(page, memo.id, notebookName);
    await selectEditorText(page, editor, "- 校对");
    await page.getByRole("button", { name: "用 AI 处理" }).click();
    const dialog = page.getByRole("dialog", { name: "AI 笔记助手" });
    await expect(dialog.getByText("- 校对", { exact: true })).toBeVisible();
    await expect(dialog.getByText("1. - 校对", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "生成", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "接受并替换选中内容" })).toBeEnabled();
    await dialog.getByRole("button", { name: "接受并替换选中内容" }).click();
    await expect(dialog).toBeHidden();

    await expect(editor.locator(":scope > p")).toHaveCount(2);
    await expect(editor.locator(":scope > ol")).toHaveCount(1);
    await expect(editor.locator(":scope > ol > li > p")).toHaveText("- 已校对");
    await expect(editor.locator("ol ol, ol ul")).toHaveCount(0);
    await expect(editor.locator(":scope > p").first()).toHaveText("入口放在选中文本菜单和笔记栏中，");
    await expect(editor.locator(":scope > p").last()).toHaveText("先预览结果，再进行写入。");
  });

  test("does not split a paragraph when a rewrite returns multiple blocks", async ({ page }) => {
    const marker = `ai-multiblock-replace-${Date.now()}`;
    const content = "入口放在笔记栏中，在线模式下先预览结果，再进行写入。";
    const memo = await createMemo(page, marker, content);
    await mockAiReplacement(page, "优化后的第一部分\n\n优化后的第二部分");

    const editor = await openMemo(page, memo.id, notebookName);
    await selectEditorText(page, editor, "在线模式下");
    await applyAiReplacement(page);

    await expect(editor.locator(":scope > p")).toHaveCount(1);
    await expect(editor.locator(":scope > p")).toHaveText(
      "入口放在笔记栏中，优化后的第一部分 优化后的第二部分先预览结果，再进行写入。",
    );
  });
});
