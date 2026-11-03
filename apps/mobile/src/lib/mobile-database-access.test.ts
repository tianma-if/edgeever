import { expect, test } from "bun:test";
import type { SQLiteDatabase } from "expo-sqlite";
import { serializeMobileDatabaseWrites } from "./mobile-database-access";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const fixture = () => {
  const entered = deferred();
  const release = deferred();
  let locked = false;
  const writes: string[] = [];
  const raw = {
    runAsync: async (sql: string) => {
      if (locked) throw new Error("NativeStatement.finalizeAsync: database is locked");
      writes.push(sql);
      return { changes: 1, lastInsertRowId: 1 };
    },
    getFirstAsync: async () => ({ value: "previous snapshot" }),
    getAllAsync: async () => [],
    withExclusiveTransactionAsync: async (task: (tx: SQLiteDatabase) => Promise<void>) => {
      if (locked) throw new Error("database is locked");
      locked = true;
      entered.resolve();
      await release.promise;
      try {
        // Raw transaction statements must bypass the outer queue.
        await task({ runAsync: async (sql: string) => { writes.push(sql); } } as SQLiteDatabase);
      } finally {
        locked = false;
      }
    },
  };
  return {
    db: serializeMobileDatabaseWrites(raw as unknown as SQLiteDatabase),
    entered, release, writes,
  };
};

test("share materialization and other scopes wait for the whole sync transaction", async () => {
  const { db, entered, release, writes } = fixture();
  const sync = db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("sync memo");
    await tx.runAsync("sync cursor");
  });
  await entered.promise;
  const share = db.runAsync("shared image memo");
  const otherAccount = db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("other account sync");
  });
  // WAL readers remain available while the writer is busy.
  expect(await db.getFirstAsync("read memo")).toEqual({ value: "previous snapshot" });
  expect(writes).toEqual([]);
  release.resolve();
  await Promise.all([sync, share, otherAccount]);
  expect(writes).toEqual(["sync memo", "sync cursor", "shared image memo", "other account sync"]);
});

test("a rejected transaction does not prevent subsequent attachment saves", async () => {
  const { db, release, writes } = fixture();
  release.resolve();
  const failed = db.withExclusiveTransactionAsync(async () => { throw new Error("rollback"); });
  const save = db.runAsync("attachment memo");
  await expect(failed).rejects.toThrow("rollback");
  await save;
  expect(writes).toEqual(["attachment memo"]);
});

test("a failed standalone write reaches the caller and later writes still run", async () => {
  const error = new Error("disk full");
  let calls = 0;
  const db = serializeMobileDatabaseWrites({
    runAsync: async () => {
      if (++calls === 1) throw error;
      return { changes: 1, lastInsertRowId: 1 };
    },
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    withExclusiveTransactionAsync: async () => {},
  } as unknown as SQLiteDatabase);
  const failed = db.runAsync("first save");
  const next = db.runAsync("next save");
  await expect(failed).rejects.toBe(error);
  expect(await next).toEqual({ changes: 1, lastInsertRowId: 1 });
  expect(calls).toBe(2);
});
