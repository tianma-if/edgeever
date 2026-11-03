import type { Notebook } from "@edgeever/shared";
import type { ImportFile, ImportFormat, ImportIssue, ImportNotebook, ImportNoteResult, ImportRunResult, ImportSummary } from "@edgeever/shared/note-import/types";
import type { ImportProgress } from "./execute";
import type { BrowserImportReader } from "./browser-reader";
import { api, createNoteImportClient } from "../api";

export type NoteImportSnapshot = {
  open: boolean; phase: "idle" | "scanning" | "ready" | "running" | "finished";
  format: ImportFormat; summary?: ImportSummary; error?: string;
  progress?: ImportProgress; scanningPath?: string; parentId: string;
  folders: ImportNotebook[]; issues: ImportIssue[]; results: ImportNoteResult[];
  destinations: Notebook[]; resultCount: number; outcome?: ImportRunResult;
};
export class NoteImportController {
  private snapshot: NoteImportSnapshot = { open: false, phase: "idle", format: "evernote", parentId: "", folders: [], issues: [], results: [], resultCount: 0, destinations: [] };
  private listeners = new Set<() => void>();
  private reader?: BrowserImportReader;
  private abort?: AbortController;
  private work: Promise<void> = Promise.resolve();
  private active = true;
  private generation = 0;
  constructor(readonly accountId: string | null, readonly target: string, private label: () => string, private refresh: () => Promise<void>) {}
  get accountLabel() { return this.label(); }
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<NoteImportSnapshot>) {
    if (!this.active) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate = () => { this.active = true; };
  open = () => {
    this.update({ open: true });
    void api.listNotebooks().then(({ notebooks }) => this.update({ destinations: notebooks })).catch(() => {});
  };
  setFormat = (format: ImportFormat) => { if (this.snapshot.phase === "idle") this.update({ format }); };
  setParent = (parentId: string) => { if (this.snapshot.phase === "ready") this.update({ parentId }); };
  select = (files: ImportFile[]) => {
    if (!files.length || this.snapshot.phase === "running" || this.snapshot.phase === "scanning") return;
    const generation = ++this.generation;
    const isCurrent = () => this.active && generation === this.generation;
    this.update({ phase: "scanning", error: undefined, summary: undefined, folders: [], issues: [], results: [], outcome: undefined, scanningPath: "", parentId: "" });
    this.work = (async () => {
      await this.reader?.close();
      if (!isCurrent()) return;
      this.reader = undefined;
      const [{ BrowserImportReader }, { BrowserImportIndex }] = await Promise.all([import("./browser-reader"), import("./browser-index")]);
      if (!this.active || generation !== this.generation) return;
      const id = crypto.randomUUID();
      const reader = new BrowserImportReader(id, this.snapshot.format, new BrowserImportIndex(id), path => { if (isCurrent()) this.update({ scanningPath: path }); });
      this.reader = reader;
      try {
        const summary = await reader.scan(files);
        if (!isCurrent()) return;
        const [folders, issues] = await Promise.all([reader.index.page<ImportNotebook>("notebook", 0, 30), reader.index.page<ImportIssue>("issue", 0, 20)]);
        if (isCurrent()) this.update({ phase: "ready", summary, folders, issues });
      } catch (error) {
        if (!isCurrent()) return;
        this.update({ phase: "idle", error: error instanceof Error && error.name === "AbortError" ? undefined : String(error instanceof Error ? error.message : error) });
        await reader.close();
        if (isCurrent()) this.reader = undefined;
      }
    })().catch(error => { if (isCurrent()) this.update({ phase: "idle", error: String(error) }); });
  };
  more = async (kind: "notebook" | "issue" | "result") => {
    const reader = this.reader, generation = this.generation;
    if (!reader || !this.active) return;
    const isCurrent = () => this.active && generation === this.generation && reader === this.reader;
    if (kind === "notebook") {
      const offset = this.snapshot.folders.length;
      const folders = await reader.index.page<ImportNotebook>(kind, offset, 30);
      if (isCurrent() && this.snapshot.folders.length === offset) this.update({ folders: [...this.snapshot.folders, ...folders] });
    }
    if (kind === "issue") {
      const offset = this.snapshot.issues.length;
      const issues = await reader.index.page<ImportIssue>(kind, offset, 20);
      if (isCurrent() && this.snapshot.issues.length === offset) this.update({ issues: [...this.snapshot.issues, ...issues] });
    }
    if (kind === "result") {
      const offset = this.snapshot.results.length;
      const results = await reader.index.page<ImportNoteResult>(kind, offset, 20);
      if (isCurrent() && this.snapshot.results.length === offset) this.update({ results: [...this.snapshot.results, ...results] });
    }
  };
  run = () => {
    if (!this.reader || !this.snapshot.summary?.notes || this.snapshot.summary.errors || !["ready", "finished"].includes(this.snapshot.phase)) return;
    const reader = this.reader;
    const generation = this.generation;
    this.abort = new AbortController();
    const abort = this.abort;
    const isCurrent = () => this.active && generation === this.generation;
    this.update({ phase: "running", error: undefined, progress: undefined });
    this.work = (async () => {
      try {
        await reader.reset();
        if (!isCurrent()) return;
        const [{ executeNoteImport }, { convertImportEnml }] = await Promise.all([import("./execute"), import("./enml")]);
        const outcome = await executeNoteImport({
          reader, index: reader.index,
          client: createNoteImportClient(abort.signal, this.accountId, isCurrent),
          parentId: this.snapshot.parentId || null, signal: abort.signal, convertEnml: convertImportEnml,
          pauseSync: window.edgeeverDesktop?.isAvailable ? async () => (await import("../desktop-sync")).pauseDesktopSyncForImport() : undefined,
          refresh: async () => { if (isCurrent()) await this.refresh(); },
          onProgress: progress => { if (isCurrent()) this.update({ progress }); },
        });
        const results = await reader.index.page<ImportNoteResult>("result", 0, 20), resultCount = await reader.index.count("result");
        if (isCurrent()) this.update({ phase: "finished", outcome, results, resultCount });
      } catch (error) {
        const code = typeof error === "object" && error && "status" in error && error.status === 404 && !this.snapshot.progress ? "unsupportedImportServer" : error instanceof Error ? error.message : String(error);
        if (!isCurrent()) return;
        const results = await reader.index.page<ImportNoteResult>("result", 0, 20), resultCount = await reader.index.count("result");
        if (isCurrent()) this.update({ phase: "finished", error: code, results, resultCount });
      }
    })();
  };
  cancel = () => {
    this.abort?.abort(); this.reader?.abort();
    if (this.snapshot.phase !== "scanning") return;
    const generation = ++this.generation;
    const reader = this.reader;
    this.reader = undefined;
    this.update({ phase: "idle", summary: undefined, scanningPath: "", folders: [], issues: [], error: undefined });
    this.work = this.work.then(() => reader?.close()).catch(error => {
      if (generation === this.generation) this.update({ error: String(error) });
    });
  };
  hide = () => { this.update({ open: false }); };
  dismiss = () => {
    if (this.snapshot.phase === "running") { this.update({ open: false }); return; }
    this.cancel();
    const generation = ++this.generation;
    const reader = this.reader;
    this.reader = undefined;
    this.update({ open: false, phase: "idle", summary: undefined, outcome: undefined, results: [], issues: [], folders: [], error: undefined });
    void this.work.then(() => reader?.close()).catch(error => {
      if (generation === this.generation) this.update({ error: String(error) });
    });
  };
  restart = async () => {
    await this.work;
    await this.reader?.close(); this.reader = undefined;
    this.generation++;
    this.update({ phase: "idle", open: true, summary: undefined, error: undefined, outcome: undefined, progress: undefined, results: [], issues: [], folders: [], parentId: "" });
  };
  dispose = () => {
    this.active = false; this.generation++;
    this.cancel();
    void this.work.finally(() => this.reader?.close()).catch(() => {});
  };
}
