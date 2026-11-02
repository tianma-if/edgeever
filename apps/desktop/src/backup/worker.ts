import { backupWorkerRuntime } from "./worker-runtime";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createEdgeEverClient } from "../../../../packages/client/src/index";
import { createEdgeEverZipStream, parseEdgeEverZip, restoreEdgeEverZip, validateBackupRelationships, type JsonBackupSource } from "../../../../packages/shared/src/backup-archive";
import type { JsonBackupManifest } from "../../../../packages/shared/src/backup";
import type { AuthSession, Notebook, Resource, AiPromptTemplate } from "../../../../packages/shared/src/types";
import { encryptArchive, decryptArchive } from "./encrypted-archive.mjs";

type Context = { baseUrl: string; accountId: string | null; token: string; locale?: string };
type Input = { operation: "export" | "import" | "verify"; context: Context; path: string; password?: string; stagingDirectory?: string; previousState?: SourceState; version?: { edgeeverVersion: string; buildId: string } };
type State = { protocolVersion: number; userId: string | null; workspaceId: string; identity: string; backupRevision: string; counts: Required<JsonBackupManifest["counts"]> };
type SourceState = Pick<State, "identity" | "workspaceId" | "backupRevision">;
const { data, port: parentPort, request: networkFetch } = await backupWorkerRuntime();
const input = data as Input;
const abort = new AbortController();
const signal = abort.signal;
let confirm: (() => void) | undefined;
parentPort?.on("message", (message) => {
  if (message.type === "cancel") abort.abort(new DOMException("Cancelled", "AbortError"));
  if (message.type === "confirm") confirm?.();
});
const send = (type: string, result: unknown) => parentPort?.postMessage({ type, result });
const fail = (code: string, message: string, status?: number): never => { throw Object.assign(new Error(message), { code, ...(status === undefined ? {} : { status }) }); };
const networkCauseCodes = (error: unknown): string[] => {
  const codes = new Set<string>();
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length && seen.size < 16) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const detail = value as { code?: unknown; cause?: unknown; errors?: unknown };
    // Do not log arbitrary messages, addresses, stacks or request credentials.
    if (typeof detail.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(detail.code)) codes.add(detail.code);
    if (detail.cause) pending.push(detail.cause);
    if (Array.isArray(detail.errors)) pending.push(...detail.errors.slice(0, 8));
  }
  return [...codes].slice(0, 8);
};
const fetchWithDiagnostics: typeof fetch = async (url, init) => {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await networkFetch(url, init);
  } catch (error) {
    if (!signal.aborted) send("request-error", {
      method: init?.method ?? "GET",
      path: new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname,
      code: "backup_network_failed",
      message: "Backup network request failed.",
      causeCodes: networkCauseCodes(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
  if (!response.ok) {
    const body = await response.clone().json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
    send("request-error", {
      method: init?.method ?? "GET",
      path: new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname,
      status: response.status,
      code: typeof body?.error?.code === "string" ? body.error.code : "backup_request_failed",
      message: typeof body?.error?.message === "string" ? body.error.message : response.statusText,
    });
  }
  return response;
};
const request = async <T>(context: Context, path: string): Promise<T> => {
  const response = await fetchWithDiagnostics(`${context.baseUrl}${path}`, { signal, headers: { Authorization: `Bearer ${context.token}`, "Accept-Language": context.locale ?? "en-US" }, credentials: "omit" });
  if (!response.ok) {
    if (response.status === 404 && path === "/api/v1/backups/state") fail("backup_server_upgrade_required", "Update the EdgeEver server to enable consistent backups.", response.status);
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    fail(body?.error?.code ?? "backup_request_failed", body?.error?.message ?? `Backup request failed (${response.status}).`, response.status);
  }
  return response.json() as Promise<T>;
};
const verifyAccount = async () => {
  const session = await request<AuthSession>(input.context, "/api/v1/auth/session");
  if (!session.authenticated || session.user?.id !== (input.context.accountId ?? "local")) fail("backup_account_changed", "The signed-in account changed. Sign in again before continuing.");
  return session;
};
const readState = async () => {
  const state = await request<State>(input.context, "/api/v1/backups/state");
  if (state.protocolVersion !== 1) fail("backup_server_upgrade_required", "The server backup protocol is not supported.");
  if (state.userId !== input.context.accountId) {
    const local = state.userId === null && input.context.accountId === "local" && !(await verifyAccount()).authRequired;
    if (!local) fail("backup_account_changed", "The signed-in backup account changed.");
  }
  return state;
};
// A failed pipeline destroys the write stream, which closes the shared fd despite
// autoClose: false. Ignore that close so the original failure reaches the caller.
const closeOutput = (handle: import("node:fs/promises").FileHandle) => handle.close().catch((error) => { if (error?.code !== "EBADF") throw error; });
const digestFactory = () => {
  const hash = createHash("sha256");
  return { update: (chunk: Uint8Array) => { hash.update(chunk); }, digest: () => hash.digest("hex") };
};

const runExport = async () => {
  const state = await readState();
  const sourceState: SourceState = { identity: state.identity, workspaceId: state.workspaceId, backupRevision: state.backupRevision };
  if (input.previousState && Object.keys(sourceState).every((key) => sourceState[key as keyof SourceState] === input.previousState![key as keyof SourceState])) return { skipped: true, sourceState };
  const page = <T>(kind: string, after: string) => request<T>(input.context, `/api/v1/backups/data?${new URLSearchParams({ kind, after, identity: state.identity, revision: state.backupRevision })}`);
  const collect = async <T>(kind: "notebooks" | "prompts") => {
    const values: T[] = [];
    let after = "";
    while (true) {
      const result = await page<Record<string, T[]> & { nextCursor: string | null }>(kind, after);
      values.push(...result[kind]);
      if (result.nextCursor === null) return values;
      after = result.nextCursor;
    }
  };
  const resourceByUrl = new Map<string, Resource>();
  let cursor = "";
  let manifest: JsonBackupManifest | undefined;
  const source: JsonBackupSource = {
    signal, resourceOrigin: input.context.baseUrl,
    listNotebooks: async () => ({ notebooks: await collect<Notebook>("notebooks") }),
    listPrompts: async () => ({ prompts: await collect<AiPromptTemplate>("prompts") }),
    getPage: async (offset) => {
      const result = await page<Awaited<ReturnType<JsonBackupSource["getPage"]>> & { nextCursor: string | null }>("memos", cursor);
      resourceByUrl.clear();
      for (const resource of result.resources) resourceByUrl.set(resource.url, resource);
      if (result.nextCursor !== null) cursor = result.nextCursor;
      return { ...result, totalCount: state.counts.memos, nextOffset: result.nextCursor === null ? null : offset + result.memos.length };
    },
    getResourceResponse: async (url) => {
      const resource = resourceByUrl.get(url) ?? fail("incompleteResources", "A backup resource is missing from its page.");
      const response = await fetchWithDiagnostics(`${input.context.baseUrl}/api/v1/resources/${encodeURIComponent(resource.id)}/blob`, { signal, headers: { Authorization: `Bearer ${input.context.token}` }, credentials: "omit" });
      if (!response.ok) fail("incompleteResources", `Could not download an attachment (${response.status}).`);
      const body = response.body ?? fail("incompleteResources", "An attachment has no body.");
      const digest = digestFactory();
      const expectedDigest = resource.sha256;
      let bytes = 0;
      return new Response(body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > resource.byteSize) fail("incompleteResources", "An attachment exceeds its recorded size.");
          digest.update(chunk); controller.enqueue(chunk);
        },
        flush() {
          const hash = digest.digest();
          if (bytes !== resource.byteSize || (expectedDigest !== null && hash !== expectedDigest)) fail("incompleteResources", "An attachment is incomplete or damaged.");
          resource.sha256 = hash;
        },
      })), { headers: { "Content-Type": resource.mimeType ?? "application/octet-stream" } });
    },
    onManifest(value) {
      for (const key of Object.keys(state.counts) as Array<keyof State["counts"]>) {
        if ((value.counts[key] ?? 0) !== state.counts[key]) fail("incompleteData", "The archive does not include every source record.");
      }
      manifest = value;
    },
  };
  const output = await open(input.path, "wx", 0o600);
  try {
    const zip = await createEdgeEverZipStream(source, input.version!, (progress) => send("progress", { stage: "exporting", ...progress }));
    const stream = Readable.fromWeb(zip as import("node:stream/web").ReadableStream<Uint8Array>);
    const contents = input.password !== undefined ? Readable.from(encryptArchive(stream, input.password, { signal })) : stream;
    await pipeline(contents, createWriteStream(input.path, { fd: output.fd, autoClose: false }), { signal });
    const final = await readState();
    if (final.identity !== state.identity || final.workspaceId !== state.workspaceId || final.backupRevision !== state.backupRevision) fail("backup_source_changed", "The source changed during backup. Try again when it is idle.");
    if (!manifest) fail("incompleteData", "The archive did not finish.");
    await output.sync();
    const size = (await output.stat()).size;
    return { manifest, size, sourceState };
  } finally { await closeOutput(output); }
};

