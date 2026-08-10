import { expect, test } from "@playwright/test";

test("keeps the global attachment manager independent from the selected note", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "附件", exact: true }).click();

  await expect(page.getByRole("heading", { name: "附件管理", exact: true })).toBeVisible();
  await expect(page.getByText("当前关联笔记")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传附件", exact: true })).toHaveCount(0);
});
