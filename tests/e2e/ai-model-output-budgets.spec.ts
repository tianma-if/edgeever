import { expect, test } from "@playwright/test";

test("edits, validates and resets a model's output budgets (#652)", async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const modelId = `e2e-budget-${suffix}`;
  const created = await page.request.post("/api/v1/ai/providers", {
    data: {
      provider: "openai-compatible",
      displayName: `E2E budget ${suffix}`,
      baseUrl: "https://models.example.com/v1",
      apiKey: "e2e-placeholder-key",
      isEnabled: true,
      initialModelId: modelId,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const settings = await created.json() as { providers: Array<{ id: string; displayName: string }> };
  const providerId = settings.providers.find((provider) => provider.displayName === `E2E budget ${suffix}`)!.id;

  const patches: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes(`/api/v1/ai/providers/${providerId}/models/`)) {
      patches.push(request.postDataJSON());
    }
  });

  try {
    await page.goto("/settings?tab=ai");
    const openButton = page.getByRole("button", { name: `输出预算: ${modelId}`, exact: true });
    await expect(openButton).toBeVisible({ timeout: 20_000 });

    // Keyboard focus shows the same Tooltip as hover.
    await openButton.focus();
    await expect(page.getByRole("tooltip").filter({ hasText: "输出预算" })).toBeVisible();

    await openButton.click();
    const dialog = page.getByRole("dialog", { name: "模型输出预算" });
    await expect(dialog).toBeVisible();
    const generation = dialog.getByLabel("正文生成（总结、改写、翻译等）");
    const tags = dialog.getByLabel("标签建议");
    const companion = dialog.getByLabel("AI 侧栏（内置）单步");
    // Text generation is automatic by default (#652); the dialog shows the detection state.
    await expect(generation).toHaveAttribute("placeholder", "自动");
    await expect(dialog.getByRole("region", { name: "模型上限" })).toContainText("尚未检测");
    await expect(tags).toHaveAttribute("placeholder", "默认 300");
    await expect(companion).toHaveAttribute("placeholder", "默认 2048");
    await expect(dialog).toContainText("部分模型会将思考 token 计入输出预算");
    const save = dialog.getByRole("button", { name: "保存", exact: true });
    await expect(save).toBeDisabled();

    await generation.fill("100");
    await expect(dialog).toContainText("请输入 256 到 131072 之间的整数");
    await expect(generation).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();

    await generation.fill("16000");
    await companion.fill("9000");
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `已自定义输出预算: ${modelId}`, exact: true })).toBeVisible();
    expect(patches).toEqual([{ generationMaxOutputTokens: 16000, companionMaxOutputTokens: 9000 }]);

    await page.reload();
    await page.getByRole("button", { name: `已自定义输出预算: ${modelId}`, exact: true }).click();
    await expect(generation).toHaveValue("16000");
    await expect(tags).toHaveValue("");
    await expect(companion).toHaveValue("9000");

    await dialog.getByRole("button", { name: "全部恢复默认" }).click();
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `输出预算: ${modelId}`, exact: true })).toBeVisible();
    expect(patches.at(-1)).toEqual({ generationMaxOutputTokens: null, companionMaxOutputTokens: null });

    // Another device saves the tag budget while the dialog is open and settings refresh.
    await page.getByRole("button", { name: `输出预算: ${modelId}`, exact: true }).click();
    await expect(dialog).toBeVisible();
    const modelConfigId = (await (await page.request.get("/api/v1/ai/settings")).json() as {
      providers: Array<{ id: string; models: Array<{ id: string; modelId: string }> }>;
    }).providers.find((provider) => provider.id === providerId)!.models.find((model) => model.modelId === modelId)!.id;
    const remote = await page.request.patch(`/api/v1/ai/providers/${providerId}/models/${modelConfigId}`, {
      data: { tagSuggestionMaxOutputTokens: 800 },
    });
    expect(remote.status()).toBe(200);
    // The app refetches stale settings (15 s stale time) when the network reconnects.
    await page.waitForTimeout(16_000);
    const refreshed = page.waitForResponse((response) => response.url().includes("/api/v1/ai/settings") && response.request().method() === "GET");
    await page.context().setOffline(true);
    await page.context().setOffline(false);
    const refreshedModel = (await (await refreshed).json() as {
      providers: Array<{ id: string; models: Array<{ modelId: string; tagSuggestionMaxOutputTokens: number | null }> }>;
    }).providers.find((provider) => provider.id === providerId)!.models.find((model) => model.modelId === modelId)!;
    expect(refreshedModel.tagSuggestionMaxOutputTokens).toBe(800);
    await generation.fill("12000");
    await save.click();
    await expect(dialog).toBeHidden();
    expect(patches.at(-1)).toEqual({ generationMaxOutputTokens: 12000 });
    const saved = (await (await page.request.get("/api/v1/ai/settings")).json() as {
      providers: Array<{ id: string; models: Array<{ modelId: string; generationMaxOutputTokens: number | null; tagSuggestionMaxOutputTokens: number | null }> }>;
    }).providers.find((provider) => provider.id === providerId)!.models.find((model) => model.modelId === modelId)!;
    expect([saved.generationMaxOutputTokens, saved.tagSuggestionMaxOutputTokens]).toEqual([12000, 800]);
  } finally {
    await page.request.delete(`/api/v1/ai/providers/${providerId}`);
  }
});
