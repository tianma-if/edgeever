import { expect, test as base, type Page } from "@playwright/test";
import type { Notebook } from "@edgeever/shared";
import { fileURLToPath } from "node:url";

type CreateNotebook = (data: { name: string; parentId?: string }) => Promise<Notebook>;

const test = base.extend<{ createNotebook: CreateNotebook }>({
  createNotebook: async ({ request }, use) => {
    const createdIds: string[] = [];
    await use(async (data) => {
      const response = await request.post("/api/v1/notebooks", { data });
      expect(response.ok()).toBeTruthy();
      const { notebook } = await response.json();
      createdIds.push(notebook.id);
      return notebook;
    });
    for (const id of createdIds.reverse()) {
      expect((await request.delete(`/api/v1/notebooks/${id}`)).ok()).toBeTruthy();
    }
  },
});

// The appearance suite exercises real navigations and API calls without a PWA
// worker, including when the built UI is served over the development origin.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  if (process.env.EDGE_EVER_E2E_BUILT_WEB === "1") {
    // Serve the built UI while keeping the same origin, real API and local
    // authentication. Chromium otherwise transforms hundreds of Vite modules
    // per navigation when Playwright request routing disables the HTTP cache.
    await page.route((url) => url.pathname === "/" || /^\/assets\/[\w.~\-]+$/.test(url.pathname), (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      return route.fulfill({ path: fileURLToPath(new URL(`../../apps/web/dist/${file}`, import.meta.url)) });
    });
  }
  // Plugin discovery is unrelated to notebook appearance and can contact GitHub.
  await page.route("**/extensions/registry.json", (route) => route.fulfill({
    json: { registryVersion: "1", updatedAt: "2026-01-01T00:00:00.000Z", entries: [] },
  }));
  await page.route("**/api/v1/workspace-extensions", (route) => route.fulfill({ json: { extensions: [] } }));
});

test("refreshes the rendered notebook when its cached appearance is stale", async ({ page, createNotebook }) => {
  const notebook = await createNotebook({ name: "Appearance refresh" });
  const notebookUrl = `/api/v1/notebooks/${notebook.id}`;
  const icon = page.locator(`[data-notebook-id="${notebook.id}"] [data-notebook-icon]`);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(icon).toHaveAttribute("data-notebook-icon", "notebook");

  // Isolate the list refresh from workspace-wide sync, as when that endpoint
  // is temporarily unavailable. Keep the list request and server data real.
  await page.route("**/api/v1/sync/**", (route) => route.abort());
  const saved = await page.request.patch(notebookUrl, { data: { icon: "alarm-clock" } });
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).notebook.icon).toBe("alarm-clock");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(icon).toHaveAttribute("data-notebook-icon", "alarm-clock");
});

const createAppearanceNotebook = async (page: Page, createNotebook: CreateNotebook) => {
  await page.addInitScript(() => localStorage.setItem("edgeever.locale.preference", "en-US"));
  const name = `Appearance interaction ${Date.now()}`;
  const notebook = await createNotebook({ name });
  const row = page.locator(`[data-notebook-id="${notebook.id}"]`);
  const dialog = page.getByRole("dialog", { name: "Appearance", exact: true });
  return {
    row,
    dialog,
    read: async () => {
      const response = await page.request.get("/api/v1/notebooks");
      expect(response.ok()).toBeTruthy();
      return (await response.json()).notebooks.find((item: { id: string }) => item.id === notebook.id);
    },
    open: async () => {
      if (page.url() === "about:blank") await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(row).toBeVisible();
      await row.hover();
      await row.getByRole("button", { name: `Open actions for ${name}`, exact: true }).click();
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(dialog).toBeVisible();
    },
  };
};

