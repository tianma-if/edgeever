export const RENDERER_RECOVERY_STORAGE_KEY = "edgeever.renderer-recovery-required";

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const getBrowserStorage = (): RecoveryStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const isRendererRecoveryRequired = (storage: RecoveryStorage | null = getBrowserStorage()) => {
  try {
    return storage?.getItem(RENDERER_RECOVERY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export const markRendererRecoveryRequired = (storage: RecoveryStorage | null = getBrowserStorage()) => {
  try {
    storage?.setItem(RENDERER_RECOVERY_STORAGE_KEY, "1");
  } catch {
    // Recovery must never turn a renderer failure into another failure.
  }
};

export const clearRendererRecoveryRequired = (storage: RecoveryStorage | null = getBrowserStorage()) => {
  try {
    storage?.removeItem(RENDERER_RECOVERY_STORAGE_KEY);
  } catch {
    // Restricted storage should not prevent the user from opening another note.
  }
};
