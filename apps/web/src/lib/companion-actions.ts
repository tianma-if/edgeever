import { ApiRequestError } from "./api";
import { isBrowserOffline } from "./network-status";

export async function assertCompanionChangesSynced(scope: string) {
  if (isBrowserOffline()) throw new ApiRequestError("Connect and sync notes before applying a suggestion.", 409, "companion_action_unsynced");
  if (window.edgeeverDesktop?.isAvailable) {
    const { getDesktopSyncSummary } = await import("./desktop-sync");
    if ((await getDesktopSyncSummary()).total > 0) throw new ApiRequestError("Sync local changes first.", 409, "companion_action_unsynced");
  } else {
    const { localDb } = await import("./local-db");
    const queued = await localDb.syncQueue.toArray();
    if (queued.some(item => !item.scope || item.scope === scope)) throw new ApiRequestError("Sync local changes first.", 409, "companion_action_unsynced");
  }
}
