import { expect, test, type APIRequestContext, type Download } from "@playwright/test";
import sharp from "sharp";

const E2E_USERNAME = process.env.EDGE_EVER_E2E_USERNAME || "admin";
const E2E_PASSWORD = process.env.EDGE_EVER_E2E_PASSWORD || "admin123";

const login = async (request: APIRequestContext) => {
  const response = await request.post("/api/v1/auth/login", {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);
};

const inspectDownload = async (download: Download) => {
  const path = await download.path();
  expect(path).not.toBeNull();
  const image = sharp(path!);
  const metadata = await image.metadata();
  const statistics = await image.stats();
  const { data: pixels, info } = await sharp(path!).raw().toBuffer({ resolveWithObject: true });
  return { metadata, statistics, topLeft: Array.from(pixels.slice(0, info.channels)) };
};

test("downloads a long note as one non-blank PNG or JPEG from the share dialog", async ({ page, request }) => {
  test.setTimeout(90_000);
  await login(request);
  const notebooksResponse = await request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = (await notebooksResponse.json() as { notebooks: Array<{ id: string; name: string }> }).notebooks;
  const notebook = notebooks[0];
  expect(notebook).toBeTruthy();

  const title = `e2e-image-export-${Date.now()}`;
  const contentMarkdown = Array.from(
    { length: 80 },
    (_, index) => `## Section ${index + 1}\n\nVisible export content ${index + 1}: EdgeEver image regression test.`,
  ).join("\n\n");
  const createResponse = await request.post("/api/v1/memos", {
    data: { notebookId: notebook.id, title, contentMarkdown },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const memoId = (await createResponse.json() as { memo: { id: string } }).memo.id;

  try {
    await page.goto("/");
    await page.getByRole("button", { name: new RegExp(notebook.name) }).click();
    await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
    await expect(page.locator(".ProseMirror")).toContainText("Visible export content 80");

    await page.getByRole("button", { name: /笔记更多操作|More note actions/ }).click();
    await expect(page.getByRole("menuitem", { name: /导出 PNG|Export PNG/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /导出 JPEG|Export JPEG/ })).toHaveCount(0);
    await page.getByRole("menuitem", { name: /分享为图片|Share as image/ }).click();
    const dialog = page.getByRole("dialog", { name: /分享为图片|Share as image/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img", { name: /笔记分享图片预览|Note image share preview/ })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole("checkbox", { name: /EdgeEver 品牌标识|EdgeEver branding/ })).toBeChecked();

    const pngDownloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: /下载图片|Download image/ }).click();
    const pngDownload = await pngDownloadPromise;
    expect(pngDownload.suggestedFilename()).toMatch(/\.png$/i);
    expect(pngDownload.suggestedFilename()).not.toMatch(/\.zip$/i);
    const pngImage = await inspectDownload(pngDownload);
    expect(pngImage.metadata.format).toBe("png");
    expect(pngImage.metadata.width).toBeGreaterThan(700);
    expect(pngImage.metadata.height).toBeGreaterThan(4_800);
    expect(pngImage.statistics.channels.some((channel) => channel.stdev > 5)).toBe(true);
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /薄荷|Mint/ }).click();
    await dialog.getByRole("checkbox", { name: /笔记本|Notebook/ }).click();
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: /JPEG/ }).click();
    await expect(dialog.getByText(/正在生成预览|Generating preview/)).toBeHidden({ timeout: 20_000 });

    const shareDownloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: /下载图片|Download image/ }).click();
    const shareDownload = await shareDownloadPromise;
    expect(shareDownload.suggestedFilename()).toMatch(/\.jpg$/i);
    const sharedImage = await inspectDownload(shareDownload);
    expect(sharedImage.metadata.format).toBe("jpeg");
    expect(sharedImage.metadata.height).toBeGreaterThan(4_800);
    expect(sharedImage.statistics.channels.some((channel) => channel.stdev > 5)).toBe(true);
    expect(sharedImage.topLeft.slice(0, 3).every((value, index) => Math.abs(value - [236, 253, 245][index]) < 20)).toBe(true);
  } finally {
    await request.delete(`/api/v1/memos/${memoId}`);
    await request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});
