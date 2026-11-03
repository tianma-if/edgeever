import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { chmod, lstat, link, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join, basename, isAbsolute } from "node:path";
import { accountScopeKey } from "./account-scope.mjs";
import { normalizeBackupConfig, nextBackupAt, backupError, backupFileName } from "./backup-settings.mjs";
import { sanitizeDesktopDiagnosticText } from "./desktop-diagnostics.mjs";

const errorInfo = (error) => ({ code: error.code ?? "backup_failed", message: error.message ?? "Backup failed", ...(Number.isInteger(error.status) ? { status: error.status } : {}) });
const assertDirectory = async (path, privateMode = false) => {
  await mkdir(path, { recursive: true, mode: privateMode ? 0o700 : undefined });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw backupError("backup_directory_invalid", "Choose a regular backup directory, not a symbolic link.");
  if (privateMode && process.platform !== "win32") await chmod(path, 0o700);
};
const atomicWrite = async (path, bytes) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); await file.close(); await rename(temporary, path); }
  finally { await file.close().catch(() => {}); await rm(temporary, { force: true }); }
};
const atomicJson = (path, value) => atomicWrite(path, JSON.stringify(value));
const readJson = async (path) => { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const ownedDirectoriesExist = async (paths) => {
  for (const path of paths) {
    const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) return false;
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("A temporary-file directory was replaced.");
  }
  return true;
};

