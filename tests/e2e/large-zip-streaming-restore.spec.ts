import { expect, test, type APIRequestContext } from "@playwright/test";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";

const E2E_USERNAME = process.env.EDGE_EVER_E2E_USERNAME || "admin";
const E2E_PASSWORD = process.env.EDGE_EVER_E2E_PASSWORD || "admin123";
const MIB = 1024 * 1024;
const RESOURCE_SPECS = [
  { suffix: "a", byteSize: 600 * MIB + 3, fill: 0x5a, tail: new Uint8Array([0x11, 0x22, 0x33]) },
] as const;

const login = async (request: APIRequestContext) => {
  const response = await request.post("/api/v1/auth/login", {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);
};

const addJsonFile = (zip: Zip, path: string, value: unknown) => {
  const entry = new ZipDeflate(path, { level: 6 });
  zip.add(entry);
  entry.push(strToU8(`${JSON.stringify(value)}\n`), true);
};

const createLargeBackup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-large-zip-e2e-"));
  const archivePath = join(directory, "edgeever-600-mib-attachment.zip");
  const output = createWriteStream(archivePath, { highWaterMark: MIB });
  let needsDrain = false;
  const finished = once(output, "finish");
  const zip = new Zip((error, data, final) => {
    if (error) {
      output.destroy(error);
      return;
    }
    if (data.byteLength > 0 && !output.write(data)) needsDrain = true;
    if (final) output.end();
  });
  const drain = async () => {
    if (!needsDrain) return;
    needsDrain = false;
    await once(output, "drain");
  };

  const marker = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const notebookId = `nb_e2e_large_zip_${marker}`;
  const memoId = `memo_e2e_large_zip_${marker}`;
  const title = `E2E 超大 ZIP 恢复 ${marker}`;
  const timestamp = "2026-08-31T00:00:00.000Z";
  const resources = RESOURCE_SPECS.map((spec) => ({
    id: `res_e2e_large_zip_${spec.suffix}_${marker}`,
    memoId,
    originalMemoId: null,
    kind: "attachment" as const,
    mimeType: "application/octet-stream",
    filename: `large-${spec.suffix}.bin`,
    byteSize: spec.byteSize,
    sha256: null,
    width: null,
    height: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivePath: `notes/E2E/${title}.assets/large-${spec.suffix}.bin`,
  }));
  const memo = {
    id: memoId,
    notebookId,
    title,
    excerpt: "Streaming restore fixture",
    tags: ["e2e-large-zip"],
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    contentJson: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Streaming restore fixture" }] }],
    },
    contentMarkdown: resources
      .map((resource) => `[${resource.filename}](/api/v1/resources/${resource.id}/blob)`)
      .join("\n\n"),
    contentText: "Streaming restore fixture",
    contentHash: `e2e-large-zip-${marker}`,
    sourceMemoIds: [],
    mergeSourceCount: 0,
    mergedIntoMemoId: null,
  };

  try {
    addJsonFile(zip, "notebooks.json", [{
      id: notebookId,
      parentId: null,
      name: `E2E Large ZIP ${marker}`,
      slug: null,
      icon: null,
      color: null,
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }]);
    addJsonFile(zip, "prompts.json", []);
    await drain();

    for (const [index, resource] of resources.entries()) {
      const spec = RESOURCE_SPECS[index];
      const entry = new ZipPassThrough(resource.archivePath);
      zip.add(entry);
      const fullChunk = new Uint8Array(MIB);
      fullChunk.fill(spec.fill);
      const fullChunkCount = Math.floor(spec.byteSize / MIB);
      for (let chunkIndex = 0; chunkIndex < fullChunkCount; chunkIndex += 1) {
        entry.push(fullChunk, false);
        await drain();
      }
      const remaining = spec.byteSize - fullChunkCount * MIB;
      if (remaining > 0) {
        const finalChunk = new Uint8Array(remaining);
        finalChunk.fill(spec.fill);
        if (spec.tail.byteLength > 0) finalChunk.set(spec.tail, finalChunk.byteLength - spec.tail.byteLength);
        entry.push(finalChunk, true);
      } else {
        entry.push(new Uint8Array(), true);
      }
      await drain();
    }

    addJsonFile(zip, `memos/${memoId}.json`, { memo, revisions: [], resources });
    const markdown = new ZipDeflate(`notes/E2E/${title}.md`, { level: 6 });
    zip.add(markdown);
    markdown.push(strToU8(`# ${title}\n\n${memo.contentMarkdown}\n`), true);
    addJsonFile(zip, "manifest.json", {
      format: "edgeever-zip",
      formatVersion: 2,
      schemaVersion: 1,
      edgeeverVersion: "e2e",
      buildId: `e2e-${marker}`,
      exportedAt: timestamp,
      includesTrash: false,
      counts: { notebooks: 1, memos: 1, revisions: 0, resources: resources.length, prompts: 0 },
    });
    zip.end();
    await finished;
    return { archivePath, directory, memoId, notebookId, resources, title };
  } catch (error) {
    output.destroy();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

test("imports a 600 MiB attachment from an EdgeEver ZIP through streaming multipart restore", async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = await createLargeBackup();
  const restoredPartNumbers: number[] = [];

  try {
    await login(page.request);
    page.on("response", (response) => {
      const match = new URL(response.url()).pathname.match(/^\/api\/v1\/resource-uploads\/[^/]+\/parts\/(\d+)$/);
      if (match && response.request().method() === "PUT" && response.ok()) {
        restoredPartNumbers.push(Number(match[1]));
      }
    });

    await page.goto("/");
    await page.getByRole("button", { name: "个人中心", exact: true }).click();
    await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "导入导出", exact: true }).click();
    await expect(page.getByText("导入与导出", { exact: true })).toBeVisible();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入 EdgeEver ZIP", exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixture.archivePath);

    const confirmation = page.getByRole("dialog", { name: "导入 EdgeEver ZIP" });
    await expect(confirmation).toBeVisible({ timeout: 120_000 });
    await expect(confirmation).toContainText("1 篇笔记和 1 个资源");
    await confirmation.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.getByText("EdgeEver ZIP 导入完成。", { exact: true })).toBeVisible({ timeout: 180_000 });

    expect(restoredPartNumbers).toHaveLength(76);
    expect(restoredPartNumbers.filter((part) => part === 1)).toHaveLength(1);
    expect(Math.max(...restoredPartNumbers)).toBe(76);

    const memoResponse = await page.request.get(`/api/v1/memos/${fixture.memoId}`);
    expect(memoResponse.ok(), await memoResponse.text()).toBe(true);
    const restoredMemo = await memoResponse.json() as { memo: { title: string; contentMarkdown: string } };
    expect(restoredMemo.memo.title).toBe(fixture.title);

    for (const [index, resource] of fixture.resources.entries()) {
      const first = await page.request.get(`/api/v1/resources/${resource.id}/blob`, {
        headers: { Range: "bytes=0-2" },
      });
      expect(first.status()).toBe(206);
      expect(Array.from(await first.body())).toEqual([RESOURCE_SPECS[index].fill, RESOURCE_SPECS[index].fill, RESOURCE_SPECS[index].fill]);

      const last = await page.request.get(`/api/v1/resources/${resource.id}/blob`, {
        headers: { Range: `bytes=${resource.byteSize - 3}-${resource.byteSize - 1}` },
      });
      expect(last.status()).toBe(206);
      const expectedTail = RESOURCE_SPECS[index].tail.byteLength > 0
        ? Array.from(RESOURCE_SPECS[index].tail)
        : [RESOURCE_SPECS[index].fill, RESOURCE_SPECS[index].fill, RESOURCE_SPECS[index].fill];
      expect(Array.from(await last.body())).toEqual(expectedTail);
    }
  } finally {
    await login(page.request).catch(() => undefined);
    await page.request.delete(`/api/v1/memos/${fixture.memoId}`).catch(() => undefined);
    await page.request.delete(`/api/v1/memos/${fixture.memoId}?permanent=1`).catch(() => undefined);
    await page.request.delete(`/api/v1/notebooks/${fixture.notebookId}`).catch(() => undefined);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
