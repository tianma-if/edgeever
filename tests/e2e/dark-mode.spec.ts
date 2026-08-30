import { expect, test, type Page } from "@playwright/test";

const installDarkTheme = (page: Page) => page.addInitScript(() => {
  localStorage.setItem("edgeever.theme", "dark");
  localStorage.setItem("edgeever.editor-theme", "custom-default");
  localStorage.setItem("edgeever.custom-editor-themes", JSON.stringify([{
    id: "custom-default",
    name: "Dark mode audit",
    light: {
      background: "#fffdf7", text: "#292524", muted: "#57534e", heading: "#1c1917",
      accent: "#0f766e", soft: "#f0fdfa", border: "#99f6e4",
    },
    dark: {
      background: "#1c1917", text: "#fafaf9", muted: "#d6d3d1", heading: "#fafaf9",
      accent: "#2dd4bf", soft: "#292524", border: "#44403c",
    },
  }]));
});

const auditVisibleTextContrast = (page: Page) => page.evaluate(() => {
  const parseColor = (color: string) => {
    const match = color.match(/rgba?\((\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:[, /]+\s*([\d.]+))?/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])] : null;
  };
  const composite = (foreground: number[], background: number[]) => {
    const alpha = foreground[3] + background[3] * (1 - foreground[3]);
    return [0, 1, 2].map((index) => (
      (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha
    )).concat(alpha);
  };
  const effectiveBackground = (element: Element) => {
    const layers: number[][] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const color = parseColor(getComputedStyle(current).backgroundColor);
      if (color && color[3] > 0) layers.push(color);
    }
    return layers.reduceRight((background, layer) => composite(layer, background), [15, 23, 42, 1]);
  };
  const luminance = (color: number[]) => color.slice(0, 3)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const ratio = (foreground: number[], background: number[]) => {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  };

  return [...document.querySelectorAll("body *")]
    .filter((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hasDirectText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const hasFormValue = (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && Boolean(element.value.trim());
      return (hasDirectText || hasFormValue) && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight &&
        style.visibility !== "hidden" && Number(style.opacity) > 0.45;
    })
    .map((element) => {
      const style = getComputedStyle(element);
      const foreground = parseColor(style.color);
      if (!foreground) return null;
      const background = effectiveBackground(element);
      const contrast = ratio(composite(foreground, background), background);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const required = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700) ? 3 : 4.5;
      return contrast + 0.05 < required
        ? `${element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value.trim().slice(0, 80)
          : element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)} (${contrast.toFixed(2)}:1)`
        : null;
    })
    .filter((failure): failure is string => Boolean(failure))
    .slice(0, 20);
});

test.describe("dark mode visual contracts", () => {
  test.beforeEach(async ({ page }) => {
    await installDarkTheme(page);
  });

  test("workspace and settings retain readable text and dark surfaces", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator(".ProseMirror")).toBeVisible();
    expect(await auditVisibleTextContrast(page)).toEqual([]);

    const titleInput = page.getByPlaceholder("无标题笔记", { exact: true });
    await titleInput.focus();
    await expect(titleInput).toBeFocused();
    expect(await auditVisibleTextContrast(page)).toEqual([]);

    await page.getByRole("button", { name: "个人中心", exact: true }).click();
    await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
    expect(await auditVisibleTextContrast(page)).toEqual([]);
  });

  test("notebook move picker keeps highlighted options dark and selected labels clean", async ({ page }) => {
    await page.goto("/");
    const selectMemosButton = page.getByRole("button", { name: "选择笔记", exact: true });
    if (await selectMemosButton.isDisabled()) {
      await page.getByRole("button", { name: "手动同步笔记", exact: true }).click();
    }
    await expect(selectMemosButton).toBeEnabled({ timeout: 20_000 });
    await selectMemosButton.click();

    const actionBar = page.locator("[data-memo-selection-action-bar]");
    const actionCard = actionBar.locator(":scope > div");
    await expect(actionBar).toBeVisible();
    await expect.poll(async () => (await actionCard.boundingBox())?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(120);

    const notebookSelect = actionBar.getByRole("combobox");
    await expect(notebookSelect).toContainText("功能演示");
    await expect(notebookSelect).not.toContainText("└");
    await notebookSelect.click();

    const nestedNotebook = page.getByRole("option", { name: /功能演示/ });
    await nestedNotebook.hover();
    await expect.poll(() => nestedNotebook.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe("rgb(241, 245, 249)");
    expect(await auditVisibleTextContrast(page)).toEqual([]);

    await nestedNotebook.click();
    await expect(notebookSelect).toHaveText("功能演示");
  });

  test("public share content remains readable in dark mode", async ({ page }) => {
    const memoId = "memo_demo_overview";
    const response = await page.request.post(`/api/v1/memos/${memoId}/share`);
    expect(response.ok()).toBe(true);
    const body = await response.json() as { share: { token: string } };

    try {
      await page.goto(`/share/${encodeURIComponent(body.share.token)}`);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.locator(".edgeever-public-share .ProseMirror")).toBeVisible();
      expect(await auditVisibleTextContrast(page)).toEqual([]);
    } finally {
      await page.request.delete(`/api/v1/memos/${memoId}/share`);
    }
  });
});
