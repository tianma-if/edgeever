import { useCallback, useSyncExternalStore } from "react";

const changedEvent = "edgeever:memo-magazine-cover-changed";
const storageKey = (scope: string, memoId: string) =>
  `edgeever.memo-magazine-cover.${encodeURIComponent(scope)}:${encodeURIComponent(memoId)}`;

const readStoredValue = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeMemoMagazineCover = (scope: string, memoId: string, enabled: boolean) => {
  const key = storageKey(scope, memoId);
  try {
    window.localStorage.setItem(key, String(enabled));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: key }));
  return true;
};

export const remapMemoMagazineCover = (scope: string, temporaryId: string, remoteId: string) => {
  if (temporaryId === remoteId) return;
  const previousKey = storageKey(scope, temporaryId);
  const previous = readStoredValue(previousKey);
  if (previous === null) return;

  const nextKey = storageKey(scope, remoteId);
  if (readStoredValue(nextKey) === null && !writeMemoMagazineCover(scope, remoteId, previous === "true")) return;
  try {
    window.localStorage.removeItem(previousKey);
  } catch {
    // A later remap can retry cleanup without replacing the durable choice.
  }
};

export const useMemoMagazineCover = (scope: string, memoId: string | undefined) => {
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
  return useSyncExternalStore(subscribe, () => key !== null && readStoredValue(key) === "true", () => false);
};