export class BackupManager {
  constructor({ userData, defaultDirectory, secureStorage, platform = process.platform, workerFactory, offsite = null, onChange = () => {}, onSuccess = () => {}, onDiagnostic = () => {}, version = { edgeeverVersion: "unknown", buildId: "unknown" } }) {
    Object.assign(this, { userData, defaultDirectory, secureStorage, platform, offsite, onChange, onSuccess, onDiagnostic, version });
    // Off-site copies report through the same status but never join the local backup queue.
    if (offsite) offsite.onChange = () => this.emit();
    this.workerFactory = workerFactory ?? ((data) => new Worker(new URL("../../build/backup-worker.mjs", import.meta.url), { workerData: data }));
    this.generation = 0; this.context = null; this.record = null; this.task = null; this.operation = null; this.closed = false; this.transitioning = false;
    this.approvedDirectories = new Set([defaultDirectory]);
    this.queue = Promise.resolve();
  }
  secureAvailable() {
    try { return this.secureStorage.isEncryptionAvailable() && !(this.platform === "linux" && this.secureStorage.getSelectedStorageBackend?.() === "basic_text"); } catch { return false; }
  }
  async secureUsable() {
    const usable = this.secureAvailable() && await this.secureStorage.isAsyncEncryptionAvailable().catch(() => false);
    const changed = this.secureUnavailable !== !usable; this.secureUnavailable = !usable;
    if (changed) this.emit();
    return usable;
  }
  statePath() { return join(this.userData, "scheduled-backups", `${this.scope}.json`); }
  secretPath(passwordId = this.record?.passwordId) { return join(this.userData, "scheduled-backups", `${this.scope}${passwordId ? `.${passwordId}` : ""}.secret`); }
  async persist() { this.record.nextDueAt = this.record.config.enabled ? nextBackupAt(this.record.scheduleAnchorAt ?? this.record.lastSuccessAt, this.record.config.interval) : null; await atomicJson(this.statePath(), this.record); }
  status() {
    if (this.transitioning || !this.record) return null;
    const r = this.record;
    return structuredClone({ config: r.config, backupSetId: r.backupSetId, actualDirectory: join(r.config.directory, r.backupSetId),
      blocked: Boolean(this.initializationError), passwordSet: Boolean(r.passwordSet), secureStorageAvailable: this.secureAvailable() && !this.secureUnavailable, lastAttemptAt: r.lastAttemptAt ?? null,
      lastCheck: r.lastCheck ?? null, lastSuccessAt: r.lastSuccessAt ?? null, lastRestoreAt: r.lastRestoreAt ?? null, nextDueAt: r.config.enabled ? nextBackupAt(r.scheduleAnchorAt ?? r.lastSuccessAt, r.config.interval) : null,
      error: r.error ?? null, warning: r.warning ?? null, importError: r.importError ?? null, importWarning: r.importWarning ?? null, history: r.history.filter((item) => item.directory === r.config.directory), task: this.task,
      pendingPublication: r.pending ? { name: r.pending.name, encrypted: r.pending.encrypted } : null,
      target: { baseUrl: this.context.baseUrl, accountId: this.context.accountId }, offsite: this.offsite?.status() ?? null });
  }
  emit() { try { this.onChange(this.status()); } catch { /* A renderer can disappear while background work continues. */ } }
  exclusive(action) {
    const result = this.queue.then(action); this.queue = result.catch(() => {}); return result;
  }
  setContext(context) {
    if (this.closed) return Promise.resolve();
    this.startupController?.abort();
    const next = context?.baseUrl && context?.accountId && typeof context?.token === "string" ? { ...context } : null;
    if (this.desiredContext?.baseUrl === next?.baseUrl && this.desiredContext?.accountId === next?.accountId && this.desiredContext?.token === next?.token) return this.contextReady ?? Promise.resolve();
    this.desiredContext = next;
    const generation = ++this.generation;
    this.transitioning = true; this.emit();
    this.contextReady = (async () => {
      await this.cancel();
      await this.exclusive(async () => {
        if (generation !== this.generation) return;
        this.approvedDirectories = new Set([this.defaultDirectory]);
        this.context = next; this.record = null; this.selection = null; this.initializationError = null;
        await this.offsite?.setScope(null);
        if (!next) { this.transitioning = false; this.emit(); return; }
        this.scope = accountScopeKey(next.baseUrl, next.accountId);
        await assertDirectory(join(this.userData, "scheduled-backups"), true);
        this.record = await readJson(this.statePath()) ?? { config: normalizeBackupConfig(undefined, this.defaultDirectory), backupSetId: randomUUID(), history: [] };
        this.record.config = normalizeBackupConfig(this.record.config, this.defaultDirectory);
        if (this.record.lastCheck?.result === "running") this.record.lastCheck = { ...this.record.lastCheck, result: "cancelled" };
        if (!this.record.pending && this.record.error?.code === "backup_decrypt_failed") {
          this.record.importError ??= this.record.error; this.record.error = null;
        }
        const entryValid = (entry) => entry && typeof entry.name === "string" && basename(entry.name) === entry.name && typeof entry.directory === "string" && isAbsolute(entry.directory) && Number.isFinite(Date.parse(entry.completedAt)) && Number.isSafeInteger(entry.size) && entry.size >= 0 && typeof entry.encrypted === "boolean";
        if (!/^[a-f0-9-]{36}$/.test(this.record.backupSetId) || !Array.isArray(this.record.history) || !this.record.history.every(entryValid) || (this.record.pending && !entryValid(this.record.pending))) throw new Error("Invalid backup completion record");
        if (this.record.passwordId !== undefined && !/^[a-f0-9-]{36}$/.test(this.record.passwordId)) throw new Error("Invalid backup credential reference");
        this.approvedDirectories.add(this.record.config.directory);
        await this.cleanStaging();
        await this.persist();
        if (generation === this.generation) await this.offsite?.setScope(this.scope, this.record.backupSetId);
        if (generation === this.generation) { this.transitioning = false; this.emit(); }
      });
      if (generation === this.generation && this.record?.pending && !this.operation) await this.recoverPublication();
    })().catch((error) => {
      if (generation !== this.generation) return;
      this.initializationError = backupError("backup_configuration_unavailable", error.message);
      this.record = { config: normalizeBackupConfig(undefined, this.defaultDirectory), backupSetId: "unavailable", history: [], error: errorInfo(this.initializationError) };
      this.transitioning = false;
      this.emit();
    });
    return this.contextReady;
  }

