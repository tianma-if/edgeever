import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../browser/image-gallery-toolbar.html", import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto(`/@fs${fixture}`);
});

test("gallery toolbar avoids editor clipping and remains usable through scrolling and resizing", async ({ page }) => {
  await page.getByRole("button", { name: "Run regression checks", exact: true }).click();
  await expect(page.locator("#summary")).toHaveText("All 6 regression checks passed");
  await expect(page.locator("#results li")).toHaveCount(6);
});

test("clicking a gallery image keeps its layout controls open until clicking outside", async ({ page }) => {
  const gallery = page.locator(".edgeever-image-gallery");
  const toolbar = gallery.getByRole("toolbar");
  const outside = page.getByText("Content before the gallery", { exact: true });

  await gallery.getByRole("img", { name: "Gallery image 1" }).click();
  await page.mouse.move(1, 1);
  await expect(toolbar).toBeVisible();

  const fitHeight = toolbar.getByRole("button", { name: "适应高度", exact: true });
  await fitHeight.click();
  await expect(fitHeight).toHaveAttribute("aria-pressed", "true");

  await outside.click({ position: { x: 8, y: 8 } });
  await expect(toolbar).toBeHidden();
});
