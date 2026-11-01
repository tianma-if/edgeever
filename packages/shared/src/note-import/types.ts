import type { MemoDetail } from "../types";

export type ImportFormat = "evernote" | "obsidian" | "joplin";
export type ImportFile = { path: string; file: File; expandArchive?: boolean };
export type ImportIssue = { key: string; severity: "error" | "warning"; code: string; path: string; detail?: string };
export type SourceEntry = { key: string; path: string; size: number; fileIndex: number; archivePath?: string; offset?: number };
export type ImportNotebook = { key: string; name: string; parentKey: string | null };
export type ImportReference = { start: number; end: number; href: string; label: string; image: boolean; wiki: boolean; resourceKey?: string; suffix?: string; targetOnly?: boolean };
export type ImportResource = { key: string; filename: string; mimeType: string; byteSize: number; entryKey?: string; enex?: boolean; hash?: string; chunks?: number };
export type ImportNote = {
  key: string; path: string; notebookKey: string; title: string; tags: string[];
  createdAt?: string; updatedAt?: string; entryKey: string; ordinal?: number;
  resources: ImportResource[]; references?: ImportReference[]; raw?: boolean;
};
export type ImportDocument = { note: ImportNote; contentMarkdown: string; enml?: string };
export type ImportSummary = { id: string; format: ImportFormat; notebooks: number; notes: number; resources: number; errors: number; warnings: number };
export type ImportKind = "entry" | "alias" | "note" | "notebook" | "issue" | "raw" | "rawTag" | "rawBinary" | "chunk" | "result" | "folderResult";
export interface ImportIndex {
  put<T>(kind: ImportKind, key: string, value: T): Promise<void>;
  get<T>(kind: ImportKind, key: string): Promise<T | undefined>;
  page<T>(kind: ImportKind, offset?: number, limit?: number): Promise<T[]>;
  count(kind: ImportKind): Promise<number>;
  remove(kind: ImportKind, key: string): Promise<void>;
  clearKind(kind: ImportKind): Promise<void>;
  clear(): Promise<void>;
}
export interface ImportReader {
  id: string; format: ImportFormat; index: ImportIndex;
  readNote(key: string, signal?: AbortSignal): Promise<ImportDocument>;
  readResourcePart(resource: ImportResource, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  releaseNote(note: ImportNote): Promise<void>;
  finishReading?(): Promise<void>;
}
export type ImportMemosInput = {
  importId: string; format: ImportFormat; notebookId: string; dryRun?: boolean;
  items: Array<{ externalId: string; title?: string; contentMarkdown?: string; tags?: string[]; createdAt?: string; updatedAt?: string }>;
};
export type ImportMemosResponse = {
  created: number; skipped: number; failed: number; wouldCreate: number;
  results: Array<{ externalId: string; status: "created" | "skipped" | "failed" | "would_create"; memo?: MemoDetail | null; error?: string }>;
};
export type ImportNoteResult = {
  key: string; path: string; memo: Pick<MemoDetail, "id" | "notebookId" | "revision" | "contentHash" | "createdAt" | "updatedAt">; urls: Record<string, string>;
  complete: boolean; error?: string; uncertain?: boolean; intendedMarkdown?: string;
};
export type ImportRunResult = { completed: number; failed: number; resources: number; cancelled: boolean; syncPending: boolean; failure?: { key: string; path: string; message: string; uncertain: boolean } };
export const IMPORT_CHUNK_BYTES = 64 * 1024;
