export const LOCAL_DATABASE_OPERATION_TIMEOUT_MS = 8_000;
const LOCAL_DATABASE_REOPEN_TIMEOUT_MS = 4_000;

class LocalDatabaseOperationTimeoutError extends Error {
  constructor() {
    super("Browser local storage operation timed out");
    this.name = "LocalDatabaseOperationTimeoutError";
  }
}

export class LocalDatabaseUnavailableError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Browser local storage is not responding");
    this.name = "LocalDatabaseUnavailableError";
    this.cause = cause;
  }
}

const withTimeout = <T>(operation: Promise<T>, timeoutMs: number) => new Promise<T>((resolve, reject) => {
  const timer = globalThis.setTimeout(() => reject(new LocalDatabaseOperationTimeoutError()), timeoutMs);
  operation.then(
    (value) => {
      globalThis.clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      globalThis.clearTimeout(timer);
      reject(error);
    },
  );
});

const isRecoverableLocalDatabaseError = (error: unknown) =>
  error instanceof LocalDatabaseOperationTimeoutError ||
  (error instanceof Error && ["AbortError", "DatabaseClosedError", "InvalidStateError", "UnknownError"].includes(error.name));

export const reopenLocalDatabase = async () => {
  const { localDb } = await import("@/lib/local-db");
  localDb.close({ disableAutoOpen: false });
  await localDb.open();
};

export const runLocalDatabaseOperationWithRecovery = async <T>(
  operation: () => Promise<T>,
  {
    reopen = reopenLocalDatabase,
    timeoutMs = LOCAL_DATABASE_OPERATION_TIMEOUT_MS,
  }: {
    reopen?: () => Promise<void>;
    timeoutMs?: number;
  } = {},
) => {
  try {
    return await withTimeout(operation(), timeoutMs);
  } catch (error) {
    if (!isRecoverableLocalDatabaseError(error)) throw error;
  }

  try {
    await withTimeout(reopen(), Math.min(timeoutMs, LOCAL_DATABASE_REOPEN_TIMEOUT_MS));
    return await withTimeout(operation(), timeoutMs);
  } catch (error) {
    throw new LocalDatabaseUnavailableError(error);
  }
};
