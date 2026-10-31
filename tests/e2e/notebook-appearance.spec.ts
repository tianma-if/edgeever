import { expect, test, type Page } from "@playwright/test";

const createAppearanceNotebook = async (page: Page) => {
  await page.addInitScript(() => localStorage.setItem("edgeever.locale.preference", "en-US"));
  await page.goto("/");
  const name = `Appearance interaction ${Date.now()}`;
  const created = await page.request.post("/api/v1/notebooks", { data: { name } });
  expect(created.ok()).toBeTruthy();
  const { notebook } = await created.json();
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
      await page.reload();
      await expect(row).toBeVisible();
      await row.hover();
      await row.getByRole("button", { name: `Open actions for ${name}`, exact: true }).click();
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(dialog).toBeVisible();
    },
    remove: async () => {
      const response = await page.request.delete(`/api/v1/notebooks/${notebook.id}`);
      expect(response.ok()).toBeTruthy();
    },
  };
};

test("selects a notebook icon with the mouse after searching and persists it across reloads", async ({ page }) => {
  const { row, dialog, read, open, remove } = await createAppearanceNotebook(page);
  try {
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
    await page.reload();
    await expect(row.locator("[data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "alarm-clock");
    await expect(row.locator('[data-notebook-icon] circle[cx="12"][cy="13"]')).toHaveCount(1);
  } finally {
    await remove();
  }
});

test("keeps icon searches as drafts on Enter and supports keyboard selection and cancellation", async ({ page }) => {
  const { dialog, read, open, remove } = await createAppearanceNotebook(page);
  try {
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
  } finally {
    await remove();
  }
});

test("saves notebook appearance, keeps drafts on cancel, and resets across reloads and themes", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("edgeever.locale.preference", "en-US");
    if (!localStorage.getItem("edgeever.notebook-color-palette")) localStorage.setItem("edgeever.notebook-color-palette", JSON.stringify(["#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed"]));
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const name = `Appearance ${Date.now()}`;
  const created = await page.request.post("/api/v1/notebooks", { data: { name } });
  expect(created.ok()).toBeTruthy();
  const { notebook } = await created.json();
  const childResponse = await page.request.post("/api/v1/notebooks", { data: { name: "Child", parentId: notebook.id } });
  const { notebook: child } = await childResponse.json();
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
  try {
    await page.reload();
    await expect(row).toBeVisible();
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
    await page.reload();
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
    await open();
    await dialog.getByLabel("Invert", { exact: true }).selectOption("row");
    await expect(dialog.locator("[data-notebook-name]")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(dialog.locator("[data-notebook-icon]")).not.toHaveAttribute("data-notebook-icon-inverted");
    const rowBackground = await dialog.locator("[data-notebook-appearance-preview]").evaluate(element => getComputedStyle(element).backgroundColor);
    await save();
    await expect.poll(readNotebook).toMatchObject({ rowInverted: true, iconInverted: false });
    await page.reload();
    await expect(row).toHaveAttribute("data-notebook-row-inverted", "true");
    await expect(row).toHaveCSS("background-color", rowBackground);
    await expect(row.locator("[data-notebook-name]")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(row.locator("[data-notebook-icon]")).toHaveCSS("color", "rgb(255, 255, 255)");
    // The active row stays recognizable; dark mode preserves the selected background.
    await row.locator("[data-notebook-tree-button]").click();
    await expect(row).toHaveClass(/notebook-inverted-row-selected/);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(row).toHaveCSS("background-color", rowBackground);
    // A nested row spans the same width, with its content still indented.
    expect((await page.request.patch(`/api/v1/notebooks/${child.id}`, { data: { rowInverted: true, color: "#2563eb" } })).ok()).toBeTruthy();
    await page.reload();
    const childRow = page.locator(`[data-notebook-id="${child.id}"]`);
    await expect(row).toHaveAttribute("data-notebook-row-inverted", "true");
    const expand = row.getByRole("button", { name: `Expand ${name}`, exact: true });
    if (await expand.isVisible()) await expand.click();
    await expect(childRow).toBeVisible();
    await expect(childRow).toHaveAttribute("data-notebook-row-inverted", "true");
    const parentBox = await row.boundingBox();
    const childBox = await childRow.boundingBox();
    expect(childBox?.x).toBe(parentBox?.x);
    expect(childBox?.width).toBe(parentBox?.width);
    await expect(childRow).toHaveCSS("padding-left", "22px");
    await expect(childRow.locator("[data-notebook-name]")).toHaveCSS("color", "rgb(255, 255, 255)");
    await page.screenshot({ path: "test-results/notebook-row-inverted.png" });
    await open();
    await expect(dialog.getByLabel("Invert", { exact: true })).toHaveValue("row");
    await dialog.getByRole("button", { name: "Reset to default", exact: true }).click();
    await save();
    await expect.poll(readNotebook).toMatchObject({ icon: null, color: null, textColor: null, isBold: false, iconInverted: false, rowInverted: false });
    await page.reload();
    await expect(row.locator("[data-notebook-icon]")).toHaveAttribute("data-notebook-icon", "notebook");
    await expect(row.locator(".notebook-custom-color")).toHaveCount(0);
    await expect(row.locator("[data-notebook-name]")).toHaveCSS("font-weight", "400");
  } finally {
    await page.request.delete(`/api/v1/notebooks/${child.id}`);
    await page.request.delete(`/api/v1/notebooks/${notebook.id}`);
  }
});
