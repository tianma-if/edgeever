import { beforeEach, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
const memos = new Map<string, { id: string; isDeleted?: boolean }>();

mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    removeItem: async (key: string) => {
      storage.delete(key);
    },
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  },
}));

mock.module("./local-mirror", () => ({
  deleteLocalMemo: async (_scope: string, memoId: string) => {
    memos.delete(memoId);
  },
  resolveLocalMemo: async (_scope: string, memoId: string) => {
    if (memos.has(memoId)) {
      return memos.get(memoId);
    }
    if (memoId.startsWith("local:")) {
      const mapped = [...memos.values()].find((memo) => memo.id === "memo-mapped");
      return mapped ?? null;
    }
    return null;
  },
  softDeleteLocalMemo: async (_scope: string, memoId: string) => {
    const memo = memos.get(memoId);
    if (!memo) return false;
    memos.set(memoId, { ...memo, isDeleted: true });
    return true;
  },
  upsertLocalMemo: async (_scope: string, memo: { id: string; isDeleted?: boolean }) => {
    memos.set(memo.id, memo);
  },
}));

const {
  queueMobileMemoCreate,
  listMobileSyncQueueItems,
} = await import("./sync-queue");
const { deleteMobileMemos } = await import("./mobile-memo-delete");

beforeEach(() => {
  storage.clear();
  memos.clear();
});

test("deletes offline-created notes without calling the API", async () => {
  const scope = "https://one.example";
  memos.set("local:empty", { id: "local:empty" });
  await queueMobileMemoCreate(scope, {
    memoId: "local:empty",
    title: "Untitled",
    contentMarkdown: "",
    notebookId: "notebook-1",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const deletedRemote: string[] = [];
  const result = await deleteMobileMemos({
    client: {
      deleteMemo: async (memoId: string) => {
        deletedRemote.push(memoId);
        return { ok: true as const };
      },
      deleteMemos: async ({ memoIds }: { memoIds: string[] }) => {
        deletedRemote.push(...memoIds);
        return { ok: true as const, deleted: memoIds.length };
      },
    } as never,
    dataScope: scope,
    syncQueueScope: scope,
    memoIds: ["local:empty"],
    permanent: false,
  });

  expect(result).toEqual({ deleted: 1, localOnly: 1, remote: 0 });
  expect(deletedRemote).toEqual([]);
  expect(memos.has("local:empty")).toBe(false);
  expect(await listMobileSyncQueueItems(scope)).toHaveLength(0);
});

test("soft-deletes synced notes through the API and local mirror", async () => {
  const scope = "https://one.example";
  memos.set("memo-1", { id: "memo-1" });
  memos.set("memo-2", { id: "memo-2" });

  const deletedBatches: string[][] = [];
  const result = await deleteMobileMemos({
    client: {
      deleteMemo: async () => {
        throw new Error("should use batch delete for multiple ids");
      },
      deleteMemos: async ({ memoIds }: { memoIds: string[] }) => {
        deletedBatches.push(memoIds);
        return { ok: true as const, deleted: memoIds.length };
      },
    } as never,
    dataScope: scope,
    syncQueueScope: scope,
    memoIds: ["memo-1", "memo-2"],
    permanent: false,
  });

  expect(result).toEqual({ deleted: 2, localOnly: 0, remote: 2 });
  expect(deletedBatches).toEqual([["memo-1", "memo-2"]]);
  expect(memos.get("memo-1")?.isDeleted).toBe(true);
  expect(memos.get("memo-2")?.isDeleted).toBe(true);
});

test("resolves remapped temporary ids to remote deletes", async () => {
  const scope = "https://one.example";
  memos.set("memo-mapped", { id: "memo-mapped" });

  const deletedMemoIds: string[] = [];
  const result = await deleteMobileMemos({
    client: {
      deleteMemo: async (memoId: string) => {
        deletedMemoIds.push(memoId);
        return { ok: true as const };
      },
      deleteMemos: async () => {
        throw new Error("should use single delete");
      },
    } as never,
    dataScope: scope,
    syncQueueScope: scope,
    memoIds: ["local:stale"],
    permanent: false,
  });

  expect(result).toEqual({ deleted: 1, localOnly: 0, remote: 1 });
  expect(deletedMemoIds).toEqual(["memo-mapped"]);
  expect(memos.get("memo-mapped")?.isDeleted).toBe(true);
});

test("updates the local mirror before the remote delete completes", async () => {
  const scope = "https://one.example";
  memos.set("memo-1", { id: "memo-1" });
  let releaseDelete: (() => void) | undefined;
  const remoteDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });

  const deletion = deleteMobileMemos({
    client: {
      deleteMemo: async () => {
        await remoteDelete;
        return { ok: true as const };
      },
      deleteMemos: async () => {
        throw new Error("should use single delete");
      },
    } as never,
    dataScope: scope,
    syncQueueScope: scope,
    memoIds: ["memo-1"],
    permanent: false,
  });

  await Bun.sleep(0);
  expect(memos.get("memo-1")?.isDeleted).toBe(true);
  releaseDelete?.();
  await deletion;
});

test("rolls the local mirror back when the remote delete fails", async () => {
  const scope = "https://one.example";
  memos.set("memo-1", { id: "memo-1" });

  await expect(deleteMobileMemos({
    client: {
      deleteMemo: async () => {
        throw new Error("network unavailable");
      },
      deleteMemos: async () => {
        throw new Error("should use single delete");
      },
    } as never,
    dataScope: scope,
    syncQueueScope: scope,
    memoIds: ["memo-1"],
    permanent: false,
  })).rejects.toThrow("network unavailable");

  expect(memos.get("memo-1")).toEqual({ id: "memo-1" });
});
