import type { ImportDocument, ImportFile, ImportFormat, ImportIndex, ImportNote, ImportReader, ImportResource, ImportSummary } from "@edgeever/shared/note-import/types";

export class BrowserImportReader implements ImportReader {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private number = 0;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  private closed = false;
  private failure?: Error;
  private closing?: Promise<void>;
  constructor(readonly id: string, readonly format: ImportFormat, readonly index: ImportIndex, private progress: (path: string) => void) {
    this.worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) { this.progress(data.progress); return; }
      const request = this.pending.get(data.requestId);
      if (!request) return;
      this.pending.delete(data.requestId);
      if (data.error) { const error = new Error(data.error.message); error.name = data.error.name; request.reject(error); }
      else request.resolve(data.result);
    };
    this.worker.onerror = event => {
      const error = new Error(event.message || "importWorkerFailed");
      this.failure = error;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
  }
  private request<T>(method: string, args?: unknown): Promise<T> {
    if (this.closed && method !== "close") return Promise.reject(new Error("importClosed"));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<T>((resolve, reject) => {
      const requestId = ++this.number;
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject });
      this.worker.postMessage({ requestId, method, args });
    });
  }
  scan(files: ImportFile[]) { return this.request<ImportSummary>("scan", { id: this.id, format: this.format, files }); }
  reset() { return this.request<void>("reset"); }
  abort() { if (!this.closed) this.worker.postMessage({ method: "abort" }); }
  readNote(key: string) { return this.request<ImportDocument>("note", key); }
  readResourcePart(resource: ImportResource, start: number, end: number) { return this.request<Uint8Array<ArrayBuffer>>("part", { resource, start, end }); }
  releaseNote(note: ImportNote) { return this.request<void>("release", note); }
  finishReading() { return this.request<void>("finish"); }
  close() {
    if (this.closing) return this.closing;
    if (this.closed) return Promise.resolve();
    this.abort();
    this.closed = true;
    this.closing = (async () => {
      try { if (!this.failure) await this.request("close"); }
      finally { this.worker.terminate(); await this.index.clear(); }
    })();
    return this.closing;
  }
}