test("selects a notebook icon with the mouse after searching and persists it across reloads", async ({ page, createNotebook }) => {
  const { row, dialog, read, open } = await createAppearanceNotebook(page, createNotebook);
  await open();
  await dialog.getByRole("button", { name: "Icon", exact: true }).click();
  const search = dialog.getByPlaceholder("Search icons (English or German)");
  await search.fill("alarm-clock");
  await expect(search).toBeFocused();
  // Use a real mouse click: dispatchEvent("click") skips Safari's blur-before-click sequence.
  await dialog.getByRole("option", { name: "alarm clock", exact: true }).click();
  await expect(dialog.getByRole("listbox")).toBeHidden();
  await expect(dialog.locator("[data-notebook-appearance-preview] [data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "alarm-clock");
  expect(await read()).toMatchObject({ icon: null });
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(read).toMatchObject({ icon: "alarm-clock" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(row.locator("[data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "alarm-clock");
  await expect(row.locator('[data-notebook-icon] circle[cx="12"][cy="13"]')).toHaveCount(1);
});

test("keeps icon searches as drafts on Enter and supports keyboard selection and cancellation", async ({ page, createNotebook }) => {
  const { dialog, read, open } = await createAppearanceNotebook(page, createNotebook);
  await open();
  await dialog.getByRole("switch", { name: "Bold", exact: true }).check();
  await dialog.getByRole("button", { name: "Icon", exact: true }).click();
  const search = dialog.getByPlaceholder("Search icons (English or German)");
  await search.fill("house");
  await search.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await expect(dialog.getByRole("listbox")).toBeVisible();
  expect(await read()).toMatchObject({ icon: null, isBold: false });
  await search.press("Escape");
  await expect(dialog.getByRole("listbox")).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Icon", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Icon", exact: true }).press("Enter");
  await search.fill("house");
  const option = dialog.getByRole("option", { name: "house", exact: true });
  await option.focus();
  await option.press("Enter");
  await expect(dialog.getByRole("listbox")).toBeHidden();
  await expect(dialog.locator("[data-notebook-appearance-preview] [data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "house");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await read()).toMatchObject({ icon: null, isBold: false });
  await open();
  await expect(dialog.getByRole("switch", { name: "Bold", exact: true })).not.toBeChecked();
  await expect(dialog.locator("[data-notebook-appearance-preview] [data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "notebook");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

const createAppearanceScenario = async (page: Page, createNotebook: CreateNotebook, appearance?: { rowInverted?: boolean; invertChild?: boolean }) => {
  await page.addInitScript(() => {
    localStorage.setItem("edgeever.locale.preference", "en-US");
    if (!localStorage.getItem("edgeever.notebook-color-palette")) localStorage.setItem("edgeever.notebook-color-palette", JSON.stringify(["#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed"]));
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const name = `Appearance ${Date.now()}`;
  const notebook = await createNotebook({ name });
  const child = await createNotebook({ name: "Child", parentId: notebook.id });
  const readNotebook = async () => (await (await page.request.get("/api/v1/notebooks")).json()).notebooks.find((item: { id: string }) => item.id === notebook.id);
  const row = page.locator(`[data-notebook-id="${notebook.id}"]`);
  const dialog = page.getByRole("dialog", { name: "Appearance", exact: true });
  const open = async () => {
    await row.hover();
    await row.getByRole("button", { name: `Open actions for ${name}`, exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(dialog).toBeVisible();
  };
  const save = async () => {
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  if (appearance) {
    expect((await page.request.patch(`/api/v1/notebooks/${notebook.id}`, {
      data: { icon: "alarm-clock", color: "#2563eb", textColor: "#dc2626", isBold: true, iconInverted: !appearance.rowInverted, rowInverted: appearance.rowInverted },
    })).ok()).toBeTruthy();
  }
  if (appearance?.invertChild) {
    expect((await page.request.patch(`/api/v1/notebooks/${child.id}`, {
      data: { rowInverted: true, color: "#2563eb" },
    })).ok()).toBeTruthy();
  }
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(row).toBeVisible();
  return { name, child, row, dialog, open, save, readNotebook };
};

test("saves notebook colors and icon inversion across reloads and themes", async ({ page, createNotebook }) => {
  const { child, row, dialog, open, save, readNotebook } = await createAppearanceScenario(page, createNotebook);
  await row.locator("[data-notebook-tree-button]").click();
  await open();
  await dialog.getByRole("button", { name: "Icon", exact: true }).click();
  await dialog.getByPlaceholder("Search icons (English or German)").fill("alarm-clock");
  await dialog.getByRole("option", { name: "alarm clock", exact: true }).click();
  await expect(dialog.locator('[data-notebook-color-picker="Icon color"] button')).toHaveCount(5);
  await expect(dialog.locator('[data-notebook-color-picker="Text color"] button')).toHaveCount(5);
  await dialog.getByRole("button", { name: "Icon color 1: #2563eb", exact: true }).click();
  await dialog.getByLabel("Icon color", { exact: true }).fill("#0d9488");
  await expect(dialog.getByRole("button", { name: "Icon color 1: #0d9488", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Text color 1: #0d9488", exact: true })).toBeVisible();
  await dialog.getByLabel("Icon color", { exact: true }).evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "#2563eb");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await dialog.getByLabel("Text color", { exact: true }).evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "#dc2626");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await dialog.getByRole("switch", { name: "Bold", exact: true }).check();
  await dialog.getByLabel("Invert", { exact: true }).selectOption("icon");
  await expect(dialog.locator("[data-notebook-icon]")).toHaveAttribute("data-notebook-icon-inverted", "true");
  await expect(dialog.locator("[data-notebook-name]")).toHaveCSS("font-weight", "700");
  await expect(dialog.locator("[data-notebook-appearance-preview] [data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "alarm-clock");
  await expect(dialog.locator("[data-notebook-name]")).toHaveCSS("color", "rgb(196, 34, 34)");
  await expect(dialog.locator("[data-notebook-icon]")).toHaveCSS("width", "24px");
  await expect(dialog.locator("[data-notebook-icon]")).toHaveCSS("padding", "4px");
  const previewColor = await dialog.locator("[data-notebook-name]").evaluate(element => getComputedStyle(element).color);
  await page.screenshot({ path: "test-results/notebook-appearance-dialog.png" });
  await save();
  await expect.poll(readNotebook).toMatchObject({ icon: "alarm-clock", color: "#2563eb", textColor: "#dc2626", isBold: true, iconInverted: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(row.locator("[data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "alarm-clock");
  await expect(row.locator('[data-notebook-icon] circle[cx="12"][cy="13"]')).toHaveCount(1);
  await expect(row.locator("[data-notebook-icon]")).toHaveAttribute("data-notebook-icon-inverted", "true");
  await expect(row.locator("[data-notebook-name]")).toHaveCSS("color", previewColor);
  await expect(row.locator("[data-notebook-name]")).toHaveCSS("font-weight", "700");
  await row.locator("[data-notebook-tree-button]").click();
  await expect(row.locator("[data-notebook-name]")).toHaveCSS("font-weight", "700");
  // Children have independent settings.
  await expect(page.locator(`[data-notebook-id="${child.id}"] [data-notebook-icon]`)).toHaveAttribute("data-notebook-icon", "notebook");
  await expect(page.locator(`[data-notebook-id="${child.id}"] [data-notebook-name]`)).toHaveCSS("font-weight", "400");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(row.locator("[data-notebook-name]")).not.toHaveCSS("color", previewColor);
  await page.screenshot({ path: "test-results/notebook-appearance-dark.png" });
});

test("discards notebook appearance and reset drafts on cancel", async ({ page, createNotebook }) => {
  const { row, dialog, open, readNotebook } = await createAppearanceScenario(page, createNotebook, {});
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await open();
  await dialog.getByLabel("Text color", { exact: true }).evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "#ffffff");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await readNotebook()).toMatchObject({ color: "#2563eb", textColor: "#dc2626", isBold: true, iconInverted: true });
  // Reset is a draft until Save; Escape discards it.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Appearance", exact: true }).click();
  await dialog.getByRole("button", { name: "Reset to default", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await readNotebook()).toMatchObject({ icon: "alarm-clock", color: "#2563eb", textColor: "#dc2626", isBold: true, iconInverted: true });
});

test("persists inverted notebook rows across reloads and themes", async ({ page, createNotebook }) => {
  const { row, dialog, open, save, readNotebook } = await createAppearanceScenario(page, createNotebook, {});
  await open();
  await dialog.getByLabel("Invert", { exact: true }).selectOption("row");
  await expect(dialog.locator("[data-notebook-name]")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(dialog.locator("[data-notebook-icon]")).not.toHaveAttribute("data-notebook-icon-inverted");
  const rowBackground = await dialog.locator("[data-notebook-appearance-preview]").evaluate(element => getComputedStyle(element).backgroundColor);
  await save();
  await expect.poll(readNotebook).toMatchObject({ rowInverted: true, iconInverted: false });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(row).toHaveAttribute("data-notebook-row-inverted", "true");
  await expect(row).toHaveCSS("background-color", rowBackground);
  await expect(row.locator("[data-notebook-name]")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(row.locator("[data-notebook-icon]")).toHaveCSS("color", "rgb(255, 255, 255)");
  // The active row stays recognizable; dark mode preserves the selected background.
  await row.locator("[data-notebook-tree-button]").click();
  await expect(row).toHaveClass(/notebook-inverted-row-selected/);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(row).toHaveCSS("background-color", rowBackground);
  await page.screenshot({ path: "test-results/notebook-row-inverted.png" });
});

test("draws an inverted child row at the full width with indented content", async ({ page, createNotebook }) => {
  const { name, child, row } = await createAppearanceScenario(page, createNotebook, { rowInverted: true, invertChild: true });
  const childRow = page.locator(`[data-notebook-id="${child.id}"]`);
  await expect(row).toHaveAttribute("data-notebook-row-inverted", "true");
  const expand = row.getByRole("button", { name: `Expand ${name}`, exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(childRow).toBeVisible();
  await expect(childRow).toHaveAttribute("data-notebook-row-inverted", "true");
  const parentBox = await row.boundingBox();
  const childBox = await childRow.boundingBox();
  expect(parentBox).not.toBeNull();
  expect(childBox).not.toBeNull();
  expect(childBox?.x).toBe(parentBox?.x);
  expect(childBox?.width).toBe(parentBox?.width);
  await expect(childRow).toHaveCSS("padding-left", "22px");
  await expect(childRow.locator("[data-notebook-name]")).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("resets inverted notebook appearance and persists the default", async ({ page, createNotebook }) => {
  const { row, dialog, open, save, readNotebook } = await createAppearanceScenario(page, createNotebook, { rowInverted: true });
  await open();
  await expect(dialog.getByLabel("Invert", { exact: true })).toHaveValue("row");
  await dialog.getByRole("button", { name: "Reset to default", exact: true }).click();
  await save();
  await expect.poll(readNotebook).toMatchObject({ icon: null, color: null, textColor: null, isBold: false, iconInverted: false, rowInverted: false });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(row.locator("[data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "notebook");
  await expect(row.locator(".notebook-custom-color")).toHaveCount(0);
  await expect(row.locator("[data-notebook-name]")).toHaveCSS("font-weight", "400");
});