  async restoreContext(seed, request = fetch) {
    if (this.closed || this.transitioning || this.context || this.record || this.startupController || !seed?.baseUrl) return;
    const generation = this.generation;
    const controller = new AbortController(); this.startupController = controller;
    try {
      const response = await request(`${seed.baseUrl}/api/v1/auth/session`, { signal: controller.signal, credentials: "omit", headers: { Authorization: `Bearer ${seed.token}` } });
      if (!response.ok) return;
      const session = await response.json();
      if (controller.signal.aborted || generation !== this.generation || this.closed || this.context || this.record || !session.authenticated || !session.user?.id) return;
      await this.setContext({ ...seed, accountId: session.user.id });
    } catch { /* Startup can be offline. The existing hourly/resume checks retry. */ }
    finally { if (this.startupController === controller) this.startupController = null; }
  }

  assertReady() { if (this.transitioning) throw backupError("backup_account_changed", "The backup account is changing. Wait until it is ready."); if (this.initializationError) throw this.initializationError; if (this.closed || !this.context || !this.record) throw backupError("backup_login_required", "Sign in to an EdgeEver instance first."); }
  assertScope(expected) { if (expected !== undefined && expected !== this.record?.backupSetId) throw backupError("backup_account_changed", "The backup account changed. Review the current target."); }
  async approveDirectory(path) {
    const generation = this.generation;
    if (!isAbsolute(path)) throw backupError("backup_directory_invalid", "Choose an absolute directory.");
    const directory = await realpath(path);
    if (generation !== this.generation) throw backupError("backup_account_changed", "The backup account changed.");
    this.approvedDirectories.add(directory); return directory;
  }
  async openFolderPath(expected) {
    this.assertReady(); this.assertScope(expected); const generation = this.generation;
    const root = this.record.config.directory;
    const folder = join(root, this.record.backupSetId);
    await assertDirectory(root); await assertDirectory(folder);
    if (generation !== this.generation) throw backupError("backup_account_changed", "The backup account changed.");
    return folder;
  }
  async save(config, password, expected) {
    return this.exclusive(async () => {
      this.assertReady(); this.assertScope(expected); if (this.operation) throw backupError("backup_busy", "Cancel the running task before changing settings.");
      const normalized = normalizeBackupConfig(config, this.defaultDirectory);
      if (!this.approvedDirectories.has(normalized.directory)) throw backupError("backup_directory_invalid", "Choose the backup directory using the directory picker.");
      if (normalized.encrypted && !this.record.passwordSet && password === undefined && this.secureAvailable() && !this.secureUnavailable) throw backupError("backup_password_required", "Enter a backup password.");
      const previous = this.record;
      const next = { ...previous, config: normalized, error: null };
      const previousSecretPath = this.secretPath();
      let newSecretPath;
      try {
        if (password !== undefined) {
          if (typeof password !== "string" || !password.length) throw backupError("backup_password_required", "Enter a backup password.");
          if (!await this.secureUsable()) throw backupError("backup_secure_storage_unavailable", "Unlock secure storage, or enter a password for a single backup without saving it.");
          const encrypted = await this.secureStorage.encryptStringAsync(password);
          next.passwordId = randomUUID(); newSecretPath = this.secretPath(next.passwordId);
          await atomicWrite(newSecretPath, encrypted);
          next.passwordSet = true; next.passwordVersion = (previous.passwordVersion ?? 0) + 1;
        }
        this.record = next;
        await this.persist();
      } catch (error) {
        this.record = previous;
        if (newSecretPath) await rm(newSecretPath, { force: true }).catch(() => {});
        throw error;
      }
      // The committed reference is authoritative; retiring old ciphertext cannot undo a saved password.
      if (newSecretPath) await rm(previousSecretPath, { force: true }).catch(() => {});
      this.emit(); return this.status();
    });
  }
  async password(once, encrypted = this.record.config.encrypted) {
    if (!encrypted) return undefined;
    if (typeof once === "string" && once.length) return once;
    if (!await this.secureUsable()) throw backupError("backup_secure_storage_unavailable", "Unlock secure storage, or enter a password for a single backup.");
    if (!this.record.passwordSet) throw backupError("backup_password_required", "Set a backup password, or enter one for a single backup.");
    try {
      const { result, shouldReEncrypt } = await this.secureStorage.decryptStringAsync(await readFile(this.secretPath()));
      if (shouldReEncrypt) await atomicWrite(this.secretPath(), await this.secureStorage.encryptStringAsync(result));
      return result;
    }
    catch { this.secureUnavailable = true; this.emit(); throw backupError("backup_secure_storage_unavailable", "Unlock secure storage or set the backup password again."); }
  }
  latestLocalBackup() { return this.record?.history.filter((item) => item.directory === this.record.config.directory).at(-1); }
  async tick(now = Date.now()) {
    if (!this.closed && !this.transitioning && this.record && !this.initializationError) this.offsite?.tick(this.latestLocalBackup(), this.record.config.retention);
    if (this.closed || this.transitioning || !this.record?.config.enabled || this.operation || this.checking) return;
    this.checking = true;
    const record = this.record; const generation = this.generation;
    try {
      const due = nextBackupAt(record.scheduleAnchorAt ?? record.lastSuccessAt, record.config.interval);
      if (record.nextDueAt !== due) await this.exclusive(async () => { if (generation === this.generation) await this.persist(); });
      if (generation !== this.generation || (due && Date.parse(due) > now) || (record.lastAttemptAt && Date.parse(record.lastAttemptAt) + 3600000 > now)) return;
      await this.run(undefined, record.backupSetId, now);
    } catch (error) {
      if (this.record && !this.transitioning && generation === this.generation) { this.record.error = errorInfo(error); await this.persist().catch(() => {}); this.emit(); }
    } finally { this.checking = false; }
  }

