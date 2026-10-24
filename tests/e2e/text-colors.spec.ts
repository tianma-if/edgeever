import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

test("applies colors to the selection and preserves them through save, mode changes, and reload", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("edgeever.locale.preference", "en-US");
    localStorage.setItem("edgeever.editorToolbarExpanded", "true");
  });
  const notebooks = await (await page.request.get("/api/v1/notebooks")).json() as { notebooks: Array<{ id: string }> };
  const title = `Color regression ${Date.now()}`;
  const created = await page.request.post("/api/v1/memos", { data: {
    notebookId: notebooks.notebooks[0].id, title, contentMarkdown: "Color this phrase. Keep this plain.",
  } });
  expect(created.status()).toBe(201);
  const { memo } = await created.json() as { memo: { id: string } };
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "All notes", exact: true }).click();
    await page.getByPlaceholder("Search notes").fill(title);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const rich = page.locator(".ProseMirror[contenteditable='true']");
    await expect(rich).toContainText("Color this phrase.");
    await rich.click();
    await page.keyboard.press("ControlOrMeta+Home");
    for (let index = 0; index < 17; index++) await page.keyboard.press("Shift+ArrowRight");

    const palette = page.getByRole("button", { name: "Text and highlight colors", exact: true });
    await palette.click();
    await page.getByRole("group", { name: "Text color", exact: true }).getByRole("menuitemradio", { name: "Blue", exact: true }).click();
    await expect(rich.locator('[data-ee-text-color="blue"]')).toHaveText("Color this phrase");
    await palette.click();
    await page.getByRole("group", { name: "Highlight color", exact: true }).getByRole("menuitemradio", { name: "Yellow", exact: true }).click();
    const colored = rich.locator('[data-ee-text-color="blue"][data-ee-background-color="yellow"]');
    await expect(colored).toHaveText("Color this phrase");
    await expect(rich.locator("p")).toHaveText("Color this phrase. Keep this plain.");
    await expect(colored).toHaveCSS("color", "rgb(51, 126, 169)");
    await expect(colored).toHaveCSS("background-color", "rgb(251, 243, 219)");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(rich.locator('[data-ee-background-color="yellow"]')).toHaveCount(0);
    await expect(rich.locator('[data-ee-text-color="blue"]')).toHaveText("Color this phrase");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(colored).toHaveText("Color this phrase");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(async () => {
      const saved = await (await page.request.get(`/api/v1/memos/${memo.id}`)).json() as { memo: { contentMarkdown: string } };
      return saved.memo.contentMarkdown;
    }).toBe('<span style="color: #337ea9; background-color: #fbf3db">Color this phrase</span>. Keep this plain.');

    await page.keyboard.press("ControlOrMeta+/");
    await expect(page.locator(".cm-content")).toContainText('background-color: #fbf3db');
    await page.keyboard.press("ControlOrMeta+/");
    await expect(colored).toHaveText("Color this phrase");
    await page.reload();
    await expect(colored).toHaveText("Color this phrase");

    // Palette colors remain legible against the dark editor background.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(colored).toHaveCSS("color", "rgb(130, 188, 224)");
    await expect(colored).toHaveCSS("background-color", "rgb(79, 70, 43)");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    // Keyboard activation returns focus to the editor after applying a swatch.
    await rich.click();
    await page.keyboard.press("ControlOrMeta+Home");
    for (let index = 0; index < 17; index++) await page.keyboard.press("Shift+ArrowRight");
    await palette.focus();
    await page.keyboard.press("Enter");
    const clear = page.getByRole("menuitem", { name: "Reset text and highlight colors" });
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(rich).toBeFocused();
    await expect(rich.locator('[data-ee-text-color], [data-ee-background-color]')).toHaveCount(0);
    await expect(rich).toHaveText("Color this phrase. Keep this plain.");

    // Colors also act as typing attributes at a collapsed caret, and each reset
    // removes only its own property.
    await page.keyboard.press("ControlOrMeta+End");
    await palette.click();
    await page.getByRole("group", { name: "Text color", exact: true }).getByRole("menuitemradio", { name: "Red", exact: true }).click();
    await palette.click();
    await page.getByRole("group", { name: "Highlight color", exact: true }).getByRole("menuitemradio", { name: "Green", exact: true }).click();
    await page.keyboard.insertText(" colored addition");
    await expect(rich.locator('[data-ee-text-color="red"][data-ee-background-color="green"]')).toHaveText(" colored addition");
    await palette.click();
    await page.getByRole("menuitemradio", { name: "No highlight", exact: true }).click();
    await page.keyboard.insertText(" red only");
    await expect(rich.locator('[data-ee-text-color="red"]:not([data-ee-background-color])')).toHaveText(" red only");
    await palette.click();
    await page.getByRole("menuitemradio", { name: "Default text color", exact: true }).click();
    await page.keyboard.insertText(" plain ending");
    await expect(rich.locator('[data-ee-text-color="red"]').filter({ hasText: "plain ending" })).toHaveCount(0);
    await expect(rich).toContainText("plain ending");
  } finally {
    await page.request.delete(`/api/v1/memos/${memo.id}`);
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
  }
});
