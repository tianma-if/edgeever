import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (level: number, text: string) => ({
  type: "heading", attrs: { level }, content: text ? [{ type: "text", text }] : [],
});
const filler = () => Array.from({ length: 12 }, (_, index) => paragraph(`Article paragraph ${index + 1}.`));

const createArticle = async (request: APIRequestContext, deepOnly = false, contentOverride?: JSONContent[]) => {
  const notebookResponse = await request.post("/api/v1/notebooks", { data: { name: `outline-${crypto.randomUUID()}` } });
  expect(notebookResponse.status()).toBe(201);
  const { notebook } = await notebookResponse.json();
  const content = contentOverride ?? (deepOnly ? [
    heading(5, "Deep section"), ...filler(), heading(6, "Leaf section"), ...filler(),
  ] : [
    heading(1, "Outline root"), { type: "image", attrs: { src: "/apple-touch-icon.png", alt: "Preview image" } }, ...filler(),
    heading(4, "Branch section"),
    heading(5, "Deep section"), ...filler(),
    heading(6, "Leaf section"), ...filler(),
    heading(5, "Duplicate"), ...filler(),
    heading(2, "Duplicate"), ...filler(),
    heading(2, ""), heading(2, "!!!"), ...filler(),
    heading(2, "ＡＰＩ 使用"), ...filler(),
    heading(2, "API 使用"), ...filler(),
  ]);
  const memoResponse = await request.post("/api/v1/memos", {
    data: { notebookId: notebook.id, title: "Public outline regression", contentJson: { type: "doc", content } },
  });
  expect(memoResponse.status()).toBe(201);
  const { memo } = await memoResponse.json();
  const singleResponse = await request.post(`/api/v1/memos/${memo.id}/share`);
  expect(singleResponse.ok()).toBe(true);
  const single = (await singleResponse.json()).share;
  const siteResponse = await request.post(`/api/v1/notebooks/${notebook.id}/share`);
  expect(siteResponse.ok()).toBe(true);
  const site = (await siteResponse.json()).share;
  return {
    memo,
    paths: { standalone: `/share/${single.token}`, site: `/share/notebook/${site.token}/${memo.id}` },
    cleanup: async () => {
      await request.delete(`/api/v1/notebooks/${notebook.id}/share`);
      await request.delete(`/api/v1/memos/${memo.id}`);
      await request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
      await request.delete(`/api/v1/notebooks/${notebook.id}`);
    },
  };
};

const expectAtFragment = async (page: Page, path: string, id: string, text: string) => {
  // Open a copied share link as a fresh document, including async body hydration.
  await page.goto("about:blank");
  await page.goto(`${path}#${encodeURIComponent(id)}`);
  const target = page.locator(`[id="${id}"]`);
  await expect(target).toHaveText(text);
  await expect(target).toBeInViewport();
};

