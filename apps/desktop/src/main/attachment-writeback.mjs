import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { lstat, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { restrictFile } from "./file-permissions.mjs";
import { isSafeResourceId, resourceIdFromRequest } from "./resource-url.mjs";

export const WRITEBACK_METADATA = ".edgeever-writeback.json";
const PENDING_BYTES = ".edgeever-writeback.pending";
const QUIET_MS = 1500;
const RETRY_MS = 30_000;
// The existing PUT /resources/:id/blob contract, not a new opening limit.
const MAX_REPLACEMENT_BYTES = 100 * 1024 * 1024;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const signature = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const failure = (code, retryable = false) => Object.assign(new Error(code), { code, retryable });

const hashFile = async path => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

export const writeAttachmentFile = async (path, bytes) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    await restrictFile(temporary);
    await rename(temporary, path);
  } finally {
    await file.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
};

const readSnapshot = async (path, expectedSignature) => {
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.size === 0 || (expectedSignature && signature(before) !== expectedSignature)) return null;
    if (before.size > MAX_REPLACEMENT_BYTES) throw failure("upload_too_large");
    const file = await open(path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    try {
      if (signature(await file.stat()) !== signature(before)) return null;
      const bytes = await file.readFile();
      const after = await lstat(path);
      if (!after.isFile() || signature(after) !== signature(before)
        || signature(await file.stat()) !== signature(before) || bytes.length !== before.size) return null;
      return { bytes, hash: digest(bytes), signature: signature(before) };
    } finally { await file.close(); }
  } catch (error) {
    // Office can move/lock an observed external path between any two calls.
    // Internal snapshot locks keep their error code for transient retries.
    if (expectedSignature && ["ENOENT", "EACCES", "EBUSY", "EPERM"].includes(error.code)) return null;
    throw error;
  }
};

const validRecord = record => {
  if (!record || !isHash(record.baseHash) || !record.localFilename || basename(record.localFilename) !== record.localFilename
    || [".", "..", WRITEBACK_METADATA, PENDING_BYTES].includes(record.localFilename) || /[\\/]/.test(record.localFilename) || typeof record.filename !== "string" || record.filename.length > 1024
    || typeof record.mimeType !== "string" || (record.pendingHash && !isHash(record.pendingHash))) return false;
  try {
    const url = new URL(record.url);
    return !url.username && !url.password && !url.port && !url.search && !url.hash
      && (url.protocol === "edgeever-resource:" && url.hostname === "resource" && isSafeResourceId(decodeURIComponent(url.pathname.slice(1)))
        || url.protocol === "edgeever-staged:" && ["", "/"].includes(url.pathname) && isSafeResourceId(url.hostname));
  } catch { return false; }
};

// Old read-only copies keep their retention policy. Managed copies are only
// removable when the original path still contains the acknowledged bytes.
export const canRemoveOpenedAttachment = async folder => {
  let record;
  try { record = JSON.parse(await readFile(join(folder, WRITEBACK_METADATA), "utf8")); }
  catch (error) { return error.code === "ENOENT"; }
  if (!validRecord(record) || record.pendingHash) return false;
  const path = join(folder, record.localFilename);
  const info = await lstat(path).catch(() => null);
  return Boolean(info?.isFile() && await hashFile(path) === record.baseHash);
};

