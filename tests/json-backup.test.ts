import { describe, expect, test } from "bun:test";
import type { AiPromptTemplate, JsonBackupMemo, JsonBackupNotebook, MemoDetail, Notebook, Resource } from "@edgeever/shared";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createEdgeEverZip,
  parseEdgeEverZip,
  restoreEdgeEverZip,
  restoreEdgeEverZipAndRefresh,
} from "../apps/web/src/lib/json-backup";

const notebook = (id: string, name: string, parentId: string | null = null): Notebook => ({
  id,
  parentId,
  name,
  slug: id,
  icon: "notebook",
  color: null,
  sortOrder: parentId ? 20 : 10,
  memoCount: 1,
  lastMemoUpdatedAt: "2026-07-14T00:00:00.000Z",
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
});

const memo: MemoDetail = {
  id: "memo_backup",
  notebookId: "nb_child",
  title: "Backup note",
  excerpt: "Hello",
  tags: ["backup"],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision: 1,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  deletedAt: null,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
  contentMarkdown: "Hello\n\n![asset](/api/v1/resources/res_backup/blob)",
  contentText: "Hello",
  contentHash: "hash",
  sourceMemoIds: [],
  mergeSourceCount: 0,
  mergedIntoMemoId: null,
};

const resource: Resource = {
  id: "res_backup",
  memoId: memo.id,
  originalMemoId: null,
  kind: "image",
  mimeType: "image/png",
  filename: "asset.png",
  byteSize: 3,
  sha256: "sha",
  width: 10,
  height: 10,
  createdAt: memo.createdAt,
  updatedAt: memo.updatedAt,
  url: "/api/v1/resources/res_backup/blob",
};

const prompt: AiPromptTemplate = {
  id: "aiprompt_backup",
  origin: "custom",
  seedKey: null,
  action: "custom",
  parameterKind: "tone",
  resultMode: "replace",
  nameCustomized: true,
  descriptionCustomized: true,
  instructionCustomized: true,
  name: "Polish",
  description: "Polish selected text",
  instruction: "Polish this text.",
  createdAt: memo.createdAt,
  updatedAt: memo.updatedAt,
};

