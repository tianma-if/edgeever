import { expect, test, type Locator } from "@playwright/test";

test.use({ locale: "en-US" });

const selectImage = async (figure: Locator) => {
  const image = figure.locator("img");
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await image.click();
  await expect(figure).toHaveClass(/is-selected/);
};

const expectPosition = async (figure: Locator, alignment: "left" | "center" | "right") => {
  await expect(figure).toHaveAttribute("data-image-align", alignment);
  await expect.poll(() => figure.evaluate((element, value) => {
    const bounds = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    const expectedLeft = value === "left" ? parent.left : value === "center"
      ? parent.left + (parent.width - bounds.width) / 2 : parent.right - bounds.width;
    return Math.abs(bounds.left - expectedLeft);
  }, alignment)).toBeLessThan(2);
};

test("positions individual images and preserves alignment through resize, undo, Markdown edits and reload", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("edgeever.locale.preference", "en-US");
    localStorage.setItem("edgeever.editorToolbarExpanded", "true");
  });
  await page.route("https://example.test/alignment.png", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280"><rect width="640" height="280" fill="#dbeafe"/><text x="320" y="155" text-anchor="middle" font-size="40" fill="#1e3a8a">Alignment test</text></svg>',
  }));
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json() as { notebooks: Array<{ id: string }> };
  const title = `Image alignment ${Date.now()}`;
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks[0].id, title,
    contentMarkdown: "![First image](https://example.test/alignment.png)\n\nBetween images.\n\n![Second image](https://example.test/alignment.png)",
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json() as { memo: { id: string } };
  const readMemo = async () => (await (await page.request.get(`/api/v1/memos/${memo.id}`)).json()).memo;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "All notes", exact: true }).click();
    await page.getByPlaceholder("Search notes").fill(title);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const rich = page.locator(".ProseMirror[contenteditable='true']");
    const images = rich.locator("figure.edgeever-image-node");
    const first = images.nth(0);
    const second = images.nth(1);
    await expect(images).toHaveCount(2);
    await expectPosition(first, "left");
    await selectImage(first);
    await first.getByRole("button", { name: "Center image", exact: true }).click();
    await expectPosition(first, "center");
    await first.getByRole("button", { name: "Small", exact: true }).click();
    await expect(first).toHaveAttribute("data-width", "35");
    await expectPosition(first, "center");

    // Starting a drag must not resize the image; moving the handle changes its
    // width without losing its center anchor.
    const handle = first.getByRole("button", { name: "Drag to resize image width" });
    await handle.hover();
    const point = await handle.boundingBox();
    expect(point).not.toBeNull();
    await page.mouse.move(point!.x + point!.width / 2, point!.y + point!.height / 2);
    await page.mouse.down();
    await expect(first).toHaveAttribute("data-width", "35");
    await page.mouse.move(point!.x + point!.width / 2 + 25, point!.y + point!.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Number(await first.getAttribute("data-width"))).toBeGreaterThan(35);
    const resizedWidth = Number(await first.getAttribute("data-width"));
    await expectPosition(first, "center");

    await selectImage(second);
    await second.getByRole("button", { name: "Align image right", exact: true }).click();
    await expectPosition(second, "right");
    await expectPosition(first, "center");
    await page.keyboard.press("ControlOrMeta+z");
    await expectPosition(second, "left");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectPosition(second, "right");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(async () => (await readMemo()).contentJson.content[2].attrs.alignment).toBe("right");

    await page.keyboard.press("ControlOrMeta+/");
    const source = page.locator(".cm-content");
    await expect(source).toContainText('data-image-align="center"');
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("\n\nSource edit preserves alignment.");
    await page.keyboard.press("ControlOrMeta+/");
    await expect(rich).toContainText("Source edit preserves alignment.");
    await expectPosition(first, "center");
    await expectPosition(second, "right");
    await expect(first).toHaveAttribute("data-width", String(resizedWidth));
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(async () => (await readMemo()).contentMarkdown).toContain("Source edit preserves alignment.");
    const reloadedMemo = page.waitForResponse((response) => response.url().endsWith(`/api/v1/memos/${memo.id}`) && response.request().method() === "GET" && response.ok());
    await page.reload();
    await reloadedMemo;
    await expect(page.getByRole("status", { name: /^Synced/ })).toBeVisible();
    await expectPosition(first, "center");
    await expectPosition(second, "right");
    await expect(first).toHaveAttribute("data-width", String(resizedWidth));

    // Returning to Left is a per-image change, with an accessible active state.
    await rich.focus();
    await selectImage(first);
    await first.getByRole("button", { name: "Align image left", exact: true }).click();
    await expectPosition(first, "left");
    await expect(first.getByRole("button", { name: "Align image left", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectPosition(second, "right");
    await page.getByRole("button", { name: /^Enable reading protection/ }).click();
    await expect(page.getByRole("group", { name: "Image alignment", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Disable reading protection and edit/ }).click();
  } finally {
    await page.request.delete(`/api/v1/memos/${memo.id}`, { timeout: 5_000 }).catch(() => {});
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`, { timeout: 5_000 }).catch(() => {});
  }
});
