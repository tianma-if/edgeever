import { useCallback, useSyncExternalStore } from "react";

const changedEvent = "edgeever:memo-reading-style-changed";
// Keep the original key so the old combined choice is available on upgrade.
const storageKey = (scope: string, memoId: string) =>
  `edgeever.memo-magazine-cover.${encodeURIComponent(scope)}:${encodeURIComponent(memoId)}`;

type MemoReadingStyle = {
  showMagazineCover: boolean;
  showChapterNavigation: boolean;
};

const readReadingStyle = (value: string | null): MemoReadingStyle => ({
  showMagazineCover: value === "true" || value === "cover",
  showChapterNavigation: value === "true" || value === "navigation",
});

const readStoredValue = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStoredValue = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: key }));
  return true;
};

export const updateMemoReadingStyle = (scope: string, memoId: string, patch: Partial<MemoReadingStyle>) => {
  const key = storageKey(scope, memoId);
  const { showMagazineCover, showChapterNavigation } = { ...readReadingStyle(readStoredValue(key)), ...patch };
  if (showMagazineCover === showChapterNavigation) return writeStoredValue(key, String(showMagazineCover));
  return writeStoredValue(key, showMagazineCover ? "cover" : "navigation");
};

export const remapMemoReadingStyle = (scope: string, temporaryId: string, remoteId: string) => {
  if (temporaryId === remoteId) return;
  const previousKey = storageKey(scope, temporaryId);
  const previous = readStoredValue(previousKey);
  if (previous === null) return;

  const nextKey = storageKey(scope, remoteId);
  if (readStoredValue(nextKey) === null && !writeStoredValue(nextKey, previous)) return;
  try {
    window.localStorage.removeItem(previousKey);
  } catch {
    // A later remap can retry cleanup without replacing the durable choice.
  }
};

export const useMemoReadingStyle = (scope: string, memoId: string | undefined) => {
  const key = memoId ? storageKey(scope, memoId) : null;
  const subscribe = useCallback((onChange: () => void) => {
    if (!key) return () => {};
    const onLocalChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) onChange();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) onChange();
    };
    window.addEventListener(changedEvent, onLocalChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(changedEvent, onLocalChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);
  const value = useSyncExternalStore(subscribe, () => key === null ? null : readStoredValue(key), () => null);
  return readReadingStyle(value);
};
