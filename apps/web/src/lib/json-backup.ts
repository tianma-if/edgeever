import { createEdgeEverZipStream } from "@edgeever/shared/backup-archive";
import type { JsonBackupSource, EdgeEverZipProgress } from "@edgeever/shared/backup-archive";
import type { BackupState, BackupTablePage, JsonBackupAiPrompt, JsonBackupRevision, Notebook } from "@edgeever/shared";
import { api, ApiRequestError } from "./api";
import { createClientUuid } from "./client-id";
export * from "@edgeever/shared/backup-archive";

export const createWorkspaceBackupSource = (): JsonBackupSource => {
  let pending: Promise<BackupState | null> | undefined;
  const readState = () => pending ??= api.getJsonBackupState().then((state) => state.tableChunks ? state : null).catch((error) => {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  });
  const read = async <T,>(query: Record<string, string>) => api.getJsonBackupData<T>((await readState())!, query);
  const catalog = async <T,>(kind: "notebooks" | "prompts") => {
    const items: T[] = [];
    let after: string | null = "";
    while (after !== null) {
      const page: Record<string, T[]> & { nextCursor: string | null } = await read({ kind, after });
      items.push(...page[kind]);
      after = page.nextCursor;
    }
    return items;
  };
  return {
    listNotebooks: async () => await readState() ? { notebooks: await catalog<Notebook>("notebooks") } : api.listNotebooks(),
    listPrompts: async () => await readState() ? { prompts: await catalog<JsonBackupAiPrompt>("prompts") } : api.listAiPrompts(),
    getResourceResponse: api.getResourceResponse,
    getPage: async (offset, limit, cursor) => {
      const state = await readState();
      if (!state) return api.getJsonBackupPage(offset, limit, cursor);
      const page = await api.getJsonBackupData<Awaited<ReturnType<JsonBackupSource["getPage"]>>>(state, {
        kind: "memos", after: cursor ?? "", tableChunks: "1",
      });
      return { ...page, totalCount: state.counts.memos, tableChunks: true, nextOffset: page.nextCursor == null ? null : offset + page.memos.length };
    },
    readRevisions: (memoId, after) => read<{ revisions: JsonBackupRevision[]; nextCursor: string | null }>({ kind: "revisions", memoId, after }),
    readTable: (memoId, revisionId, after) => read<BackupTablePage>({ kind: "table", memoId, after, ...(revisionId === null ? {} : { revisionId }) }),
    verifyVersion: async () => { if (await readState()) await read({ kind: "check" }); },
  };
};

const ZIP_MIME_TYPE = "application/zip";
const MAX_BUFFERED_ZIP_BYTES = 128 * 1024 * 1024;

export class EdgeEverZipMemoryLimitError extends Error {
  constructor() {
    super("This backup is too large for an in-memory export. Use a browser that supports streaming file saves.");
    this.name = "EdgeEverZipMemoryLimitError";
  }
}

const bufferedZipBlob = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BUFFERED_ZIP_BYTES) {
        await reader.cancel();
        throw new EdgeEverZipMemoryLimitError();
      }
      const copy = new Uint8Array(next.value.byteLength);
      copy.set(next.value);
      chunks.push(copy.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: ZIP_MIME_TYPE });
};

type StreamingFileHandle = {
  createWritable: () => Promise<WritableStream<Uint8Array>>;
  getFile?: () => Promise<File>;
};

export const saveEdgeEverZip = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void,
) => {
  const filename = `edgeever-export-${new Date().toISOString().slice(0, 10)}.zip`;
  const savePicker = (window as Window & {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<StreamingFileHandle>;
  }).showSaveFilePicker;
  if (savePicker) {
    const handle = await savePicker.call(window, { suggestedName: filename });
    const stream = await createEdgeEverZipStream(source, version, onProgress);
    await stream.pipeTo(await handle.createWritable());
    return { filename, streamed: true as const };
  }

  const stream = await createEdgeEverZipStream(source, version, onProgress);
  downloadEdgeEverZip(await bufferedZipBlob(stream), filename);
  return { filename, streamed: false as const };
};

export const createEdgeEverZipTemporaryFile = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void,
) => {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<{
      getFileHandle: (name: string, options: { create: true }) => Promise<StreamingFileHandle>;
      removeEntry: (name: string) => Promise<void>;
    }>;
  };
  if (!storage.getDirectory) {
    const stream = await createEdgeEverZipStream(source, version, onProgress);
    return { file: await bufferedZipBlob(stream), cleanup: async () => {} };
  }

  const root = await storage.getDirectory();
  const name = `edgeever-backup-${createClientUuid()}.zip`;
  const handle = await root.getFileHandle(name, { create: true });
  try {
    const stream = await createEdgeEverZipStream(source, version, onProgress);
    await stream.pipeTo(await handle.createWritable());
    if (!handle.getFile) throw new Error("The temporary backup file is unavailable");
    return {
      file: await handle.getFile(),
      cleanup: () => root.removeEntry(name).catch(() => {}),
    };
  } catch (error) {
    await root.removeEntry(name).catch(() => {});
    throw error;
  }
};

export const downloadEdgeEverZip = (
  blob: Blob,
  filename = `edgeever-export-${new Date().toISOString().slice(0, 10)}.zip`,
) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
