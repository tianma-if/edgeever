import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { markdownToDoc, parseTableDocument, serializeTableDocument, tableFallbackMarkdown, type TableDocument } from "@edgeever/shared";
import { parseEdgeEverZip } from "@edgeever/shared/backup-archive";
import { createEdgeEverClient } from "../../packages/client/src/index";

const openBackup = async (page: Page, origin: string) => {
  await page.goto(origin);
  await page.getByRole("button", { name: "个人中心", exact: true }).click();
  await page.getByRole("button", { name: "备份与导入", exact: true }).click();
  await expect(page.getByText("导入与导出", { exact: true })).toBeVisible();
};

test("exports and restores shared table chunks through the default ZIP UI", async ({ page, context, baseURL }, testInfo) => {
  const targetUrl = process.env.EDGE_EVER_E2E_CHUNKED_BACKUP_TARGET;
  test.skip(!targetUrl || !baseURL, "Requires two isolated instances with shared table storage activated");
  const source = createEdgeEverClient({ baseUrl: baseURL! });
  const target = createEdgeEverClient({ baseUrl: targetUrl! });
  const { notebooks } = await source.listNotebooks();
  const table: TableDocument = {
    schemaVersion: 1, fields: [{ id: "text", name: "Text", type: "text" }, { id: "file", name: "File", type: "attachment" }],
    view: { filters: [], sort: null },
    records: Array.from({ length: 56 }, (_, index) => ({ id: `r-${index}`, cells: { text: `Original ${index}`, file: [] } })),
  };
  const { memo } = await source.createMemo({ notebookId: notebooks[0].id, title: "Chunked ZIP test", contentMarkdown: serializeTableDocument(table), contentJson: markdownToDoc(tableFallbackMarkdown(table)) });
  const { resource } = await source.uploadMemoResource(memo.id, new File(["Chunked attachment"], "fixture.txt", { type: "text/plain" }));
  const { editSession } = await source.createMemoEditSession(memo.id);
  await source.updateTableRecords(memo.id, {
    expectedRevision: editSession.baseRevision, expectedContentHash: editSession.baseContentHash, editSessionId: editSession.id,
    mutationId: crypto.randomUUID(), deletes: [], puts: [{ id: "r-0", cells: { text: "Current first row", file: [{
      resourceId: resource.id, filename: "fixture.txt", mimeType: "text/plain", byteSize: resource.byteSize,
    }] } }],
  });

  await context.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }));
  const tableReads: string[] = [];
  const restoreActions: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/backups/data" && url.searchParams.get("kind") === "table") tableReads.push(request.url());
    if (url.pathname.startsWith("/api/v1/restores/json/tables/") && request.method() === "POST") restoreActions.push(request.postDataJSON().action);
  });
  await openBackup(page, baseURL!);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 EdgeEver ZIP", exact: true }).click();
  const download = await downloading;
  const archive = testInfo.outputPath("chunked.zip");
  await download.saveAs(archive);
  const parsed = await parseEdgeEverZip(new Blob([await readFile(archive)]));
  expect(parsed.manifest.formatVersion).toBe(3);
  expect(parsed.tableSnapshots?.get(memo.id)?.map((snapshot) => snapshot.rowPaths.length)).toEqual([3, 3]);
  const reads = tableReads.map((url) => new URL(url).searchParams).filter((query) => query.get("memoId") === memo.id);
  expect(reads.filter((query) => !query.has("revisionId"))).toHaveLength(6);
  expect(reads.filter((query) => query.has("revisionId"))).toHaveLength(3);

  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }));
  await openBackup(page, targetUrl!);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入 EdgeEver ZIP", exact: true }).click();
  await (await choosing).setFiles(archive);
  await page.getByRole("dialog", { name: "导入 EdgeEver ZIP" }).getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByText("EdgeEver ZIP 导入完成。", { exact: true })).toBeVisible({ timeout: 45_000 });
  expect(restoreActions.filter((action) => action === "rows").length).toBeGreaterThanOrEqual(6);
  expect(restoreActions).toContain("publish");
  const restored = await target.getMemo(memo.id);
  expect(parseTableDocument(restored.memo.contentMarkdown)?.records[0].cells.text).toBe("Current first row");
  const history = await target.listMemoRevisions(memo.id);
  expect(parseTableDocument(history.revisions[0].contentMarkdown)?.records[0].cells.text).toBe("Original 0");
  const blob = await target.getResourceResponse(resource.url);
  expect(await blob.text()).toBe("Chunked attachment");
});
