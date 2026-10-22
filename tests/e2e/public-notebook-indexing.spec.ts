import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { PUBLIC_PAGE_ROBOTS } from "../../packages/shared/src/public-page-headers";

const createSite = async (request: APIRequestContext) => {
  const slug = `robots-${crypto.randomUUID()}`;
  const notebookResponse = await request.post("/api/v1/notebooks", { data: { name: slug } });
  expect(notebookResponse.status()).toBe(201);
  const { notebook } = await notebookResponse.json();
  const memoResponse = await request.post("/api/v1/memos", {
    data: {
      notebookId: notebook.id,
      title: "Indexing regression",
      contentMarkdown: [
        "[Jump to section](#target-section)",
        "![Preview image](/apple-touch-icon.png)",
        ...Array.from({ length: 30 }, () => "Article paragraph before the target heading."),
        "## Target section",
        "Visible article body.",
      ].join("\n\n"),
    },
  });
  expect(memoResponse.status()).toBe(201);
  const { memo } = await memoResponse.json();
  const shareResponse = await request.post(`/api/v1/notebooks/${notebook.id}/share`);
  expect(shareResponse.ok()).toBe(true);
  const { share } = await shareResponse.json();
  const managementPath = `/api/v1/notebooks/${notebook.id}/share`;
  expect((await request.patch(`${managementPath}/site`, {
    data: { siteSlug: slug, settings: { allowIndexing: true } },
  })).ok()).toBe(true);
  return { slug, notebook, memo, share, managementPath };
};

const robots = (page: Page) => page.locator('meta[name="robots"]');
const expectRobots = async (page: Page, value: string) => {
  await expect.poll(() => robots(page).evaluateAll((elements) => [...new Set(elements.map((element) => element.getAttribute("content")))]))
    .toEqual([value]);
};

// Vite serves the bare app shell. Supply the server head for these client
// lifecycle tests; notebook-share-routes.test.mjs checks the real HTML policy.
const withServerHead = async (page: Page, path: string) => {
  await page.route(path, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/<meta\b[^>]*name=["']robots["'][^>]*>/gi, "");
    await route.fulfill({ response, body: html.replace("</head>", `<meta name="robots" content="${PUBLIC_PAGE_ROBOTS}"></head>`) });
  });
};

for (const excluded of [false, true]) {
  test(`preserves server robots until the article ${excluded ? "fails" : "loads"}`, async ({ page, request }) => {
    const site = await createSite(request);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      if (excluded) {
        expect((await request.patch(`${site.managementPath}/memos/${site.memo.id}`, { data: { excluded: true } })).ok()).toBe(true);
      }
      const path = `/s/${site.slug}/${site.memo.id}`;
      await withServerHead(page, path);
      await page.route(`**/api/public/notebook-shares/${site.share.token}/memos/${site.memo.id}`, async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(path);
      await expect(page.locator("header").getByText(site.slug, { exact: true })).toBeVisible();
      await expect(page.getByLabel("正在加载分享笔记")).toBeVisible();
      await expect(robots(page)).toHaveCount(1);
      await expectRobots(page, PUBLIC_PAGE_ROBOTS);
      release();
      if (excluded) {
        await expect(page.getByRole("heading", { name: "这篇分享笔记不可用", exact: true })).toBeVisible();
      } else {
        await expect(page.getByText("Visible article body.", { exact: true })).toBeVisible();
      }
      await expectRobots(page, excluded ? PUBLIC_PAGE_ROBOTS : "index,follow");
      if (!excluded) {
        // Keep upstream heading links alongside the site's single-click images
        // when both handlers share the read-only article wrapper.
        await page.getByRole("button", { name: "Preview image", exact: true }).click();
        await expect(page.locator(".yarl__portal")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".yarl__portal")).toHaveCount(0);
        await page.getByRole("link", { name: "Jump to section", exact: true }).click();
        const heading = page.getByRole("heading", { name: "Target section", exact: true });
        await expect(heading).toBeInViewport();
        expect(new URL(page.url()).hash).toBe("");
      }
    } finally {
      release();
      await request.delete(site.managementPath);
      await request.delete(`/api/v1/memos/${site.memo.id}`);
      await request.delete(`/api/v1/memos/${site.memo.id}?permanent=1`);
      await request.delete(`/api/v1/notebooks/${site.notebook.id}`);
    }
  });
}

test("Token URLs and opted-out aliases retain the complete noindex policy", async ({ page, request }) => {
  const site = await createSite(request);
  try {
    for (const path of [`/share/notebook/${site.share.token}`, `/share/notebook/${site.share.token}/${site.memo.id}`]) {
      await withServerHead(page, path);
      await page.goto(path);
      await expect(page.locator("header").getByText(site.slug, { exact: true })).toBeVisible();
      await expectRobots(page, PUBLIC_PAGE_ROBOTS);
    }
    expect((await request.patch(`${site.managementPath}/site`, { data: { settings: { allowIndexing: false } } })).ok()).toBe(true);
    const alias = `/s/${site.slug}`;
    await withServerHead(page, alias);
    await page.goto(alias);
    await expect(page.locator("header").getByText(site.slug, { exact: true })).toBeVisible();
    await expectRobots(page, PUBLIC_PAGE_ROBOTS);
  } finally {
    await request.delete(site.managementPath);
    await request.delete(`/api/v1/memos/${site.memo.id}`);
    await request.delete(`/api/v1/memos/${site.memo.id}?permanent=1`);
    await request.delete(`/api/v1/notebooks/${site.notebook.id}`);
  }
});
