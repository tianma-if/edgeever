import { expect, test } from "@playwright/test";

test("keeps All notes selected when the demo notebook loads late", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const title = `Startup selection ${Date.now()}`;
  const response = await page.request.post("/api/v1/memos", {
    data: { notebookId: "nb_inbox", title, contentMarkdown: "Preview row for the startup race." },
  });
  expect(response.status()).toBe(201);
  const { memo } = await response.json() as { memo: { id: string } };

  let releaseNotebooks!: () => void;
  const notebookGate = new Promise<void>((resolve) => { releaseNotebooks = resolve; });
  await page.route(/\/api\/v1\/sync\/bootstrap(\?|$)/, async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        notebooks: snapshot.notebooks.filter(({ id }: { id: string }) => !id.startsWith("nb_demo_features")),
      },
    });
  });
  await page.route(/\/api\/v1\/notebooks(\?|$)/, async (route) => {
    await notebookGate;
    await route.continue();
  });

  try {
    await page.goto("/");
    const allNotes = page.getByRole("button", { name: "全部笔记", exact: true });
    await allNotes.click();
    await page.getByPlaceholder("搜索笔记").fill(title);
    const row = page.locator(`article[data-memo-id="${memo.id}"]`);
    await expect(row).toBeVisible();
    expect(await row.boundingBox()).not.toBeNull();
    releaseNotebooks();
    await expect(page.getByRole("button", { name: /功能演示/ })).toBeVisible();
    await expect(allNotes).toHaveAttribute("aria-current", "page");
    await expect(row).toBeVisible();
  } finally {
    releaseNotebooks();
    await page.request.delete(`/api/v1/memos/${memo.id}`);
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
  }
});
