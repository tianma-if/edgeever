import { expect, test, type Page, type Route } from "@playwright/test";

// #652 PR B: sidebar body commands run the shared generation flow in parts. The model provider is
// mocked in the browser; the instance plans the parts and the client streams each one.

const PROVIDER = "https://models.e2e-body-drafts.test/v1";

type ProviderMode = "complete" | "cut-part-2";

const sections = Array.from({ length: 24 }, (_, index) => [
  `## 第 ${index + 1} 节`,
  "",
  "这是一段用于测试侧栏分段翻译的中文正文，内容足够长，使整篇笔记必须分成多段才能完成。".repeat(6),
  "",
].join("\n")).join("\n");

const sse = (chunks: Array<{ content?: string; finish?: string }>) => chunks
  .map(({ content, finish }) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish ?? null }] })}\n\n`)
  .join("") + "data: [DONE]\n\n";

const mockProvider = async (page: Page, mode: ProviderMode, seen: Array<{ part: string | null }>) => {
  await page.route(`${PROVIDER}/**`, async (route: Route) => {
    const request = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.method() === "GET") return route.fulfill({ status: 200, headers: cors, json: { object: "list", data: [{ id: "e2e-model" }] } });
    const body = request.postDataJSON() as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")?.content ?? "";
    const prompt = body.messages.at(-1)?.content ?? "";
    const token = /<edgeever-result-([0-9a-f]+)>/.exec(system)?.[1];
    const part = /part (\d+) of (\d+)/.exec(system)?.[1] ?? null;
    seen.push({ part });
    const heading = /## 第 \d+ 节/.exec(prompt)?.[0] ?? "## Part";
    const start = `<edgeever-result-${token}>\n`;
    const end = `\n</edgeever-result-${token}>`;
    const text = part
      ? `${heading.replace("第", "Section").replace(" 节", "")}\n\nTranslated part ${part}.`
      : "Translated selection.";
    const cut = mode === "cut-part-2" && part === "2";
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/event-stream" },
      body: cut
        ? sse([{ content: start }, { content: "Cut off" }, { finish: "length" }])
        : sse([{ content: start }, { content: text }, { content: end }, { finish: "stop" }]),
    });
  });
};

const setup = async (page: Page) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const created = await page.request.post("/api/v1/ai/providers", {
    data: { provider: "openai-compatible", displayName: `E2E drafts ${suffix}`, baseUrl: PROVIDER, apiKey: "e2e-placeholder-key", isEnabled: true, initialModelId: "e2e-model" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const provider = (await created.json() as { providers: Array<{ id: string; displayName: string; models: Array<{ id: string }> }> })
    .providers.find((item) => item.displayName === `E2E drafts ${suffix}`)!;
  const previousDefault = (await (await page.request.get("/api/v1/ai/settings")).json() as { defaultModelConfigId?: string | null }).defaultModelConfigId ?? null;
  expect((await page.request.put("/api/v1/ai/default-model", { data: { modelConfigId: provider.models[0]!.id } })).ok()).toBe(true);
  const notebooks = (await (await page.request.get("/api/v1/notebooks")).json() as { notebooks: Array<{ id: string }> }).notebooks;
  const title = `E2E body draft ${suffix}`;
  const memo = await page.request.post("/api/v1/memos", { data: { notebookId: notebooks[0]!.id, title, contentMarkdown: sections } });
  expect(memo.status(), await memo.text()).toBe(201);
  const memoId = (await memo.json() as { memo: { id: string } }).memo.id;
  return {
    title,
    memoId,
    cleanup: async () => {
      await page.request.put("/api/v1/ai/default-model", { data: { modelConfigId: previousDefault } });
      await page.request.delete(`/api/v1/ai/providers/${provider.id}`);
      await page.request.delete(`/api/v1/memos/${memoId}`);
      await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
    },
  };
};

const openSidebar = async (page: Page, title: string) => {
  await page.goto("/");
  // The list re-renders while it syncs; retry until the note opens.
  await expect(async () => {
    await page.getByRole("button", { name: "全部笔记", exact: true }).click({ timeout: 2_000 });
    await expect(page.getByText("所有笔记本", { exact: false }).first()).toBeVisible({ timeout: 2_000 });
    await page.getByPlaceholder("搜索笔记").fill(title);
    await page.getByText(title, { exact: true }).first().click({ timeout: 3_000 });
    await expect(page.getByRole("heading", { name: "第 1 节" }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const composer = page.getByPlaceholder("询问 AI");
  const openButton = page.getByRole("button", { name: "打开 AI 写作助手" });
  // A collapsed sidebar keeps its composer in the page, so check that it is really on screen.
  await expect(async () => {
    if (await openButton.isVisible()) await openButton.click();
    await expect(composer).toBeInViewport({ timeout: 2_000 });
    await composer.click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return composer;
};

test("a long note is translated in parts, kept after a reload and replaces the note (#652 PR B)", async ({ page }) => {
  test.setTimeout(120_000);
  const seen: Array<{ part: string | null }> = [];
  await mockProvider(page, "complete", seen);
  const { title, memoId, cleanup } = await setup(page);
  try {
    const composer = await openSidebar(page, title);
    await page.keyboard.type("/translate en");
    await page.keyboard.press("Enter");
    const draft = page.locator("[data-ai-body-draft=translate]");
    await expect(draft).toBeVisible();
    await expect(draft.getByRole("button", { name: "替换整篇笔记" })).toBeEnabled({ timeout: 60_000 });
    const parts = new Set(seen.map((item) => item.part));
    expect(parts.size).toBeGreaterThan(1);
    expect(parts.has(null)).toBe(false);
    await expect(draft).toContainText("Translated part 1.");
    await expect(draft).not.toContainText("不完整");

    // The unapplied draft survives a reload on this device.
    await page.reload();
    await openSidebar(page, title);
    await expect(draft).toContainText("已恢复上次生成但还没应用的草稿");
    await draft.getByRole("button", { name: "替换整篇笔记" }).click();
    await expect(draft).toBeHidden();
    await expect.poll(async () => {
      const saved = await (await page.request.get(`/api/v1/memos/${memoId}`)).json() as { memo: { contentMarkdown: string } };
      return saved.memo.contentMarkdown;
    }, { timeout: 30_000 }).toContain("Translated part 1.");
  } finally {
    await cleanup();
  }
});

test("a part that cannot finish keeps its source and blocks replace (#652 PR B)", async ({ page }) => {
  test.setTimeout(120_000);
  const seen: Array<{ part: string | null }> = [];
  await mockProvider(page, "cut-part-2", seen);
  const { title, cleanup } = await setup(page);
  try {
    const composer = await openSidebar(page, title);
    await page.keyboard.type("/translate en");
    await page.keyboard.press("Enter");
    const draft = page.locator("[data-ai-body-draft=translate]");
    await expect(draft.getByRole("button", { name: "复制" })).toBeEnabled({ timeout: 60_000 });
    await expect(draft).toContainText("第 2 段未能完成，保留了原文");
    await expect(draft.getByRole("button", { name: "替换整篇笔记" })).toBeDisabled();
    await expect(draft.getByRole("button", { name: "追加到笔记末尾" })).toBeEnabled();
    // The part that kept its source shows the original text, not the cut-off result.
    await expect(draft).not.toContainText("Cut off");
  } finally {
    await cleanup();
  }
});

test("selection Translate drafts only the selection and replaces only it (#652 PR B)", async ({ page }) => {
  test.setTimeout(120_000);
  const seen: Array<{ part: string | null }> = [];
  await mockProvider(page, "complete", seen);
  const { title, memoId, cleanup } = await setup(page);
  try {
    await openSidebar(page, title);
    // Select the first paragraph and use the selection menu.
    const paragraph = page.locator(".ProseMirror p").first();
    await paragraph.click({ clickCount: 3 });
    await page.locator("[data-selection-ai-action=translate]").first().click();
    const draft = page.locator("[data-ai-body-draft=translate]");
    await expect(draft).toContainText("选中内容");
    await expect(draft.getByRole("button", { name: "替换选中内容" })).toBeEnabled({ timeout: 30_000 });
    await expect(draft).toContainText("Translated selection.");
    expect(seen.every((item) => item.part === null)).toBe(true);
    await draft.getByRole("button", { name: "替换选中内容" }).click();
    await expect(draft).toBeHidden();
    await expect.poll(async () => {
      const saved = await (await page.request.get(`/api/v1/memos/${memoId}`)).json() as { memo: { contentMarkdown: string } };
      return saved.memo.contentMarkdown;
    }, { timeout: 30_000 }).toContain("Translated selection.");
    const saved = await (await page.request.get(`/api/v1/memos/${memoId}`)).json() as { memo: { contentMarkdown: string } };
    // The rest of the note is untouched.
    expect(saved.memo.contentMarkdown).toContain("## 第 2 节");
    expect(saved.memo.contentMarkdown).toContain("## 第 1 节");
  } finally {
    await cleanup();
  }
});
