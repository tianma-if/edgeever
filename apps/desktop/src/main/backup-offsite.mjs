import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { join, posix } from "node:path";
import { Transform } from "node:stream";
import { backupError } from "./backup-settings.mjs";

export const DEFAULT_OFFSITE_FOLDER = "/EdgeEver/backups";
const RETRY_AFTER_MS = 3600000;
const STALL_TIMEOUT_MS = 120000;

const privateHost = (hostname) => {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") || !host.includes(".") && !isIP(host)) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return isIP(host) === 6 && (host === "::1" || /^f[cd]/.test(host) || host.startsWith("fe80:"));
};

export const normalizeOffsiteConfig = (input) => {
  if (input === undefined) return { enabled: false, url: "", username: "", folder: DEFAULT_OFFSITE_FOLDER };
  if (!input || typeof input.enabled !== "boolean" || typeof input.url !== "string" || typeof input.username !== "string" || typeof input.folder !== "string") {
    throw backupError("offsite_invalid_configuration", "The off-site copy settings are invalid.");
  }
  const rawUrl = input.url.trim();
  let url = "";
  if (rawUrl) {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { throw backupError("offsite_invalid_url", "Enter a valid WebDAV address."); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw backupError("offsite_invalid_url", "Enter the address without a username, password, query or fragment.");
    // Basic authentication sends the password with every request.
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && privateHost(parsed.hostname))) throw backupError("offsite_insecure_url", "Use an https:// address. http:// is only allowed on a local network.");
    url = parsed.href.replace(/\/+$/, "");
  }
  const folder = `/${input.folder.trim().split("/").filter(Boolean).join("/")}`;
  if (folder.length > 512 || Array.from(folder).some((character) => character.charCodeAt(0) < 32) || /\\/.test(folder) || folder.split("/").some((part) => part === "." || part === "..")) {
    throw backupError("offsite_invalid_folder", "Enter a remote folder without . or .. segments.");
  }
  const username = input.username.trim();
  if (username.length > 256) throw backupError("offsite_invalid_configuration", "The username is too long.");
  if (input.enabled && (!url || !username)) throw backupError("offsite_invalid_configuration", "Enter the WebDAV address and username.");
  return { enabled: input.enabled, url, username, folder: folder === "/" ? DEFAULT_OFFSITE_FOLDER : folder };
};