describe("EdgeEver ZIP", () => {
  test("reports actionable archive validation errors", async () => {
    await expect(parseEdgeEverZip(new Blob(["not a zip"]))).rejects.toEqual(
      expect.objectContaining({ code: "invalidZip" })
    );

    await expect(parseEdgeEverZip(new Blob([zipSync({ "notebooks.json": strToU8("[]") })]))).rejects.toEqual(
      expect.objectContaining({ code: "missingManifest" })
    );

    const manifest = {
      format: "another-app",
      formatVersion: 1,
      schemaVersion: 1,
      edgeeverVersion: "0.1.13",
      buildId: "test-build",
      exportedAt: "2026-07-14T00:00:00.000Z",
      includesTrash: false,
      counts: { notebooks: 0, memos: 0, revisions: 0, resources: 0 },
    };
    await expect(parseEdgeEverZip(new Blob([zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
    })]))).rejects.toEqual(expect.objectContaining({ code: "unsupportedFormat" }));

    await expect(parseEdgeEverZip(new Blob([zipSync({
      "manifest.json": strToU8(JSON.stringify({ ...manifest, format: "edgeever-zip", formatVersion: 99 })),
    })]))).rejects.toEqual(expect.objectContaining({ code: "unsupportedVersion" }));
  });

  test("combines readable Markdown with versioned recovery data", async () => {
    const resourceChunks: number[] = [];
    const blob = await createEdgeEverZip(
      {
        listNotebooks: async () => ({ notebooks: [notebook("nb_child", "Child", "nb_root"), notebook("nb_root", "Root")] }),
        listPrompts: async () => ({ prompts: [prompt] }),
        getPage: async () => ({
          memos: [memo],
          resources: [resource],
          revisions: [{
            id: "rev_backup",
            memoId: memo.id,
            revision: 0,
            title: memo.title,
            tags: memo.tags,
            contentJson: memo.contentJson,
            contentMarkdown: "Hello",
            contentText: "Hello",
            contentHash: "old-hash",
            createdBy: "user",
            createdAt: memo.createdAt,
          }],
          totalCount: 1,
          nextOffset: null,
        }),
        getResourceResponse: async () => new Response(new ReadableStream({
          start(controller) {
            for (const chunk of [new Uint8Array([1]), new Uint8Array([2, 3])]) {
              resourceChunks.push(chunk.byteLength);
              controller.enqueue(chunk);
            }
            controller.close();
          },
        }), { headers: { "Content-Type": "image/png" } }),
      },
      { edgeeverVersion: "0.1.13", buildId: "test-build" }
    );
    const backup = await parseEdgeEverZip(blob);

    expect(backup.manifest.format).toBe("edgeever-zip");
    expect(backup.manifest.formatVersion).toBe(2);
    expect(backup.manifest.counts).toEqual({ notebooks: 2, memos: 1, revisions: 1, resources: 1, prompts: 1 });
    expect(backup.prompts).toEqual([prompt]);
    expect(backup.notebooks.map((item) => item.id)).toEqual(["nb_root", "nb_child"]);
    expect(backup.memos[0].memo.contentMarkdown).toBe(memo.contentMarkdown);
    expect(backup.archive).toBe(blob);
    expect(resourceChunks).toEqual([1, 2]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Array.from(files[backup.memos[0].resources[0].archivePath])).toEqual([1, 2, 3]);
    const markdown = strFromU8(files["notes/Root/Child/Backup note.md"]);
    expect(markdown).toContain("edgeever_id: \"memo_backup\"");
    expect(markdown).toContain("![asset](Backup%20note.assets/asset.png)");
    expect(backup.memos[0].resources[0].archivePath).toBe("notes/Root/Child/Backup note.assets/asset.png");
  });

  test("keeps version 1 archives importable without prompt data", async () => {
    const legacyManifest = {
      format: "edgeever-zip",
      formatVersion: 1,
      schemaVersion: 1,
      edgeeverVersion: "1.13.3",
      buildId: "legacy-build",
      exportedAt: "2026-08-09T00:00:00.000Z",
      includesTrash: false,
      counts: { notebooks: 0, memos: 0, revisions: 0, resources: 0 },
    };
    const backup = await parseEdgeEverZip(new Blob([zipSync({
      "manifest.json": strToU8(JSON.stringify(legacyManifest)),
      "notebooks.json": strToU8("[]"),
    })]));

    expect(backup.manifest.formatVersion).toBe(1);
    expect(backup.prompts).toEqual([]);
  });

  test("inspects multi-gigabyte archives through their stream instead of buffering the ZIP", async () => {
    const manifest = {
      format: "edgeever-zip",
      formatVersion: 1,
      schemaVersion: 1,
      edgeeverVersion: "1.13.3",
      buildId: "large-stream-test",
      exportedAt: "2026-08-31T00:00:00.000Z",
      includesTrash: false,
      counts: { notebooks: 0, memos: 0, revisions: 0, resources: 0 },
    };
    const actualArchive = new Blob([zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "notebooks.json": strToU8("[]"),
    })]);
    let wholeArchiveBuffered = false;
    const largeStreamingArchive = {
      size: 2 * 1024 * 1024 * 1024,
      type: "application/zip",
      slice: actualArchive.slice.bind(actualArchive),
      stream: actualArchive.stream.bind(actualArchive),
      arrayBuffer: async () => {
        wholeArchiveBuffered = true;
        throw new Error("The whole archive must not be buffered");
      },
    } as Blob;

    const backup = await parseEdgeEverZip(largeStreamingArchive);

    expect(backup.manifest.buildId).toBe("large-stream-test");
    expect(backup.archive).toBe(largeStreamingArchive);
    expect(wholeArchiveBuffered).toBe(false);
  });

  test("restores notebooks before memos and binary resources", async () => {
    const calls: string[] = [];
    const { url: _url, ...resourceMetadata } = resource;
    const backupMemo: JsonBackupMemo = {
      memo,
      revisions: [],
      resources: [{ ...resourceMetadata, archivePath: "resources/res_backup/asset.png" }],
    };
    const backup = {
      manifest: {
        format: "edgeever-zip" as const,
        formatVersion: 2 as const,
        schemaVersion: 1,
        edgeeverVersion: "0.1.13",
        buildId: "test-build",
        exportedAt: "2026-07-14T00:00:00.000Z",
        includesTrash: false as const,
        counts: { notebooks: 1, memos: 1, revisions: 0, resources: 1, prompts: 1 },
      },
      notebooks: [{
        id: "nb_child",
        parentId: null,
        name: "Child",
        slug: null,
        icon: null,
        color: null,
        sortOrder: 0,
        createdAt: memo.createdAt,
        updatedAt: memo.updatedAt,
      }] satisfies JsonBackupNotebook[],
      memos: [backupMemo],
      prompts: [prompt],
      archive: new Blob([zipSync({ "resources/res_backup/asset.png": new Uint8Array([1, 2, 3]) })]),
    };

    await restoreEdgeEverZip(backup, {
      restoreNotebooks: async () => { calls.push("notebooks"); },
      restoreMemos: async () => { calls.push("memos"); },
      restorePrompts: async () => { calls.push("prompts"); },
      createResourceRestoreSink: async () => {
        let byteSize = 0;
        return {
          write: async (chunk) => { byteSize += chunk.byteLength; },
          close: async () => { calls.push(`resource:${byteSize}`); },
          abort: async () => {},
        };
      },
    });

    expect(calls).toEqual(["prompts", "notebooks", "memos", "resource:3"]);
  });

  test("refreshes the workspace after all imported data is restored", async () => {
    const calls: string[] = [];
    const backup = {
      manifest: {
        format: "edgeever-zip" as const,
        formatVersion: 1 as const,
        schemaVersion: 1,
        edgeeverVersion: "1.13.3",
        buildId: "test-build",
        exportedAt: "2026-08-09T00:00:00.000Z",
        includesTrash: false as const,
        counts: { notebooks: 1, memos: 1, revisions: 0, resources: 0 },
      },
      notebooks: [{
        id: "nb_child",
        parentId: null,
        name: "Child",
        slug: null,
        icon: null,
        color: null,
        sortOrder: 0,
        createdAt: memo.createdAt,
        updatedAt: memo.updatedAt,
      }] satisfies JsonBackupNotebook[],
      memos: [{ memo, revisions: [], resources: [] }] satisfies JsonBackupMemo[],
      prompts: [],
      archive: new Blob([zipSync({})]),
    };

    await restoreEdgeEverZipAndRefresh(
      backup,
      {
        restoreNotebooks: async () => { calls.push("notebooks"); },
        restoreMemos: async () => { calls.push("memos"); },
        restorePrompts: async () => { calls.push("prompts"); },
        createResourceRestoreSink: async () => ({
          write: async () => {},
          close: async () => { calls.push("resource"); },
          abort: async () => {},
        }),
      },
      async () => { calls.push("refresh"); },
    );

    expect(calls).toEqual(["notebooks", "memos", "refresh"]);
  });
});