/** The request callback supplies the already-authorized, scope-bound transport. */
export const replaceAttachmentResource = async (request, input) => {
  input.assertCurrent();
  const capability = await request("/resources/writeback-capabilities", { method: "GET", cache: "no-store", signal: input.signal }, input.assertCurrent);
  input.assertCurrent();
  if (!capability.ok) {
    if ([404, 405].includes(capability.status)) {
      await capability.body?.cancel();
      throw failure("writeback_unsupported");
    }
    const body = await capability.json().catch(() => null);
    throw failure(body?.error?.code ?? `http_${capability.status}`, capability.status === 429 || capability.status >= 500);
  }
  let supported;
  try { supported = await capability.json(); }
  catch (error) { if (error.name !== "SyntaxError") throw error; }
  input.assertCurrent();
  if (supported?.preserveFilename !== true) throw failure("writeback_unsupported");
  const blobPath = `/resources/${encodeURIComponent(input.resourceId)}/blob`;
  const put = async expectedContentHash => {
    input.assertCurrent();
    const form = new FormData();
    form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.filename);
    form.append("filename", input.filename);
    form.append("preserveFilename", "true");
    form.append("mimeType", input.mimeType);
    form.append("expectedContentHash", expectedContentHash);
    const response = await request(`${blobPath}/writeback`, { method: "PUT", body: form, signal: input.signal }, input.assertCurrent);
    input.assertCurrent();
    // An older server must reject this dedicated route, even if it replaced a
    // supported server between the capability read and the write.
    if (response.status === 404 && response.headers.get("X-EdgeEver-Writeback") !== "preserve-filename") {
      await response.body?.cancel();
      throw failure("writeback_unsupported");
    }
    return response;
  };
  let response = await put(input.expectedContentHash);
  if (response.status === 409) {
    // A successful upload can lose its response. Confirm exactly this pending
    // snapshot, then use a conditional no-op PUT to obtain its resource metadata.
    await response.body?.cancel();
    const current = await request(blobPath, { method: "GET", cache: "no-store", signal: input.signal }, input.assertCurrent);
    if (current.ok) {
      const hash = createHash("sha256");
      for await (const chunk of current.body) hash.update(chunk);
      input.assertCurrent();
      if (hash.digest("hex") !== digest(input.bytes)) throw failure("resource_conflict");
      response = await put(digest(input.bytes));
    } else response = current;
  }
  input.assertCurrent();
  if (!response.ok) {
    const status = response.status;
    const body = await response.json().catch(() => null);
    throw failure(body?.error?.code ?? (status === 409 ? "resource_conflict" : status === 404 ? "not_found" : `http_${status}`), status === 429 || status >= 500);
  }
  const { resource } = await response.json();
  if (resource?.id !== input.resourceId || resource.sha256 !== digest(input.bytes)) throw failure("unavailable", true);
  return resource;
};

