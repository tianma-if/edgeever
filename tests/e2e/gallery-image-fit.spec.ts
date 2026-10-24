import { expect, test, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ locale: "en-US" });

const expectFit = async (gallery: Locator, fit: "width" | "height") => {
  await expect(gallery).toHaveAttribute("data-image-gallery-fit", fit);
  for (const img of await gallery.locator("img").all()) {
    await expect.poll(() => img.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
    await expect(img).toHaveCSS("object-fit", fit === "height" ? "contain" : "cover");
  }
};

test("gallery height fit is per gallery, undoable, persistent and usable on narrow screens", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("edgeever.locale.preference", "en-US"));
  await page.context().route("https://example.test/gallery-*.png", (route) => {
    const portrait = route.request().url().includes("portrait");
    return route.fulfill({ contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5173", "Access-Control-Allow-Credentials": "true" }, body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 300 : 800}" height="${portrait ? 800 : 300}"><rect width="100%" height="100%" fill="#dbeafe"/><rect width="100%" height="40" fill="#047857"/><rect y="${portrait ? 760 : 260}" width="100%" height="40" fill="#c2410c"/></svg>` });
  });
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json() as { notebooks: Array<{ id: string }> };
  const title = `Gallery fit ${Date.now()}`;
  const images = "![Portrait](https://example.test/gallery-portrait.png)\n\n![Landscape](https://example.test/gallery-landscape.png)";
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id, title, contentMarkdown: `${images}\n\nA separate gallery below.\n\n${images}\n\nA standalone image.\n\n![Standalone](https://example.test/gallery-landscape.png)`,
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json() as { memo: { id: string } };
  const readMemo = async () => (await (await page.request.get(`/api/v1/memos/${memo.id}`)).json()).memo;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "All notes", exact: true }).click();
    await page.getByPlaceholder("Search notes").fill(title);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const galleries = page.locator(".ProseMirror [data-edgeever-image-gallery]");
    const first = galleries.nth(0);
    const second = galleries.nth(1);
    await expect(galleries).toHaveCount(2);
    await expectFit(first, "width");
    await first.getByRole("button", { name: "Fit height", exact: true }).click();
    await expectFit(first, "height");
    await expectFit(second, "width");
    await page.keyboard.press("ControlOrMeta+z");
    await expectFit(first, "width");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectFit(first, "height");
    await first.getByRole("button", { name: "2 columns", exact: true }).click();
    await expect(first).toHaveAttribute("data-image-gallery-layout", "2");
    await expectFit(first, "height");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(async () => (await readMemo()).contentJson.content[0].attrs.fit).toBe("height");

    await page.keyboard.press("ControlOrMeta+/");
    await expect(page.locator(".cm-content")).toContainText("edgeever:image-gallery fit=height layout=2");
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("\n\nSource edit keeps the fit setting.");
    await page.keyboard.press("ControlOrMeta+/");
    await expectFit(first, "height");
    await expectFit(second, "width");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(async () => (await readMemo()).contentMarkdown).toContain("Source edit keeps the fit setting.");
    const reloadedMemo = page.waitForResponse((response) => response.url().endsWith(`/api/v1/memos/${memo.id}`) && response.request().method() === "GET" && response.ok());
    await page.reload();
    await reloadedMemo;
    await expect(page.getByRole("status", { name: /^Synced/ })).toBeVisible();
    await expectFit(first, "height");
    await expect(first.getByRole("button", { name: "Fit height", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Enable reading protection/ }).click();
    await expect(page.getByRole("button", { name: "Fit height", exact: true })).toHaveCount(0);
    await expectFit(first, "height");
    await page.getByRole("button", { name: /^Disable reading protection and edit/ }).click();

    await page.getByRole("button", { name: "More note actions", exact: true }).click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export HTML", exact: true }).click();
    const html = await readFile((await (await downloaded).path())!, "utf8");
    const exported = await page.context().newPage();
    try {
      await exported.setContent(html, { waitUntil: "domcontentloaded" });
      const exportedGalleries = exported.locator("[data-edgeever-image-gallery]");
      await expectFit(exportedGalleries.nth(0), "height");
      await expectFit(exportedGalleries.nth(1), "width");
      await expect(exported.getByRole("img", { name: "Standalone", exact: true })).toHaveCSS("display", "block");
      await expect(exported.getByRole("img", { name: "Standalone", exact: true })).toHaveCSS("max-width", "100%");
      const galleryHtml = await exportedGalleries.evaluateAll((elements) => elements.map((element) => element.outerHTML).join(""));
      await exported.setContent(`<article class="edgeever-print-content">${galleryHtml}</article>`);
      await exported.addStyleTag({ content: await readFile("apps/web/src/styles/note-print.css", "utf8") });
      await expectFit(exportedGalleries.nth(0), "height");
      await expectFit(exportedGalleries.nth(1), "width");
    } finally { await exported.close(); }

    await page.setViewportSize({ width: 390, height: 844 });
    // The responsive app starts at the mobile note list when its shell changes.
    await page.getByRole("button", { name: new RegExp(`^${title} `) }).click();
    await expectFit(first, "height");
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    const button = first.getByRole("button", { name: "Fit width", exact: true });
    await button.scrollIntoViewIfNeeded();
    const bounds = await button.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await button.click();
    await expectFit(first, "width");
  } finally {
    await page.request.delete(`/api/v1/memos/${memo.id}`, { timeout: 5_000 }).catch(() => {});
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`, { timeout: 5_000 }).catch(() => {});
  }
});
