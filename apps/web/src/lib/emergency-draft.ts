import type { LocalDraft } from "@/lib/local-db";

const EMERGENCY_DRAFT_PREFIX = "edgeever.emergency-draft.";

const getStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const storageKey = (memoId: string) => `${EMERGENCY_DRAFT_PREFIX}${memoId}`;

export const persistEmergencyDraft = (draft: LocalDraft, storage: Storage | null = getStorage()) => {
  try {
    storage?.setItem(storageKey(draft.memoId), JSON.stringify(draft));
    return Boolean(storage);
  } catch {
    return false;
  }
};

export const readEmergencyDraft = (memoId: string, storage: Storage | null = getStorage()): LocalDraft | null => {
  try {
    const value = storage?.getItem(storageKey(memoId));
    if (!value) return null;
    const draft = JSON.parse(value) as Partial<LocalDraft>;
    if (
      draft.memoId !== memoId ||
      typeof draft.title !== "string" ||
      typeof draft.tagsText !== "string" ||
      typeof draft.updatedAt !== "string" ||
      !draft.contentJson ||
      typeof draft.contentJson !== "object"
    ) {
      return null;
    }
    return draft as LocalDraft;
  } catch {
    return null;
  }
};

export const removeEmergencyDraft = (memoId: string, storage: Storage | null = getStorage()) => {
  try {
    storage?.removeItem(storageKey(memoId));
  } catch {
    // A failed cleanup must not make an already durable save fail.
  }
};
