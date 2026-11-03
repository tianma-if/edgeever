import { expect, test, type Locator, type Page } from "@playwright/test";

// Defaults from getDefaultShortcutSettings: Linux adds Shift to the title
// shortcut because Ctrl+Alt+T opens a terminal there.
const platforms = [
  { platform: "Win32", modifier: "Control", title: "Control+Alt+t", body: "Control+Alt+b" },
  { platform: "MacIntel", modifier: "Meta", title: "Meta+Alt+t", body: "Meta+Alt+b" },
  { platform: "Linux x86_64", modifier: "Control", title: "Control+Alt+Shift+T", body: "Control+Alt+b" },
];

const caret = (input: Locator) => input.evaluate((element: HTMLInputElement) => ({
  start: element.selectionStart,
  end: element.selectionEnd,
  length: element.value.length,
}));

const openNote = async (page: Page, title: string, memoId: string) => {
  await page.goto("/");
  const item = page.locator(`[data-memo-id="${memoId}"]`).locator("button").first();
  // Startup can restore the last notebook after the first click, so retry until the note is open.
  await expect(async () => {
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(title);
    await item.click({ timeout: 3_000 });
    await expect(page.getByRole("textbox", { name: "无标题笔记" })).toHaveValue(title, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
};

for (const { platform, modifier, title: titleShortcut, body: bodyShortcut } of platforms) {
  test.describe(`${platform} note focus shortcuts`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        Object.defineProperty(navigator, "platform", { get: () => value });
      }, platform);
    });

    test("moves focus to the title and body without editing the note", async ({ page }) => {
      const notebooks = await (await page.request.get("/api/v1/notebooks")).json() as {
        notebooks: Array<{ id: string }>;
      };
      const title = `Focus shortcuts ${platform} ${Date.now()}`;
      const response = await page.request.post("/api/v1/memos", {
        data: {
          notebookId: notebooks.notebooks[0]?.id,
          title,
          contentMarkdown: "First paragraph for focus.\n\nSecond paragraph.",
        },
      });
      expect(response.status()).toBe(201);
      const { memo } = await response.json() as { memo: { id: string; contentMarkdown: string; title: string } };

      try {
        await openNote(page, title, memo.id);
        const search = page.getByPlaceholder("搜索笔记");
        const titleInput = page.getByRole("textbox", { name: "无标题笔记" });
        const rich = page.locator(".ProseMirror[contenteditable='true']");
        const source = page.locator(".cm-content");
        await expect(rich).toContainText("First paragraph for focus.");
        await expect(titleInput).toHaveValue(title);

        // From the search field: title with the caret at the end, then the rich-text body.
        await search.focus();
        await page.keyboard.press(titleShortcut);
        await expect(titleInput).toBeFocused();
        expect(await caret(titleInput)).toEqual({ start: title.length, end: title.length, length: title.length });
        await page.keyboard.press(bodyShortcut);
        await expect(rich).toBeFocused();
        await expect(titleInput).toHaveValue(title);

        // Markdown source editor: title from inside the source, then back to the source.
        await page.keyboard.press(`${modifier}+/`);
        await expect(source).toBeFocused();
        await page.keyboard.press(titleShortcut);
        await expect(titleInput).toBeFocused();
        expect(await caret(titleInput)).toEqual({ start: title.length, end: title.length, length: title.length });
        await page.keyboard.press(bodyShortcut);
        await expect(source).toBeFocused();
        await page.keyboard.press(`${modifier}+/`);
        await expect(rich).toBeFocused();

        // Reading protection makes the note read-only: neither shortcut moves focus.
        // Toggle it outside the editor: the rich-text editor keeps Mod+E for inline code.
        await search.focus();
        await page.keyboard.press(`${modifier}+e`);
        await expect(titleInput).toHaveJSProperty("readOnly", true);
        await page.keyboard.press(titleShortcut);
        await expect(search).toBeFocused();
        await page.keyboard.press(bodyShortcut);
        await expect(search).toBeFocused();
        await page.keyboard.press(`${modifier}+e`);
        await expect(titleInput).toHaveJSProperty("readOnly", false);

        // A blocking dialog keeps focus.
        await page.keyboard.press(`${modifier}+o`);
        const switcher = page.getByPlaceholder("搜索笔记标题或内容…");
        await expect(switcher).toBeFocused();
        await page.keyboard.press(titleShortcut);
        await expect(switcher).toBeFocused();
        await page.keyboard.press(bodyShortcut);
        await expect(switcher).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(switcher).toHaveCount(0);

        // Nothing was typed into the note.
        await expect(titleInput).toHaveValue(title);
        const saved = await (await page.request.get(`/api/v1/memos/${memo.id}`)).json() as {
          memo: { contentMarkdown: string; title: string };
        };
        expect(saved.memo.title).toBe(title);
        expect(saved.memo.contentMarkdown).toBe(memo.contentMarkdown);
      } finally {
        await page.request.delete(`/api/v1/memos/${memo.id}`);
        await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
      }
    });
  });
}
