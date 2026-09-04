import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Prompt = {
  id: string;
  name: string;
  description: string | null;
  instruction: string;
};

const E2E_USERNAME = process.env.EDGE_EVER_E2E_USERNAME || "admin";
const E2E_PASSWORD = process.env.EDGE_EVER_E2E_PASSWORD || "admin123";

const login = async (request: APIRequestContext) => {
  const response = await request.post("/api/v1/auth/login", {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);
};

const ensureAuthenticatedPage = async (page: Page) => {
  await login(page.request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "个人中心", exact: true })).toBeVisible({ timeout: 20_000 });
};

const mockAiGeneration = async (
  page: Page,
  replacement: string,
  onRequest?: (body: Record<string, unknown>) => void,
  delayMs = 0,
) => {
  await page.route("**/api/v1/ai/generate", async (route) => {
    onRequest?.(route.request().postDataJSON() as Record<string, unknown>);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
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

const listPrompts = async (request: APIRequestContext) => {
  const response = await request.get("/api/v1/ai/prompts");
  expect(response.ok()).toBe(true);
  return (await response.json() as { prompts: Prompt[] }).prompts;
};

const deletePrompt = async (request: APIRequestContext, promptId: string) => {
  const response = await request.delete(`/api/v1/ai/prompts/${promptId}`);
  expect([200, 404]).toContain(response.status());
};

const createPrompt = async (
  request: APIRequestContext,
  payload: { name: string; description?: string; instruction: string },
) => {
  const response = await request.post("/api/v1/ai/prompts", { data: payload });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { prompt: Prompt }).prompt;
};

const openPromptLibrary = async (page: Page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page.request);
  await page.goto("/");
  const profileButton = page.getByRole("button", { name: "我的", exact: true });
  await expect(profileButton).toBeVisible({ timeout: 20_000 });
  await profileButton.click();
  await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "指令", exact: true }).click();
  await expect(page.getByRole("heading", { name: "指令库", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
};

const openMemoAssistant = async (page: Page, memoId: string, notebookName: string) => {
  await ensureAuthenticatedPage(page);
  await page.getByRole("button", { name: new RegExp(notebookName) }).click();
  await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
  await expect(page.locator(".ProseMirror[contenteditable='true']")).toBeVisible();
  await page.getByRole("button", { name: "打开 AI 写作助手", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 笔记助手" });
  await expect(dialog).toBeVisible();
  return dialog;
};

const selectAction = async (dialog: ReturnType<Page["getByRole"]>, optionName: string) => {
  await dialog.getByRole("combobox", { name: "处理方式" }).click();
  await dialog.page().getByRole("option", { name: optionName, exact: true }).click();
};

test.describe("AI custom prompts", () => {
  let notebookId: string;
  let notebookName: string;
  const createdMemoIds: string[] = [];
  const createdPromptIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    await login(request);
    const response = await request.get("/api/v1/notebooks");
    expect(response.ok()).toBe(true);
    const body = await response.json() as { notebooks: Array<{ id: string; name: string }> };
    notebookId = body.notebooks[0]?.id;
    notebookName = body.notebooks[0]?.name;
    expect(notebookId).toBeTruthy();
    expect(notebookName).toBeTruthy();
  });

  test.afterEach(async ({ request }) => {
    await login(request);
    while (createdPromptIds.length) {
      const promptId = createdPromptIds.pop();
      if (promptId) await deletePrompt(request, promptId);
    }
    while (createdMemoIds.length) {
      const memoId = createdMemoIds.pop();
      if (!memoId) continue;
      await request.delete(`/api/v1/memos/${memoId}`);
      await request.delete(`/api/v1/memos/${memoId}?permanent=1`);
    }
  });

  const createMemo = async (page: Page, title: string, contentMarkdown: string) => {
    await login(page.request);
    const response = await page.request.post("/api/v1/memos", {
      data: { notebookId, title, contentMarkdown },
    });
    expect(response.status()).toBe(201);
    const memo = (await response.json() as { memo: { id: string } }).memo;
    createdMemoIds.push(memo.id);
    return memo;
  };

  test("keeps secondary content out of AI integration settings", async ({ page }) => {
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: "个人中心", exact: true }).click();
    await page.getByRole("button", { name: "AI集成", exact: true }).click();

    await expect(page.getByRole("heading", { name: "外部 AI 模型", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "API Token 与 MCP 配置", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI 指令", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "进阶玩法", exact: true })).toHaveCount(0);
  });

  test("opens the inline composer from /ai and the configurable shortcut", async ({ page }) => {
    const memo = await createMemo(page, `e2e-ai-inline-${Date.now()}`, "用于测试内联 AI 入口。");
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: new RegExp(notebookName) }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /ai");
    const composer = page.getByRole("dialog", { name: "AI 笔记助手" });
    await expect(composer).toBeVisible();
    await expect(editor).not.toContainText("/ai");
    await composer.getByRole("button", { name: "关闭" }).click();
    await expect(composer).toBeHidden();

    await page.keyboard.press("Control+j");
    await expect(composer).toBeVisible();
  });

  test("drags the AI assistant by its header and keeps it inside the viewport", async ({ page }) => {
    const memo = await createMemo(page, `e2e-ai-drag-${Date.now()}`, "用于测试 AI 助手拖动。");
    const assistant = await openMemoAssistant(page, memo.id, notebookName);
    const dragHandle = assistant.locator('[data-ai-assistant-drag-handle="true"]');
    const [initialBox, handleBox] = await Promise.all([
      assistant.boundingBox(),
      dragHandle.boundingBox(),
    ]);
    expect(initialBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    expect(handleBox!.y).toBeCloseTo(initialBox!.y, 0);
    expect(handleBox!.height).toBeGreaterThanOrEqual(60);
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const maxLeft = viewport!.width - initialBox!.width - 12;
    const maxTop = viewport!.height - initialBox!.height - 12;
    const targetLeft = initialBox!.x > (12 + maxLeft) / 2
      ? Math.max(12, initialBox!.x - 140)
      : Math.min(maxLeft, initialBox!.x + 140);
    const targetTop = initialBox!.y > (12 + maxTop) / 2
      ? Math.max(12, initialBox!.y - 80)
      : Math.min(maxTop, initialBox!.y + 80);
    const deltaX = targetLeft - initialBox!.x;
    const deltaY = targetTop - initialBox!.y;

    const startX = handleBox!.x + Math.min(80, handleBox!.width / 2);
    const startY = handleBox!.y + 6;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 5 });
    await page.mouse.up();

    const movedBox = await assistant.boundingBox();
    expect(movedBox).not.toBeNull();
    expect(movedBox!.x).toBeCloseTo(targetLeft, 0);
    expect(movedBox!.y).toBeCloseTo(targetTop, 0);

    const movedHandleBox = await dragHandle.boundingBox();
    expect(movedHandleBox).not.toBeNull();
    await page.mouse.move(movedHandleBox!.x + 40, movedHandleBox!.y + movedHandleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport!.width - 1, viewport!.height - 1, { steps: 5 });
    await page.mouse.up();

    const clampedBox = await assistant.boundingBox();
    expect(clampedBox).not.toBeNull();
    expect(clampedBox!.x + clampedBox!.width).toBeLessThanOrEqual(viewport!.width - 11);
    expect(clampedBox!.y + clampedBox!.height).toBeLessThanOrEqual(viewport!.height - 11);
  });

  test("generates from a blank note with a custom instruction and explains source requirements", async ({ page }) => {
    const memo = await createMemo(page, `e2e-ai-blank-${Date.now()}`, "");
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: new RegExp(notebookName) }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    await expect(page.locator(".ProseMirror[contenteditable='true']")).toBeVisible();
    await page.getByPlaceholder("无标题笔记", { exact: true }).fill("");

    let customRequest: Record<string, unknown> | null = null;
    let translatedRequest: Record<string, unknown> | null = null;
    let refinedRequest: Record<string, unknown> | null = null;
    await page.route("**/api/v1/ai/generate", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.action === "custom" && body.contentMarkdown === "Write a poem.") {
        refinedRequest = body;
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          body: [
            `data: ${JSON.stringify({ type: "start" })}`,
            `data: ${JSON.stringify({ type: "text-delta", text: "Compose a poem." })}`,
            `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}`,
            "",
          ].join("\n\n"),
        });
        return;
      }
      if (body.action === "translate") {
        translatedRequest = body;
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          body: [
            `data: ${JSON.stringify({ type: "start" })}`,
            `data: ${JSON.stringify({ type: "text-delta", text: "Write a poem." })}`,
            `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}`,
            "",
          ].join("\n\n"),
        });
        return;
      }
      if (body.action !== "custom" || body.promptId) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "ai_source_required",
              message: "Note content is required for this AI action.",
            },
          }),
        });
        return;
      }
      customRequest = body;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          `data: ${JSON.stringify({ type: "start" })}`,
          `data: ${JSON.stringify({ type: "text-delta", text: "你好！祝你今天一切顺利。" })}`,
          `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}`,
          "",
        ].join("\n\n"),
      });
    });

    await page.getByRole("button", { name: "打开 AI 写作助手", exact: true }).click();
    const assistant = page.getByRole("dialog", { name: "AI 笔记助手" });
    await expect(assistant).toBeVisible();
    await assistant.getByRole("button", { name: "生成", exact: true }).click();
    const result = assistant.getByTestId("ai-assistant-result");
    await expect(result.getByRole("alert")).toHaveText("当前处理方式需要笔记内容。请先输入内容，或改用自定义指令从空白开始生成。");
    await expect(result).not.toContainText("生成结果将显示在这里。");
    await expect(assistant).not.toContainText("contentMarkdown");

    await assistant.getByRole("button", { name: "自定义指令", exact: true }).click();
    const instruction = assistant.getByRole("textbox", { name: "告诉 AI 你想怎么处理" });
    await instruction.fill("写一首诗");
    await selectAction(assistant, "翻译");
    await expect(assistant.getByRole("textbox", { name: "输入要处理的内容" })).toHaveValue("写一首诗");
    await assistant.getByRole("button", { name: "生成", exact: true }).click();
    await expect(result).toHaveText("Write a poem.");
    expect(translatedRequest).toMatchObject({
      action: "translate",
      title: "",
      contentMarkdown: "写一首诗",
      targetLanguage: "en",
    });
    expect(translatedRequest).not.toHaveProperty("instruction");

    const refinement = assistant.getByRole("textbox", { name: "继续调整" });
    await refinement.fill("更自然");
    await assistant.getByRole("button", { name: "调整", exact: true }).click();
    await expect(result).toHaveText("Compose a poem.");
    await expect(refinement).toHaveValue("更自然");
    expect(refinedRequest).toMatchObject({
      action: "custom",
      title: "",
      contentMarkdown: "Write a poem.",
      targetLanguage: "en",
    });
    expect(refinedRequest?.instruction).toContain("Keep the entire revised result in the target language: en.");
    expect(refinedRequest?.instruction).toContain("Original processing action:\ntranslate");
    expect(refinedRequest?.instruction).toContain("Original processing instruction:");
    expect(refinedRequest?.instruction).toContain("Follow-up request:\n更自然");

    await assistant.getByRole("button", { name: "清除结果", exact: true }).click();
    await assistant.getByRole("button", { name: "自定义指令", exact: true }).click();
    await expect(instruction).toHaveValue("写一首诗");
    await assistant.getByRole("button", { name: "生成", exact: true }).click();
    await expect(assistant.getByText("你好！祝你今天一切顺利。", { exact: true })).toBeVisible();
    expect(customRequest).toMatchObject({
      action: "custom",
      title: "",
      contentMarkdown: "",
      instruction: "写一首诗",
    });
  });

  test("opens the function menu from a bare slash and runs its AI command", async ({ page }) => {
    const memo = await createMemo(page, `e2e-slash-menu-${Date.now()}`, "斜杠菜单测试");
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: new RegExp(notebookName) }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    const slashMenu = page.getByLabel("插入功能菜单");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu.getByText("基本区块", { exact: true })).toBeVisible();
    await expect(slashMenu.getByText("标题 1", { exact: true })).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(slashMenu).toBeHidden();
    await expect(editor).not.toContainText("/");

    await page.keyboard.type("/");
    await expect(slashMenu).toBeVisible();
    await slashMenu.getByText("用 AI 处理", { exact: true }).click();
    await expect(slashMenu).toBeHidden();
    await expect(editor).not.toContainText("/");
    const assistant = page.getByRole("dialog", { name: "AI 笔记助手" });
    await expect(assistant).toBeVisible();
    const customInstructionButton = assistant.getByRole("button", { name: "自定义指令", exact: true });
    const actionSelect = assistant.getByRole("combobox", { name: "处理方式" });
    const generateButton = assistant.getByRole("button", { name: "生成", exact: true });
    await expect(customInstructionButton).toBeVisible();
    const [actionSelectBox, customInstructionBox, generateBox] = await Promise.all([
      actionSelect.boundingBox(),
      customInstructionButton.boundingBox(),
      generateButton.boundingBox(),
    ]);
    expect(actionSelectBox).not.toBeNull();
    expect(customInstructionBox).not.toBeNull();
    expect(generateBox).not.toBeNull();
    expect(customInstructionBox!.width).toBeGreaterThanOrEqual(120);
    expect(generateBox!.width).toBeGreaterThanOrEqual(104);
    expect(actionSelectBox!.width / customInstructionBox!.width).toBeLessThan(2.5);
    expect(customInstructionBox!.width / generateBox!.width).toBeLessThan(1.25);
    const customInstructionLineCount = await customInstructionButton.evaluate((element) => {
      const textNode = Array.from(element.childNodes)
        .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (!textNode) return 0;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      return range.getClientRects().length;
    });
    expect(customInstructionLineCount).toBe(1);
    await assistant.getByRole("combobox", { name: "处理方式" }).click();
    await expect(assistant).toBeVisible();
    const actionListbox = page.getByRole("listbox");
    await expect(actionListbox).toBeVisible();
    const [assistantBox, listboxBox] = await Promise.all([
      assistant.boundingBox(),
      actionListbox.boundingBox(),
    ]);
    expect(assistantBox).not.toBeNull();
    expect(listboxBox).not.toBeNull();
    expect(listboxBox!.y).toBeGreaterThanOrEqual(assistantBox!.y - 1);
    expect(listboxBox!.y + listboxBox!.height)
      .toBeLessThanOrEqual(assistantBox!.y + assistantBox!.height + 1);
    const [listboxZIndex, assistantZIndex] = await Promise.all([
      actionListbox.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
      assistant.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
    ]);
    expect(listboxZIndex).toBeGreaterThan(assistantZIndex);
    await expect(page.getByRole("option", { name: "自定义指令", exact: true })).toBeVisible();
    await page.getByRole("option", { name: "自定义指令", exact: true }).click();
    await expect(assistant).toBeVisible();
  });

  test("opens AI from Space in an empty block without hijacking normal spaces", async ({ page }) => {
    const memo = await createMemo(page, `e2e-ai-space-${Date.now()}`, "空格入口测试");
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: new RegExp(notebookName) }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const emptyParagraph = editor.locator("p").last();
    await expect(emptyParagraph).toHaveClass(/is-empty/);
    await expect(emptyParagraph).toHaveAttribute("data-placeholder", "Space 唤起 AI · / 浏览命令 · @ 引用笔记");
    const renderedPlaceholder = await emptyParagraph.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return {
        content: style.content,
        display: style.display,
        visibility: style.visibility,
      };
    });
    expect(renderedPlaceholder.content).toContain("Space 唤起 AI · / 浏览命令 · @ 引用笔记");
    expect(renderedPlaceholder.display).not.toBe("none");
    expect(renderedPlaceholder.visibility).not.toBe("hidden");

    await page.keyboard.press("Space");
    const assistant = page.getByRole("dialog", { name: "AI 笔记助手" });
    await expect(assistant).toBeVisible();
    await expect(emptyParagraph).toBeEmpty();

    await assistant.getByRole("button", { name: "关闭" }).click();
    await emptyParagraph.click();
    await page.keyboard.type("正常 输入");
    await expect(assistant).toBeHidden();
    await expect(emptyParagraph).toHaveText("正常 输入");
  });

  test("can disable the empty-block Space shortcut from editor preferences", async ({ page }) => {
    const memo = await createMemo(page, `e2e-ai-space-setting-${Date.now()}`, "空格开关测试");
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: new RegExp(notebookName) }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    await expect(page.locator(".ProseMirror[contenteditable='true']")).toBeVisible();

    await page.getByRole("button", { name: "个人中心", exact: true }).click();
    await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
    const shortcutSwitch = page.getByRole("switch", { name: "空白段落按 Space 是否唤起 AI" });
    await expect(shortcutSwitch).toBeChecked();
    await shortcutSwitch.click();
    await expect(shortcutSwitch).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("edgeever.editor.aiSpaceShortcutEnabled")))
      .toBe("false");

    await page.getByRole("button", { name: "返回上一页", exact: true }).click();
    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const emptyParagraph = editor.locator("p").last();
    await expect(emptyParagraph).toHaveAttribute("data-placeholder", "/ 浏览命令 · @ 引用笔记");

    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog", { name: "AI 笔记助手" })).toBeHidden();
    await expect.poll(() => emptyParagraph.evaluate((element) => element.textContent)).toBe(" ");
  });

  test("sends temporary files with one AI request", async ({ page }) => {
    const memo = await createMemo(page, `e2e-ai-attachment-${Date.now()}`, "请结合附件处理。 ");
    let submittedBody: Record<string, unknown> | null = null;
    await page.route("**/api/v1/ai/generate", async (route) => {
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          `data: ${JSON.stringify({ type: "start" })}`,
          `data: ${JSON.stringify({ type: "text-delta", text: "附件摘要" })}`,
          `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}`,
          "",
        ].join("\n\n"),
      });
    });

    const dialog = await openMemoAssistant(page, memo.id, notebookName);
    await selectAction(dialog, "自定义指令");
    await dialog.locator("textarea").fill("总结附件内容。");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("temporary context", "utf8"),
    });
    await expect(dialog.getByText("brief.txt", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "生成", exact: true }).click();
    await expect(dialog.getByText("附件摘要", { exact: true })).toBeVisible();

    expect(submittedBody).toMatchObject({
      attachments: [{
        filename: "brief.txt",
        mediaType: "text/plain",
        base64Data: Buffer.from("temporary context", "utf8").toString("base64"),
      }],
    });
  });

  test("keeps a Chinese custom instruction usable while prompts initialize", async ({ page }) => {
    const memo = await createMemo(page, `e2e-ai-ime-${Date.now()}`, "中文输入状态测试");
    let submittedBody: Record<string, unknown> | null = null;
    let generationRequestCount = 0;
    await page.route("**/api/v1/ai/prompts*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await mockAiGeneration(page, "宋词结果", (body) => {
      generationRequestCount += 1;
      submittedBody = body;
    }, 300);
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: new RegExp(notebookName) }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    await page.getByRole("button", { name: "打开 AI 写作助手", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "AI 笔记助手" });
    const textarea = dialog.locator("textarea");
    await textarea.fill("写个宋词");
    const generateButton = dialog.getByRole("button", { name: "生成", exact: true });
    await expect(generateButton).toBeEnabled();
    await expect(generateButton.locator("kbd")).toHaveText("↵");

    await textarea.press("Shift+Enter");
    await textarea.pressSequentially("不要参考原笔记");
    await expect(textarea).toHaveValue("写个宋词\n不要参考原笔记");

    await textarea.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        isComposing: true,
        key: "Enter",
      }));
    });
    expect(submittedBody).toBeNull();

    await textarea.press("Enter");
    await expect.poll(() => generationRequestCount).toBe(1);
    await textarea.press("Enter");
    await page.waitForTimeout(50);
    expect(generationRequestCount).toBe(1);

    await expect(dialog.getByText("宋词结果", { exact: true })).toBeVisible();
    expect(submittedBody).toMatchObject({
      action: "custom",
      instruction: "写个宋词\n不要参考原笔记",
    });
  });

  test("creates prompts in settings and lists them in the assistant action menu", async ({ page, request }) => {
    const promptName = `e2e-设置指令-${Date.now()}`;
    const instruction = "把笔记提炼成三条要点，使用 Markdown 列表。";

    await openPromptLibrary(page);
    await page.getByRole("button", { name: "新建指令", exact: true }).click();
    const editor = page.locator("form").filter({ has: page.getByRole("heading", { name: "新建指令", exact: true }) });
    await expect(editor).toBeVisible();
    await editor.getByPlaceholder("例如：周报提炼 / 会议待办").fill(promptName);
    await editor.getByPlaceholder("简要说明何时使用这条指令").fill("e2e settings create");
    await editor.locator("textarea").fill(instruction);
    await editor.getByRole("button", { name: "创建", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByText(promptName, { exact: true })).toBeVisible();

    await login(request);
    const prompts = await listPrompts(request);
    const created = prompts.find((prompt) => prompt.name === promptName);
    expect(created).toBeTruthy();
    if (created) createdPromptIds.push(created.id);

    const memo = await createMemo(page, `e2e-ai-prompt-list-${Date.now()}`, "本周完成功能开发，下周准备发布。");
    const dialog = await openMemoAssistant(page, memo.id, notebookName);
    await selectAction(dialog, promptName);
    await expect(dialog.getByRole("combobox", { name: "处理方式" })).toHaveText(promptName);
  });

  test("saves a freeform custom prompt as a reusable prompt", async ({ page, request }) => {
    const promptName = `e2e-保存指令-${Date.now()}`;
    const instruction = "改写成简洁友好的周报摘要，保留所有日期与负责人。";
    const memo = await createMemo(page, `e2e-ai-prompt-save-${Date.now()}`, "3 月 1 日：张三完成接口联调。");
    await mockAiGeneration(page, "- 3 月 1 日：接口联调完成（张三）");

    const dialog = await openMemoAssistant(page, memo.id, notebookName);
    await selectAction(dialog, "自定义指令");
    await dialog.locator("textarea").fill(instruction);
    await dialog.getByRole("button", { name: "保存为指令", exact: true }).click();

    const saveDialog = page.getByRole("dialog", { name: "保存为指令" });
    await expect(saveDialog).toBeVisible();
    await saveDialog.getByPlaceholder("例如：周报提炼").fill(promptName);
    await saveDialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(saveDialog).toBeHidden();
    await expect(dialog.getByRole("combobox", { name: "处理方式" })).toHaveText(promptName);

    await login(request);
    const prompts = await listPrompts(request);
    const created = prompts.find((prompt) => prompt.name === promptName);
    expect(created?.instruction).toBe(instruction);
    if (created) createdPromptIds.push(created.id);

    await dialog.getByRole("button", { name: "生成", exact: true }).click();
    await expect(dialog.getByText("- 3 月 1 日：接口联调完成（张三）", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "追加到笔记", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".ProseMirror[contenteditable='true']")).toContainText("接口联调完成（张三）");
  });

  test("inserts generated content at the caret captured when AI opens", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 720 });
    const memo = await createMemo(
      page,
      `e2e-ai-caret-insert-${Date.now()}`,
      ["第一段", "", "第二段", "", "第三段"].join("\n"),
    );
    await mockAiGeneration(page, "AI 插入段落");
    await ensureAuthenticatedPage(page);
    await page.getByRole("button", { name: new RegExp(notebookName) }).click();
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();

    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toBeVisible();
    await editor.locator(":scope > p").nth(1).click();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "打开 AI 写作助手", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "AI 笔记助手" });
    await dialog.getByRole("button", { name: "生成", exact: true }).click();
    await expect(dialog.getByText("AI 插入段落", { exact: true })).toBeVisible();
    const copyButton = dialog.getByRole("button", { name: "复制结果", exact: true });
    const appendButton = dialog.getByRole("button", { name: "追加到笔记", exact: true });
    await expect(copyButton).toBeVisible();
    await expect(appendButton).toBeVisible();
    const [dialogBox, copyButtonBox, appendButtonBox] = await Promise.all([
      dialog.boundingBox(),
      copyButton.boundingBox(),
      appendButton.boundingBox(),
    ]);
    expect(dialogBox).not.toBeNull();
    expect(copyButtonBox).not.toBeNull();
    expect(appendButtonBox).not.toBeNull();
    expect(copyButtonBox!.y).toBeGreaterThanOrEqual(dialogBox!.y);
    expect(copyButtonBox!.y + copyButtonBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height);
    expect(appendButtonBox!.y).toBeGreaterThanOrEqual(dialogBox!.y);
    expect(appendButtonBox!.y + appendButtonBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height);
    await appendButton.click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => editor.locator(":scope > p").allTextContents()).toEqual([
      "第一段",
      "第二段",
      "AI 插入段落",
      "第三段",
    ]);
  });

  test("updates and deletes a custom prompt from settings", async ({ page, request }) => {
    await login(request);
    const originalName = `e2e-更新指令-${Date.now()}`;
    const updatedName = `${originalName}-已改`;
    const created = await createPrompt(request, {
      name: originalName,
      description: "original",
      instruction: "原始指令：提取风险。",
    });
    createdPromptIds.push(created.id);

    await openPromptLibrary(page);
    const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: originalName, exact: true }) });
    await expect(row.getByText(originalName, { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "编辑指令", exact: true }).click();

    const editor = page.locator("form").filter({ has: page.getByRole("heading", { name: "编辑指令", exact: true }) });
    await expect(editor).toBeVisible();
    await editor.getByPlaceholder("例如：周报提炼 / 会议待办").fill(updatedName);
    await editor.locator("textarea").fill("更新后的指令：提取风险与应对。");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByText(updatedName, { exact: true })).toBeVisible();

    const updatedRow = page.getByRole("article").filter({ has: page.getByRole("heading", { name: updatedName, exact: true }) });
    await updatedRow.getByRole("button", { name: "删除", exact: true }).click();
    const deleteConfirm = page.getByRole("dialog").filter({ hasText: updatedName });
    await expect(deleteConfirm.getByText(/确定删除指令/)).toBeVisible();
    await deleteConfirm.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText(updatedName, { exact: true })).toHaveCount(0);

    await login(request);
    const remaining = await listPrompts(request);
    expect(remaining.some((prompt) => prompt.id === created.id)).toBe(false);
    createdPromptIds.splice(createdPromptIds.indexOf(created.id), 1);
  });

  test("uses a saved prompt from the assistant dropdown for generation", async ({ page, request }) => {
    await login(request);
    const promptName = `e2e-选用指令-${Date.now()}`;
    const created = await createPrompt(request, {
      name: promptName,
      instruction: "只输出三条关键结论。",
    });
    createdPromptIds.push(created.id);

    const memo = await createMemo(page, `e2e-ai-prompt-use-${Date.now()}`, "项目进展顺利，风险可控，下周发布。");
    await mockAiGeneration(page, "- 进展顺利\n- 风险可控\n- 下周发布");

    const dialog = await openMemoAssistant(page, memo.id, notebookName);
    await selectAction(dialog, promptName);
    await expect(dialog.getByRole("combobox", { name: "处理方式" })).toHaveText(promptName);
    await dialog.getByRole("button", { name: "生成", exact: true }).click();
    await expect(dialog.getByText("进展顺利")).toBeVisible();
    await expect(dialog.getByText("风险可控")).toBeVisible();
    await dialog.getByRole("button", { name: "替换笔记", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".ProseMirror[contenteditable='true']")).toContainText("进展顺利");
  });
});