export const createAttachmentWritebackManager = options => {
  let context = null;
  let generation = 0;
  let loading = null;
  let ticking = null;
  let storing = Promise.resolve();
  const store = operation => {
    const result = storing.then(operation);
    storing = result.catch(() => {});
    return result;
  };
  const records = new Map();
  const controllers = new Set();
  const now = () => options.now?.() ?? Date.now();
  const suspend = () => {
    generation++;
    for (const controller of controllers) controller.abort();
    controllers.clear(); records.clear(); context = null; loading = null;
  };
  const assertScope = (key, version) => {
    if (generation !== version || options.getContext()?.key !== key) throw failure("scope_changed");
  };
  const persist = (entry, record = entry.record) => {
    const bytes = JSON.stringify(record);
    return store(() => writeAttachmentFile(join(entry.folder, WRITEBACK_METADATA), bytes));
  };
  const refresh = async () => {
    const next = options.getContext();
    if (next?.key === context?.key) { if (loading) await loading; return; }
    suspend();
    if (!next) return;
    context = next;
    const version = generation;
    loading = (async () => {
      // A refreshed session may restore the same account directory while its
      // previous acknowledgement is still being committed.
      await storing;
      assertScope(next.key, version);
      const entries = await readdir(next.directory, { withFileTypes: true }).catch(error => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith("open-")) continue;
        const folder = join(next.directory, entry.name);
        const record = await readFile(join(folder, WRITEBACK_METADATA), "utf8").then(JSON.parse).catch(() => null);
        if (!validRecord(record)) continue;
        if (record.status === "error" && ["unauthorized", "forbidden", "http_401", "http_403"].includes(record.errorCode)) {
          // A context is restored only after the host validates the account.
          record.status = "pending"; record.retryAt = 0; record.retryable = true;
        }
        assertScope(next.key, version);
        records.set(entry.name, { folder, record, observed: null, observedAt: now() });
      }
    })();
    try { await loading; } finally { if (generation === version) loading = null; }
  };
  const processEntry = async (entry, key, version) => {
    const record = entry.record;
    const assertCurrent = () => assertScope(key, version);
    if (record.status === "conflict" || record.status === "error" && !record.retryable) return;
    if (record.retryAt && now() < record.retryAt) return;
    const path = join(entry.folder, record.localFilename);
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      assertCurrent();
      if (!record.pendingHash) {
        const info = await lstat(path).catch(error => {
          if (["ENOENT", "EACCES", "EBUSY", "EPERM"].includes(error.code)) return null;
          throw error;
        });
        if (!info?.isFile()) return;
        const observed = signature(info);
        if (observed === record.signature) return;
        if (observed !== entry.observed) {
          entry.observed = observed; entry.observedAt = now();
          record.status = "pending";
          return;
        }
        if (now() - entry.observedAt < QUIET_MS) return;
        const snapshot = await readSnapshot(path, observed);
        assertCurrent();
        if (!snapshot) return;
        if (snapshot.hash === record.baseHash) {
          record.signature = snapshot.signature;
          record.status = record.savedAt ? "saved" : "watching";
          await persist(entry); return;
        }
        await store(() => writeAttachmentFile(join(entry.folder, PENDING_BYTES), snapshot.bytes));
        assertCurrent();
        record.pendingHash = snapshot.hash;
        record.pendingSignature = snapshot.signature;
        record.status = "pending";
        await persist(entry);
      }
      assertCurrent();
      const resourceId = await options.resolveResourceId(record.url, assertCurrent);
      assertCurrent();
      if (!resourceId) { record.status = "pending"; record.retryAt = now() + RETRY_MS; await persist(entry); return; }
      const snapshot = await readSnapshot(join(entry.folder, PENDING_BYTES));
      assertCurrent();
      if (!snapshot || snapshot.hash !== record.pendingHash) throw failure("local_file_unavailable");
      record.status = "saving";
      const resource = await options.replace({
        resourceId, expectedContentHash: record.baseHash, bytes: snapshot.bytes,
        filename: record.filename, mimeType: record.mimeType, signal: controller.signal, assertCurrent,
      });
      assertCurrent();
      await options.onSaved({ resource, bytes: snapshot.bytes, assertCurrent });
      assertCurrent();
      const acknowledged = {
        ...record, resourceId: resource.id, byteSize: resource.byteSize, metadataAt: now(),
        baseHash: record.pendingHash, signature: record.pendingSignature,
        pendingHash: null, pendingSignature: null, status: "saved", errorCode: null,
        retryAt: 0, retryable: false, savedAt: now(),
      };
      // Keep the old baseline and immutable pending snapshot available if this
      // commit fails; the next attempt can reconcile the successful upload.
      await persist(entry, acknowledged);
      assertCurrent();
      Object.assign(record, acknowledged);
      // The acknowledgement is durable; a locked leftover snapshot must not
      // turn a successful save back into an error. Retention can remove it.
      await store(() => rm(join(entry.folder, PENDING_BYTES), { force: true })).catch(() => {});
    } catch (error) {
      if (generation !== version || options.getContext()?.key !== key) return;
      const code = typeof error.code === "string" ? error.code : null;
      record.errorCode = code ?? "unavailable";
      record.status = record.errorCode === "resource_conflict" ? "conflict" : "error";
      record.retryable = error.retryable ?? (error.name === "AbortError" || !code || ["unavailable", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "AbortError", "EBUSY", "EPERM", "EACCES"].includes(code));
      record.retryAt = record.retryable ? now() + RETRY_MS : 0;
      await persist(entry);
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  };
  return {
    suspend,
    async track({ folder, url, filename, localFilename = filename, mimeType }) {
      await refresh();
      if (!context || join(context.directory, basename(folder)) !== folder) throw failure("scope_changed");
      const version = generation; const key = context.key;
      const path = join(folder, localFilename);
      const info = await lstat(path);
      const record = { url, filename, localFilename, resourceId: url.startsWith("edgeever-resource:") ? resourceIdFromRequest(url) : null, byteSize: info.size, metadataAt: now(), mimeType: mimeType || "application/octet-stream", baseHash: await hashFile(path), signature: signature(info), status: "watching", savedAt: null };
      assertScope(key, version);
      if (!info.isFile() || !validRecord(record)) throw failure("local_file_unavailable");
      const entry = { folder, record, observed: null, observedAt: now() };
      await persist(entry); assertScope(key, version);
      records.set(basename(folder), entry);
    },
    forget: id => records.delete(id),
    async tick() {
      if (ticking) return ticking;
      ticking = (async () => {
        await refresh();
        if (!context) return;
        const key = context.key; const version = generation;
        // Keep large file snapshots bounded to one upload in the main process.
        for (const entry of records.values()) await processEntry(entry, key, version);
      })();
      try { await ticking; } finally { ticking = null; }
    },
    async list() {
      await refresh();
      return [...records.entries()].map(([id, { record }]) => ({ id, filename: record.localFilename, status: record.status === "saving" && !ticking ? "pending" : record.status, errorCode: record.errorCode ?? null, savedAt: record.savedAt, resourceId: record.resourceId ?? null, byteSize: record.byteSize ?? null, metadataAt: record.metadataAt ?? 0 }));
    },
    async retry(id) {
      await refresh(); const entry = records.get(id);
      if (!entry || entry.record.status === "saving") return;
      entry.record.status = "pending"; entry.record.retryAt = 0; entry.record.retryable = true;
      await persist(entry);
    },
    async filePath(id) {
      await refresh(); const entry = records.get(id);
      return entry ? join(entry.folder, entry.record.localFilename) : null;
    },
  };
};
