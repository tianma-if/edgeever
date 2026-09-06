import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const entryPath = resolve(process.argv[2] || "apps/web/dist/index.html");
if (!existsSync(entryPath)) {
  throw new Error("Desktop renderer is missing. Run EDGE_EVER_DESKTOP_BUILD=1 bun run build:web first.");
}
const componentTestPath = resolve(entryPath, "../desktop-renderer-test.html");
if (!existsSync(componentTestPath)) {
  throw new Error("Desktop renderer component test is missing from the production build.");
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--allow-file-access-from-files",
  ],
});

try {
  const verifyEntry = async ({ filePath, readySelector, label }) => {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(pathToFileURL(filePath).href, { waitUntil: "load" });
    try {
      await page.locator(readySelector).first().waitFor({ state: "attached", timeout: 10_000 });
      // Ref callbacks and layout effects can fail after the first React commit.
      // Keep observing long enough to catch post-mount update loops that leave
      // packaged desktop windows blank after briefly rendering.
      await page.waitForTimeout(2_000);
      if (await page.locator(readySelector).first().count() === 0) {
        throw new Error(`${label} disappeared after startup.`);
      }
    } catch (error) {
      if (pageErrors.length === 0) throw error;
    } finally {
      await page.close();
    }

    if (pageErrors.length > 0) {
      throw new Error(`${label} raised startup errors:\n${pageErrors.join("\n")}`);
    }
  };

  await verifyEntry({
    filePath: entryPath,
    readySelector: '[data-edgeever-renderer-ready="true"] #root > *',
    label: "Desktop renderer",
  });
  await verifyEntry({
    filePath: componentTestPath,
    readySelector: '[data-desktop-renderer-test-ready][data-diagram-editor-regression-ready="true"] [data-bubble-menu-regression-ready="true"]',
    label: "Desktop renderer component test",
  });

  console.log("Desktop renderer and component regression test mounted successfully from the file:// production build.");
} finally {
  await browser.close();
}