for (const layout of ["standalone", "site"] as const) {
  test(`${layout}: keeps a short final-section jump active until the reader scrolls`, async ({ page, request }) => {
    const article = await createArticle(request, false, [
      heading(1, "Long introduction"), ...filler(), ...filler(), ...filler(),
      heading(2, "Before last"), paragraph("A short section."),
      heading(2, "Last section"), paragraph("The end."),
    ]);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(article.paths[layout]);
      const outline = page.locator(".edgeever-public-share aside");
      await outline.getByRole("link", { name: "Before last", exact: true }).click();
      const atBottom = () => page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4);
      await expect.poll(atBottom).toBe(true);
      await expect(page).toHaveURL(/#article-before-last-1$/);
      await expect(outline.locator('[aria-current="location"]')).toHaveText("Before last");

      // A real wheel gesture releases the chosen target even at the page end.
      await page.mouse.move(600, 500);
      await page.mouse.wheel(0, 240);
      await expect(outline.locator('[aria-current="location"]')).toHaveText("Last section");
      await expect(page).toHaveURL(/#article-before-last-1$/);

      await outline.getByRole("link", { name: "Before last", exact: true }).click();
      await expect(outline.locator('[aria-current="location"]')).toHaveText("Before last");
      // Keyboard scrolling must also work while the clicked outline link retains focus.
      await page.keyboard.press("Home");
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(4);
      await expect(outline.locator('[aria-current="location"]')).toHaveText("Long introduction");

      await expectAtFragment(page, article.paths[layout], "article-before-last-1", "Before last");
      await expect(outline.locator('[aria-current="location"]')).toHaveText("Before last");
    } finally {
      await article.cleanup();
    }
  });

  test(`${layout}: includes H5/H6, folds the tree, and retains old fragments`, async ({ page, request }) => {
    const article = await createArticle(request);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(article.paths[layout]);
      const outline = page.locator(".edgeever-public-share aside");
      const leaf = outline.getByRole("link", { name: "Leaf section", exact: true });
      await expect(leaf).toBeVisible();
      await expect(leaf).toHaveAttribute("href", "#article-leaf-section-1");
      await expect(outline.locator("nav li")).toHaveCount(9);
      const image = page.locator(".tiptap img");
      if (layout === "site") await image.click(); else await image.dblclick();
      await expect(page.locator(".yarl__portal")).toBeVisible();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      await page.keyboard.press("Escape");
      await expect(page.locator(".yarl__portal")).toHaveCount(0);
      await outline.getByRole("button", { name: "折叠全部标题", exact: true }).click();
      await expect(outline.locator("nav li")).toHaveCount(1);
      await expect(page.locator(".tiptap h1, .tiptap h2, .tiptap h4, .tiptap h5, .tiptap h6")).toHaveCount(10);
      await outline.getByRole("button", { name: "展开全部标题", exact: true }).click();
      await expect(leaf).toBeVisible();
      await leaf.click();
      await expect(page).toHaveURL(/#article-leaf-section-1$/);
      await expect(page.locator(".tiptap h6")).toBeInViewport();
      await expect(outline.getByRole("link", { name: "Outline root", exact: true })).toBeInViewport();

      // H5/H6 entries must not consume existing H1–H4 occurrence numbers.
      await expectAtFragment(page, article.paths[layout], "article-duplicate-1", "Duplicate");
      await expect(page.locator('[id="article-duplicate-1"]')).toHaveJSProperty("tagName", "H2");
      await expectAtFragment(page, article.paths[layout], "article-section-2", "!!!");
      await expectAtFragment(page, article.paths[layout], "article-ａｐｉ-使用-1", "ＡＰＩ 使用");
      await expectAtFragment(page, article.paths[layout], "article-api-使用-1", "API 使用");
    } finally {
      await article.cleanup();
    }
  });

  test(`${layout}: navigates a deep-only outline on mobile and hides it without headings`, async ({ page, request }) => {
    const article = await createArticle(request, true);
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(article.paths[layout]);
      await page.getByRole("button", { name: "文档大纲", exact: true }).click();
      const drawer = page.getByRole("dialog");
      const leaf = drawer.getByRole("link", { name: "Leaf section", exact: true });
      await expect(leaf).toBeVisible();
      await drawer.getByRole("button", { name: "收起 Deep section", exact: true }).click();
      await expect(leaf).toHaveCount(0);
      await drawer.getByRole("button", { name: "展开全部标题", exact: true }).click();
      await leaf.click();
      await expect(drawer).toBeHidden();
      await expect(page.locator(".tiptap h6")).toBeInViewport();
      await expect(page).toHaveURL(/#article-leaf-section-1$/);

      const session = await request.post(`/api/v1/memos/${article.memo.id}/edit-sessions`);
      expect(session.ok()).toBe(true);
      const { editSession } = await session.json();
      const update = await request.patch(`/api/v1/memos/${article.memo.id}`, {
        data: {
          editSessionId: editSession.id, expectedRevision: editSession.baseRevision,
          expectedContentHash: editSession.baseContentHash, allowDestructiveOverwrite: true,
          contentMarkdown: "No headings remain.", contentJson: { type: "doc", content: [paragraph("No headings remain.")] },
        },
      });
      expect(update.ok(), await update.text()).toBe(true);
      await page.goto(article.paths[layout]);
      await expect(page.locator(".tiptap")).toHaveText("No headings remain.");
      await expect(page.getByRole("button", { name: "文档大纲", exact: true })).toHaveCount(0);
      await expect(page.locator(".edgeever-public-share aside")).toHaveCount(0);
    } finally {
      await article.cleanup();
    }
  });

  test(`${layout}: reveals nested details when navigating and ignores hidden active headings`, async ({ page, request }) => {
    const details = (label: string, content: JSONContent[]): JSONContent => ({
      type: "details", content: [
        { type: "detailsSummary", content: [{ type: "text", text: label }] },
        { type: "detailsContent", content },
      ],
    });
    const article = await createArticle(request, false, [
      heading(1, "Visible section"), ...filler(),
      details("Outer details", [details("Inner details", [heading(2, "Hidden target"), ...filler()])]),
      ...filler(),
    ]);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(article.paths[layout]);
      const outline = page.locator(".edgeever-public-share aside");
      await expect(outline.locator('[aria-current="location"]')).toHaveText("Visible section");
      await expect(page.locator(".tiptap [data-type='details'].is-open")).toHaveCount(0);
      const target = outline.getByRole("link", { name: "Hidden target", exact: true });
      await expect(target).toHaveAttribute("href", "#article-hidden-target-1");
      await target.click();
      await expect(page.locator(".tiptap [data-type='details'].is-open")).toHaveCount(2);
      await expect(page.locator(".tiptap h2")).toBeInViewport();

      await expectAtFragment(page, article.paths[layout], "article-hidden-target-1", "Hidden target");
      await expect(page.locator(".tiptap [data-type='details'].is-open")).toHaveCount(2);
      const saved = await request.get(`/api/v1/memos/${article.memo.id}`);
      expect((await saved.json()).memo.revision).toBe(article.memo.revision);
    } finally {
      await article.cleanup();
    }
  });
}
