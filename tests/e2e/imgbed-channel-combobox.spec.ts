import { expect, test, type Page } from "@playwright/test";

const channelInput = (page: Page) => page.getByRole("combobox", { name: "Channel name (optional)" });
const highlighted = (page: Page) => page.locator('[cmdk-item][aria-selected="true"]:visible');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("edgeever.locale.preference", "en-US");
    localStorage.setItem("edgeever.desktop.picgo.v1", JSON.stringify({
      provider: "imgbed", endpoint: "", serverKey: "",
      imgbed: { endpoint: "https://img.example.com", token: "test-token", uploadFolder: "", nameType: "default", uploadChannel: "telegram", channelName: "", serverCompress: true, autoRetry: null },
    }));
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings?tab=general");
  await expect(page.getByRole("button", { name: "Editor", exact: true })).toBeVisible();
  // The web build has no desktop bridge. Installing a stub after startup and
  // then opening the Editor section mounts the image host settings with it.
  // The upload and test methods mark the ImgBed bridge as available; the app
  // chains .catch() on the other two, so every method returns a promise.
  await page.evaluate(() => {
    const none = { telegram: 0, cfr2: 0, s3: 0, discord: 0, huggingface: 0, webdav: 0 };
    (window as unknown as { edgeeverDesktop: unknown }).edgeeverDesktop = {
      syncScheduledTasks: async () => ({ scheduled: 0 }),
      recordRendererError: async () => ({ recorded: true }),
      uploadImgBedImage: async () => ({ url: "" }),
      testImgBedConnection: async () => true,
      listImgBedChannels: async () => ({
        channels: { telegram: ["Alpha", "Backup", "Main"], cfr2: [], s3: [], discord: [], huggingface: [], webdav: [] },
        skipped: none,
      }),
    };
  });
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page.getByRole("button", { name: "Load channels" }).click();
  await channelInput(page).click();
  await expect(page.getByRole("option", { name: "Main", exact: true })).toBeVisible();
});

// A typed name missing from the list, then Escape and ArrowDown to reopen it
// with the typed name highlighted.
const typeAndReopen = async (page: Page) => {
  await channelInput(page).pressSequentially("Mai");
  await page.keyboard.press("Escape");
  await expect(channelInput(page)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(channelInput(page)).toHaveAttribute("aria-expanded", "true");
  await expect(highlighted(page)).toHaveText("Mai");
};

test("Enter right after reopening keeps a typed channel name that is not listed", async ({ page }) => {
  await typeAndReopen(page);
  await page.keyboard.press("Enter");
  await expect(channelInput(page)).toHaveAttribute("aria-expanded", "false");
  await expect(channelInput(page)).toHaveValue("Mai");
});

test("moving the highlight after reopening still picks a listed channel", async ({ page }) => {
  await typeAndReopen(page);
  await page.keyboard.press("ArrowUp");
  await expect(highlighted(page)).toHaveText("Main");
  await page.keyboard.press("Enter");
  await expect(channelInput(page)).toHaveAttribute("aria-expanded", "false");
  await expect(channelInput(page)).toHaveValue("Main");
});

test("Enter on the toggle button does not confirm the highlighted channel", async ({ page }) => {
  await typeAndReopen(page);
  await page.keyboard.press("ArrowUp");
  await expect(highlighted(page)).toHaveText("Main");
  await page.keyboard.press("Tab");
  await expect(page.locator("button[aria-expanded]:focus")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(channelInput(page)).toHaveValue("Mai");
});
