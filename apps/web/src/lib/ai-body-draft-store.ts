import Dexie, { type Table } from "dexie";
import type { AiTargetLanguage } from "@edgeever/shared";
import type { AiDraftIncompleteReason } from "@edgeever/shared/ai-generation";

/**
 * The latest generated, not yet applied AI body draft of one note on this device (#652 PR B).
 *
 * Kept in its own small IndexedDB database so the main local database (`edgeever-local`) keeps
 * its schema version: an older app version can still open it after this one ran.
 * The scope (`instance|user`) is the workspace on this device, so a draft never shows up for
 * another instance or account.
 */
export type AiBodyDraftAction = "translate" | "improve-writing";

/** Where a draft applies, recorded when it was generated. */
export type AiBodyDraftTarget =
  | { kind: "note"; sourceHash: string }
  | {
    kind: "selection";
    text: string;
    from: number;
    to: number;
    isInline: boolean;
    mode: "rich" | "markdown";
    /** Hash of the whole document (rich-text JSON or Markdown source) when the selection was made. */
    documentHash: string;
  };

export type AiBodyDraftRecord = {
  scope: string;
  memoId: string;
  action: AiBodyDraftAction;
  /** What the user asked, shown as the request in the sidebar conversation. */
  message: string;
  targetLanguage?: AiTargetLanguage;
  instruction?: string;
  source: string;
  text: string;
  incomplete: AiDraftIncompleteReason | null;
  incompleteParts: number[];
  target: AiBodyDraftTarget;
  createdAt: string;
};

class AiDraftDb extends Dexie {
  drafts!: Table<AiBodyDraftRecord, [string, string]>;

  constructor() {
    super("edgeever-ai-drafts");
    this.version(1).stores({ drafts: "[scope+memoId], scope, createdAt" });
  }
}

let database: AiDraftDb | null = null;
const db = () => {
  database ??= new AiDraftDb();
  return database;
};

/** Storage can be unavailable (private mode, blocked site data); drafts are then not kept. */
const tolerate = async <T,>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

export const loadAiBodyDraft = (scope: string, memoId: string) =>
  tolerate(async () => (await db().drafts.get([scope, memoId])) ?? null, null);

export const saveAiBodyDraft = (record: AiBodyDraftRecord) =>
  tolerate(async () => { await db().drafts.put(record); return true; }, false);

export const clearAiBodyDraft = (scope: string, memoId: string) =>
  tolerate(async () => { await db().drafts.delete([scope, memoId]); return true; }, false);

export const clearAiBodyDraftScope = (scope: string) =>
  tolerate(async () => { await db().drafts.where("scope").equals(scope).delete(); return true; }, false);

/** A short, stable hash for noticing that the source changed (FNV-1a over UTF-16 units). */
export const hashAiDraftSource = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${value.length.toString(36)}-${hash.toString(36)}`;
};

export type AiDraftSelectionSnapshot = Omit<Extract<AiBodyDraftTarget, { kind: "selection" }>, "kind">;

/** What the sidebar may do to the open note; provided by the editor pane (#652 PR B). */
export type AiDraftEditorApi = {
  /** The note body as AI sees it, in every editor mode. */
  noteMarkdown(): string;
  replaceNote(markdown: string): boolean;
  appendToNote(markdown: string): boolean;
  /** `false` when the text at the snapshot changed since it was taken. */
  replaceSelection(snapshot: AiDraftSelectionSnapshot, markdown: string): boolean;
  insertAfterSelection(snapshot: AiDraftSelectionSnapshot, markdown: string): boolean;
  /** The selection in the editor right now, to confirm a new target. */
  currentSelection(): AiDraftSelectionSnapshot | null;
};

/** Body drafts being generated in this window; signing out cancels them so none is saved after. */
const activeRuns = new Set<AbortController>();

export const trackAiBodyDraftRun = (controller: AbortController) => {
  activeRuns.add(controller);
  return () => { activeRuns.delete(controller); };
};

export const cancelAiBodyDraftRuns = () => {
  for (const controller of activeRuns) controller.abort();
  activeRuns.clear();
};

/** On sign-out: stop drafts being generated, then remove this account's drafts on this instance. */
export const discardAiBodyDraftsForSignOut = async (scope: string) => {
  cancelAiBodyDraftRuns();
  await clearAiBodyDraftScope(scope);
};
