import { expect, test } from "@playwright/test";

test("anchors a memo's more-actions menu to its visible trigger", async ({ page }) => {
  await page.goto("/");

  const memoCard = page.locator('[data-memo-id="memo_demo_overview"]');
  const trigger = memoCard.locator("[data-memo-actions-trigger]");
  await memoCard.hover();
  await trigger.click();

  const menu = page.locator("[data-memo-actions-menu]");
  await expect(menu).toBeVisible();

  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();

  expect(Math.abs(menuBox!.x - (triggerBox!.x + triggerBox!.width))).toBeLessThan(24);
  expect(Math.abs(menuBox!.y - (triggerBox!.y + triggerBox!.height))).toBeLessThan(24);
});
