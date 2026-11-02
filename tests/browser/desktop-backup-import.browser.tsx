// Open via Vite's /@fs/<checkout>/tests/browser/desktop-backup-import.html.
// Drive the real import/card UI through window.backupImportFixture controls.
import React from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import type { DesktopBackupStatus } from "../../packages/shared/src/backup";
import { zhCN } from "../../packages/shared/src/i18n/zh-CN";
import { DesktopScheduledBackupCard } from "../../apps/web/src/components/settings/DesktopScheduledBackupCard";
import "../../apps/web/src/styles/globals.css";

const i18n = i18next.createInstance();
await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: zhCN } }, interpolation: { escapeValue: false }, initAsync: false });
const status: DesktopBackupStatus = {
  config: { enabled: false, interval: "weekly", retention: 1, directory: "/test/Backups", encrypted: false },
  backupSetId: "fixture-backup-set", actualDirectory: "/test/Backups/fixture-backup-set", blocked: false,
  passwordSet: false, secureStorageAvailable: true, lastAttemptAt: null, lastSuccessAt: "2026-10-25T03:00:00.000Z",
  lastCheck: { at: "2026-10-26T03:00:00.000Z", result: "unchanged" }, lastRestoreAt: null, nextDueAt: null, pendingPublication: null, target: { baseUrl: "http://test-instance", accountId: "test-account" },
  task: null, error: null, warning: null, importError: null, importWarning: null, history: [
    { name: "周报归档.zip", directory: "/test/Backups", completedAt: "2026-10-24T03:00:00.000Z", size: 2301024, encrypted: false },
    { name: "EdgeEver-2026-10-25_110000.edgeever.enc", directory: "/test/Backups", completedAt: "2026-10-25T03:00:00.000Z", size: 4910204, encrypted: true },
  ],
};
const params = new URLSearchParams(location.search);
const legacyInterval = params.get("legacy-interval");
if (legacyInterval === "daily" || legacyInterval === "biweekly") status.config.interval = legacyInterval;
if (params.has("encrypted")) { status.config.encrypted = true; status.passwordSet = true; }
if (params.has("no-secure-storage")) status.secureStorageAvailable = false;
const calls: Array<{ action: string; input?: unknown }> = [];
const listeners = new Set<(status: DesktopBackupStatus) => void>();
const emit = () => { for (const listener of listeners) listener(structuredClone(status)); };
let encrypted = true;
let holdHandshake = false;
let runError = params.has("run-error");
let deleteError = false;
const saveError = new URLSearchParams(location.search).has("save-error");
let finish: (() => void) | undefined;
Object.defineProperty(window, "edgeeverDesktop", {
  configurable: true,
  value: {
    async backup(action: string, input?: unknown) {
      calls.push({ action, input });
      const value = input as { name?: string; config?: DesktopBackupStatus["config"]; password?: string; options?: { name: string; encrypted: boolean } } | undefined;
      if (action === "run") {
        if (runError) throw Object.assign(new Error("File exists"), { code: "backup_name_exists" });
        if (params.has("running")) {
          status.task = { kind: "export", phase: "exporting", completed: 2, total: 5 }; emit();
          return structuredClone(status);
        }
        const option = value!.options!; const at = new Date().toISOString();
        status.history.push({ name: option.name.replace(/(?:\.edgeever\.enc|\.zip)$/i, "") + (option.encrypted ? ".edgeever.enc" : ".zip"), directory: status.config.directory, completedAt: at, size: 149755, encrypted: option.encrypted });
        status.lastSuccessAt = at; status.lastCheck = { at, result: "success" }; emit();
      }
      if (action === "save" && saveError) throw Object.assign(new Error("Denied"), { code: "backup_directory_unavailable" });
      if (action === "choose-directory") return "/test/SelectedBackups";
      if (action === "save") { status.config = value!.config!; if (value?.password) status.passwordSet = true; emit(); }
      if (action === "delete-history") {
        if (deleteError) throw Object.assign(new Error("Denied"), { code: "EACCES" });
        status.history = status.history.filter((entry) => entry.name !== value?.name); emit();
      }
      if (action === "select-history") {
        const entry = status.history.find((entry) => entry.name === value?.name)!; encrypted = entry.encrypted;
        return { id: `selection:${entry.name}`, name: entry.name, encrypted };
      }
      if (action === "choose-import") return { id: "fixture-selection", name: encrypted ? "fixture.edgeever.enc" : "fixture.zip", encrypted };
      if (action === "prepare-import") {
        if (holdHandshake) await new Promise<void>((resolve) => { finish = resolve; });
        status.importError = null;
        status.task = { kind: "import", phase: encrypted ? "decrypting" : "checking", completed: 0, total: 0 };
        emit();
      }
      if (action === "cancel") { status.task = null; emit(); }
      if (action === "confirm-import" && status.task) { status.task.phase = "restoring"; emit(); }
      return structuredClone(status);
    },
    onBackupStatus: (listener: (status: DesktopBackupStatus) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  },
});
Object.assign(window, {
  backupImportFixture: {
    calls,
    runError: (value: boolean) => { runError = value; },
    deleteError: (value: boolean) => { deleteError = value; },
    check: (result: NonNullable<DesktopBackupStatus["lastCheck"]>["result"]) => { status.lastCheck = { at: new Date().toISOString(), result }; if (result === "failed") status.error = { code: "backup_source_changed" }; else status.error = null; emit(); },
    scope: () => { status.backupSetId = "new-account-set"; status.history = []; emit(); },
    status: () => structuredClone(status),
    hold: () => { holdHandshake = true; },
    finish: () => { holdHandshake = false; finish?.(); finish = undefined; },
    selectPlain: () => { encrypted = false; },
    backupError: () => { status.error = { code: "backup_source_changed" }; status.warning = { code: "backup_cleanup_failed" }; emit(); },
    fail: (code = "backup_decrypt_failed") => { status.importError = { code }; status.task = null; emit(); },
    failHttp: () => { status.importError = { code: "object_storage_unavailable", message: "Object storage initialization unavailable", status: 503 }; status.task = null; emit(); },
    ready: () => {
      status.task = { kind: "import", phase: "ready", completed: 1, total: 1, manifest: { format: "edgeever-zip", formatVersion: 2, schemaVersion: 73, edgeeverVersion: "test", buildId: "test", exportedAt: "2026-10-25T03:00:00.000Z", includesTrash: false, counts: { memos: 1, notebooks: 1, resources: 1, revisions: 1, prompts: 0 } } };
      emit();
    },
    done: () => { status.lastRestoreAt = new Date().toISOString(); status.task = null; emit(); },
    cleanupWarning: () => { status.importWarning = { code: "backup_staging_cleanup_failed" }; emit(); },
  },
});
createRoot(document.getElementById("fixture")!).render(
  <I18nextProvider i18n={i18n}>
    <section id="backup-and-restore"><DesktopScheduledBackupCard /></section>
  </I18nextProvider>,
);
