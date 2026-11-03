import type { SQLiteDatabase } from "expo-sqlite";

type MobileDatabase = Pick<SQLiteDatabase, "getAllAsync" | "getFirstAsync" | "runAsync" | "withExclusiveTransactionAsync">;

/** One writer per database, shared by every account scope. Never queue network work. */
export const serializeMobileDatabaseWrites = (db: MobileDatabase): MobileDatabase => {
  let pending: Promise<unknown> = Promise.resolve();
  const write = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    // A rejected write must reach its caller without poisoning subsequent saves.
    pending = result.catch(() => undefined);
    return result;
  };

  return {
    getAllAsync: db.getAllAsync.bind(db),
    getFirstAsync: db.getFirstAsync.bind(db),
    runAsync: ((...args: Parameters<SQLiteDatabase["runAsync"]>) =>
      write(() => db.runAsync(...args))) as SQLiteDatabase["runAsync"],
    // Transaction statements use the raw transaction handle. Queuing those
    // individually would deadlock behind their own enclosing transaction.
    withExclusiveTransactionAsync: (task) => write(() => db.withExclusiveTransactionAsync(task)),
  };
};