const stalled = () => backupError("offsite_stalled", "The WebDAV server stopped responding.");
// Rejects when the signal aborts, even if a request ignores its signal.
const whenAborted = (signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

const targetKey = (config) => JSON.stringify([config.url, config.username, config.folder]);
// The saved password belongs to the server and account it was entered for.
const credentialKey = (config) => JSON.stringify([config.url, config.username]);

export const offsiteErrorInfo = (error) => {
  if (error?.code?.startsWith?.("offsite_")) return { code: error.code, message: error.message };
  const status = error?.status ?? error?.response?.status;
  if (status === 401 || status === 403) return { code: "offsite_auth_failed", message: "The WebDAV server rejected the username or password.", status };
  if (status === 413) return { code: "offsite_file_too_large", message: "The backup file is too large for this WebDAV server.", status };
  if (status === 507) return { code: "offsite_storage_full", message: "The WebDAV server has no space left.", status };
  if (Number.isInteger(status)) return { code: "offsite_upload_failed", message: `The WebDAV server answered ${status}.`, status };
  const cause = error?.cause?.code ?? error?.code;
  if (["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ConnectionRefused", "FailedToOpenSocket"].includes(cause)) return { code: "offsite_unreachable", message: "The WebDAV server could not be reached." };
  return { code: "offsite_upload_failed", message: "The off-site copy failed." };
};

/**
 * Copies completed local backups to WebDAV. It keeps its own state and never
 * runs inside the local backup queue, so a slow or failed upload cannot block
 * local backups or change their result.
 */
export class OffsiteBackup {
  constructor({ userData, secureStorage, platform = process.platform, clientFactory, onChange = () => {}, now = () => Date.now(), stallTimeoutMs = STALL_TIMEOUT_MS }) {
    Object.assign(this, { userData, secureStorage, platform, onChange, now, stallTimeoutMs });
    this.clientFactory = clientFactory ?? (async (url, options) => (await import("webdav")).createClient(url, options));
    this.generation = 0; this.scope = null; this.backupSetId = null; this.record = null; this.upload = null; this.queued = null;
  }
  directory() { return join(this.userData, "scheduled-backups"); }
  statePath() { return join(this.directory(), `${this.scope}.offsite.json`); }
  secretPath(passwordId = this.record?.passwordId, scope = this.scope) { return join(this.directory(), `${scope}.offsite.${passwordId}.secret`); }
  secureAvailable() {
    try { return this.secureStorage.isEncryptionAvailable() && !(this.platform === "linux" && this.secureStorage.getSelectedStorageBackend?.() === "basic_text"); } catch { return false; }
  }
  async persist() {
    const path = this.statePath(); const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(this.record)); await file.sync(); await file.close(); await rename(temporary, path); }
    finally { await file.close().catch(() => {}); await rm(temporary, { force: true }); }
  }
  status() {
    if (!this.record) return null;
    const r = this.record;
    return structuredClone({ config: r.config, passwordSet: Boolean(r.passwordId), secureStorageAvailable: this.secureAvailable(),
      lastAttemptAt: r.lastAttemptAt ?? null, lastSuccessAt: r.lastSuccessAt ?? null, lastUploaded: r.uploads.at(-1) ? { name: r.uploads.at(-1).name, size: r.uploads.at(-1).size, uploadedAt: r.uploads.at(-1).uploadedAt } : null,
      error: r.error ?? null, warning: r.warning ?? null, task: this.upload ? { name: this.upload.name, sent: this.upload.sent, total: this.upload.total } : null });
  }
  emit() { try { this.onChange(this.status()); } catch { /* A renderer can disappear while uploads continue. */ } }

  /** Called when the backup account changes; cancels any upload for the previous one. */
  async setScope(scope, backupSetId) {
    const generation = ++this.generation;
    this.cancel();
    this.scope = scope ?? null; this.backupSetId = backupSetId ?? null; this.record = null; this.queued = null;
    if (!this.scope || !/^[a-f0-9-]{36}$/.test(this.backupSetId ?? "")) { this.emit(); return; }
    // A missing or unreadable state file starts with the option turned off.
    const stored = await readFile(this.statePath(), "utf8").then(JSON.parse).catch(() => null);
    if (generation !== this.generation) return;
    const valid = stored && Array.isArray(stored.uploads) && stored.uploads.every((item) => typeof item?.name === "string" && typeof item.remotePath === "string" && typeof item.target === "string" && Number.isSafeInteger(item.size));
    let config;
    try { config = normalizeOffsiteConfig(valid ? stored.config : undefined); } catch { config = normalizeOffsiteConfig(undefined); }
    this.record = valid ? { ...stored, config } : { config, uploads: [] };
    if (this.record.passwordId !== undefined && !/^[a-f0-9-]{36}$/.test(this.record.passwordId)) delete this.record.passwordId;
    this.emit();
    // An interrupted upload leaves a .part file; remove it on the next start.
    if (this.record.activePart) void this.removeActivePart(generation);
  }
  assertReady() { if (!this.record) throw backupError("backup_login_required", "Sign in to an EdgeEver instance first."); }

  async save(config, password) {
    this.assertReady(); const generation = this.generation;
    const normalized = normalizeOffsiteConfig(config);
    const previous = this.record;
    const next = { ...previous, config: normalized, error: null };
    let newSecret;
    if (password !== undefined) {
      if (typeof password !== "string" || !password.length) throw backupError("offsite_password_required", "Enter the WebDAV password.");
      if (!this.secureAvailable() || !await this.secureStorage.isAsyncEncryptionAvailable().catch(() => false)) throw backupError("offsite_secure_storage_unavailable", "Unlock secure storage to save the WebDAV password.");
      next.passwordId = randomUUID(); newSecret = this.secretPath(next.passwordId);
      const file = await open(newSecret, "wx", 0o600);
      try { await file.writeFile(await this.secureStorage.encryptStringAsync(password)); await file.sync(); } finally { await file.close(); }
    }
    // A new address or username never reuses the saved password, so it cannot be sent to another server.
    const dropSecret = !newSecret && previous.passwordId && credentialKey(previous.config) !== credentialKey(normalized);
    if (dropSecret) delete next.passwordId;
    if (normalized.enabled && !next.passwordId) { if (newSecret) await rm(newSecret, { force: true }); throw backupError("offsite_password_required", "Enter the WebDAV password."); }
    if (generation !== this.generation) { if (newSecret) await rm(newSecret, { force: true }); throw backupError("backup_account_changed", "The backup account changed."); }
    // Turning the copy off or pointing it elsewhere stops the running upload before it can publish.
    if (!normalized.enabled || targetKey(previous.config) !== targetKey(normalized)) this.cancel();
    this.record = next;
    try { await this.persist(); }
    catch (error) { this.record = previous; if (newSecret) await rm(newSecret, { force: true }); throw error; }
    if ((newSecret || dropSecret) && previous.passwordId) await rm(this.secretPath(previous.passwordId), { force: true }).catch(() => {});
    this.emit(); return this.status();
  }

  /** Reads the password saved with `record` in `scope`, captured by the caller before any await. */
  async password(record = this.record, scope = this.scope) {
    if (!record?.passwordId) throw backupError("offsite_password_required", "Enter the WebDAV password.");
    if (!this.secureAvailable() || !await this.secureStorage.isAsyncEncryptionAvailable().catch(() => false)) throw backupError("offsite_secure_storage_unavailable", "Unlock secure storage to use the saved WebDAV password.");
    try {
      const path = this.secretPath(record.passwordId, scope);
      const { result, shouldReEncrypt } = await this.secureStorage.decryptStringAsync(await readFile(path));
      if (shouldReEncrypt) { const temporary = `${path}.${randomUUID()}.tmp`;
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(await this.secureStorage.encryptStringAsync(result)); await file.sync(); await file.close(); await rename(temporary, path); }
        finally { await file.close().catch(() => {}); await rm(temporary, { force: true }); }
      }
      return result;
    } catch { throw backupError("offsite_secure_storage_unavailable", "Unlock secure storage or enter the WebDAV password again."); }
  }
  async client(config, password) { return this.clientFactory(config.url, { username: config.username, password }); }

  /** Bounds one WebDAV request by the stall timeout and by `parent`, so a stuck request cannot block later copies. */
  async request(run, parent) {
    const controller = new AbortController();
    const aborted = whenAborted(controller.signal); aborted.catch(() => {});
    const timer = setTimeout(() => controller.abort(stalled()), this.stallTimeoutMs); timer.unref?.();
    const forward = () => controller.abort(parent.reason);
    if (parent?.aborted) forward(); else parent?.addEventListener("abort", forward, { once: true });
    try { return await Promise.race([run(controller.signal), aborted]); }
    finally { clearTimeout(timer); parent?.removeEventListener("abort", forward); }
  }

  /** Checks the address and credentials and that the folder can be created. Does not change saved settings. */
  async test(config, password) {
    this.assertReady();
    // An account switch during any await must not mix this test with another account's password.
    const generation = this.generation; const record = this.record; const scope = this.scope;
    const assertScope = () => { if (generation !== this.generation) throw backupError("backup_account_changed", "The backup account changed."); };
    const normalized = normalizeOffsiteConfig({ ...config, enabled: false });
    if (!normalized.url || !normalized.username) throw backupError("offsite_invalid_configuration", "Enter the WebDAV address and username.");
    if (!(typeof password === "string" && password.length) && credentialKey(record.config) !== credentialKey(normalized)) {
      throw backupError("offsite_password_required", "Enter the WebDAV password for this address and username.");
    }
    const secret = typeof password === "string" && password.length ? password : await this.password(record, scope);
    assertScope();
    try {
      const client = await this.client(normalized, secret);
      await this.request((signal) => client.createDirectory(normalized.folder, { recursive: true, signal }));
      assertScope();
      await this.request((signal) => client.stat(normalized.folder, { signal }));
      assertScope();
      return { ok: true };
    } catch (error) {
      if (error?.code === "backup_account_changed") throw error;
      throw Object.assign(new Error(offsiteErrorInfo(error).message), offsiteErrorInfo(error));
    }
  }

  /**
   * Queue the latest completed local backup. Only the newest request is kept;
   * an older archive is skipped once a newer one exists.
   */
  enqueue(entry, retention) {
    if (!this.record?.config.enabled || !entry?.name) return;
    this.queued = { entry, retention };
    if (!this.upload) void this.drain();
  }
  /** Hourly check: retry the latest local archive if its copy failed or never ran. */
  tick(latest, retention, { force = false } = {}) {
    if (!this.record?.config.enabled || !latest || this.upload) return false;
    const key = targetKey(this.record.config);
    if (this.record.uploads.some((item) => item.name === latest.name && item.target === key)) return false;
    if (!force && this.record.lastAttemptAt && Date.parse(this.record.lastAttemptAt) + RETRY_AFTER_MS > this.now()) return false;
    this.enqueue(latest, retention); return true;
  }
  cancel() { this.upload?.controller.abort(); this.queued = null; }

  async drain() {
    while (this.queued && !this.upload) {
      const { entry, retention } = this.queued; this.queued = null;
      if (this.record?.config.enabled) await this.uploadEntry(entry, retention);
    }
  }

  async uploadEntry(entry, retention) {
    const generation = this.generation; const record = this.record; const scope = this.scope; const config = record.config; const key = targetKey(config);
    const controller = new AbortController();
    const current = () => generation === this.generation && !controller.signal.aborted;
    const remoteFolder = posix.join(config.folder, this.backupSetId);
    const finalPath = posix.join(remoteFolder, entry.name);
    const partPath = `${finalPath}.${randomUUID()}.part`;
    this.upload = { controller, name: entry.name, sent: 0, total: entry.size };
    this.record.lastAttemptAt = new Date(this.now()).toISOString(); this.record.error = null;
    await this.persist().catch(() => {}); this.emit();
    let file; let client; let stall;
    try {
      const localPath = join(entry.directory, this.backupSetId, entry.name);
      const info = await lstat(localPath).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      // Local retention may already have replaced this archive with a newer one.
      if (!info) return;
      if (!info.isFile() || info.isSymbolicLink()) throw backupError("offsite_source_changed", "The local backup file was replaced. It was not uploaded.");
      // Keep the file open so local retention can delete it without breaking the upload.
      file = await open(localPath, "r");
      const size = (await file.stat()).size;
      if (size !== entry.size) throw backupError("offsite_source_changed", "The local backup file changed. It was not uploaded.");
      client = await this.client(config, await this.password(record, scope));
      if (!current()) return;
      await this.request((signal) => client.createDirectory(remoteFolder, { recursive: true, signal }), controller.signal);
      this.record.activePart = { path: partPath, target: key }; await this.persist();
      const arm = () => { clearTimeout(stall); stall = setTimeout(() => controller.abort(backupError("offsite_stalled", "The WebDAV server stopped responding.")), this.stallTimeoutMs); stall.unref?.(); };
      let emittedAt = 0;
      // Count bytes as the request reads them. A "data" listener on the body
      // would switch it to flowing mode and drop chunks read before the upload starts.
      const body = new Transform({ transform: (chunk, _encoding, callback) => {
        this.upload.sent += chunk.length; arm();
        if (this.now() - emittedAt >= 1000) { emittedAt = this.now(); this.emit(); }
        callback(null, chunk);
      } });
      arm();
      const source = file.createReadStream({ autoClose: false });
      source.on("error", (error) => body.destroy(error));
      source.pipe(body);
      // The library leaves streams chunked; many WebDAV servers and proxies need an explicit length.
      await Promise.race([whenAborted(controller.signal), client.putFileContents(partPath, body, { headers: { "Content-Length": String(size) }, overwrite: true, signal: controller.signal })]);
      clearTimeout(stall);
      if (!current()) return;
      await this.request((signal) => client.moveFile(partPath, finalPath, { overwrite: true, signal }), controller.signal);
      delete this.record.activePart;
      const remote = await this.request((signal) => client.stat(finalPath, { signal }), controller.signal);
      if (remote?.size !== undefined && remote.size !== size) throw backupError("offsite_size_mismatch", "The uploaded copy has a different size. It will be uploaded again.");
      if (!current()) return;
      this.record.uploads = [...this.record.uploads.filter((item) => !(item.target === key && item.remotePath === finalPath)), { name: entry.name, remotePath: finalPath, target: key, size, uploadedAt: new Date(this.now()).toISOString() }];
      this.record.lastSuccessAt = this.record.uploads.at(-1).uploadedAt; this.record.error = null;
      await this.persist();
      await this.applyRetention(client, key, retention, current);
    } catch (error) {
      if (generation !== this.generation) return;
      const stalled = controller.signal.reason?.code === "offsite_stalled";
      // A cancelled upload (settings changed) is not a failure.
      this.record.error = controller.signal.aborted && !stalled ? null : offsiteErrorInfo(stalled ? controller.signal.reason : error);
      if (client && this.record.activePart?.path === partPath) {
        await this.request((signal) => client.deleteFile(partPath, { signal })).then(() => { delete this.record.activePart; }).catch(() => {});
      }
      await this.persist().catch(() => {});
    } finally {
      clearTimeout(stall);
      await file?.close().catch(() => {});
      if (this.upload?.controller === controller) this.upload = null;
      if (generation === this.generation) this.emit();
    }
  }

  async applyRetention(client, key, retention, current) {
    const owned = this.record.uploads.filter((item) => item.target === key).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    let failed = false;
    for (const old of owned.slice(Math.max(1, retention))) {
      if (!current()) return;
      try { await this.request((signal) => client.deleteFile(old.remotePath, { signal })); }
      catch (error) { if ((error?.status ?? error?.response?.status) !== 404) { failed = true; continue; } }
      this.record.uploads = this.record.uploads.filter((item) => item !== old);
    }
    this.record.warning = failed ? { code: "offsite_cleanup_failed" } : null;
    await this.persist();
  }

  async removeActivePart(generation) {
    const part = this.record?.activePart;
    if (!part || part.target !== targetKey(this.record.config)) { if (this.record) { delete this.record.activePart; await this.persist().catch(() => {}); } return; }
    try {
      const record = this.record; const scope = this.scope;
      const client = await this.client(record.config, await this.password(record, scope));
      if (generation !== this.generation) return;
      await this.request((signal) => client.deleteFile(part.path, { signal })).catch((error) => { if ((error?.status ?? error?.response?.status) !== 404) throw error; });
      if (generation === this.generation) { delete this.record.activePart; await this.persist(); }
    } catch { /* Retried on the next start; a leftover .part never replaces a real copy. */ }
  }
}