const diskArchive = async (path: string) => {
  const handle = await open(path, "r");
  const size = (await handle.stat()).size;
  const blob = {
    size, type: "application/zip",
    slice(start = 0, end = size) {
      return {
        async arrayBuffer() {
          signal.throwIfAborted();
          const bytes = new Uint8Array(Math.max(0, Math.min(end, size) - start));
          let received = 0;
          while (received < bytes.length) {
            const { bytesRead } = await handle.read(bytes, received, bytes.length - received, start + received);
            if (!bytesRead) fail("invalidZip", "The archive was truncated.");
            received += bytesRead;
          }
          return bytes.buffer;
        },
      };
    },
  } as Blob;
  return { blob, close: () => handle.close() };
};

const runImport = async () => {
  const staged = join(input.stagingDirectory!, "verified.zip");
  let archive: Awaited<ReturnType<typeof diskArchive>> | undefined;
  try {
    const handle = await open(input.path, "r"); const magic = Buffer.alloc(4);
    try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
    if (magic.toString("ascii") === "EDGB") {
      send("progress", { stage: "decrypting", completed: 0, total: 0 });
      await decryptArchive(input.path, staged, input.password, { signal });
    } else {
      const output = await open(staged, "wx", 0o600);
      try { await pipeline(createReadStream(input.path), createWriteStream(staged, { fd: output.fd, autoClose: false }), { signal }); }
      finally { await closeOutput(output); }
    }
    archive = await diskArchive(staged);
    const backup = await parseEdgeEverZip(archive.blob, (percentage) => send("progress", { stage: "checking", completed: percentage, total: 100 }), digestFactory);
    validateBackupRelationships(backup);
    signal.throwIfAborted();
    if (input.operation === "verify") return { manifest: backup.manifest };
    await verifyAccount();
    const confirmation = new Promise<void>((resolve, reject) => {
      confirm = resolve;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    send("ready", { manifest: backup.manifest });
    await confirmation;
    signal.throwIfAborted();
    await verifyAccount();
    const client = createEdgeEverClient({
      baseUrl: input.context.baseUrl, token: input.context.token,
      fetch: async (url, init) => {
        // The client builds bounded multipart Blobs (8 MiB). Use byte bodies in
        // Node so fetch does not retain native Blob stores across the archive.
        const body = init?.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : init?.body;
        return fetchWithDiagnostics(url, { ...init, body, credentials: "omit", signal: AbortSignal.any(init?.signal ? [signal, init.signal] : [signal]) });
      },
    });
    await restoreEdgeEverZip(backup, {
      restoreNotebooks: client.restoreJsonNotebooks, restoreMemos: client.restoreJsonMemos,
      restorePrompts: client.restoreJsonAiPrompts, createResourceRestoreSink: client.createJsonResourceRestoreSink,
    }, (progress) => send("progress", { stage: "restoring", ...progress }));
    return { manifest: backup.manifest };
  } finally { await archive?.close(); await rm(staged, { force: true }); }
};

if (parentPort) {
  (input.operation === "export" ? runExport() : runImport()).then((result) => send("done", result)).catch((error) => {
    parentPort?.postMessage({ type: "error", error: { code: signal.aborted ? "backup_cancelled" : error.code ?? (error.status ? "backup_request_failed" : "backup_failed"), message: signal.aborted ? "Cancelled" : error.message, ...(Number.isInteger(error.status) ? { status: error.status } : {}) } });
  }).finally(() => { abort.abort(); parentPort?.close(); });
}