  configKey() { return JSON.stringify([this.record.config, this.record.passwordVersion ?? 0]); }
  async previousState() {
    const entry = this.record.history.at(-1);
    if (!entry?.sourceState || entry.configKey !== this.configKey() || entry.directory !== this.record.config.directory) return undefined;
    const folder = join(entry.directory, this.record.backupSetId);
    if (!await ownedDirectoriesExist([entry.directory, folder])) return undefined;
    const file = await lstat(join(folder, entry.name)).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    return file?.isFile() && !file.isSymbolicLink() && file.size === entry.size ? entry.sourceState : undefined;
  }
  async run(oncePassword, expected, scheduledAt, options) {
    return this.exclusive(async () => {
      this.assertReady(); this.assertScope(expected);
      if (scheduledAt !== undefined) {
        const due = nextBackupAt(this.record.scheduleAnchorAt ?? this.record.lastSuccessAt, this.record.config.interval);
        if (!this.record.config.enabled || this.operation || (due && Date.parse(due) > scheduledAt) || (this.record.lastAttemptAt && Date.parse(this.record.lastAttemptAt) + 3600000 > scheduledAt)) return this.status();
      }
      if (this.operation) throw backupError("backup_busy", "A backup or restore is already running.");
      if (this.record.pending) { await this.verifyPublication(oncePassword); return this.status(); }
      const generation = this.generation;
      const encrypted = options ? options.encrypted : this.record.config.encrypted;
      if (typeof encrypted !== "boolean") throw backupError("backup_invalid_configuration", "Choose a backup format.");
      const name = options ? backupFileName(options.name, encrypted) : `edgeever-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}-${randomUUID()}${encrypted ? ".edgeever.enc" : ".zip"}`;
      const root = this.record.config.directory;
      const folder = join(root, this.record.backupSetId);
      const finalPath = join(folder, name);
      if (options && await lstat(finalPath).catch((error) => { if (error.code === "ENOENT") return null; throw error; })) throw backupError("backup_name_exists", "A file with this name already exists. Choose another name.");
      const checkedAt = () => new Date(Math.max(Date.now(), scheduledAt ?? 0)).toISOString();
      try {
        await this.cleanStaging();
        this.record.lastAttemptAt = checkedAt(); this.record.lastCheck = { at: this.record.lastAttemptAt, result: "running" }; this.record.error = null;
        await this.persist();
        const password = await this.password(oncePassword, encrypted);
        const previousState = scheduledAt === undefined ? undefined : await this.previousState();
        await assertDirectory(root); await assertDirectory(folder);
        const path = join(folder, `${name}.${randomUUID()}.part`);
        this.record.activePart = { name: basename(path), directory: root }; await this.persist();
        if (generation !== this.generation) { await this.cleanStaging(); throw backupError("backup_cancelled", "Cancelled"); }
        const configKey = encrypted === this.record.config.encrypted && oncePassword === undefined ? this.configKey() : undefined;
        const operation = this.startWorker({ operation: "export", context: this.context, path, password, previousState, version: this.version }, { kind: "export", phase: previousState ? "checking-source" : "exporting", completed: 0, total: 0 });
        operation.finish = async (result) => {
          if (!operation.current()) return;
          if (result.skipped) {
            // The comparison file must still exist when the source check completes.
            if (!await this.previousState()) throw backupError("backup_file_required", "The previous backup is no longer available. Run a new backup.");
            if (!operation.current()) return;
            this.record.lastCheck = { at: checkedAt(), result: "unchanged" };
            this.record.scheduleAnchorAt = this.record.lastCheck.at;
            return;
          }
          const completedAt = new Date().toISOString();
          const entry = { name, directory: root, completedAt, size: result.size, encrypted, sourceState: result.sourceState, configKey, checkedAt: checkedAt() };
          if (!options) { this.record.pending = entry; await this.persist(); }
          if (!await ownedDirectoriesExist([root, folder])) throw backupError("backup_publication_unverified", "The backup directory changed before publication. Its files were preserved.");
          const file = await lstat(path);
          if (!file.isFile() || file.isSymbolicLink() || file.size !== result.size) throw backupError("backup_publication_unverified", "The backup file changed before publication.");
          if (options) { entry.publicationIdentity = { dev: file.dev, ino: file.ino }; this.record.pending = entry; await this.persist(); }
          if (!operation.current()) return;
          if (!await ownedDirectoriesExist([root, folder])) throw backupError("backup_publication_unverified", "The backup directory changed before publication.");
          if (options) {
            try { await link(path, finalPath); }
            catch (error) {
              delete this.record.pending; await this.persist();
              if (error.code === "EEXIST") throw backupError("backup_name_exists", "A file with this name already exists. Choose another name.");
              throw error;
            }
          } else await rename(path, finalPath);
          if (!operation.current()) return;
          const completed = await this.completePublication(entry, operation.current);
          if (!completed || !operation.current()) return;
          try { this.onSuccess(entry); } catch { /* Notifications do not change a completed backup. */ }
        };
        operation.cleanup = () => this.cleanStaging();
        this.emit(); return this.status();
      } catch (error) {
        if (generation === this.generation) {
          this.record.lastCheck = { at: checkedAt(), result: "failed" }; this.record.error = errorInfo(error);
          await this.persist().catch(() => {}); this.emit();
        }
        throw error;
      }
    });
  }
  startWorker(data, task) {
    const generation = this.generation;
    const worker = this.workerFactory(data);
    let resolve;
    const operation = { worker, importing: task.kind === "import", current: () => generation === this.generation && !operation.cancelled, settled: false, done: new Promise((r) => { resolve = r; }) };
    const errorKey = operation.importing ? "importError" : "error";
    const warningKey = operation.importing ? "importWarning" : "warning";
    this.operation = operation; this.task = task;
    const settle = (error, result) => {
      if (operation.settled) return; operation.settled = true;
      void this.exclusive(async () => {
        try {
          if (!error && operation.current()) await operation.finish?.(result);
          if (error && operation.current()) {
            this.record[errorKey] = errorInfo(error);
            if (!operation.importing) this.record.lastCheck = { at: new Date().toISOString(), result: "failed" };
          }
          if (!operation.importing && operation.cancelled && generation === this.generation) {
            this.record.lastCheck = { at: new Date().toISOString(), result: "cancelled" }; await this.persist();
          }
          if (operation.current()) { if (!error) this.record[errorKey] = null; await this.persist(); }
        } catch (failure) { if (operation.current()) { this.record[errorKey] = errorInfo(failure); if (!operation.importing) this.record.lastCheck = { at: new Date().toISOString(), result: "failed" }; await this.persist().catch(() => {}); } }
        finally {
          try { await operation.cleanup?.(); }
          catch { this.record[warningKey] = { code: operation.importing ? "backup_staging_cleanup_failed" : "backup_part_cleanup_failed" }; await this.persist().catch(() => {}); }
          if (this.operation === operation) { this.operation = null; this.task = null; this.emit(); }
          resolve();
        }
      });
    };
    worker.on("message", (message) => {
      if (message.type === "request-error" && this.operation === operation && operation.current()) {
        const detail = message.result;
        try {
          void Promise.resolve(this.onDiagnostic("backup.request-failed", {
            kind: task.kind, phase: this.task?.phase,
            method: sanitizeDesktopDiagnosticText(detail.method),
            path: sanitizeDesktopDiagnosticText(detail.path?.split(/[?#]/, 1)[0]),
            status: detail.status,
            code: sanitizeDesktopDiagnosticText(detail.code),
            message: sanitizeDesktopDiagnosticText(detail.message),
            ...(Array.isArray(detail.causeCodes) ? { causeCodes: detail.causeCodes.filter((code) => typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)).slice(0, 8) } : {}),
            ...(Number.isFinite(detail.elapsedMs) && detail.elapsedMs >= 0 ? { elapsedMs: detail.elapsedMs } : {}),
          })).catch(() => {});
        } catch { /* Diagnostic output must not change the task result. */ }
      }
      else if (message.type === "done") settle(null, message.result);
      else if (message.type === "error") settle(message.error);
      else if (operation.current() && message.type === "progress") { this.task = { ...this.task, ...message.result, phase: message.result.stage }; this.emit(); }
      else if (operation.current() && message.type === "ready") { this.task = { ...this.task, phase: "ready", manifest: message.result.manifest }; this.emit(); }
    });
    worker.on("error", (error) => settle(error));
    worker.on("exit", (code) => { if (!operation.settled) settle(backupError(operation.cancelled ? "backup_cancelled" : "backup_worker_failed", `Backup worker exited (${code}).`)); });
    return operation;
  }
  async waitForIdle() { await this.operation?.done; }
  async cancel() {
    const operation = this.operation; if (!operation) return;
    operation.cancelled = true; operation.worker.postMessage({ type: "cancel" });
    const timer = setTimeout(() => { void operation.worker.terminate?.(); }, 5000); timer.unref?.();
    await operation.done; clearTimeout(timer);
  }
  async completePublication(entry, isCurrent = () => true) {
    if (!isCurrent()) return false;
    const publishedPath = await realpath(join(entry.directory, this.record.backupSetId, entry.name));
    const history = [];
    for (const old of this.record.history) {
      if (old.directory === entry.directory) {
        if (old.name === entry.name) continue;
        const path = join(old.directory, this.record.backupSetId, old.name);
        const resolved = await lstat(path).then((info) => info.isFile() && !info.isSymbolicLink() ? realpath(path) : null).catch(() => null);
        if (resolved === publishedPath) continue;
      }
      history.push(old);
    }
    if (!isCurrent()) return false;
    const previous = { history: [...this.record.history], lastSuccessAt: this.record.lastSuccessAt, lastCheck: this.record.lastCheck, scheduleAnchorAt: this.record.scheduleAnchorAt, warning: this.record.warning };
    this.record.history = [...history, entry]; this.record.lastSuccessAt = entry.completedAt;
    this.record.lastCheck = { at: entry.checkedAt ?? entry.completedAt, result: "success" }; this.record.scheduleAnchorAt = this.record.lastCheck.at;
    delete this.record.pending; this.record.warning = null;
    try { await this.persist(); }
    catch (error) { Object.assign(this.record, previous, { pending: entry }); throw error; }
    if (!isCurrent()) {
      Object.assign(this.record, previous, { pending: entry }); await this.persist(); return false;
    }
    const entries = this.record.history.filter((item) => item.directory === entry.directory).reverse().sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    for (const old of entries.slice(this.record.config.retention)) {
      if (!isCurrent()) break;
      if (basename(old.name) !== old.name) { this.record.warning = { code: "backup_cleanup_failed" }; continue; }
      const path = join(old.directory, this.record.backupSetId, old.name);
      try {
        for (const folder of [old.directory, join(old.directory, this.record.backupSetId)]) { const metadata = await lstat(folder); if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw backupError("backup_cleanup_failed", "A directory was replaced."); }
        const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
        if (info && (!info.isFile() || info.isSymbolicLink())) throw backupError("backup_cleanup_failed", "A backup file was replaced. It was preserved.");
        if (!isCurrent()) break;
        await rm(path, { force: true }); this.record.history = this.record.history.filter((item) => item !== old);
      } catch { this.record.warning = { code: "backup_cleanup_failed" }; }
    }
    await this.persist();
    // Starts in the background; its result never changes this backup's status.
    if (isCurrent() && entry.directory === this.record.config.directory) this.offsite?.enqueue(entry, this.record.config.retention);
    return true;
  }
  async cleanStaging() {
    if (this.record.activePart) {
      const part = this.record.activePart;
      try {
        if (basename(part.name) === part.name && part.name.endsWith(".part")) {
          const folder = join(part.directory, this.record.backupSetId);
          if (await ownedDirectoriesExist([part.directory, folder])) {
            const path = join(folder, part.name);
            const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
            if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("The temporary backup file was replaced.");
            if (info) await rm(path);
          }
        }
      } catch { throw backupError("backup_part_cleanup_failed", "An unfinished backup file could not be removed. Check its directory permissions and try again."); }
      delete this.record.activePart; await this.persist();
    }
    if (this.record.stagingId) {
      const id = this.record.stagingId;
      try {
        const parent = join(this.userData, "scheduled-backups");
        const directory = join(parent, "staging", id);
        if (/^[a-f0-9-]{36}$/.test(id) && await ownedDirectoriesExist([parent, join(parent, "staging"), directory])) await rm(directory, { recursive: true });
      }
      catch { throw backupError("backup_staging_cleanup_failed", "Private temporary files could not be removed. Check permissions and try again."); }
      if (this.record.warning?.code === "backup_staging_cleanup_failed") this.record.warning = null;
      if (this.record.importWarning?.code === "backup_staging_cleanup_failed") this.record.importWarning = null;
      delete this.record.stagingId; await this.persist();
    }
  }
  async stagingDirectory() {
    await this.cleanStaging();
    const id = randomUUID();
    const parent = join(this.userData, "scheduled-backups", "staging"); await assertDirectory(parent, true);
    const path = join(parent, id);
    this.record.stagingId = id; await this.persist(); await assertDirectory(path, true); return path;
  }
  recoverPublication() { return this.exclusive(() => this.verifyPublication()); }
  async verifyPublication(oncePassword) {
    this.assertReady(); if (this.operation) return;
    const generation = this.generation;
    const pending = this.record.pending; if (!pending) return;
    const folder = join(pending.directory, this.record.backupSetId);
    const path = join(folder, pending.name);
    try {
      if (!await ownedDirectoriesExist([pending.directory, folder])) throw new Error("The backup directory is unavailable.");
    } catch {
      this.record.error = { code: "backup_publication_unverified", message: "The interrupted backup directory is unavailable or was replaced. Its files were preserved." };
      await this.persist(); this.emit(); return;
    }
    try {
      const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (!info) { await this.cleanStaging(); delete this.record.pending; this.record.error = null; await this.persist(); this.emit(); return; }
      if (!info.isFile() || info.isSymbolicLink() || info.size !== pending.size || (pending.publicationIdentity && (info.dev !== pending.publicationIdentity.dev || info.ino !== pending.publicationIdentity.ino))) { this.record.error = { code: "backup_publication_unverified", message: "An interrupted backup needs verification. Its file was preserved." }; await this.persist(); this.emit(); return; }
      const stagingDirectory = await this.stagingDirectory();
      const password = pending.encrypted ? await this.password(oncePassword, true) : undefined;
      if (generation !== this.generation) { await this.cleanStaging(); return; }
      const operation = this.startWorker({ operation: "verify", path, stagingDirectory, password, context: this.context }, { kind: "export", phase: "checking", completed: 0, total: 0 });
      operation.finish = () => this.completePublication(pending, operation.current);
      operation.cleanup = () => this.cleanStaging();
      this.emit();
    } catch (error) { this.record.error = errorInfo(error); await this.persist(); this.emit(); }
  }

  async historyPath(name, expected, allowMissing = false) {
    this.assertReady(); this.assertScope(expected);
    if (this.operation) throw backupError("backup_busy", "A task is already running.");
    const generation = this.generation;
    const entry = this.record.history.find((item) => item.name === name && item.directory === this.record.config.directory);
    if (!entry || basename(name) !== name) throw backupError("backup_file_required", "Choose a registered backup file.");
    const folder = join(entry.directory, this.record.backupSetId);
    if (!await ownedDirectoriesExist([entry.directory, folder])) throw backupError("backup_directory_invalid", "The backup directory is unavailable.");
    const path = join(folder, name);
    const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (info && (!info.isFile() || info.isSymbolicLink())) throw backupError("backup_file_replaced", "The backup file was replaced. It was preserved.");
    if (!info && !allowMissing) throw backupError("backup_file_required", "The backup file no longer exists.");
    if (generation !== this.generation) throw backupError("backup_account_changed", "The backup account changed.");
    return { path, entry, generation };
  }
  selectHistory(name, expected) {
    return this.exclusive(async () => {
      const { path } = await this.historyPath(name, expected);
      return this.selectImport(path);
    });
  }
  deleteHistory(name, expected) {
    return this.exclusive(async () => {
      const { path, entry, generation } = await this.historyPath(name, expected, true);
      await rm(path, { force: true });
      if (generation !== this.generation) throw backupError("backup_account_changed", "The backup account changed.");
      const previous = this.record.history;
      this.record.history = previous.filter((item) => item !== entry);
      try { await this.persist(); } catch (error) { this.record.history = previous; throw error; }
      if (this.selection?.path === path) this.selection = null;
      this.emit(); return this.status();
    });
  }
  async selectImport(path) {
    this.assertReady(); if (this.operation) throw backupError("backup_busy", "A task is already running.");
    const generation = this.generation;
    const file = await open(path, "r"); const magic = Buffer.alloc(4);
    try { await file.read(magic, 0, 4, 0); } finally { await file.close(); }
    if (generation !== this.generation) throw backupError("backup_account_changed", "The backup account changed.");
    this.selection = { id: randomUUID(), path, encrypted: magic.toString("ascii") === "EDGB" };
    return { id: this.selection.id, name: basename(path), encrypted: this.selection.encrypted };
  }
  async prepareImport(id, password) {
    return this.exclusive(async () => {
      this.assertReady(); if (this.operation) throw backupError("backup_busy", "A task is already running.");
      if (this.selection?.id !== id) throw backupError("backup_file_required", "Choose the backup file again.");
      const generation = this.generation;
      this.record.importError = null;
      const stagingDirectory = await this.stagingDirectory();
      if (generation !== this.generation) { await this.cleanStaging(); throw backupError("backup_cancelled", "Cancelled"); }
      const operation = this.startWorker({ operation: "import", context: this.context, path: this.selection.path, password, stagingDirectory }, { kind: "import", phase: "checking", completed: 0, total: 0 });
      operation.finish = async () => { this.record.lastRestoreAt = new Date().toISOString(); };
      operation.cleanup = () => this.cleanStaging();
      this.emit(); return this.status();
    });
  }
  confirmImport() {
    this.assertReady(); if (!this.operation || this.task?.kind !== "import" || this.task.phase !== "ready") throw backupError("backup_import_not_ready", "Wait for the archive check to finish.");
    this.task = { ...this.task, phase: "restoring" }; this.emit(); this.operation.worker.postMessage({ type: "confirm" });
  }
  saveOffsite(config, password, expected) {
    this.assertReady(); this.assertScope(expected);
    return this.offsite.save(config, password).then(() => this.status());
  }
  testOffsite(config, password, expected) { this.assertReady(); this.assertScope(expected); return this.offsite.test(config, password); }
  uploadOffsiteNow(expected) {
    this.assertReady(); this.assertScope(expected);
    const latest = this.latestLocalBackup();
    if (!latest) throw backupError("offsite_no_backup", "Run a local backup first.");
    if (!this.offsite.tick(latest, this.record.config.retention, { force: true }) && !this.offsite.upload) throw backupError("offsite_already_uploaded", "The latest backup is already copied.");
    return this.status();
  }
  async close() { this.closed = true; this.startupController?.abort(); ++this.generation; await this.offsite?.setScope(null); await this.cancel(); await this.queue; }
}
