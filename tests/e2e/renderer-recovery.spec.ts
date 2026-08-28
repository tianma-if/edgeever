import { expect, test } from "@playwright/test";

test("starts at the note list after a renderer failure instead of reopening the previous note", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("edgeever.renderer-recovery-required", "1");
  });
  await page.goto("/");

  await expect(page.getByRole("status").getByText("已进入安全启动模式")).toBeVisible();
  const firstMemo = page.locator("[data-memo-id]").first();
  await expect(firstMemo).toBeVisible();
  await firstMemo.click();

  await expect(page.getByText("已进入安全启动模式")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("edgeever.renderer-recovery-required"))).toBeNull();
});
