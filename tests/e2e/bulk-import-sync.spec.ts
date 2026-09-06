import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type SyncMetaRow = { key?: string; value?: string };

const readLocalSyncCursor = (page: Page) => page.evaluate(async () => {
  const modulePath = "/src/lib/local-db.ts";
  const { localDb } = await import(/* @vite-ignore */ modulePath) as {
    localDb: { syncMeta: { toArray: () => Promise<SyncMetaRow[]> } };
  };
  const cursor = (await localDb.syncMeta.toArray()).find((row) => row.key === "cursor")?.value;
  return cursor === undefined ? null : Number(cursor);
});

const countLocalMemosWithMarker = (page: Page, marker: string) => page.evaluate(async (searchMarker) => {
  const modulePath = "/src/lib/local-db.ts";
  const { localDb } = await import(/* @vite-ignore */ modulePath) as {
    localDb: { memos: { toArray: () => Promise<Array<{ title?: string | null }>> } };
  };
  return (await localDb.memos.toArray()).filter((memo) => memo.title?.includes(searchMarker)).length;
}, marker);

const importMemoBatch = async (
  request: APIRequestContext,
  input: { token: string; source: string; notebookId: string; marker: string; offset: number; count: number },
) => {
  const response = await request.post("/mcp", {
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${input.token}`,
    },
    data: {
      jsonrpc: "2.0",
      id: input.offset + 1,
      method: "tools/call",
      params: {
        name: "import_memos",
        arguments: {
          source: input.source,
          notebookId: input.notebookId,
          items: Array.from({ length: input.count }, (_, index) => {
            const itemNumber = input.offset + index;
            return {
              externalId: `${input.source}-${itemNumber}`,
              title: `${input.marker} ${itemNumber}`,
              contentMarkdown: `Bulk incremental sync fixture ${input.marker} ${itemNumber}`,
            };
          }),
        },
      },
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json() as { error?: unknown; result?: { isError?: boolean } };
  expect(body.error).toBeUndefined();
  expect(body.result?.isError).toBe(false);
};

const listMemoIdsWithMarker = async (request: APIRequestContext, marker: string) => {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const search = new URLSearchParams({ q: marker, limit: "100" });
    if (cursor) search.set("cursor", cursor);
    const response = await request.get(`/api/v1/memos?${search.toString()}`);
    expect(response.ok()).toBe(true);
    const page = await response.json() as {
      memos: Array<{ id: string }>;
      nextCursor: string | null;
    };
    ids.push(...page.memos.map((memo) => memo.id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
};

const deleteMemoFixtures = async (request: APIRequestContext, memoIds: string[]) => {
  for (let offset = 0; offset < memoIds.length; offset += 50) {
    const memoIdBatch = memoIds.slice(offset, offset + 50);
    const trashResponse = await request.post("/api/v1/memos/batch/delete", {
      data: { memoIds: memoIdBatch },
    });
    expect(trashResponse.ok()).toBe(true);
    const deleteResponse = await request.post("/api/v1/memos/batch/delete", {
      data: { memoIds: memoIdBatch, permanent: true },
    });
    expect(deleteResponse.ok()).toBe(true);
  }
};

test("an existing browser mirror catches up after an import larger than one sync page", async ({ page }) => {
  test.setTimeout(120_000);
  const importedMemoCount = 205;
  const marker = `bulk-sync-${Date.now()}`;
  const source = `e2e-${marker}`;
  let createdMemoIds: string[] = [];
  let apiTokenId: string | null = null;

  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "正在同步笔记", exact: true })).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => readLocalSyncCursor(page), { timeout: 20_000 }).not.toBeNull();
    const cursorBeforeImport = await readLocalSyncCursor(page);
    expect(cursorBeforeImport).not.toBeNull();

    const tokenResponse = await page.request.post("/api/v1/api-tokens", {
      data: {
        name: `E2E bulk sync ${Date.now()}`,
        scopes: ["read:notebooks", "read:memos", "write:memos"],
      },
    });
    expect(tokenResponse.status()).toBe(201);
    const tokenBody = await tokenResponse.json() as { token: string; apiToken: { id: string } };
    apiTokenId = tokenBody.apiToken.id;

    // Stop the workspace lifecycle so all imported changes accumulate after
    // the browser's saved cursor, matching an existing client that was closed
    // while a large MCP migration ran.
    await page.goto("about:blank");

    for (let offset = 0; offset < importedMemoCount; offset += 25) {
      await importMemoBatch(page.request, {
        token: tokenBody.token,
        source,
        notebookId,
        marker,
        offset,
        count: Math.min(25, importedMemoCount - offset),
      });
    }
    createdMemoIds = await listMemoIdsWithMarker(page.request, marker);
    expect(createdMemoIds).toHaveLength(importedMemoCount);

    const firstIncrementalPage = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/sync/changes" &&
        url.searchParams.get("cursor") === String(cursorBeforeImport) &&
        url.searchParams.get("limit") === "200";
    });
    await page.goto("/");

    const firstPageResponse = await firstIncrementalPage;
    expect(firstPageResponse.ok()).toBe(true);
    const firstPageBody = await firstPageResponse.json() as { changes: unknown[]; hasMore: boolean };
    expect(firstPageBody.changes).toHaveLength(200);
    expect(firstPageBody.hasMore).toBe(true);

    await expect.poll(
      () => countLocalMemosWithMarker(page, marker),
      { timeout: 30_000 },
    ).toBe(importedMemoCount);

    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(marker);
    await expect(page.getByText(`${importedMemoCount} 条结果`, { exact: true })).toBeVisible();
  } finally {
    if (createdMemoIds.length === 0) {
      createdMemoIds = await listMemoIdsWithMarker(page.request, marker);
    }
    await deleteMemoFixtures(page.request, createdMemoIds);
    if (apiTokenId) {
      const tokenDeleteResponse = await page.request.delete(`/api/v1/api-tokens/${apiTokenId}`);
      expect(tokenDeleteResponse.ok()).toBe(true);
    }
  }
});
