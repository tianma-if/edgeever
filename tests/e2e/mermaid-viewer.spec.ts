import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Exercise real browser HTML/XML parsers and Blob-backed image decoding (#704).
// This fixture also runs directly in the built-in browser for visual checks.
test("Mermaid viewer loads HTML labels and preserves valid SVGs", async ({ page }) => {
  const fixturePath = fileURLToPath(new URL("./fixtures/mermaid-viewer.html", import.meta.url));
  await page.goto(`/@fs${fixturePath}`);
  await expect(page.locator("#result")).toHaveAttribute("data-state", "passed");
  await expect(page.locator("#cases img")).toHaveCount(8);
  await page.getByRole("button", { name: "Open reported diagram", exact: true }).click();
  const image = page.locator(".yarl__slide_image");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reset zoom", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reset zoom", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(image).toHaveCount(0);
});
