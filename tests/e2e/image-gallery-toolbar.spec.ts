import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("gallery toolbar avoids editor clipping and remains usable through scrolling and resizing", async ({ page }) => {
  const fixture = fileURLToPath(new URL("../browser/image-gallery-toolbar.html", import.meta.url));
  await page.goto(`/@fs${fixture}`);
  await page.getByRole("button", { name: "Run regression checks", exact: true }).click();
  await expect(page.locator("#summary")).toHaveText("All 6 regression checks passed");
  await expect(page.locator("#results li")).toHaveCount(6);
});
