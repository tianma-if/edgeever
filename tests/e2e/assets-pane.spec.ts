import { expect, test, type APIRequestContext } from "@playwright/test";

const E2E_USERNAME = process.env.EDGE_EVER_E2E_USERNAME || "admin";
const E2E_PASSWORD = process.env.EDGE_EVER_E2E_PASSWORD || "admin123";

const login = async (request: APIRequestContext) => {
  const response = await request.post("/api/v1/auth/login", {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);
};

test("keeps the global attachment manager independent from the selected note", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "附件", exact: true }).click();

  await expect(page.getByRole("heading", { name: "附件管理", exact: true })).toBeVisible();
  await expect(page.getByText("当前关联笔记")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传附件", exact: true })).toHaveCount(0);
});

test("deletes an attachment from the manager and accepts an idempotent retry", async ({ page, request }) => {
  await login(request);
  const notebooksResponse = await request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok(), await notebooksResponse.text()).toBe(true);
  const notebooks = (await notebooksResponse.json() as { notebooks: Array<{ id: string }> }).notebooks;
  expect(notebooks[0]).toBeTruthy();

  const suffix = Date.now();
  const filename = `issue-314-${suffix}.txt`;
  const createMemoResponse = await request.post("/api/v1/memos", {
    data: {
      notebookId: notebooks[0]!.id,
      title: `Issue 314 attachment deletion ${suffix}`,
      contentMarkdown: "Attachment deletion E2E fixture.",
    },
  });
  expect(createMemoResponse.status(), await createMemoResponse.text()).toBe(201);
  const memoId = (await createMemoResponse.json() as { memo: { id: string } }).memo.id;
  let resourceId: string | null = null;

  try {
    const uploadResponse = await request.post(`/api/v1/memos/${memoId}/resources`, {
      multipart: {
        file: {
          name: filename,
          mimeType: "text/plain",
          buffer: Buffer.from("Issue 314 attachment deletion regression test."),
        },
      },
    });
    expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
    resourceId = (await uploadResponse.json() as { resource: { id: string } }).resource.id;

    await page.goto("/");
    await page.getByRole("button", { name: "附件", exact: true }).click();
    await expect(page.getByRole("heading", { name: "附件管理", exact: true })).toBeVisible();
    await expect(page.getByText(filename, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `删除附件 ${filename}`, exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation.getByRole("heading", { name: "删除附件", exact: true })).toBeVisible();
    await confirmation.getByRole("button", { name: "删除", exact: true }).click();

    await expect(page.getByText(filename, { exact: true })).toHaveCount(0);
    const retryResponse = await request.delete(`/api/v1/resources/${resourceId}`);
    expect(retryResponse.status(), await retryResponse.text()).toBe(200);

    const resourcesResponse = await request.get("/api/v1/resources");
    expect(resourcesResponse.ok(), await resourcesResponse.text()).toBe(true);
    const resources = (await resourcesResponse.json() as { resources: Array<{ id: string }> }).resources;
    expect(resources.some((resource) => resource.id === resourceId)).toBe(false);
  } finally {
    if (resourceId) await request.delete(`/api/v1/resources/${resourceId}`);
    await request.delete(`/api/v1/memos/${memoId}`);
    await request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});
