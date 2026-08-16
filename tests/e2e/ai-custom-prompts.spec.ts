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

const mockAiGeneration = async (page: Page, replacement: string) => {
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

const openSettingsAiTab = async (page: Page) => {
  await ensureAuthenticatedPage(page);
  await page.getByRole("button", { name: "个人中心", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI集成", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 指令", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开指令库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "指令库", exact: true })).toBeVisible();
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

  test("creates prompts in settings and lists them in the assistant action menu", async ({ page, request }) => {
    const promptName = `e2e-设置指令-${Date.now()}`;
    const instruction = "把笔记提炼成三条要点，使用 Markdown 列表。";

    await openSettingsAiTab(page);
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

    await openSettingsAiTab(page);
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
